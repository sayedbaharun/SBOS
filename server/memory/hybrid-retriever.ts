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
 *               + 0.15 * ebbinghaus_decay(importance_scaled_half_life)
 *               + 0.15 * importance_score
 *
 * Ebbinghaus decay half-lives (importance-scaled):
 *   importance >= 0.8 → 365-day half-life (critical memories)
 *   importance 0.4–0.79 → 60-day half-life (useful context)
 *   importance < 0.4 → 14-day half-life (ephemeral)
 *   retrieval_count boost: each retrieval extends half-life by 10%
 *   floor: 0.20 so high-importance memories never fully vanish
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
import { expandQuery } from "./query-expander";
import { rerankResults } from "./reranker";
import { recordRetrieval, type RetrievalEvent } from "./retrieval-metrics";

// ============================================================================
// SCORING
// ============================================================================

const COSINE_WEIGHT = 0.70;
const RECENCY_WEIGHT = 0.15;
const IMPORTANCE_WEIGHT = 0.15;

// Ebbinghaus half-life tiers (in ms)
const HALF_LIFE_HIGH = 365 * 24 * 60 * 60 * 1000;  // importance >= 0.8
const HALF_LIFE_MID  =  60 * 24 * 60 * 60 * 1000;  // importance 0.4–0.79
const HALF_LIFE_LOW  =  14 * 24 * 60 * 60 * 1000;  // importance < 0.4

// Spaced-repetition boost per retrieval (+10% to half-life, capped)
const RETRIEVAL_BOOST_PER_COUNT = 0.10;
const RETRIEVAL_BOOST_MAX = 2.0; // max 2x half-life extension

// Minimum decay floor for high-importance memories (never fully forgotten)
const DECAY_FLOOR_HIGH_IMPORTANCE = 0.20;

/**
 * Ebbinghaus-inspired decay with importance-scaled half-lives.
 *
 * Half-lives:
 *   >= 0.8 importance → 365 days (critical decisions)
 *   0.4–0.79          → 60 days  (useful context)
 *   < 0.4             → 14 days  (ephemeral)
 *
 * Spaced-repetition boost: each retrieval adds 10% to the effective half-life
 * (capped at 2x), mimicking memory strengthening through recall.
 *
 * Floor: high-importance memories (>= 0.8) never decay below 0.20.
 */
function ebbinghausDecay(
  timestampMs: number,
  importance: number,
  retrievalCount: number = 0
): number {
  const age = Date.now() - timestampMs;
  if (age <= 0) return 1.0;

  // Select base half-life by importance tier
  let baseHalfLife: number;
  if (importance >= 0.8) {
    baseHalfLife = HALF_LIFE_HIGH;
  } else if (importance >= 0.4) {
    baseHalfLife = HALF_LIFE_MID;
  } else {
    baseHalfLife = HALF_LIFE_LOW;
  }

  // Spaced-repetition boost: each retrieval extends half-life by 10%
  const boost = Math.min(1 + retrievalCount * RETRIEVAL_BOOST_PER_COUNT, RETRIEVAL_BOOST_MAX);
  const effectiveHalfLife = baseHalfLife * boost;

  const decay = Math.pow(0.5, age / effectiveHalfLife);

  // Apply floor for high-importance memories so they never fully vanish
  if (importance >= 0.8) {
    return Math.max(decay, DECAY_FLOOR_HIGH_IMPORTANCE);
  }
  return decay;
}

/**
 * Calculate final weighted score for a memory result
 */
function calculateFinalScore(
  cosineSimilarity: number,
  timestamp: number,
  importance: number,
  retrievalCount: number = 0
): number {
  return (
    COSINE_WEIGHT * cosineSimilarity +
    RECENCY_WEIGHT * ebbinghausDecay(timestamp, importance, retrievalCount) +
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
 * Retrieve relevant memories using hybrid scoring with multi-angle query expansion
 * and cross-encoder reranking.
 *
 * Pipeline:
 *   1. Expand query into 3-5 angles (LLM or rule-based)
 *   2. Run triple-arm search for each query variant
 *   3. RRF fusion across all results
 *   4. Cross-encoder reranking for precision
 *   5. Deduplicate and return top-K
 */
export async function retrieveMemories(
  query: string,
  options: Partial<MemorySearchOptions> = {}
): Promise<RetrievedMemory[]> {
  const {
    limit = 10,
    min_score = 0.25,
    include_raw = true,
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
    // Step 1: Multi-angle query expansion
    const expanded = await expandQuery(query);
    const allQueries = [expanded.original, ...expanded.expansions];
    logger.debug(
      { original: query, expansions: expanded.expansions.length, method: expanded.method },
      "Query expansion complete"
    );

    // Step 2: Run triple-arm search for each query variant in parallel
    const searchOpts = {
      limit: limit * 2,
      min_score: min_score * 0.7,
      collections,
      domainFilter: domains?.[0],
      minImportance,
      maxAgeDays,
      entityTypes,
    };

    const allVectorResults: RetrievedMemory[] = [];
    const allKeywordResults: RetrievedMemory[] = [];
    const allGraphResults: RetrievedMemory[] = [];

    // Instrumentation accumulators
    const t0 = Date.now();
    let qdrantLatency = 0, keywordLatency = 0, graphLatency = 0;
    let qdrantTotal = 0, keywordTotal = 0, graphTotal = 0;
    let graphSkipped = false;

    // Search all query variants in parallel
    const searchPromises = allQueries.map(async (q) => {
      const qt0 = Date.now();
      const localResults = await searchAllCollections(q, searchOpts);
      qdrantLatency = Math.max(qdrantLatency, Date.now() - qt0);

      const kt0 = Date.now();
      const keywordResults = await keywordSearchMemories(q, limit).catch(() => []);
      keywordLatency = Math.max(keywordLatency, Date.now() - kt0);

      const gt0 = Date.now();
      const graphResults = await graphSearchArm(q, Math.ceil(limit / 2)).catch(() => []);
      graphLatency = Math.max(graphLatency, Date.now() - gt0);

      qdrantTotal += localResults.length;
      keywordTotal += keywordResults.length;
      graphTotal += graphResults.length;

      return { localResults, keywordResults, graphResults };
    });

    const searchResults = await Promise.all(searchPromises);

    for (const { localResults, keywordResults, graphResults } of searchResults) {
      // Convert vector results
      for (const r of localResults) {
        const payload = r.payload;
        const timestamp = (payload.timestamp as number) || Date.now();
        const importance = (payload.importance as number) || 0.5;
        const retrievalCount = (payload.retrieval_count as number) || 0;
        allVectorResults.push({
          id: r.id,
          collection: r.collection,
          rawScore: r.score,
          finalScore: calculateFinalScore(r.score, timestamp, importance, retrievalCount),
          text: extractText(r),
          timestamp,
          domain: payload.domain as string | undefined,
          metadata: payload,
          source: "local" as const,
        });
      }

      // Convert keyword results
      for (const r of keywordResults) {
        allKeywordResults.push({
          id: r.id,
          collection: "pg:agent_memory",
          rawScore: r.score,
          finalScore: r.score,
          text: r.content,
          timestamp: r.timestamp,
          domain: undefined,
          metadata: { memoryType: r.memoryType, importance: r.importance },
          source: "local" as const,
        });
      }

      // Convert graph results
      for (const r of graphResults) {
        allGraphResults.push({
          id: r.id,
          collection: "graph:falkordb",
          rawScore: r.score,
          finalScore: r.score,
          text: r.text,
          timestamp: Date.now(),
          domain: undefined,
          metadata: r.metadata,
          source: "local" as const,
        });
      }
    }

    // Step 3: Triple-arm Reciprocal Rank Fusion
    const merged = tripleArmRRF(allVectorResults, allKeywordResults, allGraphResults);

    // Step 4: Filter by min_score
    const filtered = merged.filter((r) => r.finalScore >= min_score);

    // Step 5: Deduplicate by content checksum
    const deduped = deduplicateResults(filtered);

    // Step 6: Cross-encoder reranking for precision
    const reranked = await rerankResults(query, deduped, Math.min(15, deduped.length));

    // Step 7: If local yields < 3 quality results, try cloud fallback
    let cloudFallbackTriggered = false;
    let cloudFallbackCount = 0;
    let cloudFallbackLatency = 0;

    if (reranked.length < 3) {
      try {
        cloudFallbackTriggered = true;
        const ct0 = Date.now();
        const cloudResults = await cloudFallback(query, {
          limit: limit - reranked.length,
          min_score,
        });
        cloudFallbackLatency = Date.now() - ct0;
        cloudFallbackCount = cloudResults.length;
        reranked.push(...cloudResults);
      } catch (error) {
        cloudFallbackLatency = Date.now() - t0; // rough fallback
        logger.debug({ error }, "Cloud fallback unavailable");
      }
    }

    // Record retrieval metrics
    const finalResults = reranked.slice(0, limit);
    recordRetrieval({
      timestamp: Date.now(),
      queryLength: query.length,
      qdrantCount: qdrantTotal,
      qdrantLatencyMs: qdrantLatency,
      keywordCount: keywordTotal,
      keywordLatencyMs: keywordLatency,
      graphCount: graphTotal,
      graphLatencyMs: graphLatency,
      graphSkipped: graphTotal === 0 && graphLatency < 5,
      cloudFallbackTriggered,
      cloudFallbackCount,
      cloudFallbackLatencyMs: cloudFallbackLatency,
      totalResults: finalResults.length,
      totalLatencyMs: Date.now() - t0,
    });

    return finalResults;
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

    // Score results: term coverage + Ebbinghaus decay + importance
    const scored: KeywordMemoryResult[] = rows.map((r: any) => {
      const contentLower = r.content.toLowerCase();

      // Term coverage score (0-1)
      const matchedTerms = terms.filter((t) => contentLower.includes(t));
      const termCoverage = matchedTerms.length / terms.length;

      const importance = r.importance || 0.5;
      const timestampMs = new Date(r.createdAt).getTime();

      // Ebbinghaus decay with importance-scaled half-life
      const decay = ebbinghausDecay(timestampMs, importance, 0);

      // Weighted score matching the standard formula weights
      const score = 0.70 * termCoverage + 0.15 * decay + 0.15 * importance;

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
