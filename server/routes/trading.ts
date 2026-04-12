/**
 * Trading Routes
 * Trading strategies and daily checklists
 */
import { Router, Request, Response } from "express";
import { storage } from "../storage";
import { logger } from "../logger";
import { insertTradingStrategySchema, type DailyTradingChecklistData } from "@shared/schema";
import { seedTradingStrategies } from "../seeds/trading-strategies";

// ============================================================================
// TRADING STRATEGIES ROUTER
// ============================================================================

const strategiesRouter = Router();

// Get all trading strategies
strategiesRouter.get("/", async (req: Request, res: Response) => {
  try {
    const isActive = req.query.isActive === "true" ? true : req.query.isActive === "false" ? false : undefined;
    const strategies = await storage.getTradingStrategies({ isActive });
    res.json(strategies);
  } catch (error) {
    logger.error({ error }, "Error fetching trading strategies");
    res.status(500).json({ error: "Failed to fetch trading strategies" });
  }
});

// Get the default trading strategy
strategiesRouter.get("/default/active", async (req: Request, res: Response) => {
  try {
    const strategy = await storage.getDefaultTradingStrategy();
    if (!strategy) {
      return res.status(404).json({ error: "No default trading strategy found" });
    }
    res.json(strategy);
  } catch (error) {
    logger.error({ error }, "Error fetching default trading strategy");
    res.status(500).json({ error: "Failed to fetch default trading strategy" });
  }
});

// Get a single trading strategy
strategiesRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    const strategy = await storage.getTradingStrategy(req.params.id);
    if (!strategy) {
      return res.status(404).json({ error: "Trading strategy not found" });
    }
    res.json(strategy);
  } catch (error) {
    logger.error({ error }, "Error fetching trading strategy");
    res.status(500).json({ error: "Failed to fetch trading strategy" });
  }
});

// Create a trading strategy
strategiesRouter.post("/", async (req: Request, res: Response) => {
  try {
    const parsed = insertTradingStrategySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid data", details: parsed.error.issues });
    }
    const strategy = await storage.createTradingStrategy(parsed.data);
    res.status(201).json(strategy);
  } catch (error) {
    logger.error({ error }, "Error creating trading strategy");
    res.status(500).json({ error: "Failed to create trading strategy" });
  }
});

// Seed default trading strategies
strategiesRouter.post("/seed", async (req: Request, res: Response) => {
  try {
    // Ensure tables exist first
    await storage.ensureSchema();

    // Seed strategies (skips any that already exist)
    await seedTradingStrategies(storage);
    const strategies = await storage.getTradingStrategies();
    res.json({ message: "Trading strategies seeded successfully", count: strategies.length, strategies });
  } catch (error: any) {
    logger.error({ error }, "Error seeding trading strategies");
    res.status(500).json({
      error: "Failed to seed trading strategies",
      message: error?.message || "Unknown error",
    });
  }
});

// Update a trading strategy
strategiesRouter.patch("/:id", async (req: Request, res: Response) => {
  try {
    const strategy = await storage.updateTradingStrategy(req.params.id, req.body);
    if (!strategy) {
      return res.status(404).json({ error: "Trading strategy not found" });
    }
    res.json(strategy);
  } catch (error) {
    logger.error({ error }, "Error updating trading strategy");
    res.status(500).json({ error: "Failed to update trading strategy" });
  }
});

// Delete a trading strategy
strategiesRouter.delete("/:id", async (req: Request, res: Response) => {
  try {
    await storage.deleteTradingStrategy(req.params.id);
    res.status(204).send();
  } catch (error) {
    logger.error({ error }, "Error deleting trading strategy");
    res.status(500).json({ error: "Failed to delete trading strategy" });
  }
});

// ============================================================================
// DAILY TRADING CHECKLISTS ROUTER
// ============================================================================

const checklistsRouter = Router();

// Get daily trading checklists
checklistsRouter.get("/", async (req: Request, res: Response) => {
  try {
    const { date, strategyId } = req.query;
    const checklists = await storage.getDailyTradingChecklists({
      date: date as string | undefined,
      strategyId: strategyId as string | undefined,
    });
    res.json(checklists);
  } catch (error) {
    logger.error({ error }, "Error fetching daily trading checklists");
    res.status(500).json({ error: "Failed to fetch daily trading checklists" });
  }
});

// Get ALL trading checklists for today
checklistsRouter.get("/today", async (req: Request, res: Response) => {
  try {
    const today = new Date().toISOString().split("T")[0];
    const checklists = await storage.getDailyTradingChecklists({ date: today });
    res.json(checklists);
  } catch (error) {
    logger.error({ error }, "Error fetching today's trading checklists");
    res.status(500).json({ error: "Failed to fetch today's trading checklists" });
  }
});

// Get a specific trading checklist
checklistsRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    const checklist = await storage.getDailyTradingChecklist(req.params.id);
    if (!checklist) {
      return res.status(404).json({ error: "Trading checklist not found" });
    }
    res.json(checklist);
  } catch (error) {
    logger.error({ error }, "Error fetching trading checklist");
    res.status(500).json({ error: "Failed to fetch trading checklist" });
  }
});

// Create a trading checklist for a specific date and strategy
checklistsRouter.post("/", async (req: Request, res: Response) => {
  try {
    const { date, strategyId, instrument } = req.body;

    if (!date || !strategyId) {
      return res.status(400).json({ error: "date and strategyId are required" });
    }

    // Check if checklist already exists for this date AND strategy
    const existingChecklists = await storage.getDailyTradingChecklists({ date, strategyId });
    if (existingChecklists.length > 0) {
      return res.status(409).json({
        error: "Checklist already exists for this strategy on this date",
        checklist: existingChecklists[0]
      });
    }

    // Get the strategy
    const strategy = await storage.getTradingStrategy(strategyId);
    if (!strategy) {
      return res.status(404).json({ error: "Trading strategy not found" });
    }

    // Ensure day record exists
    const day = await storage.getDayOrCreate(date);

    // Create checklist with optional instrument
    const data: DailyTradingChecklistData = {
      strategyId: strategy.id,
      strategyName: strategy.name,
      instrument: instrument || undefined,
      values: {},
      trades: [],
    };

    const checklist = await storage.createDailyTradingChecklist({
      dayId: day.id,
      date,
      strategyId: strategy.id,
      data,
    });

    res.status(201).json(checklist);
  } catch (error) {
    logger.error({ error }, "Error creating trading checklist");
    res.status(500).json({ error: "Failed to create trading checklist" });
  }
});

// Update a trading checklist
checklistsRouter.patch("/:id", async (req: Request, res: Response) => {
  try {
    const checklist = await storage.updateDailyTradingChecklist(req.params.id, req.body);
    if (!checklist) {
      return res.status(404).json({ error: "Trading checklist not found" });
    }
    res.json(checklist);
  } catch (error) {
    logger.error({ error }, "Error updating trading checklist");
    res.status(500).json({ error: "Failed to update trading checklist" });
  }
});

// Delete a trading checklist
checklistsRouter.delete("/:id", async (req: Request, res: Response) => {
  try {
    await storage.deleteDailyTradingChecklist(req.params.id);
    res.status(204).send();
  } catch (error) {
    logger.error({ error }, "Error deleting trading checklist");
    res.status(500).json({ error: "Failed to delete trading checklist" });
  }
});

// ============================================================================
// ECONOMIC CALENDAR ROUTER
// ============================================================================

// In-memory cache — 1 hour TTL
let calendarCache: { data: unknown[]; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000;

const calendarRouter = Router();

calendarRouter.get("/", async (req: Request, res: Response) => {
  try {
    if (calendarCache && Date.now() - calendarCache.fetchedAt < CACHE_TTL_MS) {
      return res.json(calendarCache.data);
    }

    const response = await fetch(
      "https://nfs.faireconomy.media/ff_calendar_thisweek.json",
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; SB-OS/1.0)",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(8000),
      }
    );

    if (!response.ok) {
      throw new Error(`ForexFactory returned ${response.status}`);
    }

    const raw = (await response.json()) as unknown[];
    calendarCache = { data: raw, fetchedAt: Date.now() };
    res.json(raw);
  } catch (error) {
    logger.error({ error }, "Error fetching economic calendar");
    // Degrade gracefully — return cached data if available, else empty
    res.json(calendarCache?.data ?? []);
  }
});

export { strategiesRouter, checklistsRouter, calendarRouter };
