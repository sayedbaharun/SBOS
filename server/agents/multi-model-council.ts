/**
 * Multi-Model Council — High-Stakes Decision Support
 *
 * For critical decisions (venture strategy, investments, architecture),
 * queries multiple models in parallel and synthesizes their responses.
 *
 * Inspired by Rasputin Stack's multi-model debate with:
 *   - Confidence scoring (25-95%)
 *   - Contradiction detection
 *   - Fractal mode (4 sub-perspectives → synthesis)
 *
 * Council composition (via OpenRouter):
 *   - Claude Sonnet 4 (analytical, balanced)
 *   - GPT-4o (creative, broad knowledge)
 *   - Gemini 2.5 Flash (fast, good at structured reasoning)
 *
 * Synthesis by Claude Opus 4 or GPT-4o (selectable).
 */

import { logger } from "../logger";
import { chatCompletion } from "../model-manager";

// ============================================================================
// TYPES
// ============================================================================

export interface CouncilRequest {
  question: string;
  context?: string;
  mode?: "standard" | "fractal";
  synthesisModel?: string;
}

export interface CouncilMemberResponse {
  model: string;
  response: string;
  confidence: number; // 0-100
  keyPoints: string[];
  risks: string[];
  latencyMs: number;
}

export interface CouncilResult {
  question: string;
  mode: "standard" | "fractal";
  members: CouncilMemberResponse[];
  synthesis: string;
  consensusLevel: "strong" | "moderate" | "split";
  contradictions: string[];
  recommendation: string;
  totalLatencyMs: number;
}

// ============================================================================
// COUNCIL MODELS
// ============================================================================

const COUNCIL_MODELS = [
  { id: "anthropic/claude-sonnet-4", role: "Analytical Advisor" },
  { id: "openai/gpt-4o", role: "Strategic Thinker" },
  { id: "google/gemini-2.5-flash-preview-05-20", role: "Pragmatic Engineer" },
];

const FRACTAL_PERSPECTIVES = [
  { role: "Researcher", prompt: "Provide thorough research and evidence. What data supports or contradicts this?" },
  { role: "Devil's Advocate", prompt: "Challenge assumptions. What could go wrong? What are the hidden risks?" },
  { role: "Feasibility Analyst", prompt: "Evaluate practical feasibility. What resources, timeline, and constraints apply?" },
  { role: "Creative Strategist", prompt: "Think outside the box. What unconventional approaches or opportunities exist?" },
];

const DEFAULT_SYNTHESIS_MODEL = "anthropic/claude-sonnet-4";

// ============================================================================
// COUNCIL EXECUTION
// ============================================================================

/**
 * Run the multi-model council for a high-stakes decision.
 */
export async function runCouncil(request: CouncilRequest): Promise<CouncilResult> {
  const startTime = Date.now();
  const mode = request.mode || "standard";
  const synthesisModel = request.synthesisModel || DEFAULT_SYNTHESIS_MODEL;

  logger.info({ question: request.question.slice(0, 100), mode }, "Starting multi-model council");

  let memberResponses: CouncilMemberResponse[];

  if (mode === "fractal") {
    memberResponses = await runFractalMode(request);
  } else {
    memberResponses = await runStandardMode(request);
  }

  // Detect contradictions
  const contradictions = detectContradictions(memberResponses);
  const consensusLevel = calculateConsensus(memberResponses, contradictions);

  // Synthesize
  const synthesis = await synthesizeResponses(
    request.question,
    memberResponses,
    contradictions,
    synthesisModel
  );

  const result: CouncilResult = {
    question: request.question,
    mode,
    members: memberResponses,
    synthesis: synthesis.text,
    consensusLevel,
    contradictions,
    recommendation: synthesis.recommendation,
    totalLatencyMs: Date.now() - startTime,
  };

  logger.info({
    mode,
    memberCount: memberResponses.length,
    consensusLevel,
    contradictions: contradictions.length,
    totalLatencyMs: result.totalLatencyMs,
  }, "Multi-model council complete");

  return result;
}

/**
 * Standard mode: each model answers the same question independently.
 */
async function runStandardMode(request: CouncilRequest): Promise<CouncilMemberResponse[]> {
  const systemPrompt = `You are a senior advisor participating in a multi-model council.
Answer the question thoroughly. At the end of your response, add:
CONFIDENCE: [number 25-95]%
KEY_POINTS: [bullet list of 3-5 key points]
RISKS: [bullet list of 1-3 risks or concerns]`;

  const contextBlock = request.context ? `\n\nContext:\n${request.context}` : "";

  const promises = COUNCIL_MODELS.map(async (model) => {
    const startMs = Date.now();
    try {
      const result = await chatCompletion(
        {
          messages: [
            { role: "system", content: `${systemPrompt}\n\nYour role: ${model.role}` },
            { role: "user", content: `${request.question}${contextBlock}` },
          ],
          temperature: 0.7,
          max_tokens: 1500,
        },
        "complex",
        model.id
      );

      const content = result.response.choices[0]?.message?.content || "";
      return parseCouncilResponse(model.id, content, Date.now() - startMs);
    } catch (error: any) {
      logger.warn({ model: model.id, error: error.message }, "Council member failed");
      return {
        model: model.id,
        response: `[Failed: ${error.message}]`,
        confidence: 0,
        keyPoints: [],
        risks: ["Model unavailable"],
        latencyMs: Date.now() - startMs,
      };
    }
  });

  return Promise.all(promises);
}

/**
 * Fractal mode: 4 sub-agents research from different perspectives,
 * each using the cheapest available model, then synthesis.
 */
async function runFractalMode(request: CouncilRequest): Promise<CouncilMemberResponse[]> {
  const contextBlock = request.context ? `\n\nContext:\n${request.context}` : "";
  const model = "openai/gpt-4o-mini"; // Use cheap model for sub-agents

  const promises = FRACTAL_PERSPECTIVES.map(async (perspective) => {
    const startMs = Date.now();
    try {
      const result = await chatCompletion(
        {
          messages: [
            {
              role: "system",
              content: `You are a ${perspective.role}. ${perspective.prompt}
At the end of your response, add:
CONFIDENCE: [number 25-95]%
KEY_POINTS: [bullet list of 3-5 key points]
RISKS: [bullet list of 1-3 risks or concerns]`,
            },
            { role: "user", content: `${request.question}${contextBlock}` },
          ],
          temperature: 0.7,
          max_tokens: 1000,
        },
        "moderate",
        model
      );

      const content = result.response.choices[0]?.message?.content || "";
      const parsed = parseCouncilResponse(`${model}:${perspective.role}`, content, Date.now() - startMs);
      return parsed;
    } catch (error: any) {
      return {
        model: `${model}:${perspective.role}`,
        response: `[Failed: ${error.message}]`,
        confidence: 0,
        keyPoints: [],
        risks: [],
        latencyMs: Date.now() - startMs,
      };
    }
  });

  return Promise.all(promises);
}

// ============================================================================
// PARSING & ANALYSIS
// ============================================================================

function parseCouncilResponse(
  model: string,
  content: string,
  latencyMs: number
): CouncilMemberResponse {
  // Extract confidence
  const confidenceMatch = content.match(/CONFIDENCE:\s*(\d{1,2,3})%/i);
  const confidence = confidenceMatch ? parseInt(confidenceMatch[1], 10) : 50;

  // Extract key points
  const keyPointsMatch = content.match(/KEY_POINTS:\s*([\s\S]*?)(?=RISKS:|$)/i);
  const keyPoints = keyPointsMatch
    ? keyPointsMatch[1]
        .split(/[-*]\s+/)
        .map((p) => p.trim())
        .filter((p) => p.length > 5)
    : [];

  // Extract risks
  const risksMatch = content.match(/RISKS:\s*([\s\S]*?)$/i);
  const risks = risksMatch
    ? risksMatch[1]
        .split(/[-*]\s+/)
        .map((r) => r.trim())
        .filter((r) => r.length > 5)
    : [];

  // Clean response (remove metadata sections)
  const response = content
    .replace(/CONFIDENCE:[\s\S]*$/i, "")
    .trim();

  return { model, response, confidence, keyPoints, risks, latencyMs };
}

function detectContradictions(responses: CouncilMemberResponse[]): string[] {
  const contradictions: string[] = [];

  // Simple contradiction detection: compare key points across members
  for (let i = 0; i < responses.length; i++) {
    for (let j = i + 1; j < responses.length; j++) {
      const a = responses[i];
      const b = responses[j];

      // Check if one member's risk is another's key point
      for (const risk of a.risks) {
        for (const point of b.keyPoints) {
          if (hasSignificantOverlap(risk, point)) {
            contradictions.push(
              `${a.model.split("/").pop()} flags "${risk.slice(0, 80)}" as a risk, ` +
              `but ${b.model.split("/").pop()} sees it as positive`
            );
          }
        }
      }

      // Large confidence divergence
      if (Math.abs(a.confidence - b.confidence) > 40) {
        contradictions.push(
          `Confidence split: ${a.model.split("/").pop()} (${a.confidence}%) vs ${b.model.split("/").pop()} (${b.confidence}%)`
        );
      }
    }
  }

  return contradictions.slice(0, 5);
}

function hasSignificantOverlap(a: string, b: string): boolean {
  const wordsA = Array.from(new Set(a.toLowerCase().split(/\s+/).filter((w) => w.length > 4)));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter((w) => w.length > 4));
  let overlap = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap++;
  }
  return overlap >= 3 && overlap / Math.min(wordsA.length, wordsB.size) > 0.4;
}

function calculateConsensus(
  responses: CouncilMemberResponse[],
  contradictions: string[]
): "strong" | "moderate" | "split" {
  const validResponses = responses.filter((r) => r.confidence > 0);
  if (validResponses.length === 0) return "split";

  const avgConfidence = validResponses.reduce((s, r) => s + r.confidence, 0) / validResponses.length;
  const confidenceSpread = Math.max(...validResponses.map((r) => r.confidence))
    - Math.min(...validResponses.map((r) => r.confidence));

  if (contradictions.length === 0 && avgConfidence > 70 && confidenceSpread < 20) {
    return "strong";
  }
  if (contradictions.length <= 1 && avgConfidence > 50) {
    return "moderate";
  }
  return "split";
}

// ============================================================================
// SYNTHESIS
// ============================================================================

async function synthesizeResponses(
  question: string,
  responses: CouncilMemberResponse[],
  contradictions: string[],
  synthesisModel: string
): Promise<{ text: string; recommendation: string }> {
  const memberSummaries = responses
    .map((r) => `### ${r.model} (confidence: ${r.confidence}%)\n${r.response.slice(0, 500)}\nKey points: ${r.keyPoints.join("; ")}\nRisks: ${r.risks.join("; ")}`)
    .join("\n\n");

  const contradictionBlock = contradictions.length > 0
    ? `\n\nContradictions detected:\n${contradictions.map((c) => `- ${c}`).join("\n")}`
    : "";

  try {
    const result = await chatCompletion(
      {
        messages: [
          {
            role: "system",
            content: `You are synthesizing responses from a multi-model advisory council.
Weigh each response by its confidence level and the quality of its reasoning.
When members contradict each other, analyze both sides and make a judgment call.

Format your response as:
## Synthesis
[Integrated analysis]

## Recommendation
[Clear, actionable recommendation]`,
          },
          {
            role: "user",
            content: `Question: ${question}\n\nCouncil Responses:\n${memberSummaries}${contradictionBlock}`,
          },
        ],
        temperature: 0.3,
        max_tokens: 1500,
      },
      "complex",
      synthesisModel
    );

    const content = result.response.choices[0]?.message?.content || "";

    // Extract recommendation section
    const recMatch = content.match(/## Recommendation\s*([\s\S]*?)$/i);
    const recommendation = recMatch ? recMatch[1].trim() : content.slice(-300);

    return { text: content, recommendation };
  } catch (error: any) {
    logger.error({ error: error.message }, "Council synthesis failed");
    return {
      text: "Synthesis failed. Individual member responses are available above.",
      recommendation: "Review individual member responses for guidance.",
    };
  }
}
