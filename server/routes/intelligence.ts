/**
 * Intelligence Routes
 * Daily intelligence synthesis + email triage + meeting prep APIs
 */
import { Router, Request, Response } from "express";
import { logger } from "../logger";
import { storage } from "../storage";
import { getUserDate } from "../utils/dates";

const router = Router();

// ============================================================================
// DAILY INTELLIGENCE
// ============================================================================

// GET /daily — Get today's intelligence synthesis
router.get("/daily", async (req: Request, res: Response) => {
  try {
    const date = (req.query.date as string) || getUserDate();
    const intel = await storage.getDailyIntelligence(date);

    if (!intel) {
      return res.json({
        available: false,
        message: "No intelligence synthesis for this date. Runs at 8:45am Dubai.",
      });
    }

    res.json({ available: true, ...intel });
  } catch (error: any) {
    logger.error({ error: error.message }, "Error fetching daily intelligence");
    res.status(500).json({ error: "Failed to fetch daily intelligence" });
  }
});

// GET /history — Get past intelligence syntheses
router.get("/history", async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 7;
    const history = await storage.getDailyIntelligenceHistory(limit);
    res.json(history);
  } catch (error: any) {
    logger.error({ error: error.message }, "Error fetching intelligence history");
    res.status(500).json({ error: "Failed to fetch intelligence history" });
  }
});

// POST /run — Manually trigger intelligence synthesis
router.post("/run", async (req: Request, res: Response) => {
  try {
    const { runDailyIntelligence } = await import("../agents/intelligence-synthesizer");
    const result = await runDailyIntelligence();
    res.json(result);
  } catch (error: any) {
    logger.error({ error: error.message }, "Error running intelligence synthesis");
    res.status(500).json({ error: "Failed to run intelligence synthesis" });
  }
});

// ============================================================================
// EMAIL TRIAGE
// ============================================================================

// GET /email/triage — Get email triage results
router.get("/email/triage", async (req: Request, res: Response) => {
  try {
    const date = (req.query.date as string) || getUserDate();
    const classification = req.query.classification as string;
    const limit = parseInt(req.query.limit as string) || 50;

    const triaged = await storage.getEmailTriage({ date, classification, limit });
    res.json(triaged);
  } catch (error: any) {
    logger.error({ error: error.message }, "Error fetching email triage");
    res.status(500).json({ error: "Failed to fetch email triage" });
  }
});

// GET /email/triage/:id — Get single triaged email
router.get("/email/triage/:id", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const triage = await storage.getEmailTriageById(id);
    if (!triage) {
      return res.status(404).json({ error: "Triaged email not found" });
    }
    res.json(triage);
  } catch (error: any) {
    logger.error({ error: error.message }, "Error fetching triaged email");
    res.status(500).json({ error: "Failed to fetch triaged email" });
  }
});

// POST /email/triage/run — Manually trigger email triage
router.post("/email/triage/run", async (req: Request, res: Response) => {
  try {
    const { runEmailTriage } = await import("../agents/email-triage");
    const result = await runEmailTriage();
    res.json(result);
  } catch (error: any) {
    logger.error({ error: error.message }, "Error running email triage");
    res.status(500).json({ error: "Failed to run email triage" });
  }
});

// POST /email/reply — Send email reply
router.post("/email/reply", async (req: Request, res: Response) => {
  try {
    const { emailId, message } = req.body;
    if (!emailId || !message) {
      return res.status(400).json({ error: "emailId and message are required" });
    }

    const triage = await storage.getEmailTriageByEmailId(emailId);
    if (!triage) {
      return res.status(404).json({ error: "Email not found in triage" });
    }

    const { sendEmail } = await import("../gmail");
    const result = await sendEmail({
      to: triage.fromAddress,
      subject: `Re: ${triage.subject}`,
      body: message,
      threadId: triage.threadId || undefined,
    });

    res.json(result);
  } catch (error: any) {
    logger.error({ error: error.message }, "Error sending email reply");
    res.status(500).json({ error: "Failed to send email reply" });
  }
});

// ============================================================================
// MEETING PREPS
// ============================================================================

// GET /meeting-preps — Get meeting preps
router.get("/meeting-preps", async (req: Request, res: Response) => {
  try {
    const date = (req.query.date as string) || getUserDate();
    const preps = await storage.getMeetingPreps({ date });
    res.json(preps);
  } catch (error: any) {
    logger.error({ error: error.message }, "Error fetching meeting preps");
    res.status(500).json({ error: "Failed to fetch meeting preps" });
  }
});

// POST /meeting-preps/run — Manually trigger meeting prep check
router.post("/meeting-preps/run", async (req: Request, res: Response) => {
  try {
    const { checkAndPrepMeetings } = await import("../agents/meeting-prep");
    const result = await checkAndPrepMeetings();
    res.json(result);
  } catch (error: any) {
    logger.error({ error: error.message }, "Error running meeting prep");
    res.status(500).json({ error: "Failed to run meeting prep" });
  }
});

// ============================================================================
// NUDGE STATS
// ============================================================================

// GET /nudges/stats — Get nudge response analytics
router.get("/nudges/stats", async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 14;
    const stats = await storage.getNudgeResponseStats(days);
    res.json(stats);
  } catch (error: any) {
    logger.error({ error: error.message }, "Error fetching nudge stats");
    res.status(500).json({ error: "Failed to fetch nudge stats" });
  }
});

export default router;
