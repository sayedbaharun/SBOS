/**
 * Groq API Client
 *
 * Fast, cheap LLM inference via Groq's LPU hardware.
 * Used for fast-tier agents and as a compaction fallback after Cerebras.
 * OpenAI-compatible API — same request/response format.
 *
 * Cost: $0.06–$0.18 per 1M tokens (vs $3–15 for Claude)
 * Default model: llama-3.3-70b-versatile (same quality as Cerebras Llama 3.3 70B)
 */

import { logger } from "./logger";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_DEFAULT_MODEL = "llama-3.3-70b-versatile";

export interface GroqCompletionResult {
  content: string;
  model: string;
  tokensUsed: number;
}

export interface GroqCompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

/**
 * Generate a completion using Groq's API.
 * Throws on failure — caller is responsible for fallback.
 */
export async function generateGroqCompletion(
  systemPrompt: string,
  userPrompt: string,
  options: GroqCompletionOptions = {}
): Promise<GroqCompletionResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not set");
  }

  const {
    model = GROQ_DEFAULT_MODEL,
    temperature = 0.3,
    maxTokens = 2000,
    jsonMode = false,
  } = options;

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature,
    max_tokens: maxTokens,
  };

  if (jsonMode) {
    body.response_format = { type: "json_object" };
  }

  const response = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Groq API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("Empty response from Groq");
  }

  logger.debug({ model, tokensUsed: data.usage?.total_tokens }, "Groq completion successful");

  return {
    content,
    model: `groq/${model}`,
    tokensUsed: data.usage?.total_tokens || 0,
  };
}

/**
 * Check if Groq API is configured.
 */
export function isGroqAvailable(): boolean {
  return !!process.env.GROQ_API_KEY;
}
