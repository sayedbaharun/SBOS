/**
 * Memory System Routes
 *
 * REST endpoints for the hybrid memory layer:
 * - Memory status and health
 * - Store and retrieve memories
 * - Compaction management
 * - Sync status
 * - Cloud agent (mobile access)
 * - Task queue management
 */

import { Router, type Request, type Response } from "express";
import { logger } from "../logger";
import { z } from "zod";
import { memorySearchOptionsSchema, memoryDomainSchema } from "../memory/schemas";

const router = Router();

// ============================================================================
// STATUS & HEALTH
// ============================================================================

/**
 * GET /api/memory/status
 * Get full memory system status
 */
router.get("/status", async (req: Request, res: Response) => {
  try {
    const { getQdrantStatus } = await import("../memory/qdrant-store");
    const { getPineconeStatus } = await import("../memory/pinecone-store");
    const { getSyncEngineStatus } = await import("../sync/sync-engine");
    const { getQueueStatus } = await import("../agents/task-queue");

    const embeddingsAvailable = !!process.env.OPENROUTER_API_KEY;

    const [qdrant, pinecone, sync, queue] = await Promise.all([
      getQdrantStatus(),
      getPineconeStatus().catch(() => ({
        available: false,
        indexName: "sbos-memory",
        error: "Not configured",
      })),
      getSyncEngineStatus().catch(() => ({
        running: false,
        online: false,
        bufferedEvents: 0,
        pendingEntityUpdates: 0,
        ledgerStats: { total: 0, synced: 0, pendingUp: 0, conflicts: 0 },
      })),
      getQueueStatus().catch(() => ({
        queued: 0,
        running: 0,
        completed: 0,
        failed: 0,
      })),
    ]);

    res.json({
      qdrant,
      embeddings: { available: embeddingsAvailable, provider: "openrouter", model: "text-embedding-3-small" },
      pinecone,
      sync,
      taskQueue: queue,
      ready: qdrant.available && embeddingsAvailable,
    });
  } catch (error) {
    logger.error({ error }, "Failed to get memory status");
    res.status(500).json({ error: "Failed to get memory status" });
  }
});

// ============================================================================
// COLLECTION INIT
// ============================================================================

/**
 * POST /api/memory/init
 * Initialize Qdrant collections
 */
router.post("/init", async (req: Request, res: Response) => {
  try {
    const { initCollections } = await import("../memory/qdrant-store");
    await initCollections();
    res.json({ success: true, message: "Collections initialized" });
  } catch (error) {
    logger.error({ error }, "Failed to initialize collections");
    res.status(500).json({ error: "Failed to initialize collections" });
  }
});

// ============================================================================
// STORE MEMORIES
// ============================================================================

/**
 * POST /api/memory/raw
 * Store a raw memory
 */
router.post("/raw", async (req: Request, res: Response) => {
  try {
    const { upsertRawMemory } = await import("../memory/qdrant-store");

    const body = z
      .object({
        text: z.string().min(1),
        session_id: z.string().uuid(),
        source: z.enum(["conversation", "observation", "mobile_input"]).default("conversation"),
        domain: memoryDomainSchema.default("personal"),
        entities: z.array(z.string()).default([]),
        importance: z.number().min(0).max(1).default(0.5),
      })
      .parse(req.body);

    const id = await upsertRawMemory({
      ...body,
      timestamp: Date.now(),
    });

    res.status(201).json({ id });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid input", details: error.message });
    }
    logger.error({ error }, "Failed to store raw memory");
    res.status(500).json({ error: "Failed to store raw memory" });
  }
});

// ============================================================================
// SEARCH / RETRIEVE
// ============================================================================

/**
 * POST /api/memory/search
 * Search across memory collections
 */
router.post("/search", async (req: Request, res: Response) => {
  try {
    const { retrieveMemories } = await import("../memory/hybrid-retriever");

    const options = memorySearchOptionsSchema.parse(req.body);
    const results = await retrieveMemories(options.query, options);

    res.json({
      query: options.query,
      results,
      count: results.length,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid search options", details: error.message });
    }
    logger.error({ error }, "Memory search failed");
    res.status(500).json({ error: "Memory search failed" });
  }
});

/**
 * POST /api/memory/context
 * Get memory context formatted for AI injection
 */
router.post("/context", async (req: Request, res: Response) => {
  try {
    const { retrieveAsContext } = await import("../memory/hybrid-retriever");

    const { query, ...options } = memorySearchOptionsSchema.parse(req.body);
    const context = await retrieveAsContext(query, options);

    res.json({ query, context, hasContext: context.length > 0 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid options", details: error.message });
    }
    logger.error({ error }, "Context retrieval failed");
    res.status(500).json({ error: "Context retrieval failed" });
  }
});

// ============================================================================
// COMPACTION
// ============================================================================

/**
 * POST /api/memory/compact
 * Manually trigger compaction for a session
 */
router.post("/compact", async (req: Request, res: Response) => {
  try {
    const { compactSession } = await import("../compaction/compactor");

    const { sessionId } = z
      .object({ sessionId: z.string().uuid() })
      .parse(req.body);

    const result = await compactSession(sessionId);

    if (!result) {
      return res.json({ success: false, message: "No messages to compact" });
    }

    res.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid input", details: error.message });
    }
    logger.error({ error }, "Compaction failed");
    res.status(500).json({ error: "Compaction failed" });
  }
});

/**
 * POST /api/memory/compact/messages
 * Compact arbitrary messages (not tied to a session)
 */
router.post("/compact/messages", async (req: Request, res: Response) => {
  try {
    const { compactMessages } = await import("../compaction/compactor");

    const { messages } = z
      .object({
        messages: z.array(
          z.object({
            role: z.string(),
            content: z.string(),
            timestamp: z.number().optional(),
          })
        ),
      })
      .parse(req.body);

    const result = await compactMessages(messages);
    res.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid input", details: error.message });
    }
    logger.error({ error }, "Message compaction failed");
    res.status(500).json({ error: "Message compaction failed" });
  }
});

// ============================================================================
// SESSION MONITORING
// ============================================================================

/**
 * GET /api/memory/session/:sessionId
 * Get session stats from context monitor
 */
router.get("/session/:sessionId", async (req: Request, res: Response) => {
  try {
    const { getSessionStats } = await import("../compaction/context-monitor");

    const stats = getSessionStats(String(req.params.sessionId));
    if (!stats) {
      return res.status(404).json({ error: "Session not found" });
    }
    res.json(stats);
  } catch (error) {
    logger.error({ error }, "Failed to get session stats");
    res.status(500).json({ error: "Failed to get session stats" });
  }
});

// ============================================================================
// SYNC
// ============================================================================

/**
 * GET /api/memory/sync/status
 * Get sync engine status
 */
router.get("/sync/status", async (req: Request, res: Response) => {
  try {
    const { getSyncEngineStatus } = await import("../sync/sync-engine");
    const status = await getSyncEngineStatus();
    res.json(status);
  } catch (error) {
    logger.error({ error }, "Failed to get sync status");
    res.status(500).json({ error: "Failed to get sync status" });
  }
});

/**
 * POST /api/memory/sync/start
 * Start the sync engine
 */
router.post("/sync/start", async (req: Request, res: Response) => {
  try {
    const { startSyncEngine } = await import("../sync/sync-engine");
    startSyncEngine();
    res.json({ success: true, message: "Sync engine started" });
  } catch (error) {
    logger.error({ error }, "Failed to start sync engine");
    res.status(500).json({ error: "Failed to start sync engine" });
  }
});

// ============================================================================
// CLOUD AGENT (Mobile Access)
// ============================================================================

/**
 * POST /api/memory/cloud/query
 * Query the cloud agent (for mobile access)
 * Requires MEMORY_API_KEY header for auth
 */
router.post("/cloud/query", async (req: Request, res: Response) => {
  try {
    // Check API key for mobile access
    const apiKey = String(req.headers["x-memory-api-key"] || "");
    const expectedKey = process.env.MEMORY_API_KEY;

    if (expectedKey && apiKey !== expectedKey) {
      return res.status(401).json({ error: "Invalid API key" });
    }

    const { handleCloudQuery } = await import("../agents/cloud-agent");

    const { query, requireDeepAnalysis } = z
      .object({
        query: z.string().min(1),
        requireDeepAnalysis: z.boolean().default(false),
      })
      .parse(req.body);

    const result = await handleCloudQuery(query, {
      source: "mobile",
      requireDeepAnalysis,
    });

    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid input", details: error.message });
    }
    logger.error({ error }, "Cloud query failed");
    res.status(500).json({ error: "Cloud query failed" });
  }
});

/**
 * POST /api/memory/cloud/write
 * Accept a mobile write (capture/note)
 * Requires MEMORY_API_KEY header for auth
 */
router.post("/cloud/write", async (req: Request, res: Response) => {
  try {
    const apiKey = String(req.headers["x-memory-api-key"] || "");
    const expectedKey = process.env.MEMORY_API_KEY;

    if (expectedKey && apiKey !== expectedKey) {
      return res.status(401).json({ error: "Invalid API key" });
    }

    const { acceptMobileWrite } = await import("../agents/cloud-agent");

    const body = z
      .object({
        text: z.string().min(1),
        source: z.string().default("mobile"),
        domain: z.string().optional(),
      })
      .parse(req.body);

    const result = await acceptMobileWrite(body);
    res.status(201).json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid input", details: error.message });
    }
    logger.error({ error }, "Cloud write failed");
    res.status(500).json({ error: "Cloud write failed" });
  }
});

// ============================================================================
// TASK QUEUE
// ============================================================================

/**
 * GET /api/memory/tasks
 * Get task queue status and recent tasks
 */
router.get("/tasks", async (req: Request, res: Response) => {
  try {
    const { getQueueStatus, getRecentTasks } = await import("../agents/task-queue");

    const [status, recent] = await Promise.all([
      getQueueStatus(),
      getRecentTasks(20),
    ]);

    res.json({ status, recent });
  } catch (error) {
    logger.error({ error }, "Failed to get task queue");
    res.status(500).json({ error: "Failed to get task queue" });
  }
});

/**
 * POST /api/memory/tasks/process
 * Process all pending tasks in the queue
 */
router.post("/tasks/process", async (req: Request, res: Response) => {
  try {
    const { processTaskQueue } = await import("../agents/task-queue");
    const result = await processTaskQueue();
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error({ error }, "Task processing failed");
    res.status(500).json({ error: "Task processing failed" });
  }
});

// ============================================================================
// CLAUDE MEMORY BRIDGE — Ingest markdown from Claude file-based memory
// ============================================================================

/**
 * POST /api/memory/ingest-markdown
 * Accept markdown content from Claude Code's file-based memory system and
 * store it as compacted memories in Qdrant (and Pinecone if ready).
 *
 * Auth: x-memory-api-key header (same key as cloud agent)
 * Body: { content: string, source?: string, tags?: string[] }
 */
router.post("/ingest-markdown", async (req: Request, res: Response) => {
  try {
    // Auth check
    const apiKey = String(req.headers["x-memory-api-key"] || "");
    const expectedKey = process.env.MEMORY_API_KEY;
    if (expectedKey && apiKey !== expectedKey) {
      return res.status(401).json({ error: "Invalid API key" });
    }

    const body = z
      .object({
        content: z.string().min(1).max(50_000),
        source: z.string().default("claude-memory"),
        tags: z.array(z.string()).default(["claude-memory"]),
      })
      .parse(req.body);

    const { generateEmbedding } = await import("../embeddings");
    const { upsertCompactedMemory } = await import("../memory/qdrant-store");
    const { isPineconeReady, upsertToPinecone } = await import("../memory/pinecone-store");
    const { createHash } = await import("crypto");
    const { randomUUID } = await import("crypto");

    // Split content into sections by ## headings
    const sections = body.content
      .split(/\n(?=##\s)/)
      .map((s) => s.trim())
      .filter((s) => s.length > 50); // Skip very short sections

    if (sections.length === 0) {
      return res.json({ success: true, sections: 0, message: "No substantial sections found" });
    }

    const now = Date.now();
    const pineconeReady = await isPineconeReady();
    const pineconeRecords: Array<{ id: string; text: string; metadata: Record<string, unknown> }> = [];
    let stored = 0;

    for (const section of sections) {
      try {
        const id = randomUUID();
        const checksum = createHash("sha256").update(section).digest("hex");

        await upsertCompactedMemory(
          {
            summary: section,
            source_session_ids: [],
            source_count: 1,
            timestamp: now,
            time_range_start: now,
            time_range_end: now,
            domain: "personal",
            key_entities: [],
            key_decisions: [],
            key_facts: [],
            importance: 0.7,
            compaction_model: body.source,
            version: 1,
            sync_status: pineconeReady ? "synced" : "pending",
            archived: false,
            checksum,
          },
          id
        );

        if (pineconeReady) {
          pineconeRecords.push({
            id,
            text: section,
            metadata: { source: body.source, tags: body.tags, timestamp: now, domain: "personal", importance: 0.7 },
          });
        }

        stored++;
      } catch (err: any) {
        logger.warn({ error: err.message }, "Failed to store markdown section");
      }
    }

    // Batch upsert to Pinecone
    if (pineconeReady && pineconeRecords.length > 0) {
      await upsertToPinecone("compacted", pineconeRecords).catch((err: any) =>
        logger.warn({ error: err.message }, "Pinecone upsert failed for markdown ingest")
      );
    }

    res.json({ success: true, sections: stored, totalSections: sections.length, pinecone: pineconeReady });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid input", details: error.message });
    }
    logger.error({ error }, "Markdown ingest failed");
    res.status(500).json({ error: "Markdown ingest failed" });
  }
});

// ============================================================================
// RETRIEVAL METRICS
// ============================================================================

/**
 * GET /api/memory/metrics
 * Returns aggregated retrieval pipeline metrics from in-memory ring buffer.
 * Shows per-arm latency, hit rates, cloud fallback trigger rate.
 */
router.get("/metrics", async (req: Request, res: Response) => {
  try {
    const { getMetrics } = await import("../memory/retrieval-metrics");
    const windowMinutes = req.query.minutes
      ? parseInt(String(req.query.minutes), 10)
      : undefined;
    const metrics = getMetrics(windowMinutes);
    res.json(metrics);
  } catch (error) {
    logger.error({ error }, "Failed to fetch retrieval metrics");
    res.status(500).json({ error: "Failed to fetch retrieval metrics" });
  }
});

export default router;
