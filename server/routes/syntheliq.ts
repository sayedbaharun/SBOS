/**
 * Syntheliq Bridge Routes
 * REST proxy to query Syntheliq orchestrator API from SB-OS.
 * Mounted at /api/syntheliq
 */

import { Router, type Request, type Response } from "express";
import {
  getSyntheliqDashboard,
  getSyntheliqRuns,
  getSyntheliqLeads,
  getSyntheliqPipeline,
  getSyntheliqProposals,
  getSyntheliqClients,
  getSyntheliqEscalations,
  pushSyntheliqEvent,
} from "../integrations/syntheliq-client";
import { logger } from "../logger";

const router = Router();

function handleError(res: Response, error: any) {
  logger.error({ error: error.message }, "Syntheliq route error");
  const status = error.message?.includes("not configured") ? 503 : 502;
  res.status(status).json({ error: error.message });
}

router.get("/status", async (_req: Request, res: Response) => {
  try {
    const data = await getSyntheliqDashboard();
    res.json({ data });
  } catch (error: any) {
    handleError(res, error);
  }
});

router.get("/runs", async (req: Request, res: Response) => {
  try {
    const hours = parseInt(String(req.query.hours)) || 24;
    const data = await getSyntheliqRuns(hours);
    res.json({ data });
  } catch (error: any) {
    handleError(res, error);
  }
});

router.get("/leads", async (req: Request, res: Response) => {
  try {
    const status = req.query.status ? String(req.query.status) : undefined;
    const data = await getSyntheliqLeads(status);
    res.json({ data });
  } catch (error: any) {
    handleError(res, error);
  }
});

router.get("/pipeline", async (_req: Request, res: Response) => {
  try {
    const data = await getSyntheliqPipeline();
    res.json({ data });
  } catch (error: any) {
    handleError(res, error);
  }
});

router.get("/proposals", async (req: Request, res: Response) => {
  try {
    const status = req.query.status ? String(req.query.status) : undefined;
    const data = await getSyntheliqProposals(status);
    res.json({ data });
  } catch (error: any) {
    handleError(res, error);
  }
});

router.get("/clients", async (req: Request, res: Response) => {
  try {
    const status = req.query.status ? String(req.query.status) : undefined;
    const data = await getSyntheliqClients(status);
    res.json({ data });
  } catch (error: any) {
    handleError(res, error);
  }
});

router.get("/escalations", async (_req: Request, res: Response) => {
  try {
    const data = await getSyntheliqEscalations();
    res.json({ data });
  } catch (error: any) {
    handleError(res, error);
  }
});

router.post("/events", async (req: Request, res: Response) => {
  try {
    const { type, payload } = req.body;
    if (!type) {
      res.status(400).json({ error: "Event type is required" });
      return;
    }
    const data = await pushSyntheliqEvent(type, payload);
    res.json({ data });
  } catch (error: any) {
    handleError(res, error);
  }
});

export default router;
