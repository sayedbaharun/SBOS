/**
 * Observer — Resonance Pentad Layer 2
 *
 * Generates structured observations from conversation messages using GPT-4o-mini.
 * Observations preserve task momentum (decisions, next steps, open questions)
 * and feed into the shared memory system via Resonance routing.
 *
 * Falls back to Cerebras (llama-3.3-70b) when available for cost savings.
 */

import type OpenAI from "openai";
import { z } from "zod";
import { logger } from "../logger";
import type { ObservationOutput } from "./context-budget";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const prioritySchema = z.enum(["high", "medium", "low"]);

const observationSchema = z.object({
  summary: z.string().describe("Dense 2-4 paragraph summary of the conversation so far"),
  key_decisions: z
    .array(z.object({ text: z.string(), priority: prioritySchema }))
    .default([]),
  key_facts: z.array(z.string()).default([]),
  key_entities: z.array(z.string()).default([]),
  domain: z.string().default("personal"),
  action_items: z.array(z.string()).default([]),
  nextSteps: z
    .array(z.object({ text: z.string(), priority: prioritySchema }))
    .default([]),
  openQuestions: z.array(z.string()).default([]),
});

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const OBSERVER_SYSTEM_PROMPT = `You are an Observer — a context compaction engine for an AI agent system.

Your job: summarize an ongoing multi-turn tool-use conversation into a structured observation that preserves EVERYTHING the agent needs to continue working.

Critical requirements:
1. PRESERVE MOMENTUM: The agent must be able to continue its task seamlessly from your summary.
2. Keep ALL concrete data: numbers, URLs, file paths, IDs, error messages, API responses.
3. Track what's been DONE vs what's still PENDING.
4. Note any decisions made and their rationale.
5. Flag open questions that haven't been answered yet.

Respond with ONLY valid JSON matching this schema:
{
  "summary": "Dense 2-4 paragraph summary of conversation progress",
  "key_decisions": [{"text": "...", "priority": "high|medium|low"}],
  "key_facts": ["concrete fact 1", "concrete fact 2"],
  "key_entities": ["entity1", "entity2"],
  "domain": "business|project|personal|health|finance",
  "action_items": ["completed or pending action"],
  "nextSteps": [{"text": "...", "priority": "high|medium|low"}],
  "openQuestions": ["unresolved question"]
}`;

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

/**
 * Generate a structured observation from conversation messages.
 * Uses GPT-4o-mini via OpenRouter, falls back to Cerebras.
 */
export async function generateObservation(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
): Promise<ObservationOutput | null> {
  const startTime = Date.now();

  // Format messages for the prompt
  const formatted = messages
    .map((m) => {
      const role = m.role.toUpperCase();
      let content = "";
      if (typeof m.content === "string") {
        content = m.content.slice(0, 2000); // Truncate individual messages
      } else if (m.role === "assistant" && "tool_calls" in m && m.tool_calls) {
        content = (m.tool_calls as any[])
          .map((tc) => `[Called ${tc.function?.name || "unknown"}(${(tc.function?.arguments || "").slice(0, 200)})]`)
          .join("\n");
      }
      return `${role}: ${content}`;
    })
    .filter((line) => line.length > 10)
    .join("\n\n---\n\n");

  if (formatted.length < 100) return null;

  // Truncate to ~6000 tokens worth of content
  const truncated = formatted.slice(0, 24000);

  try {
    // Try Cerebras first (cheaper, faster)
    const observation = await tryObserveWithCerebras(truncated);
    if (observation) {
      logger.debug(
        { latencyMs: Date.now() - startTime, source: "cerebras" },
        "Observer generated observation via Cerebras",
      );
      return observation;
    }
  } catch {
    // Fall through to OpenRouter
  }

  try {
    // Fall back to GPT-4o-mini via OpenRouter
    const observation = await tryObserveWithOpenRouter(truncated);
    if (observation) {
      logger.debug(
        { latencyMs: Date.now() - startTime, source: "openrouter" },
        "Observer generated observation via OpenRouter",
      );
      return observation;
    }
  } catch (err: any) {
    logger.warn(
      { error: err.message },
      "Observer failed to generate observation",
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Backends
// ---------------------------------------------------------------------------

async function tryObserveWithCerebras(
  formattedMessages: string,
): Promise<ObservationOutput | null> {
  const { generateCompletion } = await import(
    "../compaction/cerebras-client"
  );

  const result = await generateCompletion(
    OBSERVER_SYSTEM_PROMPT,
    `Summarize this agent conversation into a structured observation:\n\n${formattedMessages}`,
    { temperature: 0.3, maxTokens: 2000, jsonMode: true },
  );

  return parseObservation(result.content);
}

async function tryObserveWithOpenRouter(
  formattedMessages: string,
): Promise<ObservationOutput | null> {
  const modelManager = await import("../model-manager");

  const { response } = await modelManager.chatCompletion(
    {
      messages: [
        { role: "system", content: OBSERVER_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Summarize this agent conversation into a structured observation:\n\n${formattedMessages}`,
        },
      ],
      temperature: 0.3,
      max_tokens: 2000,
      response_format: { type: "json_object" },
    },
    "simple",
    "google/gemini-2.0-flash-exp:free",
  );

  const content = response.choices[0]?.message?.content;
  if (!content) return null;

  return parseObservation(content);
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

function parseObservation(raw: string): ObservationOutput | null {
  try {
    // Extract JSON from potential markdown code blocks
    let jsonStr = raw;
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }

    const parsed = JSON.parse(jsonStr);
    const validated = observationSchema.parse(parsed);
    return validated;
  } catch (err: any) {
    logger.debug(
      { error: err.message, raw: raw.slice(0, 200) },
      "Failed to parse observer output",
    );

    // Fallback: create minimal observation from raw text
    if (raw.length > 50) {
      return {
        summary: raw.slice(0, 2000),
        key_decisions: [],
        key_facts: [],
        key_entities: [],
        domain: "personal",
        action_items: [],
        nextSteps: [],
        openQuestions: [],
      };
    }

    return null;
  }
}
