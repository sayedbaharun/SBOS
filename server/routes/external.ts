/**
 * External Agent API Routes
 * All endpoints require external agent API key authentication.
 * Mounted at /api/external
 */
import { Router, Request, Response } from "express";
import { storage } from "../storage";
import { logger } from "../logger";
import { requireExternalAuth } from "../middleware/external-auth";
import { insertResearchSubmissionSchema } from "@shared/schema";
import { z } from "zod";

const router = Router();

// All routes require external auth
router.use(requireExternalAuth);

// ============================================================================
// RESEARCH SUBMISSIONS
// ============================================================================

// POST /api/external/research — Submit a research finding
router.post("/research", async (req: Request, res: Response) => {
  try {
    const agent = req.externalAgent!;
    const validated = insertResearchSubmissionSchema.parse({
      ...req.body,
      externalAgentId: agent.id,
    });

    const submission = await storage.createResearchSubmission(validated);
    logger.info({ agentId: agent.id, submissionId: submission.id }, "External agent submitted research");
    res.status(201).json(submission);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid data", details: (error as any).errors || error.issues });
    } else {
      logger.error({ error }, "Error creating research submission");
      res.status(500).json({ error: "Failed to create research submission" });
    }
  }
});

// GET /api/external/research — List own submissions (agent-scoped)
router.get("/research", async (req: Request, res: Response) => {
  try {
    const agent = req.externalAgent!;
    const { status, category, limit, offset } = req.query;

    const submissions = await storage.getResearchSubmissions({
      externalAgentId: agent.id,
      status: status as string | undefined,
      category: category as string | undefined,
      limit: limit ? parseInt(String(limit), 10) : undefined,
      offset: offset ? parseInt(String(offset), 10) : undefined,
    });

    res.json(submissions);
  } catch (error) {
    logger.error({ error }, "Error fetching research submissions");
    res.status(500).json({ error: "Failed to fetch research submissions" });
  }
});

// GET /api/external/research/:id — Get submission details (agent-scoped)
router.get("/research/:id", async (req: Request, res: Response) => {
  try {
    const agent = req.externalAgent!;
    const submission = await storage.getResearchSubmission(String(req.params.id));

    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    // Agents can only see their own submissions
    if (submission.externalAgentId !== agent.id) {
      return res.status(404).json({ error: "Submission not found" });
    }

    res.json(submission);
  } catch (error) {
    logger.error({ error }, "Error fetching research submission");
    res.status(500).json({ error: "Failed to fetch research submission" });
  }
});

// ============================================================================
// CONTEXT ENDPOINT
// ============================================================================

// GET /api/external/context — Get SB-OS context for research targeting
router.get("/context", async (req: Request, res: Response) => {
  try {
    const agent = req.externalAgent!;

    // Get active ventures
    const allVentures = await storage.getVentures();
    const activeVentures = allVentures
      .filter((v) => v.status !== "archived")
      .map((v) => ({
        id: v.id,
        name: v.name,
        oneLiner: v.oneLiner,
        status: v.status,
      }));

    // Get recent tasks for priorities
    const today = new Date().toISOString().split("T")[0];
    const urgentTasks = await storage.getUrgentTasks(today, 5);
    const priorities = urgentTasks.map((t) => ({
      id: t.id,
      title: t.title,
      priority: t.priority,
      status: t.status,
      dueDate: t.dueDate,
    }));

    // Get existing submissions from this agent to avoid duplicates
    const existingSubmissions = await storage.getResearchSubmissions({
      externalAgentId: agent.id,
      limit: 50,
    });
    const recentSubmissions = existingSubmissions.map((s) => ({
      id: s.id,
      title: s.title,
      status: s.status,
      category: s.category,
    }));

    res.json({
      ventures: activeVentures,
      priorities,
      recentSubmissions,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error({ error }, "Error fetching external context");
    res.status(500).json({ error: "Failed to fetch context" });
  }
});

// ============================================================================
// QUERY ENDPOINT
// ============================================================================

// POST /api/external/query — Search SB-OS knowledge base
router.post("/query", async (req: Request, res: Response) => {
  try {
    const { query, limit } = req.body;

    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "Query string is required" });
    }

    // Search docs using existing search infrastructure
    const docs = await storage.searchDocs(query);
    const results = docs.slice(0, limit || 10).map((d) => ({
      id: d.id,
      title: d.title,
      type: d.type,
      domain: d.domain,
      snippet: d.body ? d.body.substring(0, 300) : null,
    }));

    res.json({ query, results, count: results.length });
  } catch (error) {
    logger.error({ error }, "Error querying knowledge base");
    res.status(500).json({ error: "Failed to query knowledge base" });
  }
});

export default router;
