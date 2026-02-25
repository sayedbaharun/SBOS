/**
 * Graph Store — FalkorDB Knowledge Graph
 *
 * Adds structural intelligence alongside vector + keyword search.
 * Stores entities as nodes and relationships as edges.
 *
 * Graph schema (Cypher):
 *   (:Entity {id, name, type, description, first_seen, last_seen, mention_count})
 *   (:Memory {id, summary, domain, importance, timestamp})
 *   (:Decision {id, content, importance, timestamp})
 *   (:Agent {id, name, slug})
 *   (:Venture {id, name})
 *
 *   -[:MENTIONS {context, timestamp}]->
 *   -[:RELATES_TO {relationship, strength, timestamp}]->
 *   -[:DECIDED {timestamp}]->
 *   -[:LEARNED {timestamp}]->
 *   -[:BELONGS_TO]->
 *
 * Requires: FALKORDB_URL env var (e.g., redis://localhost:6379 or FalkorDB Cloud URL)
 */

import { logger } from "../logger";

const GRAPH_NAME = "sbos_knowledge";

// ============================================================================
// CLIENT
// ============================================================================

let graphInstance: any = null;
let dbInstance: any = null;

async function getGraph() {
  if (graphInstance) return graphInstance;

  const url = process.env.FALKORDB_URL;
  if (!url) {
    throw new Error("FALKORDB_URL not configured");
  }

  const { FalkorDB } = await import("falkordb");
  dbInstance = await FalkorDB.connect({ url });
  graphInstance = dbInstance.selectGraph(GRAPH_NAME);

  return graphInstance;
}

export async function isGraphAvailable(): Promise<boolean> {
  try {
    if (!process.env.FALKORDB_URL) return false;
    const graph = await getGraph();
    await graph.query("RETURN 1");
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// SCHEMA INIT
// ============================================================================

export async function initGraphSchema(): Promise<void> {
  try {
    const graph = await getGraph();

    // Create indexes for fast lookups
    await graph.createNodeRangeIndex("Entity", "id", "name", "type").catch(() => {});
    await graph.createNodeRangeIndex("Memory", "id", "domain").catch(() => {});
    await graph.createNodeRangeIndex("Decision", "id").catch(() => {});
    await graph.createNodeRangeIndex("Agent", "id", "slug").catch(() => {});
    await graph.createNodeRangeIndex("Venture", "id").catch(() => {});
    await graph.createEdgeRangeIndex("RELATES_TO", "relationship").catch(() => {});

    logger.info("FalkorDB graph schema initialized");
  } catch (error) {
    logger.warn({ error }, "FalkorDB schema init failed (may not be connected)");
  }
}

// ============================================================================
// NODE OPERATIONS
// ============================================================================

export async function upsertEntity(entity: {
  id: string;
  name: string;
  type: string;
  description: string;
  domain?: string;
}): Promise<void> {
  const graph = await getGraph();

  await graph.query(
    `MERGE (e:Entity {id: $id})
     SET e.name = $name, e.type = $type, e.description = $description,
         e.last_seen = timestamp(), e.mention_count = COALESCE(e.mention_count, 0) + 1
     ON CREATE SET e.first_seen = timestamp()`,
    { params: { id: entity.id, name: entity.name, type: entity.type, description: entity.description } }
  );
}

export async function upsertMemory(memory: {
  id: string;
  summary: string;
  domain: string;
  importance: number;
  timestamp: number;
}): Promise<void> {
  const graph = await getGraph();

  await graph.query(
    `MERGE (m:Memory {id: $id})
     SET m.summary = $summary, m.domain = $domain, m.importance = $importance, m.timestamp = $timestamp`,
    { params: { id: memory.id, summary: memory.summary, domain: memory.domain, importance: memory.importance, timestamp: memory.timestamp } }
  );
}

export async function upsertDecision(decision: {
  id: string;
  content: string;
  importance: number;
  timestamp: number;
}): Promise<void> {
  const graph = await getGraph();

  await graph.query(
    `MERGE (d:Decision {id: $id})
     SET d.content = $content, d.importance = $importance, d.timestamp = $timestamp`,
    { params: { id: decision.id, content: decision.content, importance: decision.importance, timestamp: decision.timestamp } }
  );
}

// ============================================================================
// EDGE OPERATIONS
// ============================================================================

export async function linkEntityToMemory(
  entityName: string,
  memoryId: string,
  context: string
): Promise<void> {
  const graph = await getGraph();

  await graph.query(
    `MATCH (e:Entity {name: $entityName}), (m:Memory {id: $memoryId})
     MERGE (m)-[:MENTIONS {context: $context, timestamp: timestamp()}]->(e)`,
    { params: { entityName, memoryId, context } }
  );
}

export async function linkEntities(
  entity1Name: string,
  entity2Name: string,
  relationship: string,
  strength: number = 0.5
): Promise<void> {
  const graph = await getGraph();

  await graph.query(
    `MATCH (e1:Entity {name: $name1}), (e2:Entity {name: $name2})
     MERGE (e1)-[r:RELATES_TO]->(e2)
     SET r.relationship = $relationship, r.strength = $strength, r.timestamp = timestamp()`,
    { params: { name1: entity1Name, name2: entity2Name, relationship, strength } }
  );
}

export async function linkDecisionToVenture(
  decisionId: string,
  ventureName: string
): Promise<void> {
  const graph = await getGraph();

  await graph.query(
    `MERGE (v:Venture {name: $ventureName})
     WITH v
     MATCH (d:Decision {id: $decisionId})
     MERGE (d)-[:BELONGS_TO]->(v)`,
    { params: { decisionId, ventureName } }
  );
}

// ============================================================================
// GRAPH QUERIES (for retrieval)
// ============================================================================

export interface GraphSearchResult {
  id: string;
  text: string;
  type: "entity" | "memory" | "decision" | "path";
  score: number;
  metadata: Record<string, unknown>;
}

/**
 * Find all entities and their connections related to a query entity.
 * Returns entities within 2 hops of the named entity.
 */
export async function getEntityContext(
  entityName: string,
  maxHops: number = 2
): Promise<GraphSearchResult[]> {
  try {
    const graph = await getGraph();

    const result = await graph.query(
      `MATCH (e:Entity {name: $name})-[r*1..${maxHops}]-(connected)
       RETURN connected, r, labels(connected) as labels
       LIMIT 20`,
      { params: { name: entityName } }
    );

    if (!result.data) return [];

    return result.data.map((row: any) => {
      const node = row[0] || {};
      const labels = row[2] || [];
      const nodeType = labels[0]?.toLowerCase() || "entity";

      return {
        id: node.id || "",
        text: node.description || node.summary || node.content || node.name || "",
        type: nodeType as any,
        score: 0.8, // Graph results are structurally relevant
        metadata: { ...node, labels },
      };
    });
  } catch (error) {
    logger.debug({ error, entityName }, "Graph entity context query failed");
    return [];
  }
}

/**
 * Find decisions that affected a specific venture or entity.
 */
export async function getDecisionChain(
  targetName: string
): Promise<GraphSearchResult[]> {
  try {
    const graph = await getGraph();

    const result = await graph.query(
      `MATCH (d:Decision)-[:BELONGS_TO|MENTIONS*1..2]->(target)
       WHERE target.name = $name
       RETURN d ORDER BY d.timestamp DESC LIMIT 10`,
      { params: { name: targetName } }
    );

    if (!result.data) return [];

    return result.data.map((row: any) => {
      const d = row[0] || {};
      return {
        id: d.id || "",
        text: d.content || "",
        type: "decision" as const,
        score: 0.9,
        metadata: { importance: d.importance, timestamp: d.timestamp },
      };
    });
  } catch (error) {
    logger.debug({ error, targetName }, "Graph decision chain query failed");
    return [];
  }
}

/**
 * Extract entities from a query string and find their graph context.
 * Used as the graph arm in the triple-arm retrieval pipeline.
 */
export async function graphContextSearch(
  query: string,
  limit: number = 10
): Promise<GraphSearchResult[]> {
  try {
    const graph = await getGraph();

    // Full-text search on entity names and descriptions
    const result = await graph.query(
      `MATCH (e:Entity)
       WHERE toLower(e.name) CONTAINS toLower($query) OR toLower(e.description) CONTAINS toLower($query)
       OPTIONAL MATCH (e)-[r]-(connected)
       RETURN e, collect(DISTINCT connected)[0..3] as connections, e.mention_count as mentions
       ORDER BY e.mention_count DESC
       LIMIT $limit`,
      { params: { query, limit } }
    );

    if (!result.data) return [];

    const results: GraphSearchResult[] = [];
    for (const row of result.data) {
      const entity = row[0] || {};
      const connections = row[1] || [];
      const mentions = row[2] || 1;

      // Score by mention frequency (more mentioned = more important)
      const score = Math.min(1.0, 0.5 + (mentions / 20));

      results.push({
        id: entity.id || "",
        text: `${entity.name} (${entity.type}): ${entity.description || ""}`,
        type: "entity",
        score,
        metadata: {
          name: entity.name,
          entityType: entity.type,
          mentionCount: mentions,
          connections: connections.map((c: any) => c?.name).filter(Boolean),
        },
      });
    }

    return results.slice(0, limit);
  } catch (error) {
    logger.debug({ error }, "Graph context search failed");
    return [];
  }
}

// ============================================================================
// INGESTION (called from learning extractor)
// ============================================================================

/**
 * Ingest entities and relationships from a compaction output.
 * Called after session compaction to build the knowledge graph.
 */
export async function ingestCompactionToGraph(compaction: {
  id: string;
  summary: string;
  domain: string;
  importance: number;
  timestamp: number;
  key_entities: string[];
  key_decisions: string[];
}): Promise<void> {
  try {
    const available = await isGraphAvailable();
    if (!available) return;

    // Upsert the memory node
    await upsertMemory({
      id: compaction.id,
      summary: compaction.summary,
      domain: compaction.domain,
      importance: compaction.importance,
      timestamp: compaction.timestamp,
    });

    // Upsert entities and link to memory
    for (const entityName of compaction.key_entities) {
      await upsertEntity({
        id: `entity:${entityName.toLowerCase().replace(/\s+/g, "-")}`,
        name: entityName,
        type: "concept", // Default — can be refined
        description: "",
        domain: compaction.domain,
      });
      await linkEntityToMemory(entityName, compaction.id, compaction.summary.slice(0, 200));
    }

    // Link entities that appear together (co-occurrence = relationship)
    if (compaction.key_entities.length >= 2) {
      for (let i = 0; i < compaction.key_entities.length; i++) {
        for (let j = i + 1; j < compaction.key_entities.length; j++) {
          await linkEntities(
            compaction.key_entities[i],
            compaction.key_entities[j],
            "co-occurs",
            0.5
          );
        }
      }
    }

    // Upsert decisions
    for (const decision of compaction.key_decisions) {
      const decisionId = `decision:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await upsertDecision({
        id: decisionId,
        content: decision,
        importance: compaction.importance,
        timestamp: compaction.timestamp,
      });
    }

    logger.debug(
      { entities: compaction.key_entities.length, decisions: compaction.key_decisions.length },
      "Ingested compaction to graph"
    );
  } catch (error) {
    logger.debug({ error }, "Graph ingestion failed (non-critical)");
  }
}

// ============================================================================
// HEALTH CHECK
// ============================================================================

export async function getGraphStatus(): Promise<{
  available: boolean;
  nodeCount?: number;
  edgeCount?: number;
  error?: string;
}> {
  try {
    const available = await isGraphAvailable();
    if (!available) {
      return { available: false, error: "FALKORDB_URL not configured or unreachable" };
    }

    const graph = await getGraph();
    const result = await graph.query(
      "MATCH (n) WITH count(n) as nodes MATCH ()-[r]->() RETURN nodes, count(r)"
    );

    const data = result.data?.[0] || [];
    return {
      available: true,
      nodeCount: data[0] || 0,
      edgeCount: data[1] || 0,
    };
  } catch (error: any) {
    return { available: false, error: error.message };
  }
}

// ============================================================================
// CLEANUP
// ============================================================================

export async function closeGraph(): Promise<void> {
  try {
    if (dbInstance) {
      await dbInstance.close();
      dbInstance = null;
      graphInstance = null;
    }
  } catch {
    // Ignore close errors
  }
}
