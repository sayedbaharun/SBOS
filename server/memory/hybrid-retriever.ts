/**
 * Hybrid Retriever — Triple-Arm Search
 *
 * Three retrieval arms fused via Reciprocal Rank Fusion:
 *   1. Qdrant vector search (semantic similarity)
 *   2. PostgreSQL keyword search (BM25-lite term matching)
 *   3. FalkorDB graph traversal (structural relationships) — when available
 *
 * Scoring formula (per-result):
 *   final_score = 0.70 * cosine_similarity
 *               + 0.15 * recency_decay(half_life=30d)
 *               + 0.15 * importance_score
 *
 * Arms merged via RRF with weights: vector=0.55, keyword=0.25, graph=0.20
 */

import { logger } from "../logger";
import {
  searchCollection,
  searchAllCollections,
  type QdrantSearchResult,
} from "./qdrant-store";
import { QDRANT_COLLECTIONS, type MemorySearchOptions } from "./schemas";

// ============================================================================
// SCORING
// ============================================================================

const COSINE_WEIGHT = 0.70;
const RECENCY_WEIGHT = 0.15;
const IMPORTANCE_WEIGHT = 0.15;
const RECENCY_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Calculate recency decay with configurable half-life
 */
function recencyDecay(timestampMs: number, halfLifeMs: number = RECENCY_HALF_LIFE_MS): number {
  const age = Date.now() - timestampMs;
  if (age <= 0) return 1.0;
  return Math.pow(0.5, age / halfLifeMs);
}

/**
 * Calculate final weighted score for a memory result
 */
function calculateFinalScore(
  cosineSimilarity: number,
  timestamp: number,
  importance: number
): number {
  return (
    COSINE_WEIGHT * cosineSimilarity +
    RECENCY_WEIGHT * recencyDecay(timestamp) +
    IMPORTANCE_WEIGHT * importance
  );
}

// ============================================================================
// RESULT TYPES
// ============================================================================

export interface RetrievedMemory {
  id: string;
  collection: string;
  rawScore: number;
  finalScore: number;
  text: string;
  timestamp: number;
  domain?: string;
  metadata: Record<string, unknown>;
  source: "local" | "cloud";
}

// ============================================================================
// RETRIEVAL
// ============================================================================

/**
 * Retrieve relevant memories using hybrid scoring
 */
export async function retrieveMemories(
  query: string,
  options: Partial<MemorySearchOptions> = {}
): Promise<RetrievedMemory[]> {
  const {
    limit = 10,
    min_score = 0.25,
    include_raw = false,
    include_compacted = true,
    include_entities = true,
    domains,
    minImportance,
    maxAgeDays,
    entityTypes,
  } = options;

  const collections: string[] = [];
  if (include_compacted) collections.push(QDRANT_COLLECTIONS.COMPACTED_MEMORIES);
  if (include_raw) collections.push(QDRANT_COLLECTIONS.RAW_MEMORIES);
  if (include_entities) collections.push(QDRANT_COLLECTIONS.ENTITY_INDEX);

  try {
    // Step 1: Run all three search arms in parallel
    const [localResults, keywordResults, graphResults] = await Promise.all([
      // Arm 1 — Vector: Qdrant ANN with metadata pre-filters
      searchAllCollections(query, {
        limit: limit * 2,
        min_score: min_score * 0.7,
        collections,
        domainFilter: domains?.[0],
        minImportance,
        maxAgeDays,
        entityTypes,
      }),
      // Arm 2 — Keyword: PostgreSQL ILIKE on agent_memory table
      keywordSearchMemories(query, limit * 2).catch(() => []),
      // Arm 3 — Graph: FalkorDB structural traversal (if available)
      graphSearchArm(query, limit).catch(() => []),
    ]);

    // Step 2: Re-score vector results with full formula
    const vectorScored: RetrievedMemory[] = localResults.map((r) => {
      const payload = r.payload;
      const timestamp = (payload.timestamp as number) || Date.now();
      const importance = (payload.importance as number) || 0.5;
      const text = extractText(r);

      return {
        id: r.id,
        collection: r.collection,
        rawScore: r.score,
        finalScore: calculateFinalScore(r.score, timestamp, importance),
        text,
        timestamp,
        domain: payload.domain as string | undefined,
        metadata: payload,
        source: "local" as const,
      };
    });

    // Step 3: Convert keyword results to RetrievedMemory
    const keywordScored: RetrievedMemory[] = keywordResults.map((r) => ({
      id: r.id,
      collection: "pg:agent_memory",
      rawScore: r.score,
      finalScore: r.score,
      text: r.content,
      timestamp: r.timestamp,
      domain: undefined,
      metadata: { memoryType: r.memoryType, importance: r.importance },
      source: "local" as const,
    }));

    // Step 4: Convert graph results to RetrievedMemory
    const graphScored: RetrievedMemory[] = graphResults.map((r) => ({
      id: r.id,
      collection: "graph:falkordb",
      rawScore: r.score,
      finalScore: r.score,
      text: r.text,
      timestamp: Date.now(),
      domain: undefined,
      metadata: r.metadata,
      source: "local" as const,
    }));

    // Step 5: Triple-arm Reciprocal Rank Fusion
    const merged = tripleArmRRF(vectorScored, keywordScored, graphScored);

    // Step 5: Filter by min_score
    const filtered = merged.filter((r) => r.finalScore >= min_score);

    // Step 6: Deduplicate by content checksum
    const deduped = deduplicateResults(filtered);

    // Step 7: If local yields < 3 quality results, try cloud fallback
    if (deduped.length < 3) {
      try {
        const cloudResults = await cloudFallback(query, {
          limit: limit - deduped.length,
          min_score,
        });
        deduped.push(...cloudResults);
      } catch (error) {
        logger.debug({ error }, "Cloud fallback unavailable");
      }
    }

    return deduped.slice(0, limit);
  } catch (error) {
    logger.error({ error, query }, "Memory retrieval failed");
    return [];
  }
}

/**
 * Retrieve memories and format as context string for AI injection
 */
export async function retrieveAsContext(
  query: string,
  options: Partial<MemorySearchOptions> = {}
): Promise<string> {
  const memories = await retrieveMemories(query, options);

  if (memories.length === 0) return "";

  const sections: string[] = [];

  // Group by collection type
  const compacted = memories.filter(
    (m) => m.collection === QDRANT_COLLECTIONS.COMPACTED_MEMORIES
  );
  const entities = memories.filter(
    (m) => m.collection === QDRANT_COLLECTIONS.ENTITY_INDEX
  );
  const raw = memories.filter(
    (m) => m.collection === QDRANT_COLLECTIONS.RAW_MEMORIES
  );

  if (compacted.length > 0) {
    sections.push("### Previous Context (Compacted Memories)");
    for (const m of compacted) {
      const decisions = (m.metadata.key_decisions as string[]) || [];
      const facts = (m.metadata.key_facts as string[]) || [];
      sections.push(m.text);
      if (decisions.length > 0) {
        sections.push(`Decisions: ${decisions.join("; ")}`);
      }
      if (facts.length > 0) {
        sections.push(`Key facts: ${facts.join("; ")}`);
      }
      sections.push("");
    }
  }

  if (entities.length > 0) {
    sections.push("### Known Entities");
    for (const m of entities) {
      const entityType = m.metadata.entity_type as string;
      sections.push(`- **${m.metadata.name}** (${entityType}): ${m.text}`);
    }
    sections.push("");
  }

  if (raw.length > 0) {
    sections.push("### Recent Relevant Messages");
    for (const m of raw) {
      sections.push(m.text.slice(0, 300));
    }
    sections.push("");
  }

  return sections.join("\n");
}

// ============================================================================
// HELPERS
// ============================================================================

function extractText(result: QdrantSearchResult): string {
  const p = result.payload;

  if (result.collection === QDRANT_COLLECTIONS.COMPACTED_MEMORIES) {
    return (p.summary as string) || "";
  }
  if (result.collection === QDRANT_COLLECTIONS.RAW_MEMORIES) {
    return (p.text as string) || "";
  }
  if (result.collection === QDRANT_COLLECTIONS.ENTITY_INDEX) {
    return (p.description as string) || "";
  }
  return "";
}

function deduplicateResults(results: RetrievedMemory[]): RetrievedMemory[] {
  const seen = new Set<string>();
  const deduped: RetrievedMemory[] = [];

  for (const r of results) {
    const checksum = (r.metadata.checksum as string) || r.id;
    if (!seen.has(checksum)) {
      seen.add(checksum);
      deduped.push(r);
    }
  }

  return deduped;
}

// ============================================================================
// KEYWORD SEARCH (BM25-lite on PostgreSQL agent_memory)
// ============================================================================

interface KeywordMemoryResult {
  id: string;
  content: string;
  score: number;
  timestamp: number;
  memoryType: string;
  importance: number;
}

/**
 * Keyword search on agent_memory table.
 * Uses PostgreSQL ILIKE for term matching + recency/importance scoring.
 * Acts as the keyword arm alongside Qdrant vector search.
 */
async function keywordSearchMemories(
  query: string,
  limit: number
): Promise<KeywordMemoryResult[]> {
  try {
    const { storage } = await import("../storage");
    const db = (storage as any).db;
    const { agentMemory } = await import("@shared/schema");
    const { sql } = await import("drizzle-orm");

    // Tokenize query into search terms
    const terms = query
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2);

    if (terms.length === 0) return [];

    // Build ILIKE conditions for each term
    const rows = await db
      .select()
      .from(agentMemory)
      .where(
        sql`LOWER(${agentMemory.content}) LIKE ${"%" + terms[0] + "%"}`
      )
      .orderBy(sql`${agentMemory.importance} DESC`)
      .limit(limit * 2);

    if (rows.length === 0) return [];

    // Score results: term coverage + recency + importance
    const now = Date.now();
    const HALF_LIFE = 30 * 24 * 60 * 60 * 1000;

    const scored: KeywordMemoryResult[] = rows.map((r: any) => {
      const contentLower = r.content.toLowerCase();

      // Term coverage score (0-1)
      const matchedTerms = terms.filter((t) => contentLower.includes(t));
      const termCoverage = matchedTerms.length / terms.length;

      // Recency decay
      const ageMs = now - new Date(r.createdAt).getTime();
      const recency = ageMs > 0 ? Math.pow(0.5, ageMs / HALF_LIFE) : 1.0;

      const importance = r.importance || 0.5;

      // Weighted score matching the standard formula weights
      const score = 0.70 * termCoverage + 0.15 * recency + 0.15 * importance;

      return {
        id: r.id,
        content: r.content,
        score,
        timestamp: new Date(r.createdAt).getTime(),
        memoryType: r.memoryType,
        importance,
      };
    });

    // Filter to only results that match at least one term well
    return scored
      .filter((r) => r.score > 0.2)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  } catch (error) {
    logger.debug({ error }, "Keyword memory search failed");
    return [];
  }
}

// ============================================================================
// RECIPROCAL RANK FUSION
// ============================================================================

/**
 * Triple-arm Reciprocal Rank Fusion.
 * Weights: vector=0.55, keyword=0.25, graph=0.20
 * If graph arm is empty, redistributes: vector=0.70, keyword=0.30
 */
function tripleArmRRF(
  vectorResults: RetrievedMemory[],
  keywordResults: RetrievedMemory[],
  graphResults: RetrievedMemory[]
): RetrievedMemory[] {
  const k = 60; // RRF constant

  // Adaptive weights: if graph arm is empty, redistribute to vector + keyword
  const hasGraph = graphResults.length > 0;
  const vectorWeight = hasGraph ? 0.55 : 0.70;
  const keywordWeight = hasGraph ? 0.25 : 0.30;
  const graphWeight = hasGraph ? 0.20 : 0;

  const scoreMap = new Map<string, { result: RetrievedMemory; score: number }>();

  const addArm = (results: RetrievedMemory[], weight: number) => {
    results.forEach((r, idx) => {
      const key = r.id;
      const rankScore = weight / (k + idx + 1);

      if (scoreMap.has(key)) {
        scoreMap.get(key)!.score += rankScore;
      } else {
        scoreMap.set(key, { result: r, score: rankScore });
      }
    });
  };

  addArm(vectorResults, vectorWeight);
  addArm(keywordResults, keywordWeight);
  if (hasGraph) addArm(graphResults, graphWeight);

  // Normalize and apply as finalScore
  const entries = Array.from(scoreMap.values());
  if (entries.length === 0) return [];

  const maxScore = Math.max(...entries.map((e) => e.score));
  for (const entry of entries) {
    entry.result.finalScore = maxScore > 0 ? entry.score / maxScore : 0;
  }

  return entries
    .sort((a, b) => b.score - a.score)
    .map((e) => e.result);
}

/**
 * Graph search arm — queries FalkorDB for structurally related memories.
 * Gracefully returns [] if FalkorDB is not configured.
 */
async function graphSearchArm(
  query: string,
  limit: number
): Promise<Array<{ id: string; text: string; score: number; metadata: Record<string, unknown> }>> {
  try {
    const { isGraphAvailable, graphContextSearch } = await import("./graph-store");
    const available = await isGraphAvailable();
    if (!available) return [];

    return await graphContextSearch(query, limit);
  } catch {
    return [];
  }
}

/**
 * Cloud fallback - queries Pinecone for compacted memories
 */
async function cloudFallback(
  query: string,
  options: { limit: number; min_score: number }
): Promise<RetrievedMemory[]> {
  // Lazy import to avoid requiring Pinecone when not configured
  try {
    const { searchPinecone } = await import("./pinecone-store");
    const results = await searchPinecone(query, {
      namespace: "compacted",
      topK: options.limit,
    });

    return results.map((r) => ({
      id: r.id,
      collection: "pinecone:compacted",
      rawScore: r.score,
      finalScore: r.score * COSINE_WEIGHT, // Simplified scoring for cloud
      text: (r.metadata?.summary as string) || "",
      timestamp: (r.metadata?.timestamp as number) || Date.now(),
      domain: r.metadata?.domain as string | undefined,
      metadata: r.metadata || {},
      source: "cloud" as const,
    }));
  } catch {
    return [];
  }
}
