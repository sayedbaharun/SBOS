/**
 * Cerebras API Client
 *
 * Fast summarization using Cerebras inference API.
 * Falls back to local Ollama if Cerebras is unavailable.
 */

import { logger } from "../logger";

const CEREBRAS_API_URL = "https://api.cerebras.ai/v1/chat/completions";
const CEREBRAS_MODEL = "llama-3.3-70b";
const OLLAMA_BASE_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const OLLAMA_FALLBACK_MODEL = "deepseek-r1:32b";

export interface CompletionResult {
  content: string;
  model: string;
  tokensUsed: number;
  source: "cerebras" | "groq" | "ollama";
}

/**
 * Generate a completion using Cerebras, with Ollama fallback
 */
export async function generateCompletion(
  systemPrompt: string,
  userPrompt: string,
  options: {
    temperature?: number;
    maxTokens?: number;
    jsonMode?: boolean;
  } = {}
): Promise<CompletionResult> {
  const { temperature = 0.3, maxTokens = 2000, jsonMode = true } = options;

  // Try Cerebras first
  const cerebrasKey = process.env.CEREBRAS_API_KEY;
  if (cerebrasKey) {
    try {
      return await cerebrasCompletion(
        cerebrasKey,
        systemPrompt,
        userPrompt,
        { temperature, maxTokens, jsonMode }
      );
    } catch (error) {
      logger.warn({ error }, "Cerebras failed, falling back to Ollama");
    }
  }

  // Try Groq before falling back to local Ollama
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    try {
      return await groqCompletion(groqKey, systemPrompt, userPrompt, { temperature, maxTokens, jsonMode });
    } catch (error) {
      logger.warn({ error }, "Groq failed, falling back to Ollama");
    }
  }

  // Fallback to local Ollama
  return ollamaCompletion(systemPrompt, userPrompt, {
    temperature,
    maxTokens,
    jsonMode,
  });
}

async function cerebrasCompletion(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  options: { temperature: number; maxTokens: number; jsonMode: boolean }
): Promise<CompletionResult> {
  const body: Record<string, unknown> = {
    model: CEREBRAS_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: options.temperature,
    max_tokens: options.maxTokens,
  };

  if (options.jsonMode) {
    body.response_format = { type: "json_object" };
  }

  const response = await fetch(CEREBRAS_API_URL, {
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
    throw new Error(`Cerebras API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("Empty response from Cerebras");
  }

  return {
    content,
    model: `cerebras/${CEREBRAS_MODEL}`,
    tokensUsed: data.usage?.total_tokens || 0,
    source: "cerebras",
  };
}

async function groqCompletion(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  options: { temperature: number; maxTokens: number; jsonMode: boolean }
): Promise<CompletionResult> {
  const GROQ_MODEL = "llama-3.3-70b-versatile";
  const body: Record<string, unknown> = {
    model: GROQ_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: options.temperature,
    max_tokens: options.maxTokens,
  };

  if (options.jsonMode) {
    body.response_format = { type: "json_object" };
  }

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
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

  return {
    content,
    model: `groq/${GROQ_MODEL}`,
    tokensUsed: data.usage?.total_tokens || 0,
    source: "groq",
  };
}

async function ollamaCompletion(
  systemPrompt: string,
  userPrompt: string,
  options: { temperature: number; maxTokens: number; jsonMode: boolean }
): Promise<CompletionResult> {
  const body: Record<string, unknown> = {
    model: OLLAMA_FALLBACK_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    stream: false,
    options: {
      temperature: options.temperature,
      num_predict: options.maxTokens,
    },
  };

  if (options.jsonMode) {
    body.format = "json";
  }

  const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000), // 2 min for local model
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Ollama API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const content = data.message?.content;

  if (!content) {
    throw new Error("Empty response from Ollama");
  }

  return {
    content,
    model: `ollama/${OLLAMA_FALLBACK_MODEL}`,
    tokensUsed: data.eval_count || 0,
    source: "ollama",
  };
}

/**
 * Check if Cerebras API is available
 */
export async function isCerebrasAvailable(): Promise<boolean> {
  return !!process.env.CEREBRAS_API_KEY;
}
