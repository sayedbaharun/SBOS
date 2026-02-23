/**
 * Entity Linker
 *
 * Extracts entity relationships from agent conversations and stores them
 * in the entity_relations table. Fire-and-forget after every conversation.
 *
 * Uses cheap LLM (GPT-4o-mini) for extraction.
 */

import { eq, and, or, sql } from "drizzle-orm";
import { logger } from "../logger";
import * as modelManager from "../model-manager";
import { entityRelations } from "@shared/schema";

const EXTRACTION_MODEL = "openai/gpt-4o-mini";

// Lazy DB
let db: any = null;
async function getDb() {
  if (!db) {
    const { storage } = await import("../storage");
    db = (storage as any).db;
  }
  return db;
}

const ENTITY_EXTRACTION_PROMPT = `You are an entity relationship extraction engine. Given a conversation, extract entity relationships.

Extract ONLY clear, factual relationships. Skip vague or uncertain connections.

Relationship types:
- works_at: person → organization
- works_on: person/team → project/product
- collaborates_with: person → person
- part_of: entity → larger entity
- related_to: general association
- depends_on: entity → entity it depends on
- owns: person/org → asset/product
- mentions: entity → referenced entity
- influenced_by: entity → influencing entity

Return JSON only:
{
  "relations": [
    {
      "source": "Sayed",
      "sourceType": "person",
      "target": "SB-OS",
      "targetType": "product",
      "relation": "works_on",
      "context": "building the personal OS"
    }
  ]
}

If no clear relationships, return: { "relations": [] }`;

interface ExtractedRelation {
  source: string;
  sourceType?: string;
  target: string;
  targetType?: string;
  relation: string;
  context?: string;
}

/**
 * Extract and store entity relationships from a conversation.
 * Designed to be called fire-and-forget.
 */
export async function extractEntityRelations(params: {
  userMessage: string;
  assistantResponse: string;
}): Promise<void> {
  const { userMessage, assistantResponse } = params;

  // Skip trivial exchanges
  const combined = userMessage + assistantResponse;
  if (combined.length < 150) return;

  try {
    const { response } = await modelManager.chatCompletion(
      {
        messages: [
          { role: "system", content: ENTITY_EXTRACTION_PROMPT },
          {
            role: "user",
            content: `User message:\n${userMessage.slice(0, 2000)}\n\nAssistant response:\n${assistantResponse.slice(0, 2000)}`,
          },
        ],
        temperature: 0.1,
        max_tokens: 800,
        response_format: { type: "json_object" },
      },
      "simple",
      EXTRACTION_MODEL
    );

    const content = response.choices[0]?.message?.content;
    if (!content) return;

    let parsed: { relations: ExtractedRelation[] };
    try {
      parsed = JSON.parse(content);
    } catch {
      return;
    }

    if (!parsed.relations || parsed.relations.length === 0) return;

    const database = await getDb();
    const validRelationTypes = [
      "works_at", "works_on", "collaborates_with", "part_of",
      "related_to", "depends_on", "owns", "mentions", "influenced_by",
    ];

    for (const rel of parsed.relations) {
      if (!rel.source || !rel.target || !validRelationTypes.includes(rel.relation)) {
        continue;
      }

      // Upsert: update if exists, insert if not
      const existing = await database
        .select()
        .from(entityRelations)
        .where(
          and(
            eq(entityRelations.sourceName, rel.source),
            eq(entityRelations.targetName, rel.target),
            eq(entityRelations.relationType, rel.relation as any)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        // Update: increment mention count, update lastSeen
        await database
          .update(entityRelations)
          .set({
            mentionCount: sql`${entityRelations.mentionCount} + 1`,
            lastSeen: new Date(),
            strength: Math.min(1, (existing[0].strength || 0.5) + 0.05),
            context: rel.context || existing[0].context,
          })
          .where(eq(entityRelations.id, existing[0].id));
      } else {
        // Insert new relation
        await database.insert(entityRelations).values({
          sourceName: rel.source,
          sourceType: rel.sourceType || null,
          targetName: rel.target,
          targetType: rel.targetType || null,
          relationType: rel.relation as any,
          strength: 0.5,
          context: rel.context || null,
        });
      }
    }

    logger.info(
      { relationCount: parsed.relations.length },
      "Entity relations extracted"
    );
  } catch (error: any) {
    logger.warn(
      { error: error.message },
      "Entity relation extraction failed (non-critical)"
    );
  }
}

/**
 * Get entities related to a given entity (1-hop)
 */
export async function getRelatedEntities(
  entityName: string
): Promise<Array<{
  name: string;
  type: string | null;
  relation: string;
  direction: "outgoing" | "incoming";
  strength: number | null;
  mentionCount: number | null;
}>> {
  const database = await getDb();
  const nameLower = entityName.toLowerCase();

  const relations = await database
    .select()
    .from(entityRelations)
    .where(
      or(
        sql`lower(${entityRelations.sourceName}) = ${nameLower}`,
        sql`lower(${entityRelations.targetName}) = ${nameLower}`
      )
    );

  return relations.map((r: any) => {
    const isSource = r.sourceName.toLowerCase() === nameLower;
    return {
      name: isSource ? r.targetName : r.sourceName,
      type: isSource ? r.targetType : r.sourceType,
      relation: r.relationType,
      direction: isSource ? "outgoing" as const : "incoming" as const,
      strength: r.strength,
      mentionCount: r.mentionCount,
    };
  });
}

/**
 * Get entity neighborhood with multi-hop traversal using recursive CTE
 */
export async function getEntityNeighborhood(
  entityName: string,
  maxHops: number = 2
): Promise<Array<{
  name: string;
  type: string | null;
  relation: string;
  hop: number;
  via: string | null;
}>> {
  const database = await getDb();
  const nameLower = entityName.toLowerCase();
  const clampedHops = Math.min(Math.max(maxHops, 1), 3);

  // Use recursive CTE for multi-hop traversal
  const result = await database.execute(sql`
    WITH RECURSIVE neighborhood AS (
      -- Base case: direct connections (hop 1)
      SELECT
        CASE
          WHEN lower(source_name) = ${nameLower} THEN target_name
          ELSE source_name
        END AS name,
        CASE
          WHEN lower(source_name) = ${nameLower} THEN target_type
          ELSE source_type
        END AS type,
        relation_type AS relation,
        1 AS hop,
        NULL::text AS via
      FROM entity_relations
      WHERE lower(source_name) = ${nameLower} OR lower(target_name) = ${nameLower}

      UNION

      -- Recursive case: hop N+1
      SELECT
        CASE
          WHEN lower(er.source_name) = lower(n.name) THEN er.target_name
          ELSE er.source_name
        END AS name,
        CASE
          WHEN lower(er.source_name) = lower(n.name) THEN er.target_type
          ELSE er.source_type
        END AS type,
        er.relation_type AS relation,
        n.hop + 1 AS hop,
        n.name AS via
      FROM entity_relations er
      JOIN neighborhood n ON (
        lower(er.source_name) = lower(n.name) OR lower(er.target_name) = lower(n.name)
      )
      WHERE n.hop < ${clampedHops}
        AND lower(CASE
          WHEN lower(er.source_name) = lower(n.name) THEN er.target_name
          ELSE er.source_name
        END) != ${nameLower}
    )
    SELECT DISTINCT ON (name) name, type, relation, hop, via
    FROM neighborhood
    ORDER BY name, hop
    LIMIT 50
  `);

  return (result.rows || result) as any[];
}

/**
 * Search entities by name with their relations
 */
export async function searchEntitiesWithRelations(
  query: string,
  limit: number = 10
): Promise<Array<{
  name: string;
  type: string | null;
  relations: Array<{
    relatedEntity: string;
    relation: string;
    direction: "outgoing" | "incoming";
  }>;
}>> {
  const database = await getDb();
  const queryLower = `%${query.toLowerCase()}%`;

  // Find matching entities (both as source and target)
  const matches = await database.execute(sql`
    SELECT DISTINCT entity_name, entity_type FROM (
      SELECT source_name AS entity_name, source_type AS entity_type
      FROM entity_relations
      WHERE lower(source_name) LIKE ${queryLower}
      UNION
      SELECT target_name AS entity_name, target_type AS entity_type
      FROM entity_relations
      WHERE lower(target_name) LIKE ${queryLower}
    ) entities
    LIMIT ${limit}
  `);

  const entities = (matches.rows || matches) as Array<{
    entity_name: string;
    entity_type: string | null;
  }>;

  const results = [];
  for (const entity of entities) {
    const rels = await getRelatedEntities(entity.entity_name);
    results.push({
      name: entity.entity_name,
      type: entity.entity_type,
      relations: rels.map((r) => ({
        relatedEntity: r.name,
        relation: r.relation,
        direction: r.direction,
      })),
    });
  }

  return results;
}
