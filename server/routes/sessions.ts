/**
 * Session Routes
 *
 * Cross-session continuity for Claude Code and other clients.
 * - GET /context — "catch me up" briefing for new sessions
 * - GET /search — semantic search across past session logs
 * - POST /log — save a session summary
 */
import { Router, Request, Response } from "express";
import { desc, gte, ilike, or } from "drizzle-orm";
import { logger } from "../logger";
import {
  sessionLogs,
  agentConversations,
  agents,
  captureItems,
  agentMemory,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { getUserDate } from "../utils/dates";

const router = Router();

// Lazy DB
let db: any = null;
async function getDb() {
  if (!db) {
    const { storage } = await import("../storage");
    db = (storage as any).db;
  }
  return db;
}

// ============================================================================
// GET /context — startup briefing for new sessions
// ============================================================================

router.get("/context", async (req: Request, res: Response) => {
  try {
    const database = await getDb();
    const { storage } = await import("../storage");
    const hours = parseInt(String(req.query.hours || "72"));
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const today = getUserDate();

    // Run queries in parallel
    const [recentConversations, todayDay, recentCaptures, recentLearnings, recentSessions, openTasks] =
      await Promise.all([
        // Recent agent conversations
        database
          .select({
            id: agentConversations.id,
            agentId: agentConversations.agentId,
            role: agentConversations.role,
            content: agentConversations.content,
            metadata: agentConversations.metadata,
            createdAt: agentConversations.createdAt,
            agentName: agents.name,
            agentSlug: agents.slug,
          })
          .from(agentConversations)
          .leftJoin(agents, eq(agentConversations.agentId, agents.id))
          .where(gte(agentConversations.createdAt, since))
          .orderBy(desc(agentConversations.createdAt))
          .limit(50),

        // Today's day record
        storage.getDayOrCreate(today),

        // Recent captures
        database
          .select()
          .from(captureItems)
          .where(gte(captureItems.createdAt, since))
          .orderBy(desc(captureItems.createdAt))
          .limit(20),

        // Recent learnings
        database
          .select()
          .from(agentMemory)
          .where(gte(agentMemory.createdAt, since))
          .orderBy(desc(agentMemory.createdAt))
          .limit(20),

        // Recent session logs
        database
          .select()
          .from(sessionLogs)
          .orderBy(desc(sessionLogs.createdAt))
          .limit(5),

        // Open tasks
        storage.getTasks({ status: undefined, limit: 20 }),
      ]);

    const activeTasks = openTasks.filter(
      (t: any) => t.status === "in_progress" || t.status === "todo"
    );

    res.json({
      generatedAt: new Date().toISOString(),
      periodHours: hours,
      today: todayDay,
      recentConversations,
      recentCaptures,
      recentLearnings: recentLearnings.map((l: any) => ({
        id: l.id,
        type: l.memoryType,
        content: l.content,
        importance: l.importance,
        scope: l.scope,
        createdAt: l.createdAt,
      })),
      recentSessions,
      openTasks: activeTasks.slice(0, 15),
    });
  } catch (error) {
    logger.error({ error }, "Error generating session context");
    res.status(500).json({ error: "Failed to generate session context" });
  }
});

// ============================================================================
// GET /search — search past session logs
// ============================================================================

router.get("/search", async (req: Request, res: Response) => {
  try {
    const database = await getDb();
    const query = String(req.query.q || "").trim();
    if (!query) {
      return res.status(400).json({ error: "Query parameter 'q' is required" });
    }
    const limit = Math.min(parseInt(String(req.query.limit || "10")), 50);

    // Text search across summary, key topics, and decisions
    const results = await database
      .select()
      .from(sessionLogs)
      .where(
        or(
          ilike(sessionLogs.summary, `%${query}%`),
        )
      )
      .orderBy(desc(sessionLogs.createdAt))
      .limit(limit);

    res.json(results);
  } catch (error) {
    logger.error({ error }, "Error searching session logs");
    res.status(500).json({ error: "Failed to search session logs" });
  }
});

// ============================================================================
// POST /log — save a session summary
// ============================================================================

router.post("/log", async (req: Request, res: Response) => {
  try {
    const database = await getDb();
    const { source, summary, keyTopics, decisions, openThreads, filesModified, tags } = req.body;

    if (!source || !summary) {
      return res.status(400).json({ error: "source and summary are required" });
    }

    const [created] = await database
      .insert(sessionLogs)
      .values({
        source,
        summary,
        keyTopics: keyTopics || [],
        decisions: decisions || [],
        openThreads: openThreads || [],
        filesModified: filesModified || [],
        tags: tags || [],
      })
      .returning();

    // Generate embedding async (fire-and-forget)
    try {
      const { generateEmbedding, serializeEmbedding } = await import("../embeddings");
      const embeddingText = `${summary} ${(keyTopics || []).join(" ")} ${(decisions || []).join(" ")}`;
      generateEmbedding(embeddingText).then(async (result) => {
        await database
          .update(sessionLogs)
          .set({ embedding: serializeEmbedding(result.embedding) })
          .where(eq(sessionLogs.id, created.id));
      }).catch((err: any) =>
        logger.warn({ error: err.message }, "Session log embedding failed (non-critical)")
      );
    } catch {
      // Non-critical
    }

    res.status(201).json(created);
  } catch (error) {
    logger.error({ error }, "Error saving session log");
    res.status(500).json({ error: "Failed to save session log" });
  }
});

export default router;
