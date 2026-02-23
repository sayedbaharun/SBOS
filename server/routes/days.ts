/**
 * Days Routes
 * CRUD operations for daily logs
 */
import { Router, Request, Response } from "express";
import { storage } from "../storage";
import { logger } from "../logger";
import { insertDaySchema } from "@shared/schema";
import { getUserDate } from "../utils/dates";
import { z } from "zod";

const router = Router();

// Get days (with date range)
router.get("/", async (req: Request, res: Response) => {
  try {
    const filters = {
      dateGte: req.query.date_gte as string,
      dateLte: req.query.date_lte as string,
    };

    const days = await storage.getDays(filters);
    res.json(days);
  } catch (error) {
    logger.error({ error }, "Error fetching days");
    res.status(500).json({ error: "Failed to fetch days" });
  }
});

// Get today's day (auto-create if doesn't exist)
router.get("/today", async (req: Request, res: Response) => {
  try {
    const today = getUserDate();
    const day = await storage.getDayOrCreate(today);
    res.json(day);
  } catch (error) {
    logger.error({ error }, "Error fetching today's day");
    res.status(500).json({ error: "Failed to fetch today's day" });
  }
});

// Get day by date
router.get("/:date", async (req: Request, res: Response) => {
  try {
    const day = await storage.getDay(req.params.date);
    if (!day) {
      return res.status(404).json({ error: "Day not found" });
    }
    res.json(day);
  } catch (error) {
    logger.error({ error }, "Error fetching day");
    res.status(500).json({ error: "Failed to fetch day" });
  }
});

// Create day
router.post("/", async (req: Request, res: Response) => {
  try {
    const validatedData = insertDaySchema.parse(req.body);
    const day = await storage.createDay(validatedData);
    res.status(201).json(day);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid day data", details: error.errors });
    } else {
      logger.error({ error }, "Error creating day");
      res.status(500).json({ error: "Failed to create day" });
    }
  }
});

// Update day by date
router.patch("/:date", async (req: Request, res: Response) => {
  try {
    const updates = insertDaySchema.partial().parse(req.body);
    const day = await storage.updateDay(req.params.date, updates);
    if (!day) {
      return res.status(404).json({ error: "Day not found" });
    }
    res.json(day);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid day data", details: error.errors });
    } else {
      logger.error({ error }, "Error updating day");
      res.status(500).json({ error: "Failed to update day" });
    }
  }
});

// Delete day by date
router.delete("/:date", async (req: Request, res: Response) => {
  try {
    await storage.deleteDay(req.params.date);
    res.json({ success: true });
  } catch (error) {
    logger.error({ error }, "Error deleting day");
    res.status(500).json({ error: "Failed to delete day" });
  }
});

export default router;
