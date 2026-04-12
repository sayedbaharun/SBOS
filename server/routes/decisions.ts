/**
 * Decisions Routes
 *
 * Query API for the agent decision audit trail.
 * Allows Sayed to ask "why did agent X do Y?" and get a full trace.
 */

import { Router } from "express";
import { desc, eq, and, type SQL } from "drizzle-orm";
import { logger } from "../logger";
import { storage } from "../storage";
import { decisions } from "@shared/schema";

// Lazy DB handle
let db: any = null;
async function getDb() {
  if (!db) {
    db = (storage as any).db;
  }
  return db;
}

const router = Router();

/**
 * GET /api/decisions
 * List decisions with optional filters.
 * Query params: agentSlug, action, limit (default 50, max 200), offset (default 0)
 */
router.get("/", async (req: any, res: any) => {
  try {
    const database = await getDb();
    const agentSlug = req.query.agentSlug as string | undefined;
    const action = req.query.action as string | undefined;
    const limit = Math.min(parseInt(String(req.query.limit || "50"), 10), 200);
    const offset = parseInt(String(req.query.offset || "0"), 10);

    const conditions: SQL[] = [];
    if (agentSlug) conditions.push(eq(decisions.agentSlug, agentSlug));
    if (action) conditions.push(eq(decisions.action, action));

    const rows = await database
      .select()
      .from(decisions)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(decisions.createdAt))
      .limit(limit)
      .offset(offset);

    res.json(rows);
  } catch (error: any) {
    logger.error({ error }, "GET /api/decisions failed");
    res.status(500).json({ error: "Failed to fetch decisions" });
  }
});

/**
 * GET /api/decisions/:id
 * Get a single decision by UUID.
 */
router.get("/:id", async (req: any, res: any) => {
  try {
    const database = await getDb();
    const id = String(req.params.id);

    const [row] = await database
      .select()
      .from(decisions)
      .where(eq(decisions.id, id))
      .limit(1);

    if (!row) {
      return res.status(404).json({ error: "Decision not found" });
    }

    res.json(row);
  } catch (error: any) {
    logger.error({ error }, "GET /api/decisions/:id failed");
    res.status(500).json({ error: "Failed to fetch decision" });
  }
});

export default router;
