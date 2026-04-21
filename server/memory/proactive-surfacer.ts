/**
 * Proactive Memory Surfacer
 *
 * Inspired by Rasputin Memory's /proactive endpoint.
 * Analyzes current conversation context and surfaces non-obvious,
 * high-importance memories the user didn't explicitly ask about.
 *
 * Unlike reactive retrieval (search), this is push-based:
 *   "Based on what we're discussing, you might also want to know..."
 *
 * Pipeline:
 *   1. Extract entities + topics from conversation context (LLM)
 *   2. Search memory with QUESTION_ANSWERING task type for each entity/topic
 *   3. Filter to high-importance memories not already in context
 *   4. Rank by a "surprise value" = importance × (1 - topical_similarity)
 *      (high importance + low topical overlap = most surprising/valuable)
 *   5. Return top-K formatted results
 */

import { logger } from "../logger";
import { retrieveMemories } from "./hybrid-retriever";
import type { RetrievedMemory } from "./hybrid-retriever";

// ============================================================================
// CONFIG
// ============================================================================

const MIN_IMPORTANCE_THRESHOLD = 0.60;  // Only surface high-importance memories
const MAX_SURFACE_RESULTS = 5;          // Cap proactive suggestions
const ENTITY_EXTRACT_TIMEOUT_MS = 6_000;

// ============================================================================
// TYPES
// ============================================================================

export interface ProactiveSurfaceResult {
  id: string;
  text: string;
  importance: number;
  collection: string;
  domain?: string;
  surfaceReason: string;  // Why this was surfaced
  score: number;          // Final surprise score
}

export interface ProactiveSurfaceResponse {
  memories: ProactiveSurfaceResult[];
  entitiesFound: string[];
  topicsFound: string[];
  queriesUsed: number;
}

// ============================================================================
// ENTITY + TOPIC EXTRACTION
// ============================================================================

interface ExtractedContext {
  entities: string[];
  topics: string[];
  implicit_needs: string[];
}

async function extractContextSignals(
  messages: Array<{ role: string; content: string }>
): Promise<ExtractedContext> {
  const apiKey = process.env.OPENROUTER_API_KEY;

  // Fallback: extract capitalized words as entities
  if (!apiKey) {
    const text = messages.map((m) => m.content).join(" ");
    const entities = Array.from(
      new Set(
        (text.match(/\b[A-Z][a-zA-Z]{2,}\b/g) || []).filter(
          (w) => !["The", "This", "That", "With", "From", "When", "What", "How"].includes(w)
        )
      )
    ).slice(0, 5);
    return { entities, topics: [], implicit_needs: [] };
  }

  // Last 3 exchanges for recency
  const recentMessages = messages.slice(-6);
  const contextText = recentMessages
    .map((m) => `${m.role}: ${m.content.slice(0, 300)}`)
    .join("\n");

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": process.env.SITE_URL || "http://localhost:5000",
        "X-Title": "SB-OS Proactive Memory",
      },
      body: JSON.stringify({
        model: "google/gemini-2.0-flash-exp:free",
        messages: [
          {
            role: "system",
            content: `Extract key signals from this conversation for memory retrieval.
Return JSON with:
- entities: specific names (people, companies, projects, products, places) — max 5
- topics: main subject areas being discussed — max 4
- implicit_needs: what information might be helpful that wasn't explicitly asked — max 3

Return ONLY valid JSON: {"entities": [], "topics": [], "implicit_needs": []}`,
          },
          { role: "user", content: contextText },
        ],
        max_tokens: 200,
        temperature: 0.1,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(ENTITY_EXTRACT_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`API error ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);

    return {
      entities: Array.isArray(parsed.entities) ? parsed.entities.slice(0, 5) : [],
      topics: Array.isArray(parsed.topics) ? parsed.topics.slice(0, 4) : [],
      implicit_needs: Array.isArray(parsed.implicit_needs) ? parsed.implicit_needs.slice(0, 3) : [],
    };
  } catch (error) {
    logger.debug({ error }, "Context signal extraction failed, using fallback");
    const text = messages.map((m) => m.content).join(" ");
    const entities = Array.from(
      new Set((text.match(/\b[A-Z][a-zA-Z]{2,}\b/g) || []).slice(0, 5))
    );
    return { entities, topics: [], implicit_needs: [] };
  }
}

// ============================================================================
// SURPRISE SCORING
// ============================================================================

/**
 * Compute "surprise value" of a memory given the current context queries.
 * High importance + low query similarity = most surprising and valuable.
 *
 * Surprise = importance * 0.6 + novelty_factor * 0.4
 * Where novelty_factor = 1 - (how closely it matches the explicit queries)
 */
function computeSurpriseScore(
  memory: RetrievedMemory,
  explicitQueryScores: Map<string, number>
): number {
  const importance = (memory.metadata.importance as number) || 0.5;
  // If this memory scored very high on an explicit query, it's expected — less surprising
  const explicitScore = explicitQueryScores.get(memory.id) || 0;
  const noveltyFactor = 1 - explicitScore * 0.5;
  return importance * 0.6 + noveltyFactor * 0.4;
}

// ============================================================================
// MAIN SURFACE FUNCTION
// ============================================================================

/**
 * Proactively surface non-obvious high-importance memories based on conversation context.
 *
 * @param messages - Recent conversation messages (last N exchanges)
 * @param excludeIds - Memory IDs already in the active context (skip these)
 * @returns Proactive surface results with surprise scores
 */
export async function proactivelySurface(
  messages: Array<{ role: string; content: string }>,
  excludeIds: Set<string> = new Set()
): Promise<ProactiveSurfaceResponse> {
  if (messages.length === 0) {
    return { memories: [], entitiesFound: [], topicsFound: [], queriesUsed: 0 };
  }

  // Step 1: Extract entities + topics from conversation
  const { entities, topics, implicit_needs } = await extractContextSignals(messages);

  const allSignals = [...entities, ...topics, ...implicit_needs].filter(Boolean);
  if (allSignals.length === 0) {
    return { memories: [], entitiesFound: entities, topicsFound: topics, queriesUsed: 0 };
  }

  // Step 2: Search memory for each signal in parallel (high importance filter)
  const searchPromises = allSignals.map((signal) =>
    retrieveMemories(signal, {
      limit: 5,
      min_score: 0.30,
      minImportance: MIN_IMPORTANCE_THRESHOLD,
      include_raw: false,      // Only compacted + entities for proactive (higher quality)
      include_compacted: true,
      include_entities: true,
    }).catch(() => [] as RetrievedMemory[])
  );

  const searchResults = await Promise.all(searchPromises);

  // Step 3: Collect explicit scores and deduplicate
  const seen = new Set<string>(excludeIds);
  const candidateMap = new Map<string, RetrievedMemory>();
  const explicitQueryScores = new Map<string, number>();

  for (const results of searchResults) {
    for (const memory of results) {
      if (seen.has(memory.id)) continue;
      seen.add(memory.id);

      // Track highest explicit query score for surprise computation
      const existing = explicitQueryScores.get(memory.id) || 0;
      explicitQueryScores.set(memory.id, Math.max(existing, memory.finalScore));
      candidateMap.set(memory.id, memory);
    }
  }

  // Step 4: Rank by surprise score
  const candidates = Array.from(candidateMap.values());
  const scored: ProactiveSurfaceResult[] = candidates
    .map((memory) => {
      const importance = (memory.metadata.importance as number) || 0.5;
      const surpriseScore = computeSurpriseScore(memory, explicitQueryScores);

      // Generate a human-readable reason for surfacing
      let surfaceReason = "Related to current discussion";
      if (entities.some((e) => memory.text.toLowerCase().includes(e.toLowerCase()))) {
        const matchedEntity = entities.find((e) =>
          memory.text.toLowerCase().includes(e.toLowerCase())
        );
        surfaceReason = `Mentions ${matchedEntity}`;
      } else if (topics.length > 0) {
        surfaceReason = `Related to topic: ${topics[0]}`;
      }

      return {
        id: memory.id,
        text: memory.text,
        importance,
        collection: memory.collection,
        domain: memory.domain,
        surfaceReason,
        score: surpriseScore,
      };
    })
    .filter((r) => r.importance >= MIN_IMPORTANCE_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SURFACE_RESULTS);

  logger.debug(
    {
      entities: entities.length,
      topics: topics.length,
      candidates: candidates.length,
      surfaced: scored.length,
    },
    "Proactive memory surface complete"
  );

  return {
    memories: scored,
    entitiesFound: entities,
    topicsFound: topics,
    queriesUsed: allSignals.length,
  };
}
