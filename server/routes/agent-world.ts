/**
 * Agent World State Route
 *
 * GET /api/agent/world-state
 * Returns a dense JSON snapshot of the current operating state for AI agents.
 * Response is cached for 60 seconds in-process.
 */
import { Router, Request, Response } from "express";
import { logger } from "../logger";
import { buildWorldState } from "../agent-world/builder";

const router = Router();

router.get("/world-state", async (_req: Request, res: Response) => {
  try {
    const state = await buildWorldState();
    res.json(state);
  } catch (error) {
    logger.error({ error }, "Error building agent world state");
    res.status(500).json({ error: "Failed to build world state" });
  }
});

export default router;
