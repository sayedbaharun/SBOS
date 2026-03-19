/**
 * Ventures Routes
 * CRUD operations for ventures (business initiatives)
 */
import { Router, Request, Response } from "express";
import { storage } from "../storage";
import { logger } from "../logger";
import { insertVentureSchema } from "@shared/schema";
import { z } from "zod";

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

    // Fire-and-forget: notify via Telegram about new venture
    (async () => {
      try {
        const chatId = process.env.AUTHORIZED_TELEGRAM_CHAT_IDS?.split(",")[0]?.trim();
        if (!chatId) return;

        const { sendProactiveMessage } = await import("../channels/channel-manager");
        const message = `New venture created: ${venture.name}\n\nOpen the AI Agent tab on this venture to start planning — the Venture Architect will guide you through setting up projects, phases, and tasks.`;
        await sendProactiveMessage("telegram", chatId, message);
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

export default router;
