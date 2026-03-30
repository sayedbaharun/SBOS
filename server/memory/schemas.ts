/**
 * Memory System Schemas
 *
 * Zod schemas for the hybrid memory layer:
 * - Raw memories (conversation messages stored verbatim)
 * - Compacted memories (summaries from compaction passes)
 * - Entity index (people, orgs, projects, concepts)
 * - Compaction output (structured LLM output)
 */

import { z } from "zod";

// ============================================================================
// DOMAIN & SOURCE ENUMS
// ============================================================================

export const memoryDomainSchema = z.enum([
  "health",
  "business",
  "project",
  "personal",
  "finance",
]);
export type MemoryDomain = z.infer<typeof memoryDomainSchema>;

export const memorySourceSchema = z.enum([
  "conversation",
  "observation",
  "mobile_input",
]);
export type MemorySource = z.infer<typeof memorySourceSchema>;

export const entityTypeSchema = z.enum([
  "person",
  "organization",
  "project",
  "concept",
  "location",
]);
export type EntityType = z.infer<typeof entityTypeSchema>;

export const syncStatusSchema = z.enum(["pending", "synced", "conflict"]);
export type SyncStatus = z.infer<typeof syncStatusSchema>;

// ============================================================================
// RAW MEMORIES (Qdrant: raw_memories collection)
// ============================================================================

export const rawMemoryPayloadSchema = z.object({
  text: z.string(),
  session_id: z.string().uuid(),
  timestamp: z.number(), // Unix epoch ms
  source: memorySourceSchema,
  domain: memoryDomainSchema,
  entities: z.array(z.string()).default([]),
  importance: z.number().min(0).max(1).default(0.5),
  compacted: z.boolean().default(false),
  archived: z.boolean().default(false),
  last_accessed_at: z.number().optional(),
  version: z.number().int().default(1),
  checksum: z.string(), // SHA-256
});
export type RawMemoryPayload = z.infer<typeof rawMemoryPayloadSchema>;

export const rawMemoryInputSchema = rawMemoryPayloadSchema.omit({
  checksum: true,
  version: true,
  compacted: true,
  archived: true,
  last_accessed_at: true,
});
export type RawMemoryInput = z.infer<typeof rawMemoryInputSchema>;

// ============================================================================
// COMPACTED MEMORIES (Qdrant: compacted_memories collection)
// ============================================================================

export const compactedMemoryPayloadSchema = z.object({
  summary: z.string(),
  source_session_ids: z.array(z.string()),
  source_count: z.number().int(),
  timestamp: z.number(),
  time_range_start: z.number(),
  time_range_end: z.number(),
  domain: z.string(),
  key_entities: z.array(z.string()).default([]),
  key_decisions: z.array(z.string()).default([]),
  key_facts: z.array(z.string()).default([]),
  importance: z.number().min(0).max(1).default(0.7),
  compaction_model: z.string(),
  version: z.number().int().default(1),
  sync_status: syncStatusSchema.default("pending"),
  archived: z.boolean().default(false),
  last_accessed_at: z.number().optional(),
  checksum: z.string(),
});
export type CompactedMemoryPayload = z.infer<typeof compactedMemoryPayloadSchema>;

// ============================================================================
// ENTITY INDEX (Qdrant: entity_index collection)
// ============================================================================

export const entityPayloadSchema = z.object({
  name: z.string(),
  entity_type: entityTypeSchema,
  description: z.string(),
  first_seen: z.number(),
  last_seen: z.number(),
  mention_count: z.number().int().default(1),
  related_domains: z.array(z.string()).default([]),
  attributes: z.record(z.string(), z.unknown()).default({}),
  version: z.number().int().default(1),
  checksum: z.string(),
});
export type EntityPayload = z.infer<typeof entityPayloadSchema>;

// ============================================================================
// COMPACTION OUTPUT (structured LLM output)
// ============================================================================

export const compactionOutputSchema = z.object({
  summary: z.string().describe("Dense 2-4 paragraph summary"),
  key_decisions: z.array(z.string()).default([]),
  key_facts: z.array(z.string()).default([]),
  key_entities: z.array(z.string()).default([]),
  domain: memoryDomainSchema.default("personal"),
  action_items: z.array(z.string()).default([]),
  emotional_tone: z.string().default("neutral"),
});
export type CompactionOutput = z.infer<typeof compactionOutputSchema>;

// ============================================================================
// SEARCH / RETRIEVAL
// ============================================================================

export const memorySearchOptionsSchema = z.object({
  query: z.string(),
  limit: z.number().int().min(1).max(50).default(10),
  min_score: z.number().min(0).max(1).default(0.25),
  domains: z.array(memoryDomainSchema).optional(),
  include_raw: z.boolean().default(true),
  include_compacted: z.boolean().default(true),
  include_entities: z.boolean().default(true),
  // Metadata pre-filters (reduce candidate set before vector search)
  minImportance: z.number().min(0).max(1).optional(),
  maxAgeDays: z.number().int().min(1).optional(),
  entityTypes: z.array(entityTypeSchema).optional(),
});
export type MemorySearchOptions = z.infer<typeof memorySearchOptionsSchema>;

export const memorySearchResultSchema = z.object({
  id: z.string(),
  collection: z.enum(["raw_memories", "compacted_memories", "entity_index"]),
  score: z.number(), // Final weighted score
  payload: z.record(z.string(), z.unknown()),
});
export type MemorySearchResult = z.infer<typeof memorySearchResultSchema>;

// ============================================================================
// QDRANT COLLECTION CONFIGS
// ============================================================================

export const QDRANT_COLLECTIONS = {
  RAW_MEMORIES: "raw_memories",
  COMPACTED_MEMORIES: "compacted_memories",
  ENTITY_INDEX: "entity_index",
} as const;

export const LOCAL_EMBEDDING_DIMS = 1536; // Gemini 3072 → MRL truncated to 1536 (backward compatible)
export const PINECONE_EMBEDDING_DIMS = 512; // Truncation from 1536 to save storage

// ============================================================================
// EMBEDDING TASK TYPES (Gemini Embedding 001)
// ============================================================================

export type EmbeddingTaskType =
  | "RETRIEVAL_DOCUMENT"     // Storing memories for later retrieval
  | "RETRIEVAL_QUERY"        // Searching/querying stored memories
  | "SEMANTIC_SIMILARITY"    // Dedup similarity checks
  | "FACT_VERIFICATION"      // Hot commit fact pattern matching
  | "CODE_RETRIEVAL_QUERY"   // Code-related memory search
  | "CLASSIFICATION"         // Domain/category classification
  | "CLUSTERING"             // Memory clustering
  | "QUESTION_ANSWERING";    // Q&A retrieval

// Sentinel returned by upsertRawMemory when A-MAC gate rejects a memory
export const QUALITY_GATE_REJECTED = "quality-gate-rejected";

export const PINECONE_NAMESPACES = {
  COMPACTED: "compacted",
  ENTITIES: "entities",
  DECISIONS: "decisions",
} as const;
