/**
 * Mantras & Weekly Rules Routes
 * CRUD for mantras, habits, and rules displayed on /today page
 */
import { Router, Request, Response } from "express";
import { storage } from "../storage";
import { logger } from "../logger";
import { insertMantraSchema } from "@shared/schema";
import { z } from "zod";

const router = Router();

router.get("/", async (req: Request, res: Response) => {
  try {
    const category = req.query.category as string | undefined;
    const isActive = req.query.isActive === "false" ? false : true;
    const items = await storage.getMantras({ category, isActive });
    res.json(items);
  } catch (error) {
    logger.error({ error }, "Error fetching mantras");
    res.status(500).json({ error: "Failed to fetch mantras" });
  }
});

router.get("/today", async (req: Request, res: Response) => {
  try {
    const dayNames = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    const today = dayNames[new Date().getDay()];
    const allActive = await storage.getMantras({ isActive: true });

    // Filter: show mantras that either have no days (always show) or include today
    const todayItems = allActive.filter((m) => {
      if (!m.days || (m.days as string[]).length === 0) return true;
      return (m.days as string[]).includes(today);
    });

    res.json(todayItems);
  } catch (error) {
    logger.error({ error }, "Error fetching today's mantras");
    res.status(500).json({ error: "Failed to fetch today's mantras" });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const data = insertMantraSchema.parse(req.body);
    const item = await storage.createMantra(data);
    res.status(201).json(item);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid mantra data", details: error.issues });
    } else {
      logger.error({ error }, "Error creating mantra");
      res.status(500).json({ error: "Failed to create mantra" });
    }
  }
});

router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const updates = insertMantraSchema.partial().parse(req.body);
    const item = await storage.updateMantra(String(req.params.id), updates);
    if (!item) return res.status(404).json({ error: "Mantra not found" });
    res.json(item);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid mantra data", details: error.issues });
    } else {
      logger.error({ error }, "Error updating mantra");
      res.status(500).json({ error: "Failed to update mantra" });
    }
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    await storage.deleteMantra(String(req.params.id));
    res.json({ success: true });
  } catch (error) {
    logger.error({ error }, "Error deleting mantra");
    res.status(500).json({ error: "Failed to delete mantra" });
  }
});

// Seed default mantras and gym schedule
router.post("/seed", async (req: Request, res: Response) => {
  try {
    const existing = await storage.getMantras();
    if (existing.length > 0) {
      return res.json({ message: "Mantras already seeded", count: existing.length });
    }

    const seeds = [
      { text: "Gym Session (3hr block)", category: "habit" as const, days: ["mon", "wed", "sat"], durationMin: 180, order: 1 },
      { text: "Training Session (2hr block)", category: "habit" as const, days: ["tue", "thu"], durationMin: 120, order: 2 },
      { text: "Close all windows by end of week", category: "rule" as const, days: ["fri"], order: 3 },
      { text: "Does this get us closer to launch?", category: "mantra" as const, order: 4 },
      { text: "Build what ships, not what impresses", category: "mantra" as const, order: 5 },
    ];

    const created = [];
    for (const seed of seeds) {
      created.push(await storage.createMantra(seed));
    }

    res.status(201).json({ message: `Seeded ${created.length} mantras`, count: created.length });
  } catch (error) {
    logger.error({ error }, "Error seeding mantras");
    res.status(500).json({ error: "Failed to seed mantras" });
  }
});

export default router;
