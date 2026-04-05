/**
 * Debrief Route
 *
 * POST /api/debrief
 * End-of-day debrief endpoint for Claude Code and other programmatic callers.
 *
 * Body: {
 *   text: string           — freeform debrief dump
 *   sessionLog?: string    — optional Claude Code session log content to merge in
 *   autoConfirm?: boolean  — if true, creates tasks immediately; if false (default), returns parsed items for review
 * }
 */

import { Router, Request, Response } from "express";
import { parseDebrief, executeDebrief } from "../channels/debrief-handler";
import { logger } from "../logger";

const router = Router();

router.post("/", async (req: Request, res: Response) => {
  try {
    const { text, sessionLog, autoConfirm = false } = req.body;

    if (!text || typeof text !== "string" || !text.trim()) {
      return res.status(400).json({
        error: "text is required — describe what you worked on today",
      });
    }

    const parsed = await parseDebrief(text.trim(), sessionLog);

    if (!autoConfirm) {
      return res.json({
        status: "preview",
        items: parsed.items,
        sessionSummary: parsed.sessionSummary,
        message: `Parsed ${parsed.items.length} items. Call again with autoConfirm: true to create tasks.`,
      });
    }

    const result = await executeDebrief(parsed, "web");

    return res.json({
      status: "created",
      created: result.created,
      ventureBreakdown: result.ventureBreakdown,
      sessionSummary: parsed.sessionSummary,
    });
  } catch (error: any) {
    logger.error({ error: error.message }, "Debrief route failed");
    if (error.message?.includes("JSON")) {
      return res.status(422).json({
        error: "Failed to parse debrief — try rewording your input",
      });
    }
    return res.status(500).json({ error: "Debrief failed" });
  }
});

export default router;
