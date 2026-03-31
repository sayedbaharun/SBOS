/**
 * Health Routes
 * CRUD operations for health entries
 */
import { Router, Request, Response } from "express";
import { storage } from "../storage";
import { logger } from "../logger";
import { insertHealthEntrySchema } from "@shared/schema";
import { z } from "zod";
import { isValidUUID } from "./constants";
import { getDriveClient } from "../google-drive";
import { parseSimpleCSV } from "../utils/csv-parser";

const router = Router();

export interface WeightEntry {
  date: string;         // YYYY-MM-DD (derived from "Time" column)
  weightKg: number;
  bodyFatPct: number | null;
  leanBodyMassKg: number | null;
}

// In-memory cache — new CSV uploaded weekly, 1-hour TTL is fine
let weightCache: { data: WeightEntry[]; fetchedAt: number } | null = null;
const WEIGHT_CACHE_TTL_MS = 60 * 60 * 1000;

// SB-OS / Knowledge Base / Health folder ID (fixed — contains weight CSVs)
const HEALTH_FOLDER_ID = "1Oh8r-HygmAi8BrLSNsXUDvklsCyLLAW3";

/**
 * Shared helper — fetches + parses weight CSV from Drive.
 * Results cached in memory for 1 hour.
 */
export async function fetchWeightData(): Promise<WeightEntry[]> {
  if (weightCache && Date.now() - weightCache.fetchedAt < WEIGHT_CACHE_TTL_MS) {
    return weightCache.data;
  }

  const drive = await getDriveClient();

  const fileSearch = await drive.files.list({
    q: `'${HEALTH_FOLDER_ID}' in parents and name contains 'weight' and trashed=false`,
    fields: "files(id, name, mimeType, modifiedTime)",
    orderBy: "modifiedTime desc",
    spaces: "drive",
    pageSize: 10,
  });

  const weightFile = fileSearch.data.files?.[0];
  if (!weightFile?.id) throw new Error("No weight CSV found in SB-OS/Knowledge Base/Health");

  logger.info({ fileId: weightFile.id, fileName: weightFile.name, modified: weightFile.modifiedTime }, "Loading weight CSV");

  let csvText: string;
  if (weightFile.mimeType === "application/vnd.google-apps.spreadsheet") {
    const response = await drive.files.export(
      { fileId: weightFile.id, mimeType: "text/csv" },
      { responseType: "arraybuffer" }
    );
    csvText = Buffer.from(response.data as ArrayBuffer).toString("utf-8");
  } else {
    const response = await drive.files.get(
      { fileId: weightFile.id, alt: "media" },
      { responseType: "arraybuffer" }
    );
    csvText = Buffer.from(response.data as ArrayBuffer).toString("utf-8");
  }

  const rows = parseSimpleCSV(csvText);
  const parsed: WeightEntry[] = [];

  for (const row of rows) {
    const timeVal = row["time"] ?? "";
    const dateVal = timeVal.slice(0, 10);
    if (!dateVal || dateVal.length < 10) continue;

    const weightKg = parseFloat(row["weight (kg)"] ?? "");
    if (isNaN(weightKg) || weightKg === 0) continue;

    const bodyFatPct = parseFloat(row["body fat %"] ?? "");
    const leanBodyMassKg = parseFloat(row["lean body mass (kg)"] ?? "");

    parsed.push({
      date: dateVal,
      weightKg,
      bodyFatPct: isNaN(bodyFatPct) || bodyFatPct === 0 ? null : bodyFatPct,
      leanBodyMassKg: isNaN(leanBodyMassKg) || leanBodyMassKg === 0 ? null : leanBodyMassKg,
    });
  }

  const byDate = new Map<string, WeightEntry>();
  for (const entry of parsed) {
    if (!byDate.has(entry.date)) byDate.set(entry.date, entry);
  }

  const result = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  weightCache = { data: result, fetchedAt: Date.now() };
  return result;
}

/**
 * GET /api/health/weight-trend
 */
router.get("/weight-trend", async (_req: Request, res: Response) => {
  try {
    const result = await fetchWeightData();
    res.json(result);
  } catch (error: any) {
    logger.error({ error }, "Error fetching weight trend from Drive");
    res.status(500).json({ error: "Failed to fetch weight trend", details: error.message });
  }
});

/**
 * POST /api/health/sync-weight
 * Reads latest weight + body fat from Drive CSV and writes into today's healthEntry.
 */
router.post("/sync-weight", async (req: Request, res: Response) => {
  try {
    const entries = await fetchWeightData();
    if (!entries.length) {
      return res.status(404).json({ error: "No weight data found in Drive CSV" });
    }

    // Use the most recent entry
    const latest = entries[entries.length - 1];

    const existing = await storage.getHealthEntryByDate(latest.date);
    const weightFields: Record<string, any> = {
      weightKg: latest.weightKg,
    };
    if (latest.bodyFatPct != null) weightFields.bodyFatPercent = latest.bodyFatPct;

    if (existing) {
      await storage.updateHealthEntry(existing.id, weightFields);
    } else {
      const day = await storage.getDayOrCreate(latest.date);
      await storage.createHealthEntry({ dayId: day.id, date: latest.date, ...weightFields } as any);
    }

    logger.info({ date: latest.date, weightKg: latest.weightKg, bodyFatPct: latest.bodyFatPct }, "Weight synced from Drive CSV");
    res.json({ synced: true, date: latest.date, weightKg: latest.weightKg, bodyFatPct: latest.bodyFatPct });
  } catch (error: any) {
    logger.error({ error }, "Error syncing weight from Drive");
    res.status(500).json({ error: "Failed to sync weight", details: error.message });
  }
});

// Get health entries (with date range)
router.get("/", async (req: Request, res: Response) => {
  try {
    const filters = {
      dateGte: req.query.date_gte as string,
      dateLte: req.query.date_lte as string,
    };

    const cleanFilters = Object.fromEntries(
      Object.entries(filters).filter(([_, value]) => value !== undefined)
    );

    const entries = await storage.getHealthEntries(cleanFilters);
    res.json(entries);
  } catch (error) {
    logger.error({ error }, "Error fetching health entries");
    res.status(500).json({ error: "Failed to fetch health entries" });
  }
});

// Get single health entry
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Validate UUID format to prevent PostgreSQL errors
    if (!isValidUUID(id)) {
      return res.status(400).json({ error: "Invalid health entry ID format" });
    }

    const entry = await storage.getHealthEntry(id);
    if (!entry) {
      return res.status(404).json({ error: "Health entry not found" });
    }
    res.json(entry);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ error, errorMessage, healthEntryId: req.params.id }, "Error fetching health entry");
    res.status(500).json({ error: "Failed to fetch health entry", details: errorMessage });
  }
});

// Create health entry (auto-link to Day)
router.post("/", async (req: Request, res: Response) => {
  try {
    const { date, ...healthData } = insertHealthEntrySchema.parse(req.body);

    // Ensure Day exists for this date (date is already a string in YYYY-MM-DD format)
    const day = await storage.getDayOrCreate(date);

    // Create health entry with dayId
    const entry = await storage.createHealthEntry({
      ...healthData,
      dayId: day.id,
      date,
    } as any);

    res.status(201).json(entry);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid health entry data", details: error.errors });
    } else {
      logger.error({ error }, "Error creating health entry");
      res.status(500).json({ error: "Failed to create health entry" });
    }
  }
});

// Update health entry
router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Validate UUID format to prevent PostgreSQL errors
    if (!isValidUUID(id)) {
      return res.status(400).json({ error: "Invalid health entry ID format" });
    }

    // Log incoming request for debugging
    logger.info({ healthEntryId: id, body: req.body }, "Health entry update request");

    const updates = insertHealthEntrySchema.partial().parse(req.body);
    const entry = await storage.updateHealthEntry(id, updates);
    if (!entry) {
      return res.status(404).json({ error: "Health entry not found" });
    }
    res.json(entry);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid health entry data", details: error.errors, receivedData: req.body });
    } else {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      logger.error({ error, errorMessage, errorStack, healthEntryId: req.params.id, body: req.body }, "Error updating health entry");
      res.status(500).json({ error: "Failed to update health entry", details: errorMessage, receivedData: req.body });
    }
  }
});

export default router;
