/**
 * Ventures Routes
 * CRUD operations for ventures (business initiatives)
 */
import { Router, Request, Response } from "express";
import { storage } from "../storage";
import { logger } from "../logger";
import { insertVentureSchema, insertVentureGoalSchema, insertKeyResultSchema } from "@shared/schema";
import { z } from "zod";
import { stageVenturePack, approveVenturePack } from "../agents/venture-pack";
import { publishEvent } from "../events/bus";
import { createTopicForVenture, getTopicForVenture } from "../channels/telegram-topic-service";
import { upsertVenturePinnedCard } from "../channels/pinned-cards";

const router = Router();

// Get all ventures
router.get("/", async (req: Request, res: Response) => {
  try {
    const ventures = await storage.getVentures();
    res.json(ventures);
  } catch (error) {
    logger.error({ error }, "Error fetching ventures");
    res.status(500).json({ error: "Failed to fetch ventures" });
  }
});

// Get single venture (supports both UUID and slug lookup)
router.get("/:idOrSlug", async (req: Request, res: Response) => {
  try {
    const venture = await storage.getVentureByIdOrSlug(req.params.idOrSlug);
    if (!venture) {
      return res.status(404).json({ error: "Venture not found" });
    }
    res.json(venture);
  } catch (error) {
    logger.error({ error }, "Error fetching venture");
    res.status(500).json({ error: "Failed to fetch venture" });
  }
});

// Create venture
router.post("/", async (req: Request, res: Response) => {
  try {
    const validatedData = insertVentureSchema.parse(req.body);
    const venture = await storage.createVenture(validatedData);
    res.status(201).json(venture);

    // Fire-and-forget: create Telegram topic + notify
    (async () => {
      try {
        const threadId = await createTopicForVenture(venture);

        const chatId = process.env.AUTHORIZED_TELEGRAM_CHAT_IDS?.split(",")[0]?.trim();
        if (!chatId) return;

        const { sendProactiveMessage } = await import("../channels/channel-manager");
        const topicNote = threadId ? ` A Telegram topic has been created for this venture.` : "";
        const message = `New venture created: ${venture.name}${topicNote}\n\nOpen the AI Agent tab on this venture to start planning.`;
        await sendProactiveMessage("telegram", chatId, message, threadId ?? undefined);
      } catch (err) {
        logger.error({ err, ventureId: venture.id }, "Failed to send venture creation notification");
      }
    })();
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid venture data", details: error.errors });
    } else {
      logger.error({ error }, "Error creating venture");
      res.status(500).json({ error: "Failed to create venture" });
    }
  }
});

// Update venture
router.patch("/:id", async (req: Request, res: Response) => {
  try {
    logger.info({ ventureId: req.params.id, body: req.body }, "Updating venture");
    const updates = insertVentureSchema.partial().parse(req.body);
    logger.info({ ventureId: req.params.id, updates }, "Validated venture updates");
    const venture = await storage.updateVenture(req.params.id, updates);
    if (!venture) {
      return res.status(404).json({ error: "Venture not found" });
    }
    res.json(venture);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid venture data", details: error.errors });
    } else {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      logger.error({ error, errorMessage, errorStack, ventureId: req.params.id, body: req.body }, "Error updating venture");
      res.status(500).json({ error: "Failed to update venture", details: errorMessage });
    }
  }
});

// Delete venture
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    await storage.deleteVenture(req.params.id);
    res.json({ success: true });
  } catch (error) {
    logger.error({ error }, "Error deleting venture");
    res.status(500).json({ error: "Failed to delete venture" });
  }
});

// GET /api/ventures/:id/telegram-topic — Get existing Telegram topic for venture
router.get("/:id/telegram-topic", async (req: Request, res: Response) => {
  try {
    const topic = await getTopicForVenture(String(req.params.id));
    if (!topic) {
      return res.status(404).json({ error: "No Telegram topic found for this venture" });
    }
    res.json(topic);
  } catch (error) {
    logger.error({ error }, "Error fetching venture telegram topic");
    res.status(500).json({ error: "Failed to fetch Telegram topic" });
  }
});

// POST /api/ventures/:id/create-telegram-topic — Manually create topic for existing venture
router.post("/:id/create-telegram-topic", async (req: Request, res: Response) => {
  try {
    const venture = await storage.getVentureByIdOrSlug(String(req.params.id));
    if (!venture) {
      return res.status(404).json({ error: "Venture not found" });
    }
    const threadId = await createTopicForVenture(venture);
    if (threadId === null) {
      return res.status(503).json({ error: "Telegram not configured or topic already exists" });
    }
    res.json({ success: true, threadId });
  } catch (error) {
    logger.error({ error }, "Error creating venture telegram topic");
    res.status(500).json({ error: "Failed to create Telegram topic" });
  }
});

// GET /api/ventures/:ventureId/content — Venture-scoped content deliverables
router.get("/:ventureId/content", async (req: Request, res: Response) => {
  try {
    const ventureId = String(req.params.ventureId);
    const { status, format, limit = "50" } = req.query;

    const { eq, and, desc, sql, inArray } = await import("drizzle-orm");
    const { agentTasks, agents } = await import("@shared/schema");
    const db = (storage as any).db;

    const contentTypes = ["social_post", "video_script", "carousel"];
    const conditions: any[] = [
      sql`${agentTasks.deliverableType} IN ('social_post', 'video_script', 'carousel')`,
    ];

    // Filter by agent's ventureId — join agents to check
    conditions.push(eq(agents.ventureId, ventureId));

    if (status && status !== "all") {
      conditions.push(eq(agentTasks.status, status as any));
    }

    if (format && format !== "all" && contentTypes.includes(format as string)) {
      conditions.push(sql`${agentTasks.deliverableType} = ${format}`);
    }

    const rows = await db
      .select({
        task: agentTasks,
        agentName: agents.name,
        agentSlug: agents.slug,
      })
      .from(agentTasks)
      .innerJoin(agents, eq(agentTasks.assignedTo, agents.id))
      .where(and(...conditions))
      .orderBy(desc(agentTasks.createdAt))
      .limit(parseInt(String(limit), 10));

    const enriched = rows.map((r: any) => ({
      ...r.task,
      agentName: r.agentName || "Unknown Agent",
      agentSlug: r.agentSlug || "unknown",
    }));

    res.json(enriched);
  } catch (error) {
    logger.error({ error }, "Error fetching venture content");
    res.status(500).json({ error: "Failed to fetch venture content" });
  }
});

// ============================================================================
// VENTURE GOALS
// ============================================================================

// List goals for a venture
router.get("/:ventureId/goals", async (req: Request, res: Response) => {
  try {
    const goals = await storage.getVentureGoals(req.params.ventureId);
    // Attach key results to each goal
    const withKRs = await Promise.all(
      goals.map(async (g) => ({ ...g, keyResults: await storage.getKeyResults(g.id) }))
    );
    res.json(withKRs);
  } catch (error) {
    logger.error({ error }, "Error fetching venture goals");
    res.status(500).json({ error: "Failed to fetch venture goals" });
  }
});

// Create a goal (optionally with key results in body)
router.post("/:ventureId/goals", async (req: Request, res: Response) => {
  try {
    const parse = insertVentureGoalSchema.safeParse({ ...req.body, ventureId: req.params.ventureId });
    if (!parse.success) return res.status(400).json({ error: parse.error.issues });

    const goal = await storage.createVentureGoal(parse.data);

    // Create key results if provided
    const krs = req.body.keyResults as Array<{ title: string; targetValue: number; unit: string; projectId?: string }> | undefined;
    const createdKRs = krs
      ? await Promise.all(krs.map((kr) => storage.createKeyResult({ ...kr, goalId: goal.id, currentValue: 0 })))
      : [];

    // Set this as the venture's currentGoalId
    await storage.updateVenture(req.params.ventureId, { currentGoalId: goal.id } as any);

    res.status(201).json({ ...goal, keyResults: createdKRs });
  } catch (error) {
    logger.error({ error }, "Error creating venture goal");
    res.status(500).json({ error: "Failed to create venture goal" });
  }
});

// Update a goal
router.patch("/goals/:goalId", async (req: Request, res: Response) => {
  try {
    const updated = await storage.updateVentureGoal(req.params.goalId, req.body);
    if (!updated) return res.status(404).json({ error: "Goal not found" });
    res.json(updated);
  } catch (error) {
    logger.error({ error }, "Error updating venture goal");
    res.status(500).json({ error: "Failed to update venture goal" });
  }
});

// Delete a goal
router.delete("/goals/:goalId", async (req: Request, res: Response) => {
  try {
    await storage.deleteVentureGoal(req.params.goalId);
    res.json({ success: true });
  } catch (error) {
    logger.error({ error }, "Error deleting venture goal");
    res.status(500).json({ error: "Failed to delete venture goal" });
  }
});

// List key results for a goal
router.get("/goals/:goalId/key-results", async (req: Request, res: Response) => {
  try {
    const krs = await storage.getKeyResults(req.params.goalId);
    res.json(krs);
  } catch (error) {
    logger.error({ error }, "Error fetching key results");
    res.status(500).json({ error: "Failed to fetch key results" });
  }
});

// Add a key result to a goal
router.post("/goals/:goalId/key-results", async (req: Request, res: Response) => {
  try {
    const parse = insertKeyResultSchema.safeParse({ ...req.body, goalId: req.params.goalId, currentValue: req.body.currentValue ?? 0 });
    if (!parse.success) return res.status(400).json({ error: parse.error.issues });
    const kr = await storage.createKeyResult(parse.data);
    res.status(201).json(kr);
  } catch (error) {
    logger.error({ error }, "Error creating key result");
    res.status(500).json({ error: "Failed to create key result" });
  }
});

// Update a key result
router.patch("/key-results/:krId", async (req: Request, res: Response) => {
  try {
    const updated = await storage.updateKeyResult(req.params.krId, req.body);
    if (!updated) return res.status(404).json({ error: "Key result not found" });
    res.json(updated);
  } catch (error) {
    logger.error({ error }, "Error updating key result");
    res.status(500).json({ error: "Failed to update key result" });
  }
});

// Quick progress update
router.patch("/key-results/:krId/progress", async (req: Request, res: Response) => {
  try {
    const { currentValue } = req.body;
    if (typeof currentValue !== "number") return res.status(400).json({ error: "currentValue must be a number" });
    const updated = await storage.updateKeyResultProgress(req.params.krId, currentValue);
    if (!updated) return res.status(404).json({ error: "Key result not found" });
    res.json(updated);

    // Publish events + update pinned card (all fire-and-forget)
    if (updated.status === "at_risk" || updated.status === "behind") {
      publishEvent("kr.at_risk", {
        krId: updated.id,
        title: updated.title,
        goalId: updated.goalId,
        status: updated.status,
        currentValue: updated.currentValue,
        targetValue: updated.targetValue,
      }).catch(() => {});
    }

    publishEvent("kr.progress_updated", {
      krId: updated.id,
      goalId: updated.goalId,
      currentValue: updated.currentValue,
      targetValue: updated.targetValue,
      status: updated.status,
    }).catch(() => {});

    // Resolve ventureId via goalId and refresh the pinned KR card in the venture's topic
    storage.getVentureGoal(updated.goalId)
      .then((goal: any) => {
        if (goal?.ventureId) upsertVenturePinnedCard(String(goal.ventureId));
      })
      .catch(() => {});
  } catch (error) {
    logger.error({ error }, "Error updating key result progress");
    res.status(500).json({ error: "Failed to update progress" });
  }
});

// Delete a key result
router.delete("/key-results/:krId", async (req: Request, res: Response) => {
  try {
    await storage.deleteKeyResult(req.params.krId);
    res.json({ success: true });
  } catch (error) {
    logger.error({ error }, "Error deleting key result");
    res.status(500).json({ error: "Failed to delete key result" });
  }
});

// ============================================================================
// Venture Pack (Drive staging + approval pipeline)
// ============================================================================

// POST /api/ventures/:id/stage-pack — generate docs in Drive staging folder
router.post("/:ventureId/stage-pack", async (req: Request, res: Response) => {
  try {
    const venture = await storage.getVenture(String(req.params.ventureId));
    if (!venture) return res.status(404).json({ error: "Venture not found" });

    const questionnaire = req.body ?? {};
    if (!questionnaire.ventureType) questionnaire.ventureType = venture.domain ?? "other";

    const pack = await stageVenturePack({ venture, questionnaire });
    res.status(201).json(pack);
  } catch (error) {
    logger.error({ error }, "Error staging venture pack");
    res.status(500).json({ error: "Failed to stage venture pack" });
  }
});

// POST /api/ventures/:id/approve-pack — commit staged pack to DB
router.post("/:ventureId/approve-pack", async (req: Request, res: Response) => {
  try {
    const venture = await storage.getVenture(String(req.params.ventureId));
    if (!venture) return res.status(404).json({ error: "Venture not found" });

    const { goals, projects, vision, mission } = req.body;
    if (!Array.isArray(goals) || !Array.isArray(projects)) {
      return res.status(400).json({ error: "goals and projects arrays are required" });
    }

    const result = await approveVenturePack({
      ventureId: venture.id,
      goals,
      projects,
      vision,
      mission,
    });

    res.status(201).json(result);
  } catch (error) {
    logger.error({ error }, "Error approving venture pack");
    res.status(500).json({ error: "Failed to approve venture pack" });
  }
});

// GET /api/ventures/:id/staged-pack — get staged pack status (Drive folder link)
router.get("/:ventureId/staged-pack", async (req: Request, res: Response) => {
  try {
    const venture = await storage.getVenture(String(req.params.ventureId));
    if (!venture) return res.status(404).json({ error: "Venture not found" });

    // Return staging status from active goal (if any) + venture fields
    const activeGoal = await storage.getActiveVentureGoal(venture.id);
    res.json({
      ventureId: venture.id,
      ventureName: venture.name,
      vision: (venture as any).vision ?? null,
      mission: (venture as any).mission ?? null,
      currentGoalId: (venture as any).currentGoalId ?? null,
      activeGoal: activeGoal ?? null,
      stagingStatus: activeGoal ? "committed" : "none",
    });
  } catch (error) {
    logger.error({ error }, "Error fetching staged pack status");
    res.status(500).json({ error: "Failed to fetch staged pack status" });
  }
});

// ============================================================================
// LAUNCH READINESS — Track 10-category launch checklist per venture
// ============================================================================

// GET /api/ventures/:id/launch-readiness
router.get("/:id/launch-readiness", async (req: Request, res: Response) => {
  try {
    const venture = await storage.getVenture(String(req.params.id));
    if (!venture) return res.status(404).json({ error: "Venture not found" });

    const items = await storage.getVentureLaunchReadiness(venture.id);
    const score = computeReadinessScore(items);
    const tier = computeCurrentTier(items);

    res.json({ ventureId: venture.id, score, currentTier: tier, items });
  } catch (error) {
    logger.error({ error }, "Error fetching launch readiness");
    res.status(500).json({ error: "Failed to fetch launch readiness" });
  }
});

// POST /api/ventures/:id/launch-readiness/bulk — upsert all items
router.post("/:id/launch-readiness/bulk", async (req: Request, res: Response) => {
  try {
    const venture = await storage.getVenture(String(req.params.id));
    if (!venture) return res.status(404).json({ error: "Venture not found" });

    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "items array is required" });
    }

    await storage.upsertVentureLaunchReadiness(venture.id, items);
    const updated = await storage.getVentureLaunchReadiness(venture.id);

    res.json({ success: true, count: updated.length });
  } catch (error) {
    logger.error({ error }, "Error bulk upserting launch readiness");
    res.status(500).json({ error: "Failed to update launch readiness" });
  }
});

// PATCH /api/ventures/:id/launch-readiness/:itemId — update single item
router.patch("/:id/launch-readiness/:itemId", async (req: Request, res: Response) => {
  try {
    const { status, agentReady, notes } = req.body;
    const updated = await storage.updateVentureLaunchReadinessItem(
      String(req.params.itemId),
      { status, agentReady, notes }
    );
    if (!updated) return res.status(404).json({ error: "Item not found" });
    res.json(updated);
  } catch (error) {
    logger.error({ error }, "Error updating launch readiness item");
    res.status(500).json({ error: "Failed to update item" });
  }
});

// POST /api/ventures/:id/launch-readiness/run-audit — AI audit of venture readiness
router.post("/:id/launch-readiness/run-audit", async (req: Request, res: Response) => {
  try {
    const venture = await storage.getVenture(String(req.params.id));
    if (!venture) return res.status(404).json({ error: "Venture not found" });

    const [projects, tasks, docs] = await Promise.all([
      storage.getProjects({ ventureId: venture.id }),
      storage.getTasks({ ventureId: venture.id }),
      storage.getDocs({ ventureId: venture.id }),
    ]);

    const { auditVentureReadiness } = await import("../agents/launch-readiness-parser");
    const parsed = await auditVentureReadiness({
      name: venture.name,
      oneLiner: venture.oneLiner,
      domain: venture.domain,
      notes: venture.notes,
      projectCount: projects.length,
      taskCount: tasks.length,
      docCount: docs.length,
    });

    const items = parsed.categories.flatMap(cat =>
      cat.items.map(item => ({
        category: cat.id,
        categoryName: cat.name,
        item: item.item,
        tier: item.tier,
        status: item.status,
        agentReady: item.agentReady,
        notes: null as string | null,
      }))
    );

    await storage.upsertVentureLaunchReadiness(venture.id, items);
    const updated = await storage.getVentureLaunchReadiness(venture.id);
    const score = computeReadinessScore(updated);
    const tier = computeCurrentTier(updated);

    res.json({ success: true, score, currentTier: tier, count: updated.length });
  } catch (error) {
    logger.error({ error }, "Error running launch readiness audit");
    res.status(500).json({ error: "Failed to run audit" });
  }
});

// Helper: compute 1-100 readiness score
function computeReadinessScore(items: any[]): number {
  if (items.length === 0) return 0;
  const weights: Record<string, number> = { mvp: 3, soft: 2, full: 1 };
  let total = 0, max = 0;
  for (const item of items) {
    if (item.status === 'na') continue;
    const w = weights[item.tier] || 1;
    max += w;
    if (item.status === 'done') total += w;
    else if (item.status === 'partial') total += w * 0.5;
  }
  return max === 0 ? 0 : Math.round((total / max) * 100);
}

// Helper: determine current tier
function computeCurrentTier(items: any[]): string {
  const active = items.filter(i => i.status !== 'na');
  const mvpItems = active.filter(i => i.tier === 'mvp');
  const softItems = active.filter(i => i.tier === 'soft');
  const fullItems = active.filter(i => i.tier === 'full');
  const allDone = (arr: any[]) => arr.every(i => i.status === 'done');
  if (mvpItems.length > 0 && !allDone(mvpItems)) return 'pre-mvp';
  if (softItems.length > 0 && !allDone(softItems)) return 'mvp';
  if (fullItems.length > 0 && !allDone(fullItems)) return 'soft';
  return 'full';
}

export default router;
