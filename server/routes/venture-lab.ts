/**
 * Venture Lab Routes
 * AI-powered business idea research, scoring, approval, and compilation
 *
 * Flow: Idea → Research → Score → Approve → Compile (→ Venture)
 */
import { Router, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import crypto from "crypto";
import { storage } from "../storage";
import { logger } from "../logger";

const router = Router();

// Rate limiter for AI endpoints - 10 requests per minute
const aiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: {
    error: "Too many AI requests",
    message: "Please wait a moment before making another request.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const session = (req as any).session;
    return session?.userId || req.ip || "anonymous";
  },
  validate: { xForwardedForHeader: false, keyGeneratorIpFallback: false },
});

// Domain labels for context
const DOMAIN_LABELS: Record<string, string> = {
  saas: "SaaS / Software",
  media: "Media / Content",
  ecommerce: "E-commerce / Retail",
  services: "Services / Consulting",
  marketplace: "Marketplace / Platform",
  fintech: "Fintech / Finance",
  healthtech: "Healthtech / Wellness",
  edtech: "Edtech / Education",
  realty: "Real Estate",
  other: "Other",
};

// Input validation schemas
const createIdeaSchema = z.object({
  name: z.string().min(1, "Idea name is required"),
  description: z.string().min(10, "Description must be at least 10 characters"),
  domain: z.string().optional(),
  targetCustomer: z.string().optional(),
  initialThoughts: z.string().optional(),
});

const updateResearchSchema = z.object({
  researchContent: z.string().min(100, "Research content too short"),
});

const approvalSchema = z.object({
  decision: z.enum(["approved", "parked", "killed"]),
  comment: z.string().optional(),
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate a deterministic hash for scoring inputs
 */
function generateScoreInputHash(idea: {
  name: string;
  description: string;
  domain?: string | null;
  targetCustomer?: string | null;
}, researchContent: string): string {
  const normalized = JSON.stringify({
    name: idea.name.toLowerCase().trim(),
    description: idea.description.toLowerCase().trim(),
    domain: idea.domain?.toLowerCase().trim() || "",
    targetCustomer: idea.targetCustomer?.toLowerCase().trim() || "",
    researchHash: crypto.createHash("md5").update(researchContent).digest("hex"),
  });
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

/**
 * Determine verdict from final score
 */
function getVerdict(finalScore: number): "GREEN" | "YELLOW" | "RED" {
  if (finalScore >= 80) return "GREEN";
  if (finalScore >= 70) return "YELLOW";
  return "RED";
}

/**
 * Create OpenAI client for OpenRouter
 */
async function getOpenAIClient() {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY not configured");
  }
  const OpenAI = (await import("openai")).default;
  return new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
  });
}

// ============================================================================
// IDEAS CRUD
// ============================================================================

/**
 * GET /api/venture-lab/ideas
 * List all venture ideas
 */
router.get("/ideas", async (req: Request, res: Response) => {
  try {
    const { status, verdict, limit, offset } = req.query;

    const ideas = await storage.getVentureIdeas({
      status: status as string,
      verdict: verdict as string,
      limit: limit ? parseInt(limit as string) : undefined,
      offset: offset ? parseInt(offset as string) : undefined,
    });

    res.json(ideas);
  } catch (error: any) {
    logger.error({ error }, "Error fetching venture ideas");
    res.status(500).json({ error: "Failed to fetch ideas", message: error.message });
  }
});

/**
 * GET /api/venture-lab/ideas/:id
 * Get a single venture idea
 */
router.get("/ideas/:id", async (req: Request, res: Response) => {
  try {
    const idea = await storage.getVentureIdea(req.params.id);

    if (!idea) {
      return res.status(404).json({ error: "Idea not found" });
    }

    // If there's a research doc, fetch it too
    let researchDoc = null;
    if (idea.researchDocId) {
      researchDoc = await storage.getDoc(idea.researchDocId);
    }

    res.json({ idea, researchDoc });
  } catch (error: any) {
    logger.error({ error }, "Error fetching venture idea");
    res.status(500).json({ error: "Failed to fetch idea", message: error.message });
  }
});

/**
 * POST /api/venture-lab/ideas
 * Create a new venture idea
 */
router.post("/ideas", async (req: Request, res: Response) => {
  try {
    const parsed = createIdeaSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
    }

    const idea = await storage.createVentureIdea({
      name: parsed.data.name,
      description: parsed.data.description,
      domain: parsed.data.domain,
      targetCustomer: parsed.data.targetCustomer,
      initialThoughts: parsed.data.initialThoughts,
      status: "idea",
    });

    res.status(201).json(idea);
  } catch (error: any) {
    logger.error({ error }, "Error creating venture idea");
    res.status(500).json({ error: "Failed to create idea", message: error.message });
  }
});

/**
 * DELETE /api/venture-lab/ideas/:id
 * Delete a venture idea
 */
router.delete("/ideas/:id", async (req: Request, res: Response) => {
  try {
    await storage.deleteVentureIdea(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    logger.error({ error }, "Error deleting venture idea");
    res.status(500).json({ error: "Failed to delete idea", message: error.message });
  }
});

// ============================================================================
// RESEARCH
// ============================================================================

/**
 * POST /api/venture-lab/ideas/:id/research
 * Run internal AI research on an idea
 * Multi-step: Market → Competitors → Execution
 */
router.post("/ideas/:id/research", aiRateLimiter, async (req: Request, res: Response) => {
  try {
    const idea = await storage.getVentureIdea(req.params.id);
    if (!idea) {
      return res.status(404).json({ error: "Idea not found" });
    }

    // Update status to researching
    await storage.updateVentureIdea(idea.id, { status: "researching" });

    const openai = await getOpenAIClient();
    const domainLabel = idea.domain ? DOMAIN_LABELS[idea.domain] || idea.domain : "Unknown";

    // Build the idea context
    const ideaContext = `
BUSINESS IDEA:
- Name: ${idea.name}
- Description: ${idea.description}
${idea.domain ? `- Domain/Industry: ${domainLabel}` : ""}
${idea.targetCustomer ? `- Target Customer: ${idea.targetCustomer}` : ""}
${idea.initialThoughts ? `- Initial Hypotheses: ${idea.initialThoughts}` : ""}
`.trim();

    // Multi-step research using Perplexity via OpenRouter
    const researchPrompt = `You are a skeptical venture research analyst. Be commercial and critical.

${ideaContext}

Produce a comprehensive research document with the following sections. Be specific - name real companies, cite real data where possible, and provide concrete analysis.

## 1. Problem Definition & Market Validation
- Is this a real problem people/businesses actively pay to solve?
- Market size estimates (TAM/SAM/SOM)
- Demand signals and evidence
- Who is the ideal customer profile?

## 2. Target Buyer Analysis
- Who exactly will pay for this? (Not users, buyers)
- What is their budget capacity?
- What triggers a purchase decision?
- Current alternatives they use

## 3. Competitive Landscape
- Direct competitors (name specific companies)
- Indirect competitors and alternatives
- Market gaps and underserved segments
- What moats exist or could be built?

## 4. Business Model Analysis
- What revenue models work in this space?
- Typical pricing benchmarks
- Unit economics in similar businesses
- Path to profitability

## 5. Distribution & Go-to-Market
- How do successful players acquire customers?
- What channels work best?
- Customer acquisition cost benchmarks
- Network effects or virality potential

## 6. Execution Requirements
- What's needed to build an MVP?
- Key skills or team required
- Timeline to first revenue
- Operational complexities

## 7. Risk Assessment
- Regulatory/legal friction (UAE and global)
- Market timing factors
- Key failure modes
- Barriers to entry

## 8. AI Leverage Opportunities
- Where can AI provide 10x advantage?
- Automation opportunities
- Data moat potential

## 9. Recommendation
**Verdict:** [PROCEED / PARK / KILL]

**Key Reasons:**
1. [Primary reason]
2. [Secondary reason]
3. [Third reason]

**If PROCEED - First Validation Steps:**
1. [Step 1]
2. [Step 2]
3. [Step 3]

**If PARK/KILL - What Would Change This?**
[What conditions or changes would make this viable?]

Be thorough, skeptical, and specific. This research will inform a GO/NO-GO decision.`;

    logger.info({ ideaId: idea.id }, "Starting internal research via Perplexity");

    const completion = await openai.chat.completions.create({
      model: "perplexity/sonar-pro", // Best for research with web search
      messages: [
        { role: "user", content: researchPrompt },
      ],
      temperature: 0.7, // Some creativity for research
      max_tokens: 8000,
    });

    const researchContent = completion.choices[0]?.message?.content;
    if (!researchContent) {
      throw new Error("No research content generated");
    }

    const tokensUsed = completion.usage?.total_tokens || 0;

    // Create research document
    const today = new Date().toISOString().split("T")[0];
    const docBody = `# Venture Research: ${idea.name}

**Status:** Researched
**Research Date:** ${today}
**Research Model:** perplexity/sonar-pro
**Tokens Used:** ${tokensUsed}

---

## Idea Summary
**Name:** ${idea.name}
**Description:** ${idea.description}
${idea.domain ? `**Domain:** ${domainLabel}` : ""}
${idea.targetCustomer ? `**Target Customer:** ${idea.targetCustomer}` : ""}

---

${researchContent}
`;

    // Save to docs
    const doc = await storage.createDoc({
      title: `Venture Research: ${idea.name}`,
      body: docBody,
      type: "research",
      domain: "venture_ops",
      status: "draft",
      tags: ["venture-lab", "research", idea.domain || ""].filter(Boolean),
    });

    // Update idea with research results
    await storage.updateVentureIdea(idea.id, {
      status: "researched",
      researchDocId: doc.id,
      researchCompletedAt: new Date(),
      researchModel: "perplexity/sonar-pro",
      researchTokensUsed: tokensUsed,
    });

    const updatedIdea = await storage.getVentureIdea(idea.id);

    res.json({
      idea: updatedIdea,
      researchDoc: doc,
      tokensUsed,
    });
  } catch (error: any) {
    logger.error({ error, ideaId: req.params.id }, "Error running research");

    // Reset status on failure
    await storage.updateVentureIdea(req.params.id, { status: "idea" });

    if (error.message?.includes("401") || error.message?.includes("invalid_api_key")) {
      return res.status(503).json({
        error: "AI service configuration error",
        message: "Please check your OpenRouter API key configuration.",
      });
    }

    res.status(500).json({ error: "Research failed", message: error.message });
  }
});

/**
 * PATCH /api/venture-lab/ideas/:id/research
 * Update research content (user editing before scoring)
 */
router.patch("/ideas/:id/research", async (req: Request, res: Response) => {
  try {
    const idea = await storage.getVentureIdea(req.params.id);
    if (!idea) {
      return res.status(404).json({ error: "Idea not found" });
    }

    if (!idea.researchDocId) {
      return res.status(400).json({ error: "No research document to update" });
    }

    const parsed = updateResearchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
    }

    // Update the research doc
    await storage.updateDoc(idea.researchDocId, {
      body: parsed.data.researchContent,
    });

    const doc = await storage.getDoc(idea.researchDocId);
    res.json({ doc });
  } catch (error: any) {
    logger.error({ error }, "Error updating research");
    res.status(500).json({ error: "Failed to update research", message: error.message });
  }
});

// ============================================================================
// SCORING
// ============================================================================

/**
 * POST /api/venture-lab/ideas/:id/score
 * Score an idea based on research (deterministic)
 */
router.post("/ideas/:id/score", aiRateLimiter, async (req: Request, res: Response) => {
  try {
    const idea = await storage.getVentureIdea(req.params.id);
    if (!idea) {
      return res.status(404).json({ error: "Idea not found" });
    }

    if (!idea.researchDocId) {
      return res.status(400).json({ error: "Research must be completed before scoring" });
    }

    // Get research content
    const researchDoc = await storage.getDoc(idea.researchDocId);
    if (!researchDoc) {
      return res.status(400).json({ error: "Research document not found" });
    }

    // Check for cached score with same inputs
    const inputHash = generateScoreInputHash(idea, researchDoc.body || "");
    const existingWithHash = await storage.getVentureIdeaByScoreHash(inputHash);

    if (existingWithHash && existingWithHash.scoreData) {
      // Return cached score for determinism
      logger.info({ ideaId: idea.id }, "Returning cached score");
      return res.json({
        idea: existingWithHash,
        cached: true,
      });
    }

    // Update status to scoring
    await storage.updateVentureIdea(idea.id, { status: "scoring" });

    const openai = await getOpenAIClient();

    const scoringPrompt = `You are a venture scoring system. Analyze this business idea and research, then provide a structured score.

## IDEA
Name: ${idea.name}
Description: ${idea.description}
Domain: ${idea.domain || "Not specified"}
Target Customer: ${idea.targetCustomer || "Not specified"}

## RESEARCH
${researchDoc.body}

---

Score this venture opportunity on these dimensions. Total must equal 100.

SCORING DIMENSIONS:
1. Buyer Clarity & Budget (max 20): Is there a clear buyer with budget?
2. Pain Intensity & Urgency (max 15): How painful is the problem?
3. Distribution Feasibility (max 15): Can the founder realistically reach customers?
4. Revenue Model Realism (max 15): Does the business model math work?
5. Competitive Edge (max 10): Is there a defensible moat?
6. Execution Complexity (max 10, inverse): Lower complexity = higher score
7. Regulatory Friction (max 10, inverse): Less friction = higher score
8. AI Leverage (max 5): Can AI provide significant advantage?

Also provide:
- Confidence level (0-1): How confident are you in this assessment?
- Kill reasons: If score is low, what are the deal-breakers?
- Next validation steps: What should be validated first?

RESPOND ONLY WITH VALID JSON in this exact format:
{
  "rawScore": <number 0-100>,
  "confidence": <number 0-1>,
  "breakdown": {
    "buyerClarityBudget": {"score": <n>, "max": 20, "reasoning": "<why>"},
    "painIntensityUrgency": {"score": <n>, "max": 15, "reasoning": "<why>"},
    "distributionFeasibility": {"score": <n>, "max": 15, "reasoning": "<why>"},
    "revenueModelRealism": {"score": <n>, "max": 15, "reasoning": "<why>"},
    "competitiveEdge": {"score": <n>, "max": 10, "reasoning": "<why>"},
    "executionComplexity": {"score": <n>, "max": 10, "reasoning": "<why>"},
    "regulatoryFriction": {"score": <n>, "max": 10, "reasoning": "<why>"},
    "aiLeverage": {"score": <n>, "max": 5, "reasoning": "<why>"}
  },
  "killReasons": ["<reason1>", "<reason2>"],
  "nextValidationSteps": ["<step1>", "<step2>", "<step3>"]
}`;

    logger.info({ ideaId: idea.id }, "Starting deterministic scoring");

    const completion = await openai.chat.completions.create({
      model: "openai/gpt-4o",
      messages: [
        { role: "user", content: scoringPrompt },
      ],
      temperature: 0, // DETERMINISTIC
      max_tokens: 2000,
      response_format: { type: "json_object" },
    });

    const scoreContent = completion.choices[0]?.message?.content;
    if (!scoreContent) {
      throw new Error("No score content generated");
    }

    const scoreData = JSON.parse(scoreContent);
    const finalScore = scoreData.rawScore * scoreData.confidence;
    const verdict = getVerdict(finalScore);

    // Add finalScore to scoreData
    scoreData.finalScore = finalScore;

    // Update idea with score
    await storage.updateVentureIdea(idea.id, {
      status: "scored",
      scoreData: scoreData,
      verdict: verdict,
      scoredAt: new Date(),
      scoreInputHash: inputHash,
    });

    const updatedIdea = await storage.getVentureIdea(idea.id);

    res.json({
      idea: updatedIdea,
      cached: false,
    });
  } catch (error: any) {
    logger.error({ error, ideaId: req.params.id }, "Error scoring idea");

    // Reset status on failure
    await storage.updateVentureIdea(req.params.id, { status: "researched" });

    res.status(500).json({ error: "Scoring failed", message: error.message });
  }
});

// ============================================================================
// APPROVAL
// ============================================================================

/**
 * POST /api/venture-lab/ideas/:id/approve
 * Human approval decision
 */
router.post("/ideas/:id/approve", async (req: Request, res: Response) => {
  try {
    const idea = await storage.getVentureIdea(req.params.id);
    if (!idea) {
      return res.status(404).json({ error: "Idea not found" });
    }

    if (idea.status !== "scored") {
      return res.status(400).json({ error: "Idea must be scored before approval" });
    }

    const parsed = approvalSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
    }

    const { decision, comment } = parsed.data;

    // RED verdict cannot be approved for compilation
    if (decision === "approved" && idea.verdict === "RED") {
      return res.status(400).json({
        error: "Cannot approve RED verdict",
        message: "Ideas with RED verdict (score < 70) cannot be compiled into ventures. Consider parking or killing this idea.",
      });
    }

    const session = (req as any).session;
    const userId = session?.userId;

    let newStatus: string;
    switch (decision) {
      case "approved":
        newStatus = "approved";
        break;
      case "parked":
        newStatus = "parked";
        break;
      case "killed":
        newStatus = "rejected";
        break;
      default:
        newStatus = idea.status;
    }

    await storage.updateVentureIdea(idea.id, {
      status: newStatus as any,
      approvalDecision: decision,
      approvalComment: comment,
      approvedBy: userId,
      approvedAt: new Date(),
    });

    const updatedIdea = await storage.getVentureIdea(idea.id);

    res.json({ idea: updatedIdea });
  } catch (error: any) {
    logger.error({ error, ideaId: req.params.id }, "Error approving idea");
    res.status(500).json({ error: "Approval failed", message: error.message });
  }
});

// ============================================================================
// COMPILATION
// ============================================================================

/**
 * POST /api/venture-lab/ideas/:id/compile
 * Compile approved idea into venture + projects + tasks
 */
router.post("/ideas/:id/compile", aiRateLimiter, async (req: Request, res: Response) => {
  try {
    const idea = await storage.getVentureIdea(req.params.id);
    if (!idea) {
      return res.status(404).json({ error: "Idea not found" });
    }

    if (idea.status !== "approved") {
      return res.status(400).json({ error: "Idea must be approved before compilation" });
    }

    if (!idea.verdict || idea.verdict === "RED") {
      return res.status(400).json({ error: "Cannot compile RED verdict ideas" });
    }

    // Update status to compiling
    await storage.updateVentureIdea(idea.id, { status: "compiling" });

    const openai = await getOpenAIClient();

    // Get research for context
    let researchContent = "";
    if (idea.researchDocId) {
      const doc = await storage.getDoc(idea.researchDocId);
      researchContent = doc?.body || "";
    }

    const isFullPack = idea.verdict === "GREEN";

    const compilePrompt = `You are a venture compiler. Create a structured execution plan for this approved business idea.

## IDEA
Name: ${idea.name}
Description: ${idea.description}
Domain: ${idea.domain || "general"}
Target Customer: ${idea.targetCustomer || "Not specified"}
Verdict: ${idea.verdict}
Score: ${idea.scoreData?.finalScore?.toFixed(1) || "N/A"}

## RESEARCH SUMMARY
${researchContent.slice(0, 4000)}

---

${isFullPack ? `
Generate a FULL VENTURE PACK with:
1. Venture metadata
2. 4 projects covering: Validation, MVP Build, Go-to-Market, Scale
3. 3 phases per project
4. 5-8 tasks per project

` : `
Generate a PILOT PACK (validation sprint) with:
1. Venture metadata
2. 1 project: Validation Sprint (3-7 days)
3. 2 phases: Research, Test
4. Maximum 15 tasks focused on validation
`}

RESPOND ONLY WITH VALID JSON:
{
  "venture": {
    "name": "<venture name>",
    "oneLiner": "<one sentence description>",
    "domain": "<saas|media|realty|trading|personal|other>",
    "status": "planning",
    "notes": "<strategic notes>"
  },
  "projects": [
    {
      "name": "<project name>",
      "category": "<marketing|sales_biz_dev|customer_success|product|tech_engineering|operations|research_dev|finance|people_hr|legal_compliance|admin_general|strategy_leadership>",
      "priority": "<P0|P1|P2|P3>",
      "outcome": "<what success looks like>",
      "notes": "<project notes>",
      "phases": [
        {
          "name": "<phase name>",
          "order": 0,
          "notes": "<phase notes>"
        }
      ],
      "tasks": [
        {
          "title": "<task title>",
          "priority": "<P0|P1|P2|P3>",
          "type": "<business|deep_work|admin|health|learning|personal>",
          "estEffort": <hours as number>,
          "notes": "<task details>"
        }
      ]
    }
  ]
}`;

    logger.info({ ideaId: idea.id, verdict: idea.verdict }, "Starting compilation");

    const completion = await openai.chat.completions.create({
      model: "openai/gpt-4o",
      messages: [
        { role: "user", content: compilePrompt },
      ],
      temperature: 0.3, // Some variation but mostly consistent
      max_tokens: 8000,
      response_format: { type: "json_object" },
    });

    const compileContent = completion.choices[0]?.message?.content;
    if (!compileContent) {
      throw new Error("No compilation content generated");
    }

    const compiled = JSON.parse(compileContent);
    const tokensUsed = completion.usage?.total_tokens || 0;

    // Create the venture
    const venture = await storage.createVenture({
      name: compiled.venture.name,
      oneLiner: compiled.venture.oneLiner,
      domain: compiled.venture.domain || idea.domain || "other",
      status: "planning",
      notes: compiled.venture.notes,
    });

    let projectsCreated = 0;
    let phasesCreated = 0;
    let tasksCreated = 0;

    // Create projects, phases, and tasks
    for (const projectData of compiled.projects) {
      const project = await storage.createProject({
        name: projectData.name,
        ventureId: venture.id,
        category: projectData.category,
        priority: projectData.priority,
        outcome: projectData.outcome,
        notes: projectData.notes,
        status: "not_started",
      });
      projectsCreated++;

      // Create phases
      const phaseIds: Record<number, string> = {};
      for (const phaseData of projectData.phases || []) {
        const phase = await storage.createPhase({
          name: phaseData.name,
          projectId: project.id,
          order: phaseData.order,
          notes: phaseData.notes,
          status: "not_started",
        });
        phaseIds[phaseData.order] = phase.id;
        phasesCreated++;
      }

      // Create tasks
      for (const taskData of projectData.tasks || []) {
        await storage.createTask({
          title: taskData.title,
          ventureId: venture.id,
          projectId: project.id,
          priority: taskData.priority,
          type: taskData.type,
          estEffort: taskData.estEffort,
          notes: taskData.notes,
          status: "todo",
        });
        tasksCreated++;
      }
    }

    // Update idea as compiled
    await storage.updateVentureIdea(idea.id, {
      status: "compiled",
      ventureId: venture.id,
      compiledAt: new Date(),
      compilationData: {
        projectsCreated,
        phasesCreated,
        tasksCreated,
        model: "openai/gpt-4o",
        tokensUsed,
      },
    });

    const updatedIdea = await storage.getVentureIdea(idea.id);

    res.json({
      idea: updatedIdea,
      venture,
      stats: {
        projectsCreated,
        phasesCreated,
        tasksCreated,
        tokensUsed,
      },
    });
  } catch (error: any) {
    logger.error({ error, ideaId: req.params.id }, "Error compiling idea");

    // Reset status on failure
    await storage.updateVentureIdea(req.params.id, { status: "approved" });

    res.status(500).json({ error: "Compilation failed", message: error.message });
  }
});

// ============================================================================
// LEGACY: Generate Prompt (for external research fallback)
// ============================================================================

/**
 * POST /api/venture-lab/generate-prompt
 * Generate a research prompt for external AI (Gemini/Perplexity)
 * Kept for backward compatibility
 */
router.post("/generate-prompt", aiRateLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = createIdeaSchema.extend({
      provider: z.enum(["gemini", "perplexity"]).default("gemini"),
    }).safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
    }

    const { name, description, domain, targetCustomer, initialThoughts, provider } = parsed.data;

    // If no OpenRouter key, return template prompt
    if (!process.env.OPENROUTER_API_KEY) {
      return res.json({
        prompt: generateFallbackPrompt(parsed.data),
        method: "template",
      });
    }

    const domainLabel = domain ? DOMAIN_LABELS[domain] || domain : "Unknown";
    const openai = await getOpenAIClient();

    const systemPrompt = `You are a strategic business analyst. Create a CUSTOMIZED research prompt for ${provider === "gemini" ? "Google Gemini" : "Perplexity"} to research this specific business idea. The prompt should be tailored to this idea, not generic.`;

    const userPrompt = `
BUSINESS IDEA:
- Name: ${name}
- Description: ${description}
${domain ? `- Domain: ${domainLabel}` : ""}
${targetCustomer ? `- Target Customer: ${targetCustomer}` : ""}
${initialThoughts ? `- Initial Thoughts: ${initialThoughts}` : ""}

Generate a customized research prompt that will help make a GO/NO-GO decision. Include specific competitors to research, domain-relevant questions, and structured output format.`;

    const completion = await openai.chat.completions.create({
      model: "openai/gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 4000,
    });

    const generatedPrompt = completion.choices[0]?.message?.content;

    res.json({
      prompt: generatedPrompt || generateFallbackPrompt(parsed.data),
      method: generatedPrompt ? "ai" : "template",
      tokensUsed: completion.usage?.total_tokens,
    });
  } catch (error: any) {
    logger.error({ error }, "Error generating prompt");
    res.status(500).json({ error: "Failed to generate prompt", message: error.message });
  }
});

/**
 * Fallback template prompt generator
 */
function generateFallbackPrompt(idea: {
  name: string;
  description: string;
  domain?: string;
  targetCustomer?: string;
  initialThoughts?: string;
  provider?: string;
}): string {
  const domainLabel = idea.domain ? DOMAIN_LABELS[idea.domain] || idea.domain : "";

  return `# Venture Research Request: ${idea.name}

## The Idea
**Name:** ${idea.name}
**Description:** ${idea.description}
${idea.domain ? `**Domain:** ${domainLabel}` : ""}
${idea.targetCustomer ? `**Target Customer:** ${idea.targetCustomer}` : ""}

## Research Required

### 1. Problem & Market Validation
- Is this a real problem people pay to solve?
- Market size estimates (TAM/SAM/SOM)
- Ideal customer profile

### 2. Competitive Landscape
- Direct competitors
- Indirect competitors
- Market gaps

### 3. Business Model
- Revenue models in this space
- Pricing benchmarks
- Unit economics

### 4. Go-to-Market
- Customer acquisition strategies
- Distribution channels
- CAC benchmarks

### 5. Execution Requirements
- MVP requirements
- Team needs
- Timeline to revenue

### 6. Risks
- Barriers to entry
- Regulatory issues
- Key failure modes

### 7. Recommendation
**Decision:** [GO / NO-GO / NEEDS MORE]
**Key Reasons:** List top 3
**Next Steps:** If GO, what to do first`;
}

export default router;
