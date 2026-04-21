/**
 * Decision Memories Routes
 * CRUD operations for decision memory capture and outcome loop
 */
import { Router, Request, Response } from "express";
import { storage } from "../storage";
import { logger } from "../logger";
import {
  insertDecisionMemorySchema,
  updateDecisionMemorySchema,
  closeDecisionMemorySchema,
  type DecisionDerivedMetadata,
} from "@shared/schema";
import { z } from "zod";

const router = Router();

/**
 * Generate derived metadata for a decision using AI
 * This is called synchronously at save-time with a small spinner in the UI
 */
async function generateDerivedMetadata(
  context: string,
  decision: string,
  reasoning: string | null
): Promise<DecisionDerivedMetadata | null> {
  try {
    // Check if OpenRouter API key is available
    if (!process.env.OPENROUTER_API_KEY) {
      logger.warn("No OPENROUTER_API_KEY set, skipping derived metadata generation");
      return null;
    }

    const OpenAI = (await import("openai")).default;
    const openai = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
    });

    const prompt = `Analyze this decision and extract structured metadata. Be concise.

CONTEXT: ${context}

DECISION: ${decision}

REASONING: ${reasoning || "Not provided"}

Return a JSON object with these fields:
- canonicalSummary: A 1-2 sentence summary of the decision (max 280 chars)
- principles: Array of 1-3 decision principles used (e.g., "bias to action", "minimize downside risk")
- constraints: Array of 1-3 constraints considered (e.g., "time pressure", "budget limit", "team capacity")
- reversibility: One of "reversible", "hard_to_reverse", or "irreversible"
- riskLevel: One of "low", "medium", or "high"
- archetype: One word describing the decision type (e.g., "delegation", "resource_allocation", "tooling_choice", "pricing", "hiring", "prioritization", "investment", "partnership")

Respond with only valid JSON, no markdown.`;

    const response = await openai.chat.completions.create({
      model: "google/gemini-2.0-flash-exp:free", // Use fast, cheap model for metadata
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 500,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      return null;
    }

    // Parse JSON response
    const parsed = JSON.parse(content.trim());

    // Validate and sanitize the response
    const derived: DecisionDerivedMetadata = {
      canonicalSummary: String(parsed.canonicalSummary || "").slice(0, 280),
      principles: Array.isArray(parsed.principles) ? parsed.principles.slice(0, 5) : [],
      constraints: Array.isArray(parsed.constraints) ? parsed.constraints.slice(0, 5) : [],
      reversibility: ["reversible", "hard_to_reverse", "irreversible"].includes(parsed.reversibility)
        ? parsed.reversibility
        : undefined,
      riskLevel: ["low", "medium", "high"].includes(parsed.riskLevel)
        ? parsed.riskLevel
        : undefined,
      archetype: typeof parsed.archetype === "string" ? parsed.archetype.toLowerCase() : undefined,
    };

    return derived;
  } catch (error) {
    logger.error({ error }, "Error generating derived metadata for decision");
    return null;
  }
}

/**
 * Basic redaction of potential secrets from text
 */
function redactSecrets(text: string): string {
  if (!text) return text;

  // Patterns that look like API keys, tokens, passwords
  const patterns = [
    // API keys (various formats)
    /\b[a-zA-Z0-9_-]{32,}\b/g, // Long alphanumeric strings
    /\b(sk|pk|api|key|token|secret|password|auth)[_-]?[a-zA-Z0-9]{16,}\b/gi,
    // Bearer tokens
    /Bearer\s+[a-zA-Z0-9._-]+/gi,
    // URLs with credentials
    /https?:\/\/[^:]+:[^@]+@/g,
  ];

  let redacted = text;
  for (const pattern of patterns) {
    redacted = redacted.replace(pattern, "[REDACTED]");
  }

  return redacted;
}

// ============================================================================
// LIST / GET
// ============================================================================

// Get all decision memories with optional filters
router.get("/", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const offset = parseInt(req.query.offset as string) || 0;
    const closed = req.query.closed === "true" ? true : req.query.closed === "false" ? false : undefined;
    const archetype = req.query.archetype as string | undefined;
    const tagsParam = req.query.tags as string | undefined;
    const tags = tagsParam ? tagsParam.split(",").map((t) => t.trim()) : undefined;

    const decisions = await storage.getDecisionMemories({
      limit,
      offset,
      closed,
      archetype,
      tags,
    });

    res.json({
      data: decisions,
      pagination: {
        limit,
        offset,
        count: decisions.length,
        hasMore: decisions.length === limit,
      },
    });
  } catch (error) {
    logger.error({ error }, "Error fetching decision memories");
    res.status(500).json({ error: "Failed to fetch decision memories" });
  }
});

// Get decisions due for follow-up (for Evening Review)
router.get("/due", async (req: Request, res: Response) => {
  try {
    const dueDecisions = await storage.getDueDecisions();
    res.json(dueDecisions);
  } catch (error) {
    logger.error({ error }, "Error fetching due decisions");
    res.status(500).json({ error: "Failed to fetch due decisions" });
  }
});

// Get decisions eligible for early signal check (for Evening Review)
router.get("/early-check", async (req: Request, res: Response) => {
  try {
    const earlyCheckDecisions = await storage.getEarlyCheckDecisions();
    res.json(earlyCheckDecisions);
  } catch (error) {
    logger.error({ error }, "Error fetching early check decisions");
    res.status(500).json({ error: "Failed to fetch early check decisions" });
  }
});

// Get decisions for AI context (used by AI chat)
router.get("/retrieve", async (req: Request, res: Response) => {
  try {
    const query = (req.query.query as string) || "";
    const tagsParam = req.query.tags as string | undefined;
    const tags = tagsParam ? tagsParam.split(",").map((t) => t.trim()) : undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 20);

    const decisions = await storage.retrieveDecisionsForAI(query, tags, limit);
    res.json(decisions);
  } catch (error) {
    logger.error({ error }, "Error retrieving decisions for AI");
    res.status(500).json({ error: "Failed to retrieve decisions" });
  }
});

// Export all decision memories as JSON
router.get("/export", async (req: Request, res: Response) => {
  try {
    const decisions = await storage.exportDecisionMemories();
    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="decision-memories-${new Date().toISOString().split("T")[0]}.json"`
    );
    res.json({
      exportedAt: new Date().toISOString(),
      count: decisions.length,
      decisions,
    });
  } catch (error) {
    logger.error({ error }, "Error exporting decision memories");
    res.status(500).json({ error: "Failed to export decision memories" });
  }
});

// Get single decision memory
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const decision = await storage.getDecisionMemory(req.params.id);
    if (!decision) {
      return res.status(404).json({ error: "Decision memory not found" });
    }
    res.json(decision);
  } catch (error) {
    logger.error({ error }, "Error fetching decision memory");
    res.status(500).json({ error: "Failed to fetch decision memory" });
  }
});

// ============================================================================
// CREATE
// ============================================================================

// Create decision memory with derived metadata generation
router.post("/", async (req: Request, res: Response) => {
  try {
    // Validate input
    const validatedData = insertDecisionMemorySchema.parse(req.body);

    // Redact potential secrets
    const context = redactSecrets(validatedData.context);
    const decision = redactSecrets(validatedData.decision);
    const reasoning = validatedData.reasoning ? redactSecrets(validatedData.reasoning) : null;

    // Generate derived metadata (sync, with potential delay)
    const derived = await generateDerivedMetadata(context, decision, reasoning);

    // Create the decision memory
    const decisionMemory = await storage.createDecisionMemory({
      ...validatedData,
      context,
      decision,
      reasoning,
      derived,
    });

    res.status(201).json(decisionMemory);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid decision data", details: error.errors });
    } else {
      logger.error({ error }, "Error creating decision memory");
      res.status(500).json({ error: "Failed to create decision memory" });
    }
  }
});

// ============================================================================
// UPDATE
// ============================================================================

// Update decision memory (for editing before outcome is recorded)
router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const updates = updateDecisionMemorySchema.parse(req.body);

    // Redact potential secrets if text fields are being updated
    if (updates.context) {
      updates.context = redactSecrets(updates.context);
    }
    if (updates.decision) {
      updates.decision = redactSecrets(updates.decision);
    }
    if (updates.reasoning) {
      updates.reasoning = redactSecrets(updates.reasoning);
    }

    const decision = await storage.updateDecisionMemory(req.params.id, updates);
    if (!decision) {
      return res.status(404).json({ error: "Decision memory not found" });
    }
    res.json(decision);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid decision data", details: error.errors });
    } else {
      logger.error({ error }, "Error updating decision memory");
      res.status(500).json({ error: "Failed to update decision memory" });
    }
  }
});

// Close decision loop (record outcome)
router.post("/:id/close", async (req: Request, res: Response) => {
  try {
    const data = closeDecisionMemorySchema.parse(req.body);

    // Redact potential secrets from outcome notes
    if (data.outcomeNotes) {
      data.outcomeNotes = redactSecrets(data.outcomeNotes);
    }

    const decision = await storage.closeDecisionMemory(req.params.id, data);
    if (!decision) {
      return res.status(404).json({ error: "Decision memory not found" });
    }
    res.json(decision);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid outcome data", details: error.errors });
    } else {
      logger.error({ error }, "Error closing decision loop");
      res.status(500).json({ error: "Failed to close decision loop" });
    }
  }
});

// ============================================================================
// DELETE
// ============================================================================

// Delete decision memory
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    await storage.deleteDecisionMemory(req.params.id);
    res.json({ success: true });
  } catch (error) {
    logger.error({ error }, "Error deleting decision memory");
    res.status(500).json({ error: "Failed to delete decision memory" });
  }
});

export default router;
