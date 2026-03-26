/**
 * Qdrant Store - Cloud Vector Database
 *
 * Manages three collections:
 * - raw_memories: verbatim conversation messages
 * - compacted_memories: compaction summaries
 * - entity_index: people, orgs, projects, concepts
 *
 * Uses OpenRouter text-embedding-3-small (1536 dims) for embeddings.
 */

import { QdrantClient } from "@qdrant/js-client-rest";
import { logger } from "../logger";
import { generateEmbedding, generateEmbeddings } from "../embeddings";
import {
  QDRANT_COLLECTIONS,
  LOCAL_EMBEDDING_DIMS,
  type RawMemoryPayload,
  type CompactedMemoryPayload,
  type EntityPayload,
} from "./schemas";
import { createHash, randomUUID } from "crypto";

// ============================================================================
// CLIENT SETUP
// ============================================================================

const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";
const QDRANT_API_KEY = process.env.QDRANT_API_KEY;

let client: QdrantClient | null = null;

function getClient(): QdrantClient {
  if (!client) {
    const opts: any = { url: QDRANT_URL };
    if (QDRANT_API_KEY) {
      opts.apiKey = QDRANT_API_KEY;
    }
    client = new QdrantClient(opts);
  }
  return client;
}

// ============================================================================
// COLLECTION MANAGEMENT
// ============================================================================

/**
 * Initialize all Qdrant collections if they don't exist
 */
export async function initCollections(): Promise<void> {
  const qdrant = getClient();

  const collections = [
    QDRANT_COLLECTIONS.RAW_MEMORIES,
    QDRANT_COLLECTIONS.COMPACTED_MEMORIES,
    QDRANT_COLLECTIONS.ENTITY_INDEX,
  ];

  for (const name of collections) {
    try {
      const exists = await qdrant.collectionExists(name);
      if (!exists.exists) {
        await qdrant.createCollection(name, {
          vectors: {
            size: LOCAL_EMBEDDING_DIMS,
            distance: "Cosine",
          },
        });

        // Create payload indexes for common query patterns
        if (name === QDRANT_COLLECTIONS.RAW_MEMORIES) {
          await qdrant.createPayloadIndex(name, {
            field_name: "session_id",
            field_schema: "keyword",
          });
          await qdrant.createPayloadIndex(name, {
            field_name: "domain",
            field_schema: "keyword",
          });
          await qdrant.createPayloadIndex(name, {
            field_name: "compacted",
            field_schema: "bool",
          });
          await qdrant.createPayloadIndex(name, {
            field_name: "timestamp",
            field_schema: "integer",
          });
          await qdrant.createPayloadIndex(name, {
            field_name: "importance",
            field_schema: "float",
          });
        }

        if (name === QDRANT_COLLECTIONS.COMPACTED_MEMORIES) {
          await qdrant.createPayloadIndex(name, {
            field_name: "domain",
            field_schema: "keyword",
          });
          await qdrant.createPayloadIndex(name, {
            field_name: "sync_status",
            field_schema: "keyword",
          });
          await qdrant.createPayloadIndex(name, {
            field_name: "timestamp",
            field_schema: "integer",
          });
          await qdrant.createPayloadIndex(name, {
            field_name: "importance",
            field_schema: "float",
          });
        }

        if (name === QDRANT_COLLECTIONS.ENTITY_INDEX) {
          await qdrant.createPayloadIndex(name, {
            field_name: "entity_type",
            field_schema: "keyword",
          });
          await qdrant.createPayloadIndex(name, {
            field_name: "name",
            field_schema: "keyword",
          });
        }

        logger.info({ collection: name }, "Created Qdrant collection");
      }
    } catch (error) {
      logger.error({ error, collection: name }, "Failed to init Qdrant collection");
      throw error;
    }
  }
}

/**
 * Ensure payload indexes exist on existing collections.
 * Safe to call repeatedly — Qdrant ignores duplicate index creation.
 * Call this on startup to add new indexes to pre-existing collections.
 */
export async function ensurePayloadIndexes(): Promise<void> {
  const qdrant = getClient();

  const indexSpecs: Array<{ collection: string; field: string; schema: string }> = [
    { collection: QDRANT_COLLECTIONS.RAW_MEMORIES, field: "importance", schema: "float" },
    { collection: QDRANT_COLLECTIONS.COMPACTED_MEMORIES, field: "importance", schema: "float" },
    { collection: QDRANT_COLLECTIONS.RAW_MEMORIES, field: "archived", schema: "bool" },
    { collection: QDRANT_COLLECTIONS.COMPACTED_MEMORIES, field: "archived", schema: "bool" },
  ];

  for (const spec of indexSpecs) {
    try {
      await qdrant.createPayloadIndex(spec.collection, {
        field_name: spec.field,
        field_schema: spec.schema as any,
      });
      logger.info({ collection: spec.collection, field: spec.field }, "Created payload index");
    } catch (error: any) {
      // Index already exists — safe to ignore
      if (error?.message?.includes("already exists") || error?.status === 400) {
        logger.debug({ collection: spec.collection, field: spec.field }, "Payload index already exists");
      } else {
        logger.warn({ error, collection: spec.collection, field: spec.field }, "Failed to create payload index");
      }
    }
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function computeChecksum(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

// ============================================================================
// RAW MEMORIES CRUD
// ============================================================================

/**
 * Store a raw memory (conversation message) in Qdrant
 */
export async function upsertRawMemory(
  payload: Omit<RawMemoryPayload, "checksum" | "version" | "compacted" | "archived" | "last_accessed_at"> & {
    id?: string;
  }
): Promise<string> {
  const qdrant = getClient();
  const id = payload.id || randomUUID();
  const checksum = computeChecksum(payload.text);

  const embedding = await generateEmbedding(payload.text);

  const fullPayload: RawMemoryPayload = {
    ...payload,
    compacted: false,
    archived: false,
    version: 1,
    checksum,
  };

  await qdrant.upsert(QDRANT_COLLECTIONS.RAW_MEMORIES, {
    wait: true,
    points: [
      {
        id,
        vector: embedding.embedding,
        payload: fullPayload as Record<string, unknown>,
      },
    ],
  });

  return id;
}

/**
 * Store multiple raw memories in batch
 */
export async function upsertRawMemories(
  memories: Array<
    Omit<RawMemoryPayload, "checksum" | "version" | "compacted" | "archived" | "last_accessed_at"> & { id?: string }
  >
): Promise<string[]> {
  if (memories.length === 0) return [];

  const qdrant = getClient();

  const texts = memories.map((m) => m.text);
  const embeddings = await generateEmbeddings(texts);

  const ids: string[] = [];
  const points = memories.map((mem, i) => {
    const id = mem.id || randomUUID();
    ids.push(id);
    return {
      id,
      vector: embeddings[i].embedding,
      payload: {
        ...mem,
        compacted: false,
        archived: false,
        version: 1,
        checksum: computeChecksum(mem.text),
      } as Record<string, unknown>,
    };
  });

  await qdrant.upsert(QDRANT_COLLECTIONS.RAW_MEMORIES, {
    wait: true,
    points,
  });

  return ids;
}

/**
 * Mark raw memories as compacted
 */
export async function markAsCompacted(ids: string[]): Promise<void> {
  const qdrant = getClient();

  for (const id of ids) {
    await qdrant.setPayload(QDRANT_COLLECTIONS.RAW_MEMORIES, {
      payload: { compacted: true },
      points: [id],
    });
  }
}

/**
 * Get raw memories by session ID
 */
export async function getRawMemoriesBySession(
  sessionId: string
): Promise<Array<{ id: string; payload: RawMemoryPayload }>> {
  const qdrant = getClient();

  const result = await qdrant.scroll(QDRANT_COLLECTIONS.RAW_MEMORIES, {
    filter: {
      must: [{ key: "session_id", match: { value: sessionId } }],
    },
    limit: 1000,
    with_payload: true,
  });

  return result.points.map((p) => ({
    id: p.id as string,
    payload: p.payload as unknown as RawMemoryPayload,
  }));
}

/**
 * Get uncompacted raw memories
 */
export async function getUncompactedMemories(
  limit: number = 100
): Promise<Array<{ id: string; payload: RawMemoryPayload }>> {
  const qdrant = getClient();

  const result = await qdrant.scroll(QDRANT_COLLECTIONS.RAW_MEMORIES, {
    filter: {
      must: [{ key: "compacted", match: { value: false } }],
    },
    limit,
    with_payload: true,
    order_by: { key: "timestamp", direction: "asc" },
  });

  return result.points.map((p) => ({
    id: p.id as string,
    payload: p.payload as unknown as RawMemoryPayload,
  }));
}

// ============================================================================
// COMPACTED MEMORIES CRUD
// ============================================================================

/**
 * Store a compacted memory in Qdrant
 */
export async function upsertCompactedMemory(
  payload: CompactedMemoryPayload,
  id?: string
): Promise<string> {
  const qdrant = getClient();
  const pointId = id || randomUUID();

  const embedding = await generateEmbedding(payload.summary);

  await qdrant.upsert(QDRANT_COLLECTIONS.COMPACTED_MEMORIES, {
    wait: true,
    points: [
      {
        id: pointId,
        vector: embedding.embedding,
        payload: payload as Record<string, unknown>,
      },
    ],
  });

  return pointId;
}

/**
 * Get compacted memories pending sync
 */
export async function getPendingSyncMemories(): Promise<
  Array<{ id: string; payload: CompactedMemoryPayload }>
> {
  const qdrant = getClient();

  const result = await qdrant.scroll(QDRANT_COLLECTIONS.COMPACTED_MEMORIES, {
    filter: {
      must: [{ key: "sync_status", match: { value: "pending" } }],
    },
    limit: 100,
    with_payload: true,
  });

  return result.points.map((p) => ({
    id: p.id as string,
    payload: p.payload as unknown as CompactedMemoryPayload,
  }));
}

/**
 * Update sync status of a compacted memory
 */
export async function updateSyncStatus(
  id: string,
  status: "pending" | "synced" | "conflict"
): Promise<void> {
  const qdrant = getClient();

  await qdrant.setPayload(QDRANT_COLLECTIONS.COMPACTED_MEMORIES, {
    payload: { sync_status: status },
    points: [id],
  });
}

// ============================================================================
// ENTITY INDEX CRUD
// ============================================================================

/**
 * Upsert an entity into the entity index
 */
export async function upsertEntity(
  payload: EntityPayload,
  id?: string
): Promise<string> {
  const qdrant = getClient();
  const pointId = id || randomUUID();

  const embeddingText = `${payload.name}: ${payload.description}`;
  const embedding = await generateEmbedding(embeddingText);

  await qdrant.upsert(QDRANT_COLLECTIONS.ENTITY_INDEX, {
    wait: true,
    points: [
      {
        id: pointId,
        vector: embedding.embedding,
        payload: payload as Record<string, unknown>,
      },
    ],
  });

  return pointId;
}

/**
 * Find entity by name (exact match)
 */
export async function findEntityByName(
  name: string
): Promise<{ id: string; payload: EntityPayload } | null> {
  const qdrant = getClient();

  const result = await qdrant.scroll(QDRANT_COLLECTIONS.ENTITY_INDEX, {
    filter: {
      must: [{ key: "name", match: { value: name } }],
    },
    limit: 1,
    with_payload: true,
  });

  if (result.points.length === 0) return null;

  return {
    id: result.points[0].id as string,
    payload: result.points[0].payload as unknown as EntityPayload,
  };
}

/**
 * Update entity with new mention info
 */
export async function updateEntityMention(
  id: string,
  updates: {
    description?: string;
    last_seen: number;
    domain?: string;
    attributes?: Record<string, unknown>;
  }
): Promise<void> {
  const qdrant = getClient();

  // Get current entity to increment mention count
  const points = await qdrant.retrieve(QDRANT_COLLECTIONS.ENTITY_INDEX, {
    ids: [id],
    with_payload: true,
  });

  if (points.length === 0) return;

  const current = points[0].payload as unknown as EntityPayload;

  const payload: Record<string, unknown> = {
    last_seen: updates.last_seen,
    mention_count: current.mention_count + 1,
    version: current.version + 1,
  };

  if (updates.description) {
    payload.description = updates.description;
    payload.checksum = computeChecksum(updates.description);
  }

  if (updates.domain && !current.related_domains.includes(updates.domain)) {
    payload.related_domains = [...current.related_domains, updates.domain];
  }

  if (updates.attributes) {
    payload.attributes = { ...current.attributes, ...updates.attributes };
  }

  await qdrant.setPayload(QDRANT_COLLECTIONS.ENTITY_INDEX, {
    payload,
    points: [id],
  });
}

// ============================================================================
// SEARCH
// ============================================================================

export interface QdrantSearchResult {
  id: string;
  score: number;
  collection: string;
  payload: Record<string, unknown>;
}

/**
 * Search a specific collection by vector similarity
 */
export async function searchCollection(
  collection: string,
  query: string,
  options: {
    limit?: number;
    min_score?: number;
    filter?: Record<string, unknown>;
  } = {}
): Promise<QdrantSearchResult[]> {
  const qdrant = getClient();
  const { limit = 10, min_score = 0.25, filter } = options;

  const embedding = await generateEmbedding(query);

  const results = await qdrant.search(collection, {
    vector: embedding.embedding,
    limit,
    score_threshold: min_score,
    filter: filter as any,
    with_payload: true,
  });

  return results.map((r) => ({
    id: r.id as string,
    score: r.score,
    collection,
    payload: r.payload as Record<string, unknown>,
  }));
}

/**
 * Search across all memory collections with metadata pre-filtering.
 *
 * Pre-filters (applied at Qdrant index level before ANN search):
 * - domainFilter: restrict to a specific domain
 * - minImportance: exclude low-signal memories (e.g., >= 0.4)
 * - maxAgeDays: exclude old memories (e.g., last 90 days)
 * - entityTypes: restrict entity_index to specific types
 */
export async function searchAllCollections(
  query: string,
  options: {
    limit?: number;
    min_score?: number;
    collections?: string[];
    domainFilter?: string;
    minImportance?: number;
    maxAgeDays?: number;
    entityTypes?: string[];
  } = {}
): Promise<QdrantSearchResult[]> {
  const {
    limit = 10,
    min_score = 0.25,
    collections = [
      QDRANT_COLLECTIONS.COMPACTED_MEMORIES,
      QDRANT_COLLECTIONS.RAW_MEMORIES,
      QDRANT_COLLECTIONS.ENTITY_INDEX,
    ],
    domainFilter,
    minImportance,
    maxAgeDays,
    entityTypes,
  } = options;

  // Build per-collection filters (different collections have different indexed fields)
  const buildFilter = (collection: string) => {
    const must: Array<Record<string, unknown>> = [];
    const must_not: Array<Record<string, unknown>> = [];

    // Domain filter (indexed on raw_memories and compacted_memories)
    if (domainFilter && collection !== QDRANT_COLLECTIONS.ENTITY_INDEX) {
      must.push({ key: "domain", match: { value: domainFilter } });
    }

    // Importance pre-filter (available on raw_memories and compacted_memories)
    if (minImportance !== undefined && collection !== QDRANT_COLLECTIONS.ENTITY_INDEX) {
      must.push({ key: "importance", range: { gte: minImportance } });
    }

    // Timestamp pre-filter (indexed on raw_memories and compacted_memories)
    if (maxAgeDays !== undefined && collection !== QDRANT_COLLECTIONS.ENTITY_INDEX) {
      const cutoffMs = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
      must.push({ key: "timestamp", range: { gte: cutoffMs } });
    }

    // Entity type filter (only on entity_index)
    if (entityTypes && entityTypes.length > 0 && collection === QDRANT_COLLECTIONS.ENTITY_INDEX) {
      must.push({ key: "entity_type", match: { any: entityTypes } });
    }

    // Exclude archived memories (must_not so records without the field are still included)
    if (collection !== QDRANT_COLLECTIONS.ENTITY_INDEX) {
      must_not.push({ key: "archived", match: { value: true } });
    }

    const filter: Record<string, unknown> = {};
    if (must.length > 0) filter.must = must;
    if (must_not.length > 0) filter.must_not = must_not;
    return Object.keys(filter).length > 0 ? filter : undefined;
  };

  const searchPromises = collections.map((col) =>
    searchCollection(col, query, { limit, min_score, filter: buildFilter(col) })
  );

  const allResults = (await Promise.all(searchPromises)).flat();

  // Sort by score descending
  allResults.sort((a, b) => b.score - a.score);

  return allResults.slice(0, limit);
}

// ============================================================================
// ARCHIVE (SOFT DELETE)
// ============================================================================

/**
 * Mark a memory as archived — non-destructive soft delete.
 * Archived memories are excluded from search but not deleted.
 */
export async function archiveMemory(id: string, collection: string): Promise<void> {
  const qdrant = getClient();
  await qdrant.setPayload(collection, {
    payload: { archived: true, last_accessed_at: Date.now() },
    points: [id],
  });
}

/**
 * Find old low-importance memories eligible for archiving.
 * Only returns IDs (no payload) for efficiency.
 */
export async function getOldLowImportanceMemories(
  collection: string,
  olderThanDays: number,
  maxImportance: number,
  limit: number = 200
): Promise<string[]> {
  const qdrant = getClient();
  const cutoffMs = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;

  const result = await qdrant.scroll(collection, {
    filter: {
      must: [
        { key: "timestamp", range: { lt: cutoffMs } },
        { key: "importance", range: { lte: maxImportance } },
      ],
      must_not: [
        { key: "archived", match: { value: true } },
      ],
    } as any,
    limit,
    with_payload: false,
  });

  return result.points.map((p) => p.id as string);
}

/**
 * Get compacted memories for Pinecone sync (by sync_status, excluding archived).
 * Used by the nightly sync job.
 */
export async function getCompactedMemoriesForSync(
  limit: number = 200
): Promise<Array<{ id: string; payload: CompactedMemoryPayload }>> {
  const qdrant = getClient();

  const result = await qdrant.scroll(QDRANT_COLLECTIONS.COMPACTED_MEMORIES, {
    filter: {
      must: [{ key: "sync_status", match: { value: "pending" } }],
      must_not: [{ key: "archived", match: { value: true } }],
    } as any,
    limit,
    with_payload: true,
  });

  return result.points.map((p) => ({
    id: p.id as string,
    payload: p.payload as unknown as CompactedMemoryPayload,
  }));
}

/**
 * Scroll compacted memories for Pinecone backfill (high importance, not archived).
 */
export async function scrollHighValueCompacted(
  minImportance: number = 0.5,
  limit: number = 100,
  offset?: string
): Promise<{ points: Array<{ id: string; payload: CompactedMemoryPayload }>; nextOffset?: string }> {
  const qdrant = getClient();

  const result = await qdrant.scroll(QDRANT_COLLECTIONS.COMPACTED_MEMORIES, {
    filter: {
      must: [{ key: "importance", range: { gte: minImportance } }],
      must_not: [{ key: "archived", match: { value: true } }],
    } as any,
    limit,
    offset: offset as any,
    with_payload: true,
  });

  return {
    points: result.points.map((p) => ({
      id: p.id as string,
      payload: p.payload as unknown as CompactedMemoryPayload,
    })),
    nextOffset: result.next_page_offset as string | undefined,
  };
}

// ============================================================================
// HEALTH CHECK
// ============================================================================

/**
 * Check Qdrant connectivity and collection status
 */
export async function getQdrantStatus(): Promise<{
  available: boolean;
  collections: Record<string, { count: number }>;
  error?: string;
}> {
  try {
    const qdrant = getClient();
    const collections: Record<string, { count: number }> = {};

    for (const name of Object.values(QDRANT_COLLECTIONS)) {
      try {
        const info = await qdrant.getCollection(name);
        collections[name] = { count: info.points_count || 0 };
      } catch {
        collections[name] = { count: 0 };
      }
    }

    return { available: true, collections };
  } catch (error) {
    return {
      available: false,
      collections: {},
      error: error instanceof Error ? error.message : "Connection failed",
    };
  }
}
