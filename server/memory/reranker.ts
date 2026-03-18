/**
 * Cross-Encoder Reranker
 *
 * After RRF fusion, re-scores the top-N candidates for precision.
 * Uses a lightweight LLM call to judge query-document relevance.
 *
 * Inspired by Rasputin Stack's bge-reranker-v2-m3 approach, but
 * using GPT-4o-mini as a cross-encoder proxy (no separate model needed).
 *
 * Flow:
 *   RRF fusion (fast, recall-focused)
 *     → Top 20 candidates
 *       → Reranker (precision-focused)
 *         → Top 10 final results
 */

import { logger } from "../logger";
import type { RetrievedMemory } from "./hybrid-retriever";

/**
 * Rerank retrieved memories for improved precision.
 * Only processes top-N candidates to keep costs low.
 *
 * @param query - Original user query
 * @param candidates - Pre-ranked candidates from RRF
 * @param topN - Number of candidates to rerank (default: 15)
 * @returns Reranked results with updated scores
 */
export async function rerankResults(
  query: string,
  candidates: RetrievedMemory[],
  topN: number = 15
): Promise<RetrievedMemory[]> {
  // Skip reranking for small result sets
  if (candidates.length <= 3) return candidates;

  const toRerank = candidates.slice(0, topN);
  const rest = candidates.slice(topN);

  try {
    const reranked = await llmRerank(query, toRerank);
    return [...reranked, ...rest];
  } catch (error) {
    logger.debug({ error }, "Reranking failed, returning original order");
    return candidates;
  }
}

/**
 * Use GPT-4o-mini as a cross-encoder to score query-document relevance.
 * Returns candidates sorted by relevance score.
 */
async function llmRerank(
  query: string,
  candidates: RetrievedMemory[]
): Promise<RetrievedMemory[]> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return candidates;

  // Build numbered document list for the LLM
  const docList = candidates
    .map((c, i) => `[${i}] ${c.text.slice(0, 200)}`)
    .join("\n");

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer": process.env.SITE_URL || "http://localhost:5000",
      "X-Title": "SB-OS Reranker",
    },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a relevance judge. Given a query and numbered documents, score each document's relevance to the query from 0.0 to 1.0.
Return ONLY a JSON array of objects: [{"idx": 0, "score": 0.9}, ...] sorted by score descending.
Be strict: only highly relevant documents get > 0.7. Tangentially related = 0.3-0.5. Irrelevant = 0.0-0.2.`,
        },
        {
          role: "user",
          content: `Query: ${query}\n\nDocuments:\n${docList}`,
        },
      ],
      max_tokens: 300,
      temperature: 0.0,
    }),
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) return candidates;

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "";
  const jsonStr = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const scores: Array<{ idx: number; score: number }> = JSON.parse(jsonStr);

  if (!Array.isArray(scores)) return candidates;

  // Apply reranker scores
  const scoreMap = new Map<number, number>();
  for (const s of scores) {
    if (typeof s.idx === "number" && typeof s.score === "number") {
      scoreMap.set(s.idx, s.score);
    }
  }

  // Blend reranker score with existing RRF score (70% reranker, 30% RRF)
  const reranked = candidates.map((c, i) => {
    const rerankerScore = scoreMap.get(i);
    if (rerankerScore !== undefined) {
      return {
        ...c,
        finalScore: 0.7 * rerankerScore + 0.3 * c.finalScore,
      };
    }
    return c;
  });

  reranked.sort((a, b) => b.finalScore - a.finalScore);

  logger.debug(
    { candidates: candidates.length, reranked: reranked.length },
    "Cross-encoder reranking complete"
  );

  return reranked;
}
