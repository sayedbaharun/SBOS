import OpenAI from "openai";
import { logger } from "./logger";
import type { InsertTokenUsageLog } from "@shared/schema";

// Initialize OpenRouter with OpenAI-compatible API (lazy initialization)
let openai: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!openai) {
    if (!process.env.OPENROUTER_API_KEY) {
      throw new Error("OPENROUTER_API_KEY is not set. AI features are disabled.");
    }
    openai = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": process.env.SITE_URL || "http://localhost:5000",
        "X-Title": "SB-OS",
      },
    });
  }
  return openai;
}

// ============================================================================
// KILO CODE FALLBACK (when OpenRouter credits are exhausted)
// ============================================================================

let kiloClient: OpenAI | null = null;

function getKiloClient(): OpenAI | null {
  if (!process.env.KILOCODE_API_KEY) return null;
  if (!kiloClient) {
    kiloClient = new OpenAI({
      apiKey: process.env.KILOCODE_API_KEY,
      baseURL: "https://api.kilo.ai/api/gateway",
      defaultHeaders: {
        "HTTP-Referer": process.env.SITE_URL || "http://localhost:5000",
        "X-Title": "SB-OS",
      },
    });
  }
  return kiloClient;
}

// ============================================================================
// GROQ FALLBACK (cheap fast-tier LLM on LPU hardware)
// ============================================================================

let groqClient: OpenAI | null = null;

function getGroqClient(): OpenAI | null {
  if (!process.env.GROQ_API_KEY) return null;
  if (!groqClient) {
    groqClient = new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: "https://api.groq.com/openai/v1",
    });
  }
  return groqClient;
}

// ============================================================================
// DIRECT OPENAI FALLBACK (bypasses OpenRouter when it's having a bad day)
// ============================================================================

let directOpenAIClient: OpenAI | null = null;

function getDirectOpenAIClient(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!directOpenAIClient) {
    directOpenAIClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: "https://api.openai.com/v1",
    });
  }
  return directOpenAIClient;
}

/** Returns true for errors that indicate OpenRouter credits are exhausted */
function isCreditsExhausted(error: any): boolean {
  return (
    error.status === 402 || // Payment required
    (error.status === 400 && /insufficient.*credit/i.test(error.message || "")) ||
    (error.status === 429 && /limit|quota|credit/i.test(error.message || ""))
  );
}

// Short-lived cache: once we know OpenRouter is out of credits, skip it entirely
// for OPENROUTER_COOLDOWN_MS to avoid wasting ~3s per call cycling dead models
const OPENROUTER_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
let openRouterExhaustedAt: number | null = null;

function markOpenRouterExhausted(): void {
  openRouterExhaustedAt = Date.now();
  providerHealth.openrouter.status = "exhausted";
  providerHealth.openrouter.lastFailure = Date.now();
  providerHealth.openrouter.consecutiveFailures++;
  logger.info(`OpenRouter marked as credit-exhausted for ${OPENROUTER_COOLDOWN_MS / 1000}s`);
}

function isOpenRouterCoolingDown(): boolean {
  if (!openRouterExhaustedAt) return false;
  if (Date.now() - openRouterExhaustedAt > OPENROUTER_COOLDOWN_MS) {
    openRouterExhaustedAt = null; // Reset — try OpenRouter again
    providerHealth.openrouter.status = "healthy";
    return false;
  }
  return true;
}

// ============================================================================
// PROVIDER HEALTH MONITORING
// ============================================================================

export interface ProviderHealthStatus {
  status: "healthy" | "degraded" | "down" | "exhausted";
  lastSuccess: number | null;
  lastFailure: number | null;
  consecutiveFailures: number;
  avgLatencyMs: number;
  totalRequests: number;
  totalFailures: number;
  lastModel: string | null;
}

const createHealthEntry = (): ProviderHealthStatus => ({
  status: "healthy",
  lastSuccess: null,
  lastFailure: null,
  consecutiveFailures: 0,
  avgLatencyMs: 0,
  totalRequests: 0,
  totalFailures: 0,
  lastModel: null,
});

const providerHealth: Record<string, ProviderHealthStatus> = {
  openrouter: createHealthEntry(),
  kilo: createHealthEntry(),
  groq: createHealthEntry(),
  openai_direct: createHealthEntry(),
  local: createHealthEntry(),
};

// Rolling average for latency (exponential moving average)
function updateLatency(provider: string, latencyMs: number): void {
  const h = providerHealth[provider];
  if (!h) return;
  const alpha = 0.3; // Weight for new sample
  h.avgLatencyMs = h.avgLatencyMs === 0
    ? latencyMs
    : Math.round(h.avgLatencyMs * (1 - alpha) + latencyMs * alpha);
}

function recordSuccess(provider: string, latencyMs: number, model: string): void {
  const h = providerHealth[provider];
  if (!h) return;
  h.lastSuccess = Date.now();
  h.consecutiveFailures = 0;
  h.status = "healthy";
  h.totalRequests++;
  h.lastModel = model;
  updateLatency(provider, latencyMs);
}

function recordFailure(provider: string, model: string): void {
  const h = providerHealth[provider];
  if (!h) return;
  h.lastFailure = Date.now();
  h.consecutiveFailures++;
  h.totalRequests++;
  h.totalFailures++;
  h.lastModel = model;
  // Mark degraded after 2 failures, down after 5
  if (h.consecutiveFailures >= 5) h.status = "down";
  else if (h.consecutiveFailures >= 2) h.status = "degraded";
}

/**
 * Get health status for all LLM providers.
 * Used by the gateway health monitor and the /api/health/providers endpoint.
 */
export function getProviderHealth(): Record<string, ProviderHealthStatus & { configured: boolean }> {
  return {
    openrouter: {
      ...providerHealth.openrouter,
      configured: !!process.env.OPENROUTER_API_KEY,
    },
    kilo: {
      ...providerHealth.kilo,
      configured: !!process.env.KILOCODE_API_KEY,
    },
    groq: {
      ...providerHealth.groq,
      configured: !!process.env.GROQ_API_KEY,
    },
    openai_direct: {
      ...providerHealth.openai_direct,
      configured: !!process.env.OPENAI_API_KEY,
    },
    local: {
      ...providerHealth.local,
      configured: !!process.env.LOCAL_MODEL_URL,
    },
  };
}

/**
 * Get the active provider for the current request.
 * Returns which provider will be used based on current health state.
 */
export function getActiveProvider(): string {
  if (isOpenRouterCoolingDown()) {
    return getKiloClient() ? "kilo" : "openrouter";
  }
  return "openrouter";
}

/**
 * Run a lightweight health probe against each configured provider.
 * Call periodically (e.g. every 60s) to detect outages proactively.
 */
export async function probeProviderHealth(): Promise<Record<string, "ok" | "error">> {
  const results: Record<string, "ok" | "error"> = {};

  // OpenRouter probe
  if (process.env.OPENROUTER_API_KEY) {
    try {
      const start = Date.now();
      const resp = await fetch("https://openrouter.ai/api/v1/models", {
        headers: { "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}` },
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok) {
        recordSuccess("openrouter", Date.now() - start, "probe");
        results.openrouter = "ok";
      } else {
        recordFailure("openrouter", "probe");
        results.openrouter = "error";
      }
    } catch {
      recordFailure("openrouter", "probe");
      results.openrouter = "error";
    }
  }

  // Kilo probe
  if (process.env.KILOCODE_API_KEY) {
    try {
      const start = Date.now();
      const resp = await fetch("https://api.kilo.ai/api/gateway/models", {
        headers: { "Authorization": `Bearer ${process.env.KILOCODE_API_KEY}` },
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok) {
        recordSuccess("kilo", Date.now() - start, "probe");
        results.kilo = "ok";
      } else {
        recordFailure("kilo", "probe");
        results.kilo = "error";
      }
    } catch {
      recordFailure("kilo", "probe");
      results.kilo = "error";
    }
  }

  // Local probe
  const localAvailable = await isLocalAvailable();
  if (localAvailable) {
    recordSuccess("local", 0, "probe");
    results.local = "ok";
  } else if (process.env.LOCAL_MODEL_URL) {
    recordFailure("local", "probe");
    results.local = "error";
  }

  return results;
}

// ============================================================================
// MODEL CONSTANTS — Change here to update across the system
// ============================================================================

/**
 * Free fast model on OpenRouter — replaces gpt-4o-mini for bulk/routine tasks.
 * Benchmarks equal or better than gpt-4o-mini at $0 cost.
 * Updated by free_model_scout cron job every 5 days.
 */
export const FREE_MINI_MODEL = "google/gemini-2.0-flash-exp:free";

// ============================================================================
// LOCAL MODEL (LM Studio / Qwen 3.5)
// ============================================================================

const LM_STUDIO_URL = process.env.LOCAL_MODEL_URL || "http://localhost:1234/v1";
const LOCAL_MODEL_NAME = process.env.LOCAL_MODEL_NAME || "qwen3.5-35b-a3b";
const LOCAL_FALLBACK_MODEL = "anthropic/claude-3.5-haiku";

let localClient: OpenAI | null = null;

function getLocalClient(): OpenAI {
  if (!localClient) {
    localClient = new OpenAI({
      apiKey: "lm-studio", // LM Studio doesn't require a real key
      baseURL: LM_STUDIO_URL,
    });
  }
  return localClient;
}

// Cached health check to avoid hammering the local endpoint
let localAvailableCache: { available: boolean; checkedAt: number } | null = null;
const LOCAL_HEALTH_CACHE_TTL = 60_000; // 60 seconds

export async function isLocalAvailable(): Promise<boolean> {
  if (localAvailableCache && Date.now() - localAvailableCache.checkedAt < LOCAL_HEALTH_CACHE_TTL) {
    return localAvailableCache.available;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const response = await fetch(`${LM_STUDIO_URL}/models`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const available = response.ok;
    localAvailableCache = { available, checkedAt: Date.now() };
    return available;
  } catch {
    localAvailableCache = { available: false, checkedAt: Date.now() };
    return false;
  }
}

export function getLocalModelInfo() {
  return { url: LM_STUDIO_URL, model: LOCAL_MODEL_NAME, fallback: LOCAL_FALLBACK_MODEL };
}

/**
 * Chat completion via local LM Studio model.
 * Falls back to cloud fast tier (Haiku) on failure.
 */
async function localChatCompletion(
  params: ChatCompletionParams,
): Promise<{
  response: OpenAI.Chat.ChatCompletion;
  metrics: ModelMetrics;
}> {
  const startTime = Date.now();

  // Check if local is available first
  const available = await isLocalAvailable();
  if (available) {
    try {
      logger.info({ model: LOCAL_MODEL_NAME }, `Attempting local chat completion`);
      const response = await getLocalClient().chat.completions.create({
        model: LOCAL_MODEL_NAME,
        messages: params.messages,
        tools: params.tools,
        tool_choice: params.tool_choice,
        temperature: params.temperature ?? 0.7,
        max_tokens: params.max_tokens,
        response_format: params.response_format,
      });

      const latencyMs = Date.now() - startTime;
      const modelTag = `local/${LOCAL_MODEL_NAME}`;
      logger.info({
        model: modelTag,
        tokensUsed: response.usage?.total_tokens,
        latencyMs,
      }, `Local chat completion successful`);

      return {
        response,
        metrics: {
          modelUsed: modelTag,
          attemptNumber: 1,
          totalAttempts: 1,
          success: true,
          tokensUsed: response.usage?.total_tokens,
          latencyMs,
        },
      };
    } catch (error: any) {
      logger.warn({ error: error.message }, `Local model failed, falling back to cloud`);
      // Invalidate cache so next call re-checks
      localAvailableCache = null;
    }
  } else {
    logger.info(`Local model unavailable, falling back to ${LOCAL_FALLBACK_MODEL}`);
  }

  // Fallback to cloud fast tier
  return chatCompletion(params, "simple", LOCAL_FALLBACK_MODEL);
}

// ============================================================================
// TOKEN USAGE LOGGING
// ============================================================================

// Approximate cost per 1M tokens (in cents) for common models
const MODEL_COST_PER_MILLION: Record<string, { input: number; output: number }> = {
  "anthropic/claude-opus-4": { input: 1500, output: 7500 },
  "anthropic/claude-sonnet-4": { input: 300, output: 1500 },
  "anthropic/claude-3.5-haiku": { input: 80, output: 400 },
  "openai/gpt-4o": { input: 250, output: 1000 },
  "google/gemini-2.0-flash-exp:free": { input: 15, output: 60 },
  "google/gemini-2.5-pro-preview-06-05": { input: 125, output: 1000 },
  "google/gemini-2.5-flash-preview-05-20": { input: 15, output: 60 },
  "google/gemini-2.5-flash-lite": { input: 10, output: 40 },
  "deepseek/deepseek-chat": { input: 14, output: 28 },
  "meta-llama/llama-3.3-70b-instruct": { input: 12, output: 30 },
  "groq/llama-3.3-70b-versatile": { input: 6, output: 6 },
  "groq/llama-3.1-8b-instant": { input: 5, output: 5 },
  "groq/llama-4-scout-17b-16e-instruct": { input: 15, output: 15 },
};

function estimateCostCents(model: string, promptTokens: number, completionTokens: number): number {
  const pricing = MODEL_COST_PER_MILLION[model];
  if (!pricing) return 0; // Unknown model — cost unknown
  return (promptTokens * pricing.input + completionTokens * pricing.output) / 1_000_000;
}

/**
 * Log token usage to the database (fire-and-forget).
 */
export function logTokenUsage(
  model: string,
  usage: OpenAI.CompletionUsage | undefined,
  source: InsertTokenUsageLog["source"],
  agentId?: string | null,
): void {
  if (!usage) return;
  const promptTokens = usage.prompt_tokens || 0;
  const completionTokens = usage.completion_tokens || 0;
  const totalTokens = usage.total_tokens || 0;
  const estimatedCostCents = estimateCostCents(model, promptTokens, completionTokens);

  // Fire-and-forget — don't block the caller
  (async () => {
    try {
      const { storage } = await import("./storage");
      await (storage as any).db.insert(
        (await import("@shared/schema")).tokenUsageLog
      ).values({
        agentId: agentId || null,
        model,
        promptTokens,
        completionTokens,
        totalTokens,
        estimatedCostCents,
        source: source || "web_chat",
      });
    } catch (err: any) {
      logger.warn({ error: err.message }, "Failed to log token usage");
    }
  })();
}

// Model configuration with fallback cascade (OpenRouter model names)
// Free-tier models at the end mean we survive even if OpenRouter credits run out
export const MODEL_CASCADE = [
  { name: "openai/gpt-4o", maxRetries: 2, description: "Primary - Best quality" },
  { name: "google/gemini-2.0-flash-exp:free", maxRetries: 2, description: "Fallback 1 - Free fast model" },
  { name: "anthropic/claude-sonnet-4", maxRetries: 1, description: "Fallback 2 - Reliable Anthropic" },
  { name: "google/gemini-2.0-flash-exp:free", maxRetries: 1, description: "Fallback 3 - Free Gemini catch-all" },
] as const;

// Available models for selection in UI (via OpenRouter)
export const AVAILABLE_MODELS = [
  // Anthropic models (newest first)
  { id: "anthropic/claude-opus-4", name: "Claude Opus 4", provider: "Anthropic", description: "Most powerful Claude, best for complex tasks" },
  { id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4", provider: "Anthropic", description: "Excellent balance of speed and capability" },
  { id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4", provider: "Anthropic", description: "Strong balance of speed and capability" },
  { id: "anthropic/claude-3.5-haiku", name: "Claude 3.5 Haiku", provider: "Anthropic", description: "Fast and affordable Claude" },
  // OpenAI models
  { id: "openai/gpt-4.5-preview", name: "GPT-4.5 Preview", provider: "OpenAI", description: "Latest and most capable GPT model" },
  { id: "openai/o3-mini", name: "o3-mini", provider: "OpenAI", description: "Latest mini reasoning model" },
  { id: "openai/o1", name: "o1", provider: "OpenAI", description: "Advanced reasoning model for complex tasks" },
  { id: "openai/o1-mini", name: "o1-mini", provider: "OpenAI", description: "Faster reasoning model" },
  { id: "openai/gpt-4o", name: "GPT-4o", provider: "OpenAI", description: "Fast, multimodal flagship model" },
  { id: "google/gemini-2.0-flash-exp:free", name: "GPT-4o Mini", provider: "OpenAI", description: "Fast and efficient, good for most tasks" },
  // Google models
  { id: "google/gemini-2.5-pro-preview-06-05", name: "Gemini 2.5 Pro", provider: "Google", description: "Latest Gemini, most capable" },
  { id: "google/gemini-2.5-flash-preview-05-20", name: "Gemini 2.5 Flash", provider: "Google", description: "Fast latest-gen Gemini" },
  { id: "google/gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite", provider: "Google", description: "Ultra-fast agentic Gemini" },
  { id: "google/gemini-2.0-flash-001", name: "Gemini 2.0 Flash", provider: "Google", description: "Fast and capable" },
  { id: "google/gemini-2.0-flash-thinking-exp", name: "Gemini 2.0 Flash Thinking", provider: "Google", description: "Reasoning-enhanced Gemini" },
  // DeepSeek models
  { id: "deepseek/deepseek-r1", name: "DeepSeek R1", provider: "DeepSeek", description: "Advanced reasoning model" },
  { id: "deepseek/deepseek-chat", name: "DeepSeek V3", provider: "DeepSeek", description: "Latest DeepSeek chat model" },
  // Meta models
  { id: "meta-llama/llama-3.3-70b-instruct", name: "Llama 3.3 70B", provider: "Meta", description: "Latest Llama, open source" },
] as const;

// Task complexity classification for smart model selection
export type TaskComplexity = "simple" | "moderate" | "complex";

export interface ModelMetrics {
  modelUsed: string;
  attemptNumber: number;
  totalAttempts: number;
  success: boolean;
  errorMessage?: string;
  tokensUsed?: number;
  latencyMs: number;
}

export interface ChatCompletionParams {
  messages: OpenAI.Chat.ChatCompletionMessageParam[];
  tools?: OpenAI.Chat.ChatCompletionTool[];
  tool_choice?: OpenAI.Chat.ChatCompletionToolChoiceOption;
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: "json_object" | "text" };
}

/**
 * Determine optimal model based on task complexity.
 * $0-first routing: prefers local model for simple/moderate tasks when available.
 */
export function selectModelForTask(complexity: TaskComplexity): string {
  // Check if local model is available (use cached result to avoid blocking)
  const localReady = localAvailableCache?.available && (Date.now() - localAvailableCache.checkedAt < LOCAL_HEALTH_CACHE_TTL);

  switch (complexity) {
    case "simple":
      // $0-first: use local model for simple tasks when available
      if (localReady) return `local/${LOCAL_MODEL_NAME}`;
      return "google/gemini-2.0-flash-exp:free";
    case "moderate":
      // $0-first: use local model for moderate tasks when available
      if (localReady) return `local/${LOCAL_MODEL_NAME}`;
      return "google/gemini-2.0-flash-exp:free";
    case "complex":
      // Complex tasks always use cloud for quality
      return "openai/gpt-4o";
    default:
      return "openai/gpt-4o";
  }
}

/**
 * Multi-model chat completion with automatic fallback
 * Tries models in cascade order until success or all fail
 * @param params - Chat completion parameters
 * @param complexity - Task complexity for model selection (ignored if preferredModel is set)
 * @param preferredModel - Optional specific model to use (bypasses complexity-based selection)
 */
export async function chatCompletion(
  params: ChatCompletionParams,
  complexity: TaskComplexity = "complex",
  preferredModel?: string,
): Promise<{
  response: OpenAI.Chat.ChatCompletion;
  metrics: ModelMetrics;
}> {
  // Route local/ prefix to local model pipeline
  if (preferredModel && preferredModel.startsWith("local/")) {
    return localChatCompletion(params);
  }

  // Use preferred model if specified, otherwise select based on complexity
  const selectedModel = preferredModel || selectModelForTask(complexity);

  // ── Fast path: if OpenRouter is known-exhausted, go straight to Kilo ──
  const kilo = getKiloClient();
  if (kilo && isOpenRouterCoolingDown()) {
    const startTime = Date.now();
    try {
      logger.info({ model: selectedModel, provider: "kilo" }, `OpenRouter cooling down — using Kilo directly`);
      const response = await kilo.chat.completions.create({
        model: selectedModel,
        messages: params.messages,
        tools: params.tools,
        tool_choice: params.tool_choice,
        temperature: params.temperature ?? 0.7,
        max_tokens: params.max_tokens,
        response_format: params.response_format,
      });

      const latencyMs = Date.now() - startTime;
      logger.info({ model: selectedModel, latencyMs, provider: "kilo" }, `✅ Kilo direct call successful`);
      recordSuccess("kilo", latencyMs, selectedModel);
      logTokenUsage(`kilo/${selectedModel}`, response.usage, "web_chat");

      return {
        response,
        metrics: {
          modelUsed: `kilo/${selectedModel}`,
          attemptNumber: 1,
          totalAttempts: 1,
          success: true,
          tokensUsed: response.usage?.total_tokens,
          latencyMs,
        },
      };
    } catch (kiloError: any) {
      recordFailure("kilo", selectedModel);
      logger.warn({ error: kiloError.message }, `Kilo direct call failed — trying OpenRouter cascade`);
      // Clear cooldown so we fall through to normal cascade
      openRouterExhaustedAt = null;
    }
  }
  const startIndex = MODEL_CASCADE.findIndex((m) => m.name === selectedModel);

  // Build cascade: if preferred model is in cascade, reorder to start with it
  // If not in cascade (custom model), prepend it to the cascade with default retries
  let orderedCascade: Array<{ name: string; maxRetries: number; description: string }>;
  if (startIndex >= 0) {
    orderedCascade = [
      ...MODEL_CASCADE.slice(startIndex),
      ...MODEL_CASCADE.slice(0, startIndex),
    ];
  } else if (preferredModel) {
    // Custom model not in cascade - try it first, then fall back to default cascade
    orderedCascade = [
      { name: preferredModel, maxRetries: 2, description: "Custom preferred model" },
      ...MODEL_CASCADE,
    ];
  } else {
    orderedCascade = [...MODEL_CASCADE];
  }

  let lastError: Error | null = null;
  let totalAttempts = 0;

  // Try each model in the cascade
  for (const modelConfig of orderedCascade) {
    const { name: model, maxRetries } = modelConfig;

    // Try this model with retries
    for (let retry = 0; retry <= maxRetries; retry++) {
      totalAttempts++;
      const startTime = Date.now();

      try {
        logger.info({
          model,
          attempt: retry + 1,
          maxRetries: maxRetries + 1,
          totalAttempts,
          complexity,
        }, `Attempting chat completion with ${model}`);

        const response = await getOpenAIClient().chat.completions.create({
          model,
          messages: params.messages,
          tools: params.tools,
          tool_choice: params.tool_choice,
          temperature: params.temperature ?? 0.7,
          max_tokens: params.max_tokens,
          response_format: params.response_format,
        });

        const latencyMs = Date.now() - startTime;

        logger.info({
          model,
          tokensUsed: response.usage?.total_tokens,
          latencyMs,
          finishReason: response.choices[0]?.finish_reason,
        }, `✅ Chat completion successful with ${model}`);

        // Track provider health
        recordSuccess("openrouter", latencyMs, model);

        // Log token usage (fire-and-forget)
        logTokenUsage(model, response.usage, "web_chat");

        return {
          response,
          metrics: {
            modelUsed: model,
            attemptNumber: retry + 1,
            totalAttempts,
            success: true,
            tokensUsed: response.usage?.total_tokens,
            latencyMs,
          },
        };
      } catch (error: any) {
        lastError = error;
        const latencyMs = Date.now() - startTime;

        // Track provider health
        recordFailure("openrouter", model);

        logger.warn({
          model,
          attempt: retry + 1,
          maxRetries: maxRetries + 1,
          error: error.message,
          errorType: error.constructor.name,
          latencyMs,
        }, `❌ Chat completion failed with ${model}`);

        // Check if it's a rate limit or server error (worth retrying)
        const isRetryable = 
          error.status === 429 || // Rate limit
          error.status === 500 || // Server error
          error.status === 503 || // Service unavailable
          error.code === 'ECONNRESET' || // Connection reset
          error.code === 'ETIMEDOUT'; // Timeout

        if (!isRetryable || retry === maxRetries) {
          // Don't retry this model anymore
          break;
        }

        // Exponential backoff before retry
        const backoffMs = Math.min(1000 * Math.pow(2, retry), 10000);
        logger.info({ backoffMs }, `Waiting before retry...`);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }

  // ── Kilo Code fallback: triggers on ANY cascade failure (not just credit exhaustion) ──
  const kiloFallback = getKiloClient();
  if (kiloFallback && lastError) {
    if (isCreditsExhausted(lastError)) markOpenRouterExhausted();
    const kiloModel = selectedModel;
    const startTime = Date.now();
    try {
      logger.info({ model: kiloModel }, `OpenRouter cascade exhausted — falling back to Kilo gateway`);
      const response = await kiloFallback.chat.completions.create({
        model: kiloModel,
        messages: params.messages,
        tools: params.tools,
        tool_choice: params.tool_choice,
        temperature: params.temperature ?? 0.7,
        max_tokens: params.max_tokens,
        response_format: params.response_format,
      });

      const latencyMs = Date.now() - startTime;
      logger.info({ model: kiloModel, latencyMs, provider: "kilo" }, `✅ Kilo fallback successful`);
      recordSuccess("kilo", latencyMs, kiloModel);
      logTokenUsage(`kilo/${kiloModel}`, response.usage, "web_chat");

      return {
        response,
        metrics: {
          modelUsed: `kilo/${kiloModel}`,
          attemptNumber: totalAttempts + 1,
          totalAttempts: totalAttempts + 1,
          success: true,
          tokensUsed: response.usage?.total_tokens,
          latencyMs,
        },
      };
    } catch (kiloError: any) {
      recordFailure("kilo", kiloModel);
      logger.warn({ error: kiloError.message, model: kiloModel }, `❌ Kilo fallback failed — trying direct OpenAI`);
    }
  }

  // ── Direct OpenAI fallback: bypasses OpenRouter entirely ──
  const directOpenAI = getDirectOpenAIClient();
  if (directOpenAI && lastError) {
    const directModel = "gpt-4o-mini"; // cheap, reliable, always available
    const startTime = Date.now();
    try {
      logger.info({ model: directModel }, `Trying direct OpenAI (bypassing OpenRouter)`);
      const response = await directOpenAI.chat.completions.create({
        model: directModel,
        messages: params.messages,
        tools: params.tools,
        tool_choice: params.tool_choice,
        temperature: params.temperature ?? 0.7,
        max_tokens: params.max_tokens,
        response_format: params.response_format,
      });

      const latencyMs = Date.now() - startTime;
      logger.info({ model: directModel, latencyMs, provider: "openai_direct" }, `✅ Direct OpenAI fallback successful`);
      recordSuccess("openai_direct", latencyMs, directModel);
      logTokenUsage(`openai/${directModel}`, response.usage, "web_chat");

      return {
        response,
        metrics: {
          modelUsed: `openai/${directModel}`,
          attemptNumber: totalAttempts + 1,
          totalAttempts: totalAttempts + 1,
          success: true,
          tokensUsed: response.usage?.total_tokens,
          latencyMs,
        },
      };
    } catch (directError: any) {
      recordFailure("openai_direct", directModel);
      logger.warn({ error: directError.message }, `❌ Direct OpenAI fallback also failed`);
    }
  }

  // ── Groq fallback: all tiers, last resort before dead letter ──
  const groqFallback = getGroqClient();
  if (groqFallback) {
    const groqModel = "llama-3.3-70b-versatile";
    const startTime = Date.now();
    try {
      logger.info({ model: groqModel }, `All primary providers failed — falling back to Groq (all tiers)`);
      const response = await groqFallback.chat.completions.create({
        model: groqModel,
        messages: params.messages,
        tools: params.tools,
        tool_choice: params.tool_choice,
        temperature: params.temperature ?? 0.7,
        max_tokens: params.max_tokens,
        response_format: params.response_format,
      });

      const latencyMs = Date.now() - startTime;
      logger.info({ model: groqModel, latencyMs, provider: "groq" }, `✅ Groq fallback successful`);
      recordSuccess("groq", latencyMs, groqModel);
      logTokenUsage(`groq/${groqModel}`, response.usage, "web_chat");

      return {
        response,
        metrics: {
          modelUsed: `groq/${groqModel}`,
          attemptNumber: totalAttempts + 1,
          totalAttempts: totalAttempts + 1,
          success: true,
          tokensUsed: response.usage?.total_tokens,
          latencyMs,
        },
      };
    } catch (groqError: any) {
      recordFailure("groq", groqModel);
      logger.error({ error: groqError.message, model: groqModel }, `❌ Groq fallback also failed`);
    }
  }

  // All providers failed
  const errorMessage = lastError?.message || "All models failed";
  logger.error({
    totalAttempts,
    modelsAttempted: orderedCascade.map(m => m.name),
    lastError: errorMessage,
  }, `🚨 All model fallbacks exhausted (OpenRouter + Kilo + DirectOpenAI + Groq)`);

  throw new Error(`All AI models failed after ${totalAttempts} attempts: ${errorMessage}`);
}

/**
 * Streaming chat completion with fallback
 * Similar to chatCompletion but for streaming responses
 */
export async function chatCompletionStream(
  params: ChatCompletionParams,
  complexity: TaskComplexity = "complex",
): Promise<{
  stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
  metrics: Omit<ModelMetrics, "latencyMs" | "tokensUsed">;
}> {
  const preferredModel = selectModelForTask(complexity);

  // ── Fast path: if OpenRouter is known-exhausted, stream from Kilo directly ──
  const kiloStream = getKiloClient();
  if (kiloStream && isOpenRouterCoolingDown()) {
    try {
      logger.info({ model: preferredModel, provider: "kilo" }, `OpenRouter cooling down — streaming from Kilo directly`);
      const stream = await kiloStream.chat.completions.create({
        model: preferredModel,
        messages: params.messages,
        tools: params.tools,
        tool_choice: params.tool_choice,
        temperature: params.temperature ?? 0.7,
        max_tokens: params.max_tokens,
        stream: true,
      });
      return {
        stream,
        metrics: { modelUsed: `kilo/${preferredModel}`, attemptNumber: 1, totalAttempts: 1, success: true },
      };
    } catch (kiloError: any) {
      logger.warn({ error: kiloError.message }, `Kilo streaming direct failed — trying OpenRouter cascade`);
      openRouterExhaustedAt = null;
    }
  }

  const startIndex = MODEL_CASCADE.findIndex((m) => m.name === preferredModel);

  const orderedCascade = [
    ...MODEL_CASCADE.slice(startIndex),
    ...MODEL_CASCADE.slice(0, startIndex),
  ];

  let lastError: Error | null = null;
  let totalAttempts = 0;

  for (const modelConfig of orderedCascade) {
    const { name: model, maxRetries } = modelConfig;

    for (let retry = 0; retry <= maxRetries; retry++) {
      totalAttempts++;

      try {
        logger.info({
          model,
          attempt: retry + 1,
          maxRetries: maxRetries + 1,
          complexity,
        }, `Attempting streaming completion with ${model}`);

        const stream = await getOpenAIClient().chat.completions.create({
          model,
          messages: params.messages,
          tools: params.tools,
          tool_choice: params.tool_choice,
          temperature: params.temperature ?? 0.7,
          max_tokens: params.max_tokens,
          stream: true,
        });

        logger.info({ model }, `✅ Streaming started with ${model}`);

        return {
          stream,
          metrics: {
            modelUsed: model,
            attemptNumber: retry + 1,
            totalAttempts,
            success: true,
          },
        };
      } catch (error: any) {
        lastError = error;

        logger.warn({
          model,
          attempt: retry + 1,
          error: error.message,
        }, `❌ Streaming failed with ${model}`);

        const isRetryable = 
          error.status === 429 ||
          error.status === 500 ||
          error.status === 503;

        if (!isRetryable || retry === maxRetries) {
          break;
        }

        const backoffMs = Math.min(1000 * Math.pow(2, retry), 10000);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }

  // ── Kilo Code fallback for streaming ──
  const kiloFb = getKiloClient();
  if (kiloFb && lastError && isCreditsExhausted(lastError)) {
    markOpenRouterExhausted();
    const kiloModel = preferredModel;
    try {
      logger.info({ model: kiloModel }, `OpenRouter credits exhausted — streaming fallback to Kilo gateway`);
      const stream = await kiloFb.chat.completions.create({
        model: kiloModel,
        messages: params.messages,
        tools: params.tools,
        tool_choice: params.tool_choice,
        temperature: params.temperature ?? 0.7,
        max_tokens: params.max_tokens,
        stream: true,
      });

      logger.info({ model: kiloModel, provider: "kilo" }, `✅ Kilo streaming started`);
      return {
        stream,
        metrics: {
          modelUsed: `kilo/${kiloModel}`,
          attemptNumber: totalAttempts + 1,
          totalAttempts: totalAttempts + 1,
          success: true,
        },
      };
    } catch (kiloError: any) {
      logger.error({ error: kiloError.message, model: kiloModel }, `❌ Kilo streaming fallback also failed`);
    }
  }

  const errorMessage = lastError?.message || "All models failed";
  logger.error({
    totalAttempts,
    lastError: errorMessage,
  }, `🚨 All streaming model fallbacks exhausted (including Kilo)`);

  throw new Error(`All AI models failed for streaming after ${totalAttempts} attempts: ${errorMessage}`);
}

/**
 * Helper: Get current model status (for monitoring/debugging)
 */
export function getModelCascadeInfo() {
  return MODEL_CASCADE.map((model) => ({
    name: model.name,
    description: model.description,
    maxRetries: model.maxRetries,
  }));
}
