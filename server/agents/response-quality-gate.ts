/**
 * Response Quality Gate
 *
 * Deterministic (no extra LLM call) quality scoring for agent responses.
 * Catches common budget-model failure modes before they propagate.
 *
 * Inspired by Rasputin's quality gate, adapted for SB-OS agent runtime.
 *
 * Checks:
 * - XML tag hallucination (budget models sometimes emit raw <tool_use> artifacts)
 * - Missing expected JSON structure when JSON was requested
 * - Prompt injection/leakage patterns
 * - Empty or trivially short responses
 * - Repeated content (model stuck in a loop)
 *
 * Returns score 0-1. If < threshold, caller should escalate to next model tier.
 */

import { logger } from "../logger";
import { MODEL_TIER_DEFAULTS } from "./types";

// ============================================================================
// SCORING
// ============================================================================

export interface QualityScore {
  score: number;
  issues: string[];
  shouldEscalate: boolean;
}

const ESCALATION_THRESHOLD = 0.5;

// Tools that perform read-only operations — claiming "done" after only these is suspicious
const READ_ONLY_TOOLS = new Set([
  "list_tasks", "list_projects", "get_venture_summary", "search_knowledge_base",
  "get_day", "get_life_context", "explore_knowledge_graph", "search_memory",
  "calendar_read", "syntheliq_status", "web_search", "deep_research",
  "generate_report", "market_analyze",
]);

// Patterns that indicate the agent is claiming to have completed a mutative action
const ACTION_CLAIM_PATTERNS = [
  /(I['']ve|I have) (updated|created|modified|changed|set|configured|granted|revoked|added|removed|deleted|deployed|sent|scheduled|enabled|disabled|given)/i,
  /\b(Done|Completed|Finished)[!.\s]/i,
  /(successfully|already) (updated|created|modified|changed|set|configured|granted|enabled|disabled)/i,
  /has been (updated|created|modified|changed|set|configured|granted|enabled|disabled|added|removed)/i,
  /I('ve| have) (now |just )?(set up|set|given|granted|taken care of|handled|completed|finished|done that)/i,
];

/**
 * Score a model response for quality issues.
 * Pure deterministic — no LLM calls.
 */
export function scoreResponse(
  content: string,
  context?: { expectsJson?: boolean; agentSlug?: string; toolCallsMade?: string[] }
): QualityScore {
  let score = 1.0;
  const issues: string[] = [];

  if (!content || content.trim().length === 0) {
    return { score: 0, issues: ["empty_response"], shouldEscalate: true };
  }

  // 1. XML tag hallucination — budget models sometimes emit raw XML tool artifacts
  const xmlHallucinationPatterns = [
    /<tool_use>/i,
    /<\/tool_use>/i,
    /<tool_name>/i,
    /<parameters>/i,
    /<function_call>/i,
    /<invoke\s/i,
    /<antThinking>/i,
  ];
  for (const pattern of xmlHallucinationPatterns) {
    if (pattern.test(content)) {
      score -= 0.4;
      issues.push("xml_hallucination");
      break; // Only penalize once for XML hallucination
    }
  }

  // 2. Missing JSON when JSON was expected
  if (context?.expectsJson) {
    try {
      // Try to find JSON in the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        score -= 0.3;
        issues.push("missing_expected_json");
      } else {
        JSON.parse(jsonMatch[0]);
      }
    } catch {
      score -= 0.2;
      issues.push("malformed_json");
    }
  }

  // 3. Prompt injection/leakage — model regurgitating system prompt
  const leakagePatterns = [
    /you are an? (?:AI|assistant|language model|helpful)/i,
    /as an AI language model/i,
    /I(?:'m| am) (?:just )?an? AI/i,
    /my instructions (?:say|tell|are)/i,
    /system prompt/i,
    /\[INST\]/,
    /\[\/INST\]/,
    /<<SYS>>/,
    /<\|im_start\|>/,
  ];
  for (const pattern of leakagePatterns) {
    if (pattern.test(content)) {
      score -= 0.15;
      issues.push("prompt_leakage");
      break;
    }
  }

  // 4. Trivially short response (less than 20 chars for a non-tool response)
  if (content.trim().length < 20) {
    score -= 0.15;
    issues.push("trivially_short");
  }

  // 5. Repetition detection — same sentence/phrase repeated 3+ times
  const sentences = content.split(/[.!?\n]+/).filter((s) => s.trim().length > 10);
  if (sentences.length >= 3) {
    const seen = new Map<string, number>();
    for (const s of sentences) {
      const normalized = s.trim().toLowerCase();
      seen.set(normalized, (seen.get(normalized) || 0) + 1);
    }
    const counts = Array.from(seen.values());
    for (let i = 0; i < counts.length; i++) {
      if (counts[i] >= 3) {
        score -= 0.3;
        issues.push("repetition_loop");
        break;
      }
    }
  }

  // 6. Credential/secret leakage in response
  const credentialPatterns = [
    /sk-[a-zA-Z0-9]{20,}/,           // OpenAI-style keys
    /key-[a-zA-Z0-9]{20,}/,          // Generic API keys
    /ghp_[a-zA-Z0-9]{36}/,           // GitHub personal access tokens
    /xoxb-[a-zA-Z0-9-]+/,            // Slack bot tokens
    /AKIA[A-Z0-9]{16}/,              // AWS access keys
    /-----BEGIN (?:RSA )?PRIVATE KEY/, // Private keys
    /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\./, // JWTs (only flag very long ones)
    /postgresql:\/\/[^:]+:[^@]+@/,    // DB connection strings with passwords
  ];
  for (const pattern of credentialPatterns) {
    if (pattern.test(content)) {
      score -= 0.5;
      issues.push("credential_leakage");
      break;
    }
  }

  // 7. Action claim without a mutative tool call
  // Fires when: agent prose claims it did something, but no write-type tool was called.
  if (context?.toolCallsMade !== undefined) {
    const toolsCalled = context.toolCallsMade;
    const hasOnlyReadOnly = toolsCalled.length === 0 ||
      toolsCalled.every((t) => READ_ONLY_TOOLS.has(t));

    if (hasOnlyReadOnly) {
      for (const pattern of ACTION_CLAIM_PATTERNS) {
        if (pattern.test(content)) {
          score -= 0.4;
          issues.push("action_claim_without_tool");
          break;
        }
      }
    }
  }

  score = Math.max(0, Math.min(1, score));

  if (issues.length > 0) {
    logger.debug(
      { score, issues, agentSlug: context?.agentSlug, contentPreview: content.slice(0, 100) },
      "Quality gate scored response"
    );
  }

  return {
    score,
    issues,
    shouldEscalate: score < ESCALATION_THRESHOLD,
  };
}

// ============================================================================
// ESCALATION
// ============================================================================

/**
 * Get the next-tier model to escalate to.
 * fast → mid, mid → top, top → null (already at max)
 */
export function getEscalationModel(currentModel: string): string | null {
  // Determine current tier
  if (
    currentModel === MODEL_TIER_DEFAULTS.fast ||
    currentModel.includes("haiku")
  ) {
    return MODEL_TIER_DEFAULTS.mid; // Haiku → Sonnet
  }

  if (
    currentModel === MODEL_TIER_DEFAULTS.mid ||
    currentModel.includes("sonnet")
  ) {
    return MODEL_TIER_DEFAULTS.top; // Sonnet → Opus
  }

  // Already on top tier or unknown model — no escalation possible
  return null;
}

/**
 * Scrub potential credentials from a response string.
 * Defense-in-depth — architectural isolation is the primary defense.
 */
export function scrubCredentials(content: string): string {
  return content
    .replace(/sk-[a-zA-Z0-9]{20,}/g, "sk-***REDACTED***")
    .replace(/key-[a-zA-Z0-9]{20,}/g, "key-***REDACTED***")
    .replace(/ghp_[a-zA-Z0-9]{36}/g, "ghp_***REDACTED***")
    .replace(/xoxb-[a-zA-Z0-9-]+/g, "xoxb-***REDACTED***")
    .replace(/AKIA[A-Z0-9]{16}/g, "AKIA***REDACTED***")
    .replace(/-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA )?PRIVATE KEY-----/g, "***PRIVATE_KEY_REDACTED***")
    .replace(/postgresql:\/\/([^:]+):[^@]+@/g, "postgresql://$1:***@");
}
