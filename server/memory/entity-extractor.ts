/**
 * Entity Extractor — Auto-extract people, orgs, and relationships
 *
 * Runs after every meaningful conversation to:
 * 1. Extract named entities (people, orgs, projects, concepts)
 * 2. Detect relationships between entities
 * 3. Upsert to Qdrant entity_index + PostgreSQL entity_relations
 *
 * Uses GPT-4o-mini for cheap extraction (fire-and-forget pattern).
 */

import { logger } from "../logger";
import { storage } from "../storage";

export interface ExtractedEntity {
  name: string;
  type: "person" | "organization" | "project" | "concept" | "location";
  description: string;
  attributes?: Record<string, unknown>;
}

export interface ExtractedRelation {
  source: string;
  target: string;
  type: string;
  context?: string;
}

export interface ExtractionResult {
  entities: ExtractedEntity[];
  relations: ExtractedRelation[];
}

/**
 * Extract entities and relationships from a conversation.
 * Fire-and-forget — errors are logged, not thrown.
 */
export async function extractEntities(
  userMessage: string,
  assistantResponse: string,
  domain?: string
): Promise<ExtractionResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return { entities: [], relations: [] };

  const conversationText = `User: ${userMessage}\nAssistant: ${assistantResponse}`;

  // Skip very short messages
  if (conversationText.length < 50) return { entities: [], relations: [] };

  const systemPrompt = `Extract named entities and relationships from the conversation.
Return JSON with:
{
  "entities": [
    { "name": "Full Name", "type": "person|organization|project|concept|location", "description": "Brief description based on context", "attributes": {} }
  ],
  "relations": [
    { "source": "Entity A", "target": "Entity B", "type": "works_at|works_on|collaborates_with|part_of|related_to|depends_on|owns|mentions|influenced_by", "context": "Brief context" }
  ]
}

Rules:
- Only extract clearly mentioned entities (don't infer)
- Use full names when available
- "type" for relations must be one of the enum values listed
- Skip generic terms ("the project", "a company")
- Return empty arrays if no clear entities found
- Return ONLY valid JSON`;

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "HTTP-Referer": process.env.SITE_URL || "http://localhost:5000",
        "X-Title": "SB-OS Entity Extraction",
      },
      body: JSON.stringify({
        model: "meta-llama/llama-4-scout:free",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: conversationText },
        ],
        max_tokens: 500,
        temperature: 0.1,
      }),
    });

    if (!response.ok) return { entities: [], relations: [] };

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    const jsonStr = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(jsonStr);

    const result: ExtractionResult = {
      entities: Array.isArray(parsed.entities) ? parsed.entities : [],
      relations: Array.isArray(parsed.relations) ? parsed.relations : [],
    };

    // Persist to vector store + database
    if (result.entities.length > 0 || result.relations.length > 0) {
      await persistExtractions(result, domain);
    }

    logger.debug(
      { entities: result.entities.length, relations: result.relations.length },
      "Entities extracted from conversation"
    );

    return result;
  } catch (error) {
    logger.debug({ error }, "Entity extraction failed (non-critical)");
    return { entities: [], relations: [] };
  }
}

/**
 * Persist extracted entities to Qdrant + PostgreSQL
 */
async function persistExtractions(
  result: ExtractionResult,
  domain?: string
): Promise<void> {
  const now = Date.now();

  // Upsert entities to Qdrant
  try {
    const { findEntityByName, upsertEntity, updateEntityMention } = await import("./qdrant-store");
    const { createHash } = await import("crypto");

    for (const entity of result.entities) {
      const existing = await findEntityByName(entity.name);

      if (existing) {
        // Update existing entity with new mention
        await updateEntityMention(existing.id, {
          description: entity.description,
          last_seen: now,
          domain,
          attributes: entity.attributes,
        });
      } else {
        // Create new entity
        await upsertEntity({
          name: entity.name,
          entity_type: entity.type as any,
          description: entity.description,
          first_seen: now,
          last_seen: now,
          mention_count: 1,
          related_domains: domain ? [domain] : [],
          attributes: entity.attributes || {},
          version: 1,
          checksum: createHash("sha256").update(entity.description).digest("hex"),
        });
      }
    }
  } catch (error) {
    logger.debug({ error }, "Entity upsert to Qdrant failed (non-critical)");
  }

  // Persist relations to PostgreSQL
  try {
    const validRelationTypes = [
      "works_at", "works_on", "collaborates_with", "part_of",
      "related_to", "depends_on", "owns", "mentions", "influenced_by",
    ];

    for (const rel of result.relations) {
      if (!validRelationTypes.includes(rel.type)) continue;

      await storage.upsertEntityRelation({
        sourceName: rel.source,
        targetName: rel.target,
        relationType: rel.type as any,
        context: rel.context,
      });
    }
  } catch (error) {
    logger.debug({ error }, "Relation persistence failed (non-critical)");
  }
}

/**
 * Extract entities from a Telegram message (lightweight version for NLP messages).
 */
export async function extractEntitiesFromMessage(
  text: string,
  domain?: string
): Promise<void> {
  // Only process messages that likely contain entity mentions
  const hasProperNoun = /[A-Z][a-z]+(?:\s[A-Z][a-z]+)*/.test(text);
  if (!hasProperNoun || text.length < 30) return;

  await extractEntities(text, "", domain);
}
