/**
 * Internal Research Review Routes
 * Used by the web UI for reviewing/approving research submissions.
 * Protected by session auth (applied globally in index.ts).
 * Mounted at /api/research
 */
import { Router, Request, Response } from "express";
import { storage } from "../storage";
import { logger } from "../logger";
import { z } from "zod";

const router = Router();

// GET /api/research — List all submissions (with filters)
router.get("/", async (req: Request, res: Response) => {
  try {
    const { status, category, externalAgentId, limit, offset } = req.query;

    const submissions = await storage.getResearchSubmissions({
      status: status as string | undefined,
      category: category as string | undefined,
      externalAgentId: externalAgentId as string | undefined,
      limit: limit ? parseInt(String(limit), 10) : undefined,
      offset: offset ? parseInt(String(offset), 10) : undefined,
    });

    // Enrich with agent names
    const agentIds = Array.from(new Set(submissions.map((s) => s.externalAgentId)));
    const agents = await Promise.all(agentIds.map((id) => storage.getExternalAgent(id)));
    const agentMap = new Map(agents.filter(Boolean).map((a) => [a!.id, a!]));

    const enriched = submissions.map((s) => ({
      ...s,
      agentName: agentMap.get(s.externalAgentId)?.name || "Unknown Agent",
      agentSlug: agentMap.get(s.externalAgentId)?.slug || "unknown",
    }));

    res.json(enriched);
  } catch (error) {
    logger.error({ error }, "Error fetching research submissions");
    res.status(500).json({ error: "Failed to fetch research submissions" });
  }
});

// GET /api/research/:id — Get full submission
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const submission = await storage.getResearchSubmission(String(req.params.id));
    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    // Enrich with agent info
    const agent = await storage.getExternalAgent(submission.externalAgentId);

    res.json({
      ...submission,
      agentName: agent?.name || "Unknown Agent",
      agentSlug: agent?.slug || "unknown",
    });
  } catch (error) {
    logger.error({ error }, "Error fetching research submission");
    res.status(500).json({ error: "Failed to fetch research submission" });
  }
});

// Validation schemas for approve/reject
const approveSchema = z.object({
  promoteTo: z.enum(["venture", "capture", "doc"]),
  name: z.string().optional(),
  description: z.string().optional(),
  notes: z.string().optional(),
});

// POST /api/research/:id/approve — Approve and promote
router.post("/:id/approve", async (req: Request, res: Response) => {
  try {
    const submission = await storage.getResearchSubmission(String(req.params.id));
    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    if (submission.status !== "pending" && submission.status !== "needs_more_info") {
      return res.status(400).json({ error: `Cannot approve submission with status: ${submission.status}` });
    }

    const { promoteTo, name, description, notes } = approveSchema.parse(req.body);
    let promotedTo: { type: string; id: string } | undefined;

    if (promoteTo === "venture") {
      const venture = await storage.createVenture({
        name: name || submission.title,
        oneLiner: description || submission.summary,
        notes: `Source: External research submission\n\n${submission.fullContent || submission.summary}`,
        status: "planning",
      });
      promotedTo = { type: "venture", id: venture.id };
    } else if (promoteTo === "capture") {
      const capture = await storage.createCapture({
        title: submission.title,
        notes: `${submission.summary}\n\n${submission.fullContent || ""}`,
        type: "idea",
        source: "web",
      });
      promotedTo = { type: "capture", id: capture.id };
    } else if (promoteTo === "doc") {
      const doc = await storage.createDoc({
        title: name || submission.title,
        type: "research",
        body: submission.fullContent || submission.summary,
        tags: submission.tags ? (submission.tags as string[]) : undefined,
        status: "active",
      });
      promotedTo = { type: "doc", id: doc.id };
    }

    const updated = await storage.updateResearchSubmission(submission.id, {
      status: "approved",
      reviewNote: notes || null,
      promotedTo: promotedTo || null,
      reviewedAt: new Date(),
    });

    logger.info({ submissionId: submission.id, promoteTo, promotedTo }, "Research submission approved");
    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid data", details: (error as any).errors || error.issues });
    } else {
      logger.error({ error }, "Error approving research submission");
      res.status(500).json({ error: "Failed to approve research submission" });
    }
  }
});

// POST /api/research/:id/reject — Reject with note
router.post("/:id/reject", async (req: Request, res: Response) => {
  try {
    const submission = await storage.getResearchSubmission(String(req.params.id));
    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    const { note } = req.body;

    const updated = await storage.updateResearchSubmission(submission.id, {
      status: "rejected",
      reviewNote: note || null,
      reviewedAt: new Date(),
    });

    logger.info({ submissionId: submission.id }, "Research submission rejected");
    res.json(updated);
  } catch (error) {
    logger.error({ error }, "Error rejecting research submission");
    res.status(500).json({ error: "Failed to reject research submission" });
  }
});

// POST /api/research/:id/request-info — Request more info from agent
router.post("/:id/request-info", async (req: Request, res: Response) => {
  try {
    const submission = await storage.getResearchSubmission(String(req.params.id));
    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    const { note } = req.body;

    const updated = await storage.updateResearchSubmission(submission.id, {
      status: "needs_more_info",
      reviewNote: note || null,
    });

    logger.info({ submissionId: submission.id }, "More info requested for research submission");
    res.json(updated);
  } catch (error) {
    logger.error({ error }, "Error requesting more info");
    res.status(500).json({ error: "Failed to update research submission" });
  }
});

// ============================================================================
// EXTERNAL AGENT MANAGEMENT
// ============================================================================

// GET /api/research/agents — List all registered external agents
router.get("/agents", async (_req: Request, res: Response) => {
  try {
    const agents = await storage.getExternalAgents();
    // Don't expose API key hashes
    const safe = agents.map(({ apiKeyHash, ...rest }) => rest);
    res.json(safe);
  } catch (error) {
    logger.error({ error }, "Error fetching external agents");
    res.status(500).json({ error: "Failed to fetch external agents" });
  }
});

// POST /api/research/agents/register — Register a new external agent
router.post("/agents/register", async (req: Request, res: Response) => {
  try {
    const { name, type } = req.body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "Agent name is required" });
    }

    // Generate slug from name
    const slug = name.toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").substring(0, 100);

    // Generate a random API key
    const { randomBytes } = await import("crypto");
    const apiKey = `sbos_${randomBytes(32).toString("hex")}`;

    // Hash it for storage
    const { hashApiKey } = await import("../middleware/external-auth");
    const apiKeyHash = hashApiKey(apiKey);

    const agent = await storage.createExternalAgent({
      name: name.trim(),
      slug,
      apiKeyHash,
      type: type || "research",
    });

    // Return the agent WITHOUT hash, but WITH the plaintext key (shown once)
    const { apiKeyHash: _, ...safeAgent } = agent;
    res.status(201).json({ agent: safeAgent, apiKey });
  } catch (error) {
    logger.error({ error }, "Error registering external agent");
    res.status(500).json({ error: "Failed to register external agent" });
  }
});

// PATCH /api/research/agents/:id — Update agent (status, name, etc.)
router.patch("/agents/:id", async (req: Request, res: Response) => {
  try {
    const { status, name } = req.body;
    const updates: Record<string, any> = {};
    if (status) updates.status = status;
    if (name) updates.name = name;

    const updated = await storage.updateExternalAgent(String(req.params.id), updates);
    if (!updated) {
      return res.status(404).json({ error: "Agent not found" });
    }

    const { apiKeyHash, ...safe } = updated;
    res.json(safe);
  } catch (error) {
    logger.error({ error }, "Error updating external agent");
    res.status(500).json({ error: "Failed to update external agent" });
  }
});

// DELETE /api/research/agents/:id — Delete an external agent
router.delete("/agents/:id", async (req: Request, res: Response) => {
  try {
    await storage.deleteExternalAgent(String(req.params.id));
    res.json({ success: true });
  } catch (error) {
    logger.error({ error }, "Error deleting external agent");
    res.status(500).json({ error: "Failed to delete external agent" });
  }
});

export default router;
