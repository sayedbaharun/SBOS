/**
 * Approval Policies Routes
 *
 * CRUD endpoints for managing auto-approval policies.
 * Policies let low-risk agent deliverables skip the manual review queue.
 *
 * GET    /api/approval-policies           List policies (filterable)
 * POST   /api/approval-policies           Create a policy
 * PATCH  /api/approval-policies/:id       Update a policy
 * DELETE /api/approval-policies/:id       Delete a policy
 */

import { Router, Request, Response } from "express";
import { eq, and, SQL } from "drizzle-orm";
import { z } from "zod";
import { storage } from "../storage";
import { logger } from "../logger";
import { approvalPolicies, insertApprovalPolicySchema } from "@shared/schema";

const router = Router();

// Lazy DB handle — mirrors the pattern used in other server/agents/* files.
let db: any = null;
async function getDb() {
  if (!db) {
    db = (storage as any).db;
  }
  return db;
}

// ---------------------------------------------------------------------------
// GET / — list policies with optional filters
// ---------------------------------------------------------------------------
router.get("/", async (req: Request, res: Response) => {
  try {
    const database = await getDb();

    const conditions: SQL[] = [];

    if (req.query.agentSlug) {
      conditions.push(eq(approvalPolicies.agentSlug, String(req.query.agentSlug)));
    }
    if (req.query.ventureId) {
      conditions.push(eq(approvalPolicies.ventureId, String(req.query.ventureId)));
    }
    if (req.query.active !== undefined) {
      const activeVal = req.query.active !== "false";
      conditions.push(eq(approvalPolicies.active, activeVal));
    }

    const rows =
      conditions.length > 0
        ? await database
            .select()
            .from(approvalPolicies)
            .where(and(...conditions))
        : await database.select().from(approvalPolicies);

    res.json(rows);
  } catch (error) {
    logger.error({ error }, "Error fetching approval policies");
    res.status(500).json({ error: "Failed to fetch approval policies" });
  }
});

// ---------------------------------------------------------------------------
// POST / — create a new policy
// ---------------------------------------------------------------------------
router.post("/", async (req: Request, res: Response) => {
  try {
    const data = insertApprovalPolicySchema.parse(req.body);
    const database = await getDb();

    const [created] = await database
      .insert(approvalPolicies)
      .values(data)
      .returning();

    res.status(201).json(created);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res
        .status(400)
        .json({ error: "Invalid policy data", details: error.issues });
    }
    logger.error({ error }, "Error creating approval policy");
    res.status(500).json({ error: "Failed to create approval policy" });
  }
});

// ---------------------------------------------------------------------------
// PATCH /:id — update an existing policy
// ---------------------------------------------------------------------------
router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const updates = insertApprovalPolicySchema.partial().parse(req.body);
    const database = await getDb();

    const [updated] = await database
      .update(approvalPolicies)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(approvalPolicies.id, id))
      .returning();

    if (!updated) {
      return res.status(404).json({ error: "Approval policy not found" });
    }

    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res
        .status(400)
        .json({ error: "Invalid policy data", details: error.issues });
    }
    logger.error({ error }, "Error updating approval policy");
    res.status(500).json({ error: "Failed to update approval policy" });
  }
});

// ---------------------------------------------------------------------------
// DELETE /:id — delete a policy
// ---------------------------------------------------------------------------
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const database = await getDb();

    const [deleted] = await database
      .delete(approvalPolicies)
      .where(eq(approvalPolicies.id, id))
      .returning();

    if (!deleted) {
      return res.status(404).json({ error: "Approval policy not found" });
    }

    res.json({ success: true, id });
  } catch (error) {
    logger.error({ error }, "Error deleting approval policy");
    res.status(500).json({ error: "Failed to delete approval policy" });
  }
});

export default router;
