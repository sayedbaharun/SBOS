/**
 * Events Routes
 * POST /api/events/publish  — publish an event
 * GET  /api/events/log      — read the event log
 */
import { Router, Request, Response } from "express";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { logger } from "../logger";
import { storage } from "../storage";
import { eventLog } from "@shared/schema";
import { publishEvent } from "../events/bus";

const router = Router();

// Lazy DB
let db: any = null;
async function getDb() {
  if (!db) {
    db = (storage as any).db;
  }
  return db;
}

// ─── POST /publish ────────────────────────────────────────────────────────────
const publishSchema = z.object({
  eventType: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).default({}),
});

router.post("/publish", async (req: Request, res: Response) => {
  try {
    const parsed = publishSchema.parse(req.body);
    const deliveredTo = await publishEvent(
      parsed.eventType,
      parsed.payload as Record<string, any>
    );

    // Grab the latest log row for this event to return its id
    const database = await getDb();
    const [latest] = await database
      .select()
      .from(eventLog)
      .where(eq(eventLog.eventType, parsed.eventType))
      .orderBy(desc(eventLog.createdAt))
      .limit(1);

    return res.status(201).json({
      deliveredTo,
      logId: latest?.id ?? null,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", issues: error.issues });
    }
    logger.error({ error: error.message }, "POST /events/publish failed");
    return res.status(500).json({ error: "Failed to publish event" });
  }
});

// ─── GET /log ─────────────────────────────────────────────────────────────────
router.get("/log", async (req: Request, res: Response) => {
  try {
    const database = await getDb();

    const rawLimit = parseInt(String(req.query.limit ?? "50"), 10);
    const limit = Math.min(isNaN(rawLimit) || rawLimit < 1 ? 50 : rawLimit, 200);
    const offset = parseInt(String(req.query.offset ?? "0"), 10) || 0;
    const typeFilter = req.query.type ? String(req.query.type) : null;

    const query = database
      .select()
      .from(eventLog)
      .orderBy(desc(eventLog.createdAt))
      .limit(limit)
      .offset(offset);

    let rows = await query;

    // Post-filter by type if requested (avoids complex conditional drizzle query)
    if (typeFilter) {
      rows = rows.filter((r: any) => r.eventType === typeFilter);
    }

    return res.json(rows);
  } catch (error: any) {
    logger.error({ error: error.message }, "GET /events/log failed");
    return res.status(500).json({ error: "Failed to fetch event log" });
  }
});

export default router;
