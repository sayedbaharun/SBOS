/**
 * Event Subscriptions Routes
 * Full CRUD for event_subscriptions table.
 *
 * GET    /api/event-subscriptions         list (filterable)
 * POST   /api/event-subscriptions         create
 * PATCH  /api/event-subscriptions/:id     update
 * DELETE /api/event-subscriptions/:id     delete
 */
import { Router, Request, Response } from "express";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { logger } from "../logger";
import { storage } from "../storage";
import {
  eventSubscriptions,
  insertEventSubscriptionSchema,
} from "@shared/schema";

const router = Router();

// Lazy DB
let db: any = null;
async function getDb() {
  if (!db) {
    db = (storage as any).db;
  }
  return db;
}

// ─── GET / ────────────────────────────────────────────────────────────────────
router.get("/", async (req: Request, res: Response) => {
  try {
    const database = await getDb();

    let rows = await database.select().from(eventSubscriptions);

    // Optional query filters (post-filter for simplicity)
    const { eventType, agentSlug, active } = req.query;

    if (eventType) {
      rows = rows.filter((r: any) => r.eventType === String(eventType));
    }
    if (agentSlug) {
      rows = rows.filter((r: any) => r.agentSlug === String(agentSlug));
    }
    if (active !== undefined) {
      const activeBool = active === "true";
      rows = rows.filter((r: any) => r.active === activeBool);
    }

    return res.json(rows);
  } catch (error: any) {
    logger.error({ error: error.message }, "GET /event-subscriptions failed");
    return res.status(500).json({ error: "Failed to list event subscriptions" });
  }
});

// ─── POST / ───────────────────────────────────────────────────────────────────
router.post("/", async (req: Request, res: Response) => {
  try {
    const data = insertEventSubscriptionSchema.parse(req.body);
    const database = await getDb();

    const [row] = await database
      .insert(eventSubscriptions)
      .values(data)
      .returning();

    return res.status(201).json(row);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", issues: error.issues });
    }
    logger.error({ error: error.message }, "POST /event-subscriptions failed");
    return res.status(500).json({ error: "Failed to create event subscription" });
  }
});

// ─── PATCH /:id ───────────────────────────────────────────────────────────────
const updateSchema = z.object({
  eventType: z.string().min(1).optional(),
  agentSlug: z.string().min(1).optional(),
  filterJson: z.record(z.string(), z.unknown()).nullable().optional(),
  active: z.boolean().optional(),
});

router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const updates = updateSchema.parse(req.body);

    const database = await getDb();

    const [existing] = await database
      .select()
      .from(eventSubscriptions)
      .where(eq(eventSubscriptions.id, id));

    if (!existing) {
      return res.status(404).json({ error: "Event subscription not found" });
    }

    const [updated] = await database
      .update(eventSubscriptions)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(eventSubscriptions.id, id))
      .returning();

    return res.json(updated);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", issues: error.issues });
    }
    logger.error({ error: error.message }, "PATCH /event-subscriptions/:id failed");
    return res.status(500).json({ error: "Failed to update event subscription" });
  }
});

// ─── DELETE /:id ──────────────────────────────────────────────────────────────
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const database = await getDb();

    const [existing] = await database
      .select()
      .from(eventSubscriptions)
      .where(eq(eventSubscriptions.id, id));

    if (!existing) {
      return res.status(404).json({ error: "Event subscription not found" });
    }

    await database
      .delete(eventSubscriptions)
      .where(eq(eventSubscriptions.id, id));

    return res.json({ success: true });
  } catch (error: any) {
    logger.error({ error: error.message }, "DELETE /event-subscriptions/:id failed");
    return res.status(500).json({ error: "Failed to delete event subscription" });
  }
});

export default router;
