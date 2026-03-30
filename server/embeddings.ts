/**
 * Embeddings Service
 *
 * Primary: Google Gemini Embedding 001 (MTEB 68.32, 8K context, task-type routing)
 *   - 3072-dim native, truncated to 1536 via MRL for backward compatibility
 *   - 8 task types for purpose-specific embedding quality
 *
 * Fallback: OpenRouter text-embedding-3-small (1536-dim)
 *   - Used when GOOGLE_AI_API_KEY is not set
 */

import { logger } from "./logger";
import type { EmbeddingTaskType } from "./memory/schemas";

// ============================================================================
// CONFIG
// ============================================================================

const GEMINI_MODEL = "gemini-embedding-001";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_OUTPUT_DIMS = 1536; // MRL truncation from 3072 for backward compat

const OPENROUTER_MODEL = "text-embedding-3-small";
const OPENROUTER_DIMS = 1536;
const MAX_INPUT_TOKENS = 8191;
const MAX_CHARS = MAX_INPUT_TOKENS * 4;

// Gemini batch limit per request
const GEMINI_BATCH_SIZE = 100;

export interface EmbeddingResult {
  embedding: number[];
  model: string;
  tokensUsed: number;
}

// ============================================================================
// PROVIDER DETECTION
// ============================================================================

function useGemini(): boolean {
  return !!process.env.GOOGLE_AI_API_KEY;
}

// ============================================================================
// GEMINI EMBEDDING
// ============================================================================

async function geminiEmbed(
  text: string,
  taskType: EmbeddingTaskType = "RETRIEVAL_DOCUMENT"
): Promise<EmbeddingResult> {
  const apiKey = process.env.GOOGLE_AI_API_KEY!;
  const truncatedText = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;

  const response = await fetch(
    `${GEMINI_API_BASE}/${GEMINI_MODEL}:embedContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: `models/${GEMINI_MODEL}`,
        content: { parts: [{ text: truncatedText }] },
        taskType,
        outputDimensionality: GEMINI_OUTPUT_DIMS,
      }),
      signal: AbortSignal.timeout(15000),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini embedding error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const values = data.embedding?.values;

  if (!values || !Array.isArray(values)) {
    throw new Error("Invalid Gemini embedding response structure");
  }

  return {
    embedding: values,
    model: GEMINI_MODEL,
    tokensUsed: 0, // Gemini doesn't report token usage for embeddings
  };
}

async function geminiBatchEmbed(
  texts: string[],
  taskType: EmbeddingTaskType = "RETRIEVAL_DOCUMENT"
): Promise<EmbeddingResult[]> {
  const apiKey = process.env.GOOGLE_AI_API_KEY!;
  const results: EmbeddingResult[] = [];

  for (let i = 0; i < texts.length; i += GEMINI_BATCH_SIZE) {
    const batch = texts.slice(i, i + GEMINI_BATCH_SIZE);

    const requests = batch.map((text) => ({
      model: `models/${GEMINI_MODEL}`,
      content: {
        parts: [{ text: text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text }],
      },
      taskType,
      outputDimensionality: GEMINI_OUTPUT_DIMS,
    }));

    const response = await fetch(
      `${GEMINI_API_BASE}/${GEMINI_MODEL}:batchEmbedContents?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requests }),
        signal: AbortSignal.timeout(30000),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini batch embedding error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const embeddings = data.embeddings;

    if (!Array.isArray(embeddings)) {
      throw new Error("Invalid Gemini batch embedding response");
    }

    for (const emb of embeddings) {
      results.push({
        embedding: emb.values,
        model: GEMINI_MODEL,
        tokensUsed: 0,
      });
    }

    // Rate limiting between batches
    if (i + GEMINI_BATCH_SIZE < texts.length) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  return results;
}

// ============================================================================
// OPENROUTER FALLBACK
// ============================================================================

async function openRouterEmbed(text: string): Promise<EmbeddingResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("Neither GOOGLE_AI_API_KEY nor OPENROUTER_API_KEY set");
  }

  const truncatedText = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;

  const response = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": process.env.SITE_URL || "http://localhost:5000",
      "X-Title": "SB-OS RAG",
    },
    body: JSON.stringify({
      model: `openai/${OPENROUTER_MODEL}`,
      input: truncatedText,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Embedding API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();

  if (!data.data?.[0]?.embedding) {
    throw new Error("Invalid embedding response structure");
  }

  return {
    embedding: data.data[0].embedding,
    model: OPENROUTER_MODEL,
    tokensUsed: data.usage?.total_tokens || 0,
  };
}

async function openRouterBatchEmbed(texts: string[]): Promise<EmbeddingResult[]> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("Neither GOOGLE_AI_API_KEY nor OPENROUTER_API_KEY set");
  }

  const batchSize = 20;
  const results: EmbeddingResult[] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts
      .slice(i, i + batchSize)
      .map((text) => (text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text));

    const response = await fetch("https://openrouter.ai/api/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": process.env.SITE_URL || "http://localhost:5000",
        "X-Title": "SB-OS RAG",
      },
      body: JSON.stringify({
        model: `openai/${OPENROUTER_MODEL}`,
        input: batch,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Embedding batch API error ${response.status}: ${errorText}`);
    }

    const data = await response.json();

    if (!data.data || !Array.isArray(data.data)) {
      throw new Error("Invalid batch embedding response structure");
    }

    const sortedData = [...data.data].sort((a, b) => a.index - b.index);

    for (const item of sortedData) {
      results.push({
        embedding: item.embedding,
        model: OPENROUTER_MODEL,
        tokensUsed: Math.ceil((data.usage?.total_tokens || 0) / batch.length),
      });
    }

    if (i + batchSize < texts.length) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  return results;
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Generate embedding for a single text.
 * Uses Gemini Embedding 001 if GOOGLE_AI_API_KEY is set, else OpenRouter.
 *
 * @param text - Text to embed
 * @param taskType - Gemini task type for purpose-specific quality (ignored for OpenRouter)
 */
export async function generateEmbedding(
  text: string,
  taskType?: EmbeddingTaskType
): Promise<EmbeddingResult> {
  try {
    if (useGemini()) {
      return await geminiEmbed(text, taskType || "RETRIEVAL_DOCUMENT");
    }
    return await openRouterEmbed(text);
  } catch (error) {
    // If Gemini fails, try OpenRouter fallback
    if (useGemini() && process.env.OPENROUTER_API_KEY) {
      logger.warn({ error }, "Gemini embedding failed, falling back to OpenRouter");
      return await openRouterEmbed(text);
    }
    logger.error({ error, textLength: text.length }, "Failed to generate embedding");
    throw error;
  }
}

/**
 * Generate embeddings for multiple texts (batched).
 * Uses Gemini Embedding 001 if GOOGLE_AI_API_KEY is set, else OpenRouter.
 *
 * @param texts - Texts to embed
 * @param taskType - Gemini task type (ignored for OpenRouter)
 */
export async function generateEmbeddings(
  texts: string[],
  taskType?: EmbeddingTaskType
): Promise<EmbeddingResult[]> {
  if (texts.length === 0) return [];

  try {
    if (useGemini()) {
      return await geminiBatchEmbed(texts, taskType || "RETRIEVAL_DOCUMENT");
    }
    return await openRouterBatchEmbed(texts);
  } catch (error) {
    if (useGemini() && process.env.OPENROUTER_API_KEY) {
      logger.warn({ error }, "Gemini batch embedding failed, falling back to OpenRouter");
      return await openRouterBatchEmbed(texts);
    }
    logger.error({ error, count: texts.length }, "Failed to generate batch embeddings");
    throw error;
  }
}

/**
 * Calculate cosine similarity between two embeddings
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Embedding dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (magnitude === 0) return 0;

  return dotProduct / magnitude;
}

/**
 * Parse embedding from JSON string (stored in DB)
 */
export function parseEmbedding(embeddingJson: string | null): number[] | null {
  if (!embeddingJson) return null;

  try {
    const parsed = JSON.parse(embeddingJson);
    if (Array.isArray(parsed) && parsed.every((n) => typeof n === "number")) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Serialize embedding to JSON string for DB storage
 */
export function serializeEmbedding(embedding: number[]): string {
  return JSON.stringify(embedding);
}

/**
 * Get embedding dimensions
 */
export function getEmbeddingDimensions(): number {
  return GEMINI_OUTPUT_DIMS; // Always 1536 regardless of provider
}

/**
 * Get current embedding provider info
 */
export function getEmbeddingProvider(): { provider: string; model: string; dims: number } {
  if (useGemini()) {
    return { provider: "google", model: GEMINI_MODEL, dims: GEMINI_OUTPUT_DIMS };
  }
  return { provider: "openrouter", model: OPENROUTER_MODEL, dims: OPENROUTER_DIMS };
}
