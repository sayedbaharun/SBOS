/**
 * ensureMemoryIndexes
 *
 * Creates any database indexes that Drizzle's schema push cannot handle
 * (e.g. functional GIN indexes on expression columns).
 *
 * Idempotent — uses IF NOT EXISTS, safe to call on every startup.
 */

import { logger } from "../logger";
import { sql } from "drizzle-orm";

export async function ensureMemoryIndexes(): Promise<void> {
  try {
    const { storage } = await import("../storage");
    const db = (storage as any).db;

    // GIN index for full-text search on agent_memory.content
    // Powers the BM25 keyword arm in hybrid-retriever.ts
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_agent_memory_content_fts
      ON agent_memory
      USING gin(to_tsvector('english', content))
    `);

    logger.info("Memory indexes verified (GIN FTS on agent_memory.content)");
  } catch (err: any) {
    // Non-fatal — keyword arm falls back gracefully if index creation fails
    logger.warn({ error: err.message }, "Failed to ensure memory indexes — keyword arm may be slower");
  }
}
