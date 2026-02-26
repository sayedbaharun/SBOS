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
    const database = await getDb();
    const id = String(req.params.id);

    const [task] = await database
      .select()
      .from(agentTasks)
      .where(eq(agentTasks.id, id));

    if (!task) {
      return res.status(404).json({ error: "Deliverable not found" });
    }

    if (task.status !== "needs_review") {
      return res.status(400).json({ error: `Cannot approve task with status: ${task.status}` });
    }

    const result = task.result as Record<string, any>;
    if (!result || !result.type) {
      return res.status(400).json({ error: "Deliverable has no structured result" });
    }

    const promotedTo: Array<{ type: string; id: string }> = [];

    switch (result.type) {
      case "document": {
        const doc = await storage.createDoc({
          title: result.title,
          body: result.body,
          type: result.docType || "page",
          domain: result.domain,
          ventureId: result.ventureId || undefined,
          status: "active",
        });
        promotedTo.push({ type: "doc", id: String(doc.id) });
        break;
      }

      case "recommendation": {
        if (result.suggestedAction === "create_task") {
          const details = result.actionDetails || {};
          const newTask = await storage.createTask({
            title: result.title,
            notes: `${result.summary}\n\n**Rationale:** ${result.rationale}`,
            priority: details.priority || "P2",
            status: "todo",
            ventureId: details.ventureId,
          });
          promotedTo.push({ type: "task", id: String(newTask.id) });
        } else if (result.suggestedAction === "create_doc") {
          const doc = await storage.createDoc({
            title: result.title,
            body: `## Summary\n${result.summary}\n\n## Rationale\n${result.rationale}`,
            type: "research",
            status: "active",
          });
          promotedTo.push({ type: "doc", id: String(doc.id) });
        }
        // no_action — just mark approved, no entity created
        break;
      }

      case "action_items": {
        const items = result.items || [];
        for (const item of items) {
          const newTask = await storage.createTask({
            title: item.title,
            notes: item.notes,
            priority: item.priority || "P2",
            status: "todo",
            ventureId: item.ventureId || undefined,
            projectId: item.projectId || undefined,
            dueDate: item.dueDate,
          });
          promotedTo.push({ type: "task", id: String(newTask.id) });
        }
        break;
      }

      case "code": {
        const lang = result.language || "typescript";
        const body = `${result.description ? `${result.description}\n\n` : ""}\`\`\`${lang}\n${result.code}\n\`\`\``;
        const doc = await storage.createDoc({
          title: result.title,
          body,
          type: "tech_doc",
          ventureId: result.ventureId || undefined,
          status: "active",
        });
        promotedTo.push({ type: "doc", id: String(doc.id) });
        break;
      }

      default:
        return res.status(400).json({ error: `Unknown deliverable type: ${result.type}` });
    }

    // Update task status
    await database
      .update(agentTasks)
      .set({
        status: "completed",
        promotedTo,
        completedAt: new Date(),
        reviewFeedback: req.body.feedback || null,
      })
      .where(eq(agentTasks.id, id));

    logger.info({ taskId: id, promotedTo }, "Deliverable approved");
    res.json({ success: true, promotedTo });
  } catch (error) {
    logger.error({ error }, "Error approving deliverable");
    res.status(500).json({ error: "Failed to approve deliverable" });
  }
});

// POST /api/review/:id/reject — Reject with feedback
router.post("/:id/reject", async (req: Request, res: Response) => {
  try {
    const database = await getDb();
    const id = String(req.params.id);
    const { feedback } = req.body;

    const [task] = await database
      .select()
      .from(agentTasks)
      .where(eq(agentTasks.id, id));

    if (!task) {
      return res.status(404).json({ error: "Deliverable not found" });
    }

    await database
      .update(agentTasks)
      .set({
        status: "failed",
        reviewFeedback: feedback || "Rejected",
        completedAt: new Date(),
      })
      .where(eq(agentTasks.id, id));

    logger.info({ taskId: id }, "Deliverable rejected");
    res.json({ success: true });
  } catch (error) {
    logger.error({ error }, "Error rejecting deliverable");
    res.status(500).json({ error: "Failed to reject deliverable" });
  }
});

// POST /api/review/:id/request-changes — Send back to agent with feedback
router.post("/:id/request-changes", async (req: Request, res: Response) => {
  try {
    const database = await getDb();
    const id = String(req.params.id);
    const { feedback } = req.body;

    if (!feedback) {
      return res.status(400).json({ error: "Feedback is required when requesting changes" });
    }

    const [task] = await database
      .select()
      .from(agentTasks)
      .where(eq(agentTasks.id, id));

    if (!task) {
      return res.status(404).json({ error: "Deliverable not found" });
    }

    await database
      .update(agentTasks)
      .set({
        status: "pending",
        reviewFeedback: feedback,
      })
      .where(eq(agentTasks.id, id));

    logger.info({ taskId: id }, "Changes requested on deliverable");
    res.json({ success: true });
  } catch (error) {
    logger.error({ error }, "Error requesting changes");
    res.status(500).json({ error: "Failed to request changes" });
  }
});

export default router;
