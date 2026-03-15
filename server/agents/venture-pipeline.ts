/**
 * Venture Pipeline — Autonomous Venture Launch
 *
 * /idea in Telegram → deep research → Gemini validation → double-yes check →
 * user GO/KILL → autonomous venture creation + parallel agent work → final notification
 *
 * Only ONE human decision point: go/no-go after research validation.
 */

import { logger } from "../logger";
import { storage } from "../storage";
import { buildResearchPrompt } from "../routes/venture-lab";
import type { VentureIdea } from "@shared/schema";

// ============================================================================
// TYPES
// ============================================================================

type PipelineStepStatus = "pending" | "running" | "done" | "failed";

interface PipelineData {
  chatId?: string;
  perplexityVerdict?: string;
  geminiValidation?: string;
  geminiVerdict?: string;
  ventureCodename?: string;
  driveFolderId?: string;
  driveFolderUrl?: string;
  steps: {
    branding?: { status: PipelineStepStatus; taskId?: string; driveFileIds?: string[]; error?: string };
    prd?: { status: PipelineStepStatus; taskId?: string; driveFileId?: string; error?: string };
    gtm?: { status: PipelineStepStatus; taskId?: string; driveFileId?: string; error?: string };
    landingPage?: { status: PipelineStepStatus; taskId?: string; vercelUrl?: string; error?: string };
  };
  completedAt?: string;
  totalTokensUsed?: number;
}

// ============================================================================
// HELPERS
// ============================================================================

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

async function sendTelegram(chatId: string, text: string, replyMarkup?: any) {
  const { getAuthorizedChatIds } = await import("../channels/adapters/telegram-adapter");
  const targetIds = chatId ? [chatId] : getAuthorizedChatIds();

  // If we have inline keyboard, send directly via bot
  if (replyMarkup) {
    const { getTelegramBot } = await import("../channels/adapters/telegram-adapter");
    const bot = getTelegramBot();
    if (bot) {
      for (const cid of targetIds) {
        try {
          await bot.telegram.sendMessage(cid, text, {
            parse_mode: "HTML",
            reply_markup: replyMarkup,
          });
        } catch (err: any) {
          logger.error({ err: err.message, chatId: cid }, "Failed to send pipeline Telegram message");
        }
      }
      return;
    }
  }

  // Otherwise use queued messaging
  const { sendProactiveMessage } = await import("../channels/channel-manager");
  for (const cid of targetIds) {
    await sendProactiveMessage("telegram", cid, text);
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function updatePipelineData(ideaId: string, data: Partial<PipelineData>) {
  const idea = await storage.getVentureIdea(ideaId);
  if (!idea) return;
  const existing = (idea.pipelineData as PipelineData) || { steps: {} };
  const merged = { ...existing, ...data, steps: { ...existing.steps, ...data.steps } };
  await storage.updateVentureIdea(ideaId, { pipelineData: merged } as any);
}

function extractVerdict(text: string): string {
  // Look for PROCEED / PARK / KILL in the text
  const upper = text.toUpperCase();
  if (upper.includes("PROCEED")) return "PROCEED";
  if (upper.includes("PARK")) return "PARK";
  if (upper.includes("KILL")) return "KILL";
  return "UNKNOWN";
}

function generateCodename(): string {
  const adjectives = [
    "Iron", "Cobalt", "Neon", "Crimson", "Apex", "Quantum", "Obsidian",
    "Zenith", "Meridian", "Titan", "Falcon", "Phoenix", "Onyx", "Cipher",
    "Atlas", "Prism", "Vortex", "Echo", "Nova", "Pulse",
  ];
  const nouns = [
    "Shield", "Forge", "Spire", "Orbit", "Gate", "Core", "Nexus",
    "Ridge", "Storm", "Blade", "Crown", "Lens", "Flare", "Arc",
    "Vault", "Reef", "Peak", "Wave", "Shard", "Link",
  ];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  return `${adj} ${noun}`;
}

// ============================================================================
// STEP 1: PERPLEXITY RESEARCH
// ============================================================================

async function runPerplexityResearch(ideaId: string): Promise<{ content: string; tokensUsed: number }> {
  const idea = await storage.getVentureIdea(ideaId);
  if (!idea) throw new Error("Idea not found");

  await storage.updateVentureIdea(ideaId, { status: "researching" } as any);

  const openai = await getOpenAIClient();
  const researchPrompt = buildResearchPrompt(idea);

  logger.info({ ideaId }, "Pipeline: Starting Perplexity research");

  const completion = await openai.chat.completions.create({
    model: "perplexity/sonar-pro",
    messages: [{ role: "user", content: researchPrompt }],
    temperature: 0.7,
    max_tokens: 8000,
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("No research content generated");

  const tokensUsed = completion.usage?.total_tokens || 0;

  // Save research doc
  const doc = await storage.createDoc({
    title: `Venture Research: ${idea.name}`,
    body: `# Venture Research: ${idea.name}\n\n${content}`,
    type: "research",
    domain: "venture_ops",
    status: "draft",
    tags: ["venture-lab", "research", "pipeline", idea.domain || ""].filter(Boolean),
  });

  await storage.updateVentureIdea(ideaId, {
    status: "researched",
    researchDocId: doc.id,
    researchCompletedAt: new Date(),
    researchModel: "perplexity/sonar-pro",
    researchTokensUsed: tokensUsed,
  } as any);

  const verdict = extractVerdict(content);
  await updatePipelineData(ideaId, { perplexityVerdict: verdict });

  return { content, tokensUsed };
}

// ============================================================================
// STEP 2: GEMINI VALIDATION
// ============================================================================

async function runGeminiValidation(ideaId: string, researchContent: string): Promise<{ verdict: string; validation: string; tokensUsed: number }> {
  const idea = await storage.getVentureIdea(ideaId);
  if (!idea) throw new Error("Idea not found");

  await storage.updateVentureIdea(ideaId, { status: "validating" } as any);

  const openai = await getOpenAIClient();

  const validationPrompt = `You are a skeptical second reviewer. Your job is to independently validate AI-generated business research.

## BUSINESS IDEA
Name: ${idea.name}
Description: ${idea.description}
${idea.domain ? `Domain: ${idea.domain}` : ""}
${idea.targetCustomer ? `Target Customer: ${idea.targetCustomer}` : ""}

## RESEARCH TO VALIDATE
${researchContent.slice(0, 6000)}

---

## YOUR TASK
1. Challenge the claims made in the research. Are the market size estimates realistic? Are the competitors accurately identified?
2. Verify the competitive analysis independently — are there major players missing?
3. Assess whether the business model assumptions are sound
4. Check if the risk assessment is complete — are there risks the first reviewer missed?
5. Evaluate the overall quality and depth of the research

## YOUR VERDICT
After your analysis, give your independent verdict:

**VERDICT: [PROCEED / PARK / KILL]**

**Confidence:** [HIGH / MEDIUM / LOW]

**Key Agreement/Disagreement with First Reviewer:**
1. [Point 1]
2. [Point 2]
3. [Point 3]

**Critical Risks Not Addressed:**
- [Risk 1]
- [Risk 2]

**Summary:** [2-3 sentences on your overall assessment]`;

  logger.info({ ideaId }, "Pipeline: Starting Gemini validation");

  const completion = await openai.chat.completions.create({
    model: "google/gemini-2.5-pro-preview",
    messages: [{ role: "user", content: validationPrompt }],
    temperature: 0.3,
    max_tokens: 4000,
  });

  const validation = completion.choices[0]?.message?.content;
  if (!validation) throw new Error("No validation content generated");

  const tokensUsed = completion.usage?.total_tokens || 0;
  const verdict = extractVerdict(validation);

  await updatePipelineData(ideaId, {
    geminiValidation: validation,
    geminiVerdict: verdict,
  });

  return { verdict, validation, tokensUsed };
}

// ============================================================================
// STEP 3: DOUBLE-YES CHECK
// ============================================================================

async function checkDoubleYes(ideaId: string, researchContent: string, geminiValidation: string): Promise<boolean> {
  const idea = await storage.getVentureIdea(ideaId);
  if (!idea) throw new Error("Idea not found");

  const pData = (idea.pipelineData as PipelineData) || { steps: {} };
  const perplexityVerdict = pData.perplexityVerdict || "UNKNOWN";
  const geminiVerdict = pData.geminiVerdict || "UNKNOWN";
  const chatId = pData.chatId || "";

  const bothProceed = perplexityVerdict === "PROCEED" && geminiVerdict === "PROCEED";

  if (!bothProceed) {
    // Failed validation — notify and reject
    await storage.updateVentureIdea(ideaId, { status: "rejected" } as any);

    const reasonLines = [
      `Perplexity: <b>${escapeHtml(perplexityVerdict)}</b>`,
      `Gemini: <b>${escapeHtml(geminiVerdict)}</b>`,
    ];

    // Extract a brief summary from Gemini validation
    const summaryMatch = geminiValidation.match(/\*\*Summary:\*\*\s*(.+?)(?:\n|$)/);
    if (summaryMatch) {
      reasonLines.push(`\n${escapeHtml(summaryMatch[1])}`);
    }

    await sendTelegram(chatId,
      `\u274C <b>Idea Failed Validation</b>\n\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n` +
      `<b>${escapeHtml(idea.name)}</b>\n\n` +
      reasonLines.join("\n")
    );

    logger.info({ ideaId, perplexityVerdict, geminiVerdict }, "Pipeline: Double-yes failed");
    return false;
  }

  // Both say PROCEED — send summary with GO/KILL buttons
  await storage.updateVentureIdea(ideaId, { status: "validated" } as any);

  // Build a concise research summary (first 500 chars of key sections)
  const summaryLines: string[] = [];
  const sections = ["Market Validation", "Competitive Landscape", "Recommendation"];
  for (const section of sections) {
    const regex = new RegExp(`##\\s*\\d*\\.?\\s*${section}[\\s\\S]*?(?=##|$)`, "i");
    const match = researchContent.match(regex);
    if (match) {
      const clean = match[0].replace(/##\s*\d*\.?\s*/g, "").trim().slice(0, 200);
      summaryLines.push(clean);
    }
  }

  const summary = summaryLines.length > 0
    ? summaryLines.map(s => escapeHtml(s)).join("\n\n")
    : escapeHtml(researchContent.slice(0, 600));

  await sendTelegram(chatId,
    `\u2705 <b>Double-Yes: Both AI reviewers say PROCEED</b>\n\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n` +
    `<b>${escapeHtml(idea.name)}</b>\n\n` +
    `${summary}\n\n` +
    `<i>Tap GO to launch the full venture pipeline.</i>`,
    {
      inline_keyboard: [[
        { text: "\uD83D\uDE80 GO", callback_data: `venture:go:${ideaId}` },
        { text: "\uD83D\uDDD1\uFE0F KILL", callback_data: `venture:kill:${ideaId}` },
      ]],
    }
  );

  logger.info({ ideaId }, "Pipeline: Double-yes passed, awaiting user decision");
  return true;
}

// ============================================================================
// STEP 5-8: AUTONOMOUS PIPELINE
// ============================================================================

async function createVentureAndFolder(ideaId: string): Promise<{ ventureId: string; folderId: string; codename: string }> {
  const idea = await storage.getVentureIdea(ideaId);
  if (!idea) throw new Error("Idea not found");

  const codename = generateCodename();

  // Create venture in DB
  const venture = await storage.createVenture({
    name: idea.name,
    oneLiner: idea.description.slice(0, 200),
    domain: (idea.domain as any) || "other",
    status: "planning",
    notes: `Codename: ${codename}\nAuto-created by venture pipeline.`,
  });

  // Create Drive folder
  let folderId = "";
  let folderUrl = "";
  try {
    const { createVentureFolder } = await import("../google-drive");
    folderId = await createVentureFolder(codename);
    folderUrl = `https://drive.google.com/drive/folders/${folderId}`;
  } catch (err: any) {
    logger.warn({ err: err.message }, "Pipeline: Drive folder creation failed (non-critical)");
  }

  await storage.updateVentureIdea(ideaId, { ventureId: venture.id } as any);
  await updatePipelineData(ideaId, {
    ventureCodename: codename,
    driveFolderId: folderId,
    driveFolderUrl: folderUrl,
  });

  return { ventureId: venture.id, folderId, codename };
}

async function runDocAgent(
  ideaId: string,
  stepName: "branding" | "prd" | "gtm",
  agentSlug: string,
  prompt: string,
  folderId: string,
  docNames: string[],
): Promise<{ driveFileIds: string[] }> {
  const driveFileIds: string[] = [];

  await updatePipelineData(ideaId, { steps: { [stepName]: { status: "running" } } });

  try {
    const openai = await getOpenAIClient();

    const completion = await openai.chat.completions.create({
      model: "openai/gpt-4o",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.5,
      max_tokens: 6000,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error(`No content generated for ${stepName}`);

    // Split content by doc names if multiple docs expected
    if (docNames.length === 1) {
      // Single doc
      if (folderId) {
        try {
          const { createDoc } = await import("../google-drive");
          const file = await createDoc(docNames[0], content, folderId);
          if (file.id) driveFileIds.push(file.id);
        } catch (err: any) {
          logger.warn({ err: err.message, step: stepName }, "Pipeline: Drive doc creation failed");
        }
      }
    } else {
      // Multiple docs: split by markdown headers
      const sections = content.split(/^# /m).filter(Boolean);
      for (let i = 0; i < Math.min(sections.length, docNames.length); i++) {
        const docContent = `# ${sections[i]}`;
        if (folderId) {
          try {
            const { createDoc } = await import("../google-drive");
            const file = await createDoc(docNames[i], docContent, folderId);
            if (file.id) driveFileIds.push(file.id);
          } catch (err: any) {
            logger.warn({ err: err.message, step: stepName, doc: docNames[i] }, "Pipeline: Drive doc creation failed");
          }
        }
      }

      // If split didn't work well, create a combined doc
      if (driveFileIds.length === 0 && folderId) {
        try {
          const { createDoc } = await import("../google-drive");
          const file = await createDoc(docNames[0], content, folderId);
          if (file.id) driveFileIds.push(file.id);
        } catch (err: any) {
          logger.warn({ err: err.message, step: stepName }, "Pipeline: Combined doc creation failed");
        }
      }
    }

    const tokensUsed = completion.usage?.total_tokens || 0;
    await updatePipelineData(ideaId, {
      steps: { [stepName]: { status: "done", driveFileIds: stepName === "branding" ? driveFileIds : undefined, driveFileId: stepName !== "branding" ? driveFileIds[0] : undefined } },
      totalTokensUsed: ((await storage.getVentureIdea(ideaId))?.pipelineData as PipelineData)?.totalTokensUsed || 0 + tokensUsed,
    });

    return { driveFileIds };
  } catch (err: any) {
    logger.error({ err: err.message, step: stepName, ideaId }, "Pipeline: Agent step failed");

    await updatePipelineData(ideaId, {
      steps: { [stepName]: { status: "failed", error: err.message } },
    });

    // Log to dead letter
    try {
      await storage.createDeadLetterJob({
        jobName: `venture-pipeline:${stepName}`,
        agentSlug: agentSlug,
        error: err.message,
        payload: { ideaId, stepName },
      });
    } catch {}

    throw err;
  }
}

async function runLandingPageAgent(
  ideaId: string,
  folderId: string,
  brandContent: string,
  prdContent: string,
): Promise<{ vercelUrl?: string }> {
  await updatePipelineData(ideaId, { steps: { landingPage: { status: "running" } } });

  try {
    const idea = await storage.getVentureIdea(ideaId);
    if (!idea) throw new Error("Idea not found");

    const openai = await getOpenAIClient();

    const prompt = `You are a senior frontend developer. Build a modern, responsive landing page for this venture.

## VENTURE
Name: ${idea.name}
Description: ${idea.description}

## BRAND GUIDE (use these colors, fonts, and tone)
${brandContent.slice(0, 2000)}

## PRODUCT REQUIREMENTS (use these features for the page)
${prdContent.slice(0, 2000)}

## REQUIREMENTS
- Single-page HTML with inline CSS and minimal JS
- Responsive (mobile-first)
- Sections: Hero with CTA, Features/Benefits, Social Proof placeholder, Final CTA
- Use the brand colors and typography from the guide
- Modern, clean design (NOT generic AI aesthetic)
- Include meta tags for SEO
- Include Open Graph tags

Output ONLY the complete HTML code, nothing else.`;

    const completion = await openai.chat.completions.create({
      model: "openai/gpt-4o",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 8000,
    });

    const htmlContent = completion.choices[0]?.message?.content;
    if (!htmlContent) throw new Error("No landing page content generated");

    // Clean up potential markdown code block wrappers
    const cleanHtml = htmlContent.replace(/^```html?\n?/i, "").replace(/\n?```$/i, "").trim();

    // Save to Drive
    if (folderId) {
      try {
        const { createDoc } = await import("../google-drive");
        await createDoc("Landing Page", cleanHtml, folderId);
      } catch {}
    }

    // Deploy to Vercel if token available
    let vercelUrl: string | undefined;
    if (process.env.VERCEL_TOKEN) {
      try {
        const fs = await import("fs/promises");
        const path = await import("path");
        const tmpDir = `/tmp/sbos-venture-pipeline-${ideaId}`;
        await fs.mkdir(tmpDir, { recursive: true });
        await fs.writeFile(path.join(tmpDir, "index.html"), cleanHtml);

        // Use simple Vercel deployment
        const { execSync } = await import("child_process");
        const result = execSync(
          `cd ${tmpDir} && npx vercel --yes --token=${process.env.VERCEL_TOKEN}${process.env.VERCEL_TEAM_ID ? ` --scope=${process.env.VERCEL_TEAM_ID}` : ""} 2>&1`,
          { timeout: 60000, encoding: "utf-8" }
        );

        // Extract URL from output
        const urlMatch = result.match(/(https:\/\/[^\s]+\.vercel\.app)/);
        if (urlMatch) {
          vercelUrl = urlMatch[1];
        }

        // Cleanup
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      } catch (err: any) {
        logger.warn({ err: err.message }, "Pipeline: Vercel deployment failed (non-critical)");
      }
    }

    await updatePipelineData(ideaId, {
      steps: { landingPage: { status: "done", vercelUrl } },
    });

    return { vercelUrl };
  } catch (err: any) {
    logger.error({ err: err.message, ideaId }, "Pipeline: Landing page step failed");
    await updatePipelineData(ideaId, {
      steps: { landingPage: { status: "failed", error: err.message } },
    });

    try {
      await storage.createDeadLetterJob({
        jobName: "venture-pipeline:landingPage",
        agentSlug: "mvp-builder",
        error: err.message,
        payload: { ideaId },
      });
    } catch {}

    return {};
  }
}

async function sendFinalNotification(ideaId: string) {
  const idea = await storage.getVentureIdea(ideaId);
  if (!idea) return;

  const pData = (idea.pipelineData as PipelineData) || { steps: {} };
  const chatId = pData.chatId || "";
  const codename = pData.ventureCodename || idea.name;
  const folderUrl = pData.driveFolderUrl;

  const lines: string[] = [
    `\uD83C\uDF89 <b>Venture Pack Ready: ${escapeHtml(codename)}</b>`,
    `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501`,
    `<b>${escapeHtml(idea.name)}</b>`,
    "",
  ];

  // Report each step
  const stepIcons: Record<string, string> = {
    branding: "\uD83C\uDFA8",
    prd: "\uD83D\uDCCB",
    gtm: "\uD83D\uDE80",
    landingPage: "\uD83C\uDF10",
  };
  const stepLabels: Record<string, string> = {
    branding: "Brand Guide & Visual Identity",
    prd: "Product Requirements Document",
    gtm: "GTM Launch Plan",
    landingPage: "Landing Page",
  };

  for (const [step, icon] of Object.entries(stepIcons)) {
    const stepData = pData.steps[step as keyof typeof pData.steps] as Record<string, any> | undefined;
    if (stepData?.status === "done") {
      let link = "";
      if (step === "landingPage" && stepData.vercelUrl) {
        link = ` — <a href="${escapeHtml(stepData.vercelUrl)}">Preview</a>`;
      }
      lines.push(`${icon} ${stepLabels[step]} \u2705${link}`);
    } else if (stepData?.status === "failed") {
      lines.push(`${icon} ${stepLabels[step]} \u274C`);
    } else {
      lines.push(`${icon} ${stepLabels[step]} \u23ED\uFE0F Skipped`);
    }
  }

  if (folderUrl) {
    lines.push("");
    lines.push(`\uD83D\uDCC1 <a href="${escapeHtml(folderUrl)}">View Drive Folder</a>`);
  }

  await sendTelegram(chatId, lines.join("\n"));
}

// ============================================================================
// MAIN PIPELINE ENTRY POINTS
// ============================================================================

/**
 * Start the venture pipeline for a new idea.
 * Called from /idea Telegram command. Fire-and-forget.
 */
export async function startVenturePipeline(ideaId: string, chatId: string): Promise<void> {
  try {
    // Initialize pipeline data
    await updatePipelineData(ideaId, { chatId, steps: {} });

    // Step 1: Perplexity research
    const { content: researchContent, tokensUsed: researchTokens } = await runPerplexityResearch(ideaId);
    await updatePipelineData(ideaId, { totalTokensUsed: researchTokens });

    // Progress notification
    await sendTelegram(chatId,
      `\uD83D\uDD0D <b>Research complete</b> — running Gemini validation...`
    );

    // Step 2: Gemini validation
    const { validation: geminiValidation, tokensUsed: geminiTokens } = await runGeminiValidation(ideaId, researchContent);
    await updatePipelineData(ideaId, { totalTokensUsed: researchTokens + geminiTokens });

    // Step 3: Double-yes check (sends GO/KILL buttons if both PROCEED)
    await checkDoubleYes(ideaId, researchContent, geminiValidation);

  } catch (err: any) {
    logger.error({ err: err.message, ideaId }, "Pipeline: Failed during research/validation phase");

    // Reset status and notify
    await storage.updateVentureIdea(ideaId, { status: "failed" } as any);

    const idea = await storage.getVentureIdea(ideaId);
    const pData = (idea?.pipelineData as PipelineData) || { steps: {} };

    await sendTelegram(pData.chatId || chatId,
      `\u274C <b>Pipeline Failed</b>\n${escapeHtml(err.message)}`
    );

    try {
      await storage.createDeadLetterJob({
        jobName: "venture-pipeline:research-validation",
        agentSlug: "venture-pipeline",
        error: err.message,
        payload: { ideaId },
      });
    } catch {}
  }
}

/**
 * Handle user's GO/KILL decision from Telegram inline keyboard.
 */
export async function handleUserDecision(ideaId: string, decision: "yes" | "no"): Promise<void> {
  const idea = await storage.getVentureIdea(ideaId);
  if (!idea) return;

  const pData = (idea.pipelineData as PipelineData) || { steps: {} };
  const chatId = pData.chatId || "";

  if (decision === "no") {
    await storage.updateVentureIdea(ideaId, { status: "rejected" } as any);
    await sendTelegram(chatId,
      `\uD83D\uDDD1\uFE0F <b>Idea killed:</b> ${escapeHtml(idea.name)}`
    );
    return;
  }

  // User said GO — launch autonomous pipeline
  await storage.updateVentureIdea(ideaId, { status: "pipeline" } as any);
  await sendTelegram(chatId,
    `\uD83D\uDE80 <b>Launching pipeline for ${escapeHtml(idea.name)}...</b>\nI'll notify you when the venture pack is ready.`
  );

  // Fire-and-forget the autonomous execution
  runAutonomousPipeline(ideaId).catch((err) => {
    logger.error({ err: err.message, ideaId }, "Pipeline: Autonomous execution failed (unhandled)");
  });
}

/**
 * Run the autonomous pipeline after user says GO.
 * Creates venture, runs parallel agent work, landing page, final notification.
 */
async function runAutonomousPipeline(ideaId: string): Promise<void> {
  const idea = await storage.getVentureIdea(ideaId);
  if (!idea) return;

  const pData = (idea.pipelineData as PipelineData) || { steps: {} };
  const chatId = pData.chatId || "";

  try {
    // Get research content
    let researchContent = "";
    if (idea.researchDocId) {
      const doc = await storage.getDoc(idea.researchDocId);
      researchContent = doc?.body || "";
    }

    // Step 5: Create venture + Drive folder
    const { ventureId, folderId, codename } = await createVentureAndFolder(ideaId);

    await sendTelegram(chatId,
      `\uD83D\uDCC2 <b>Venture created:</b> ${escapeHtml(codename)}\nRunning 3 agents in parallel...`
    );

    // Step 6: Parallel agent work
    const researchSummary = researchContent.slice(0, 3000);

    const brandingPrompt = `Create comprehensive brand guidelines for a new venture.

## VENTURE
Name: ${idea.name}
Description: ${idea.description}

## RESEARCH CONTEXT
${researchSummary}

## DELIVERABLES
Create TWO documents:

# Brand Guide
- Brand positioning (rooted in competitive analysis from the research)
- Voice and tone guidelines
- Messaging framework (taglines, elevator pitch, value propositions)
- Target audience personas

# Visual Identity
- Color palette (primary, secondary, accent colors with hex codes)
- Typography recommendations (heading + body fonts)
- Logo direction and guidance
- Imagery style and mood
- UI component style notes

Base your choices on the industry context from the research. NOT generic AI aesthetic — industry-informed and distinctive.`;

    const prdPrompt = `Create a Product Requirements Document for this venture.

## VENTURE
Name: ${idea.name}
Description: ${idea.description}
${idea.targetCustomer ? `Target Customer: ${idea.targetCustomer}` : ""}

## RESEARCH CONTEXT
${researchSummary}

## DOCUMENT STRUCTURE
# Product Requirements Document: ${idea.name}

## Problem Statement
(Based on the research findings)

## User Personas
(2-3 detailed personas from research buyer analysis)

## MVP Feature Scope
(Prioritized feature list — P0 must-haves, P1 should-haves, P2 nice-to-haves)

## Technical Architecture Recommendation
(Stack, infrastructure, key integrations)

## Success Metrics
(KPIs for launch, 30-day, 90-day)

## Risks & Mitigations
(From research risk assessment)

Be specific and actionable. This PRD should be sufficient for a developer to start building.`;

    const gtmPrompt = `Create a 90-day go-to-market launch plan for this venture.

## VENTURE
Name: ${idea.name}
Description: ${idea.description}
${idea.targetCustomer ? `Target Customer: ${idea.targetCustomer}` : ""}

## RESEARCH CONTEXT
${researchSummary}

## DOCUMENT STRUCTURE
# 90-Day GTM Launch Plan: ${idea.name}

## Target Segments
(Prioritized from research buyer analysis)

## Channel Strategy
### Organic Channels
(Content, SEO, community, partnerships)
### Paid Channels
(PPC, social ads, sponsorships — with estimated CPAs from research benchmarks)

## Week-by-Week Timeline
### Weeks 1-2: Foundation
### Weeks 3-4: Soft Launch
### Weeks 5-8: Growth Phase
### Weeks 9-12: Scale Phase

## Budget Allocation
(Breakdown by channel with expected ROI)

## Success Metrics
(Weekly/monthly KPIs)

## Quick Wins
(First 5 things to do in week 1)

Be specific to the industry and market. Use the competitive intelligence from the research.`;

    // Run 3 agents in parallel
    const results = await Promise.allSettled([
      runDocAgent(ideaId, "branding", "content-strategist", brandingPrompt, folderId, ["Brand Guide", "Visual Identity"]),
      runDocAgent(ideaId, "prd", "venture-architect", prdPrompt, folderId, ["Product Requirements"]),
      runDocAgent(ideaId, "gtm", "growth-specialist", gtmPrompt, folderId, ["GTM Launch Plan"]),
    ]);

    // Progress notification
    const doneCount = results.filter(r => r.status === "fulfilled").length;
    const failedCount = results.filter(r => r.status === "rejected").length;
    await sendTelegram(chatId,
      `\u2705 <b>${doneCount}/3 agent tasks complete</b>${failedCount > 0 ? ` (\u274C ${failedCount} failed)` : ""}\nBuilding landing page...`
    );

    // Step 7: Landing page (needs branding + PRD)
    // Get the content from the branding and PRD results for the landing page
    let brandContent = "";
    let prdContent = "";

    // Read back from research if agent results available
    const brandResult = results[0];
    const prdResult = results[1];

    if (brandResult.status === "fulfilled" && folderId) {
      try {
        const { listFiles } = await import("../google-drive");
        const files = await listFiles(folderId);
        const brandFile = files.files.find(f => f.name?.includes("Brand"));
        if (brandFile?.id) {
          // Use the brand content from the doc
          brandContent = `Brand guide created and saved to Drive.`;
        }
      } catch {}
    }

    if (prdResult.status === "fulfilled" && folderId) {
      prdContent = `PRD created and saved to Drive.`;
    }

    // If we have at least branding or PRD content, generate landing page
    if (brandResult.status === "fulfilled" || prdResult.status === "fulfilled") {
      await runLandingPageAgent(ideaId, folderId, brandContent || researchSummary, prdContent || researchSummary);
    } else {
      await updatePipelineData(ideaId, {
        steps: { landingPage: { status: "failed", error: "Skipped: both branding and PRD failed" } },
      });
    }

    // Step 8: Final notification
    await storage.updateVentureIdea(ideaId, {
      status: "compiled",
      compiledAt: new Date(),
    } as any);

    await updatePipelineData(ideaId, { completedAt: new Date().toISOString() });
    await sendFinalNotification(ideaId);

    logger.info({ ideaId, codename }, "Pipeline: Autonomous execution complete");

  } catch (err: any) {
    logger.error({ err: err.message, ideaId }, "Pipeline: Autonomous execution failed");

    await storage.updateVentureIdea(ideaId, { status: "failed" } as any);
    await sendTelegram(chatId,
      `\u274C <b>Pipeline failed:</b> ${escapeHtml(err.message)}\nPartial results may be in Drive.`
    );

    try {
      await storage.createDeadLetterJob({
        jobName: "venture-pipeline:autonomous",
        agentSlug: "venture-pipeline",
        error: err.message,
        payload: { ideaId },
      });
    } catch {}
  }
}
