/**
 * Review Queue Routes
 * Deliverable review and approval workflow.
 * Protected by session auth (applied globally in index.ts).
 * Mounted at /api/review
 */
import { Router, Request, Response } from "express";
import { eq, and, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { agentTasks, agents, deliverableResultSchema } from "@shared/schema";
import { storage } from "../storage";
import { logger } from "../logger";
import {
  approveDeliverable,
  rejectDeliverable,
  requestChanges,
} from "./review-actions";
import { recordReviewFeedback } from "../review-feedback";

const router = Router();

// Lazy DB
let db: any = null;
async function getDb() {
  if (!db) {
    db = (storage as any).db;
  }
  return db;
}

// GET /api/review — List deliverables (filter by status, type, limit/offset)
router.get("/", async (req: Request, res: Response) => {
  try {
    const database = await getDb();
    const {
      status = "needs_review",
      type,
      limit = "50",
      offset = "0",
    } = req.query;

    const conditions = [
      // Only tasks that have a deliverableType (are deliverables)
      sql`${agentTasks.deliverableType} IS NOT NULL`,
    ];

    if (status && status !== "all") {
      conditions.push(eq(agentTasks.status, status as any));
    }

    if (type && type !== "all") {
      conditions.push(sql`${agentTasks.deliverableType} = ${type}`);
    }

    const rows = await database
      .select({
        task: agentTasks,
        agentName: agents.name,
        agentSlug: agents.slug,
      })
      .from(agentTasks)
      .leftJoin(agents, eq(agentTasks.assignedTo, agents.id))
      .where(and(...conditions))
      .orderBy(desc(agentTasks.createdAt))
      .limit(parseInt(String(limit), 10))
      .offset(parseInt(String(offset), 10));

    const enriched = rows.map((r: any) => ({
      ...r.task,
      agentName: r.agentName || "Unknown Agent",
      agentSlug: r.agentSlug || "unknown",
    }));

    res.json(enriched);
  } catch (error) {
    logger.error({ error }, "Error fetching review queue");
    res.status(500).json({ error: "Failed to fetch review queue" });
  }
});

// GET /api/review/stats — Counts by status (for sidebar badge)
router.get("/stats", async (req: Request, res: Response) => {
  try {
    const database = await getDb();

    const rows = await database
      .select({
        status: agentTasks.status,
        count: sql<number>`count(*)::int`,
      })
      .from(agentTasks)
      .where(sql`${agentTasks.deliverableType} IS NOT NULL`)
      .groupBy(agentTasks.status);

    const stats: Record<string, number> = {};
    for (const row of rows) {
      stats[row.status] = row.count;
    }

    res.json({
      pending: stats["needs_review"] || 0,
      approved: stats["completed"] || 0,
      rejected: stats["failed"] || 0,
      total:
        (stats["needs_review"] || 0) +
        (stats["completed"] || 0) +
        (stats["failed"] || 0),
    });
  } catch (error) {
    logger.error({ error }, "Error fetching review stats");
    res.status(500).json({ error: "Failed to fetch review stats" });
  }
});

// GET /api/review/:id — Single deliverable with agent name
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const database = await getDb();
    const id = String(req.params.id);

    const [row] = await database
      .select({
        task: agentTasks,
        agentName: agents.name,
        agentSlug: agents.slug,
      })
      .from(agentTasks)
      .leftJoin(agents, eq(agentTasks.assignedTo, agents.id))
      .where(eq(agentTasks.id, id));

    if (!row) {
      return res.status(404).json({ error: "Deliverable not found" });
    }

    res.json({
      ...row.task,
      agentName: row.agentName || "Unknown Agent",
      agentSlug: row.agentSlug || "unknown",
    });
  } catch (error) {
    logger.error({ error }, "Error fetching deliverable");
    res.status(500).json({ error: "Failed to fetch deliverable" });
  }
});

// POST /api/review/:id/approve — Approve → create doc/tasks based on type
router.post("/:id/approve", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const result = await approveDeliverable(id, req.body?.feedback);

    if (!result.success) {
      const status = result.error?.includes("not found") ? 404 : 400;
      return res.status(status).json({ error: result.error });
    }

    res.json({ success: true, promotedTo: result.promotedTo });
  } catch (error: any) {
    logger.error({ err: error, message: error?.message, stack: error?.stack }, "Error approving deliverable");
    res.status(500).json({ error: "Failed to approve deliverable", detail: error?.message });
  }
});

// POST /api/review/:id/reject — Reject with feedback
router.post("/:id/reject", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const result = await rejectDeliverable(id, req.body?.feedback);

    if (!result.success) {
      return res.status(404).json({ error: result.error });
    }

    recordReviewFeedback(id, req.body?.feedback || "", "rejected").catch((e) =>
      logger.warn({ error: e }, "Failed to record review feedback")
    );

    res.json({ success: true });
  } catch (error) {
    logger.error({ error }, "Error rejecting deliverable");
    res.status(500).json({ error: "Failed to reject deliverable" });
  }
});

// POST /api/review/:id/request-changes — Send back to agent with feedback
router.post("/:id/request-changes", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const { feedback } = req.body;

    if (!feedback) {
      return res.status(400).json({ error: "Feedback is required when requesting changes" });
    }

    const result = await requestChanges(id, feedback);

    if (!result.success) {
      return res.status(404).json({ error: result.error });
    }

    recordReviewFeedback(id, req.body?.feedback || "", "changes_requested").catch((e) =>
      logger.warn({ error: e }, "Failed to record review feedback")
    );

    res.json({ success: true });
  } catch (error) {
    logger.error({ error }, "Error requesting changes");
    res.status(500).json({ error: "Failed to request changes" });
  }
});

// DELETE /api/review — Delete all deliverables from review queue
router.delete("/", async (req: Request, res: Response) => {
  try {
    const database = await getDb();
    const { status } = req.query;

    const conditions = [sql`${agentTasks.deliverableType} IS NOT NULL`];

    if (status && status !== "all") {
      conditions.push(eq(agentTasks.status, status as any));
    }

    const result = await database
      .delete(agentTasks)
      .where(and(...conditions));

    res.json({ success: true, deleted: result.rowCount ?? 0 });
  } catch (error) {
    logger.error({ error }, "Error deleting review queue");
    res.status(500).json({ error: "Failed to delete review queue" });
  }
});

export default router;
