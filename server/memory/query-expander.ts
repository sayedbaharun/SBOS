/**
 * Multi-Angle Query Expansion
 *
 * Transforms a single user query into 3-5 reformulated queries to improve recall.
 * Inspired by Rasputin Stack's multi-angle expansion approach.
 *
 * Expansion angles:
 *   1. Original query (always included)
 *   2. Entity-focused — extract and search for specific entities
 *   3. Temporal — add time context if relevant
 *   4. Synonym/topic — rephrase with related terms
 *   5. Action-focused — what was decided/done about this
 *
 * Uses GPT-4o-mini for cheap, fast expansion (~100 tokens output).
 * Falls back to rule-based expansion if LLM is unavailable.
 */

import { logger } from "../logger";

export interface ExpandedQueries {
  original: string;
  expansions: string[];
  method: "llm" | "rule-based";
}

/**
 * Expand a single query into multiple search angles.
 * Returns the original + 2-4 reformulations.
 */
export async function expandQuery(query: string): Promise<ExpandedQueries> {
  // Skip expansion for very short queries
  if (query.length < 15) {
    return { original: query, expansions: [], method: "rule-based" };
  }

  try {
    return await llmExpand(query);
  } catch {
    return ruleBasedExpand(query);
  }
}

/**
 * LLM-based expansion using GPT-4o-mini for cheap, fast reformulation.
 */
async function llmExpand(query: string): Promise<ExpandedQueries> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return ruleBasedExpand(query);

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer": process.env.SITE_URL || "http://localhost:5000",
      "X-Title": "SB-OS Query Expansion",
    },
    body: JSON.stringify({
      model: "google/gemini-2.0-flash-exp:free",
      messages: [
        {
          role: "system",
          content: `Generate 3 alternative search queries for a memory/knowledge retrieval system.
Each query should approach the topic from a different angle:
1. Entity-focused: mention specific people, orgs, or projects
2. Topic/synonym: rephrase using related terms or broader/narrower scope
3. Action-focused: what decisions, actions, or outcomes relate to this

Return ONLY a JSON array of 3 strings. No explanation.`,
        },
        { role: "user", content: query },
      ],
      max_tokens: 200,
      temperature: 0.4,
    }),
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) return ruleBasedExpand(query);

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "";
  const jsonStr = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const expansions: string[] = JSON.parse(jsonStr);

  if (!Array.isArray(expansions) || expansions.length === 0) {
    return ruleBasedExpand(query);
  }

  logger.debug({ original: query, expansions: expansions.length }, "LLM query expansion");
  return { original: query, expansions: expansions.slice(0, 4), method: "llm" };
}

/**
 * Rule-based expansion as fallback when LLM is unavailable.
 * Uses simple heuristics: entity extraction, temporal hints, keyword variants.
 */
function ruleBasedExpand(query: string): ExpandedQueries {
  const expansions: string[] = [];
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);

  // Extract capitalized words as potential entities
  const entities = query.match(/[A-Z][a-z]+(?:\s[A-Z][a-z]+)*/g) || [];
  if (entities.length > 0) {
    expansions.push(entities.join(" "));
  }

  // Action-focused variant
  const actionWords = ["decided", "built", "changed", "fixed", "created", "discussed", "planned"];
  const hasAction = actionWords.some((a) => query.toLowerCase().includes(a));
  if (!hasAction && words.length >= 3) {
    expansions.push(`decisions about ${words.slice(0, 4).join(" ")}`);
  }

  // Topic broadening — use key nouns
  const stopWords = new Set([
    "the", "and", "for", "with", "about", "from", "that", "this",
    "what", "when", "where", "how", "who", "why", "are", "was",
    "were", "been", "has", "have", "had", "not", "but", "all",
  ]);
  const keyTerms = words.filter((w) => !stopWords.has(w)).slice(0, 3);
  if (keyTerms.length >= 2) {
    expansions.push(keyTerms.join(" ") + " context");
  }

  return { original: query, expansions, method: "rule-based" };
}
