/**
 * Memory Lifecycle — Autonomous Memory Maintenance
 *
 * Inspired by Rasputin Stack's 7-process memory lifecycle.
 * Implements 4 key processes for SB-OS:
 *
 * 1. Hot Commit (every 30min) — Pattern-match facts from recent messages, no LLM needed
 * 2. Importance Enrichment (nightly) — Score/re-score memories by importance
 * 3. Graph Deepening (weekly) — Discover new entity relationships from existing data
 * 4. Memory Cleanup (weekly) — Prune stale/low-importance memories
 *
 * All functions are designed to be called from scheduled-jobs.ts handlers.
 */

import { logger } from "../logger";

// Lazy DB
let db: any = null;
async function getDb() {
  if (!db) {
    const { storage } = await import("../storage");
    db = (storage as any).db;
  }
  return db;
}

// ============================================================================
// 1. HOT COMMIT — Fast pattern-based fact extraction (no LLM)
// ============================================================================

/**
 * Scan recent agent conversations for extractable facts using pattern matching.
 * Captures: dates, numbers, names, URLs, decisions, preferences.
 * Runs every 30 minutes, sub-100ms per message.
 */
export async function hotCommitFacts(): Promise<{ factsExtracted: number }> {
  const database = await getDb();
  const { agentConversations, agentMemory } = await import("@shared/schema");
  const { sql, gte, eq, and } = await import("drizzle-orm");

  // Get messages from last 35 minutes that haven't been hot-committed
  const cutoff = new Date(Date.now() - 35 * 60 * 1000);
  const recentMessages = await database
    .select()
    .from(agentConversations)
    .where(
      and(
        gte(agentConversations.createdAt, cutoff),
        eq(agentConversations.role, "assistant")
      )
    )
    .limit(100);

  let factsExtracted = 0;

  for (const msg of recentMessages) {
    const content = msg.content || "";
    const facts = extractFactsWithPatterns(content);

    for (const fact of facts) {
      try {
        await database.insert(agentMemory).values({
          agentId: msg.agentId,
          memoryType: "learning",
          content: fact.text,
          importance: fact.importance,
          scope: "agent",
          tags: ["hot_commit", fact.pattern],
        }).onConflictDoNothing();
        factsExtracted++;
      } catch {
        // Skip duplicates
      }
    }
  }

  logger.info({ factsExtracted, messagesScanned: recentMessages.length }, "Hot commit complete");
  return { factsExtracted };
}

export interface ExtractedFact {
  text: string;
  importance: number;
  pattern: string;
}

/**
 * Pattern-based fact extraction — no LLM needed, sub-ms per message.
 */
export function extractFactsWithPatterns(text: string): ExtractedFact[] {
  const facts: ExtractedFact[] = [];

  // Decision patterns
  const decisionPatterns = [
    /(?:decided|agreed|committed|chose|selected) (?:to |that )(.{20,200})/gi,
    /(?:the decision is|we(?:'ll| will)|going (?:to|with)) (.{20,150})/gi,
  ];
  for (const pattern of decisionPatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      facts.push({ text: `Decision: ${match[1].trim()}`, importance: 0.8, pattern: "decision" });
    }
  }

  // Preference patterns
  const prefPatterns = [
    /(?:prefer|always use|never use|should always|should never) (.{15,150})/gi,
    /(?:the best approach is|the right way to) (.{15,150})/gi,
  ];
  for (const pattern of prefPatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      facts.push({ text: `Preference: ${match[1].trim()}`, importance: 0.7, pattern: "preference" });
    }
  }

  // Date/deadline patterns
  const datePatterns = [
    /(?:deadline|due|by|before|launches? on|ships? on|goes live) (?:is )?(\d{4}-\d{2}-\d{2}|\w+ \d{1,2}(?:st|nd|rd|th)?(?:,? \d{4})?)/gi,
  ];
  for (const pattern of datePatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const surrounding = text.slice(Math.max(0, match.index - 40), match.index + match[0].length + 40);
      facts.push({ text: `Deadline: ${surrounding.trim()}`, importance: 0.9, pattern: "date" });
    }
  }

  // Numerical facts (budgets, metrics, counts)
  const numPatterns = [
    /(?:budget|cost|revenue|spent|earned|saved|price) (?:is |of |:? )?(?:\$|AED |USD )?([\d,]+(?:\.\d{2})?)/gi,
  ];
  for (const pattern of numPatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const surrounding = text.slice(Math.max(0, match.index - 30), match.index + match[0].length + 30);
      facts.push({ text: `Financial: ${surrounding.trim()}`, importance: 0.8, pattern: "number" });
    }
  }

  // Limit to avoid flooding
  return facts.slice(0, 10);
}

// ============================================================================
// 2. IMPORTANCE ENRICHMENT — Score memories by importance (nightly)
// ============================================================================

/**
 * Re-score agent_memory entries that have default importance (0.5).
 * Uses lightweight LLM call to batch-score memories.
 */
export async function enrichImportance(): Promise<{ scored: number }> {
  const database = await getDb();
  const { agentMemory } = await import("@shared/schema");
  const { eq, sql } = await import("drizzle-orm");

  // Find memories with default importance that haven't been enriched
  const unscored = await database
    .select()
    .from(agentMemory)
    .where(eq(agentMemory.importance, 0.5))
    .limit(50);

  if (unscored.length === 0) {
    logger.debug("No memories need importance enrichment");
    return { scored: 0 };
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return { scored: 0 };

  // Batch score in groups of 10
  let scored = 0;
  for (let i = 0; i < unscored.length; i += 10) {
    const batch = unscored.slice(i, i + 10);
    const memList = batch
      .map((m: any, idx: number) => `[${idx}] ${(m.content || "").slice(0, 200)}`)
      .join("\n");

    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
          "HTTP-Referer": process.env.SITE_URL || "http://localhost:5000",
          "X-Title": "SB-OS Memory Enrichment",
        },
        body: JSON.stringify({
          model: "openai/gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `Score each memory's importance for a founder managing multiple businesses.
Score 0.1-1.0 where:
  0.1-0.3 = trivial (small talk, temporary info)
  0.4-0.6 = moderate (useful context, preferences)
  0.7-0.8 = important (decisions, deadlines, key relationships)
  0.9-1.0 = critical (financial, legal, strategic decisions)
Return ONLY a JSON array: [{"idx": 0, "score": 0.7}, ...]`,
            },
            { role: "user", content: `Memories:\n${memList}` },
          ],
          max_tokens: 200,
          temperature: 0.0,
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) continue;

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || "";
      const jsonStr = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const scores: Array<{ idx: number; score: number }> = JSON.parse(jsonStr);

      for (const s of scores) {
        if (typeof s.idx !== "number" || typeof s.score !== "number") continue;
        const mem = batch[s.idx];
        if (!mem) continue;

        const clampedScore = Math.max(0.1, Math.min(1.0, s.score));
        await database
          .update(agentMemory)
          .set({ importance: clampedScore })
          .where(eq(agentMemory.id, mem.id));
        scored++;
      }
    } catch (err: any) {
      logger.debug({ error: err.message }, "Importance enrichment batch failed");
    }
  }

  logger.info({ scored, total: unscored.length }, "Importance enrichment complete");
  return { scored };
}

// ============================================================================
// 3. GRAPH DEEPENING — Discover new entity relationships (weekly)
// ============================================================================

/**
 * Find entities that co-occur in memories but aren't yet linked in the graph.
 * Creates new RELATES_TO edges based on co-occurrence patterns.
 */
export async function deepenGraph(): Promise<{ newEdges: number }> {
  try {
    const { isGraphAvailable, linkEntities } = await import("./graph-store");
    const available = await isGraphAvailable();
    if (!available) {
      logger.debug("Graph not available, skipping deepening");
      return { newEdges: 0 };
    }

    const database = await getDb();
    const { agentMemory } = await import("@shared/schema");
    const { sql } = await import("drizzle-orm");

    // Find memories tagged with entity info (from entity extraction pipeline)
    const memoriesWithEntities = await database
      .select()
      .from(agentMemory)
      .where(sql`${agentMemory.tags}::text LIKE '%entit%'`)
      .limit(200);

    // Also search for memories containing capitalized proper nouns (entity candidates)
    const entityMemories = await database
      .select()
      .from(agentMemory)
      .where(sql`${agentMemory.content} ~ '[A-Z][a-z]+\\s+[A-Z][a-z]+'`)
      .limit(200);

    const allMemories = [...memoriesWithEntities, ...entityMemories];

    // Build co-occurrence map from entity names found in content
    const coOccurrences = new Map<string, { count: number; contexts: string[] }>();

    for (const mem of allMemories) {
      // Extract capitalized entity candidates from content
      const content = mem.content || "";
      const entityMatches = content.match(/[A-Z][a-z]+(?:\s[A-Z][a-z]+)*/g) || [];
      const entitySet: string[] = Array.from(new Set(entityMatches));
      const entities = entitySet.filter((e) => e.length > 2);
      if (entities.length < 2) continue;

      // Generate all pairs
      for (let i = 0; i < entities.length; i++) {
        for (let j = i + 1; j < entities.length; j++) {
          const key = [entities[i], entities[j]].sort().join("|||");
          const existing = coOccurrences.get(key) || { count: 0, contexts: [] };
          existing.count++;
          if (existing.contexts.length < 3) {
            existing.contexts.push(content.slice(0, 100));
          }
          coOccurrences.set(key, existing);
        }
      }
    }

    // Create edges for pairs that co-occur 2+ times
    let newEdges = 0;
    const entries = Array.from(coOccurrences.entries());
    for (const [key, data] of entries) {
      if (data.count < 2) continue;

      const [entity1, entity2] = key.split("|||");
      const strength = Math.min(1.0, 0.3 + (data.count / 10));

      try {
        await linkEntities(entity1, entity2, "co-occurs", strength);
        newEdges++;
      } catch {
        // Entity may not exist in graph yet
      }
    }

    logger.info({ newEdges, pairsAnalyzed: coOccurrences.size }, "Graph deepening complete");
    return { newEdges };
  } catch (error: any) {
    logger.warn({ error: error.message }, "Graph deepening failed");
    return { newEdges: 0 };
  }
}

// ============================================================================
// 4. MEMORY CLEANUP — Prune stale/low-importance memories (weekly)
// ============================================================================

/**
 * Remove low-importance memories older than 90 days.
 * Keeps all memories with importance >= 0.7.
 */
export async function cleanupMemories(): Promise<{ pruned: number }> {
  const database = await getDb();
  const { agentMemory } = await import("@shared/schema");
  const { sql, lt, and, lte } = await import("drizzle-orm");

  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  try {
    const result = await database
      .delete(agentMemory)
      .where(
        and(
          lt(agentMemory.createdAt, ninetyDaysAgo),
          lte(agentMemory.importance, 0.3)
        )
      )
      .returning({ id: agentMemory.id });

    const pruned = result.length;
    logger.info({ pruned }, "Memory cleanup complete");
    return { pruned };
  } catch (error: any) {
    logger.warn({ error: error.message }, "Memory cleanup failed");
    return { pruned: 0 };
  }
}
