/**
 * A-MAC Quality Gate
 *
 * Inspired by Rasputin Memory's A-MAC (Autonomous Memory Acceptance Criteria).
 * Scores incoming memories on three axes before storage:
 *   - Relevance: is this about something real and meaningful?
 *   - Novelty: does it add new information vs. what's already known?
 *   - Specificity: does it contain concrete details (names, dates, numbers, decisions)?
 *
 * Composite score = (relevance + novelty + specificity) / 3
 * Threshold: composite < 0.40 → rejected (pure noise)
 *
 * Fail-open: if the LLM times out or errors, the memory is accepted.
 * This prevents a flaky LLM from blocking all memory writes.
 */

import { logger } from "../logger";

// ============================================================================
// CONFIG
// ============================================================================

const QUALITY_THRESHOLD = 0.40;         // Below this → reject
const GATE_TIMEOUT_MS   = 5_000;        // 5 seconds — fail-open on timeout
const MIN_TEXT_LENGTH   = 30;           // Skip gate for very short text

// Short texts that are always noise regardless of score
const NOISE_PATTERNS = [
  /^(ok|okay|yes|no|sure|thanks|thank you|got it|understood|noted)\.?$/i,
  /^[\s\d!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]+$/,  // Only whitespace/numbers/punctuation
];

export interface QualityGateResult {
  accepted: boolean;
  score: number;       // 0.0–1.0 composite
  relevance: number;
  novelty: number;
  specificity: number;
  reason?: string;     // Why rejected (if rejected)
  skipped?: boolean;   // True if gate was skipped (fail-open)
}

// ============================================================================
// FAST HEURISTIC CHECKS (no LLM)
// ============================================================================

/**
 * Fast pre-checks before calling the LLM gate.
 * Returns null to proceed with LLM scoring, or a result to short-circuit.
 */
function fastPreCheck(text: string): QualityGateResult | null {
  // Too short to be meaningful
  if (text.trim().length < MIN_TEXT_LENGTH) {
    return {
      accepted: false,
      score: 0,
      relevance: 0,
      novelty: 0,
      specificity: 0,
      reason: "Too short",
    };
  }

  // Obvious noise patterns
  for (const pattern of NOISE_PATTERNS) {
    if (pattern.test(text.trim())) {
      return {
        accepted: false,
        score: 0,
        relevance: 0,
        novelty: 0,
        specificity: 0,
        reason: "Noise pattern",
      };
    }
  }

  // Strong specificity signals → auto-accept without LLM call (fast path)
  const hasDate = /\b\d{4}[-/]\d{2}[-/]\d{2}\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{1,2}/i.test(text);
  const hasCurrency = /\b(aed|usd|\$|€|£)\s*[\d,]+|\b[\d,]+\s*(aed|usd)/i.test(text);
  const hasDecision = /\b(decided|choosing|going with|committing to|confirmed|agreed|rejected)\b/i.test(text);
  const hasURL = /https?:\/\/\S+/.test(text);
  const hasCode = /```[\s\S]+```|`[^`]+`/.test(text);

  if ((hasDate || hasCurrency || hasDecision || hasURL || hasCode) && text.length > 60) {
    return {
      accepted: true,
      score: 0.85,
      relevance: 0.85,
      novelty: 0.80,
      specificity: 0.90,
      reason: "Fast-path: high-specificity signal",
    };
  }

  return null; // Proceed to LLM scoring
}

// ============================================================================
// LLM SCORING
// ============================================================================

async function llmScore(text: string): Promise<{ relevance: number; novelty: number; specificity: number } | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;

  const prompt = `Score this memory on three axes (0.0 to 1.0 each):

Memory: "${text.slice(0, 500)}"

Score:
- relevance: Is this about something real and meaningful for a person's life/work? (0=noise, 1=highly relevant)
- novelty: Does this add new information rather than restating obvious facts? (0=generic, 1=unique insight)
- specificity: Does it contain concrete details — names, numbers, dates, decisions, commands, URLs? (0=vague, 1=very specific)

Return ONLY valid JSON: {"relevance": 0.0, "novelty": 0.0, "specificity": 0.0}`;

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": process.env.SITE_URL || "http://localhost:5000",
        "X-Title": "SB-OS Quality Gate",
      },
      body: JSON.stringify({
        model: "google/gemini-2.0-flash-exp:free",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 80,
        temperature: 0.0,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(GATE_TIMEOUT_MS),
    });

    if (!response.ok) return null;

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);

    const relevance = Math.min(1, Math.max(0, Number(parsed.relevance) || 0));
    const novelty = Math.min(1, Math.max(0, Number(parsed.novelty) || 0));
    const specificity = Math.min(1, Math.max(0, Number(parsed.specificity) || 0));

    return { relevance, novelty, specificity };
  } catch {
    return null; // Fail-open: timeout or parse error
  }
}

// ============================================================================
// PUBLIC GATE
// ============================================================================

/**
 * Run the A-MAC quality gate on a memory before storage.
 *
 * Fast pre-checks first (no LLM), then LLM scoring if needed.
 * Fail-open: if LLM is unavailable or times out, memory is accepted.
 *
 * @param text - The memory text to evaluate
 * @returns QualityGateResult with accepted flag and scores
 */
export async function runQualityGate(text: string): Promise<QualityGateResult> {
  // Fast pre-check (synchronous, no LLM)
  const fastResult = fastPreCheck(text);
  if (fastResult !== null) {
    if (!fastResult.accepted) {
      logger.debug({ text: text.slice(0, 80), reason: fastResult.reason }, "Quality gate: fast reject");
    }
    return fastResult;
  }

  // LLM scoring
  const scores = await llmScore(text);

  // Fail-open: if LLM unavailable, accept the memory
  if (scores === null) {
    return {
      accepted: true,
      score: 0.5,
      relevance: 0.5,
      novelty: 0.5,
      specificity: 0.5,
      skipped: true,
    };
  }

  const composite = (scores.relevance + scores.novelty + scores.specificity) / 3;
  const accepted = composite >= QUALITY_THRESHOLD;

  if (!accepted) {
    logger.debug(
      { text: text.slice(0, 80), composite, ...scores },
      "Quality gate: LLM reject"
    );
  }

  return {
    accepted,
    score: composite,
    ...scores,
    reason: accepted ? undefined : `Composite ${composite.toFixed(2)} below threshold ${QUALITY_THRESHOLD}`,
  };
}

/**
 * Check if quality gating is enabled.
 * Requires either OPENROUTER_API_KEY for LLM scoring, or still works via fast heuristics.
 */
export function isQualityGateEnabled(): boolean {
  return true; // Always enabled — fast heuristics work without API key
}
