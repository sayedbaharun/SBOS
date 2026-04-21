/**
 * Wiki Synthesizer
 *
 * Generates auto-wiki articles for entities using an iterative
 * search/select/done loop (inspired by Atomic's wiki synthesis).
 *
 * Flow:
 *   1. Search hybrid retriever for entity-related memories
 *   2. Iteratively refine queries (up to MAX_ROUNDS)
 *   3. Synthesize collected chunks → wiki article with inline citations
 *   4. Store as a doc (type: 'reference', metadata.isWiki: true)
 */

import { logger } from "../logger";
import { storage } from "../storage";

const MAX_ROUNDS = 8;
const TARGET_CHUNKS = 15;
const SYNTHESIS_MODEL = "google/gemini-flash-1.5-8b";
const SEARCH_MODEL = "google/gemini-2.0-flash-exp:free";

interface MemoryChunk {
  id: string;
  text: string;
  type: string;
  score: number;
}

interface WikiResult {
  entityName: string;
  article: string;
  sources: MemoryChunk[];
  docId?: string;
  created: boolean;
}

// ── LLM helpers ───────────────────────────────────────────────────────────────

async function callLLM(
  model: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens = 2000,
  temperature = 0.4
): Promise<string | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": process.env.SITE_URL || "http://localhost:5000",
        "X-Title": "SB-OS Wiki Synthesizer",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        max_tokens: maxTokens,
        temperature,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) return null;
    const data: any = await response.json();
    return data.choices?.[0]?.message?.content ?? null;
  } catch (err) {
    logger.debug({ err }, "Wiki LLM call failed");
    return null;
  }
}

// ── Hybrid search ─────────────────────────────────────────────────────────────

async function searchMemory(query: string, limit = 8): Promise<MemoryChunk[]> {
  try {
    const { retrieveMemories } = await import("./hybrid-retriever");
    const results = await retrieveMemories(query, { limit, min_score: 0.15 });
    return results.map((r: any) => ({
      id: r.id,
      text: r.text || r.content || "",
      type: r.type || "memory",
      score: r.score || 0.5,
    }));
  } catch (err) {
    logger.debug({ err }, "Wiki search failed");
    return [];
  }
}

// ── Iterative research loop ───────────────────────────────────────────────────

async function collectChunks(entityName: string): Promise<MemoryChunk[]> {
  const collected = new Map<string, MemoryChunk>(); // dedup by id
  const queriesUsed = new Set<string>();

  // Generate initial search queries for this entity
  const initialQueries = [
    entityName,
    `${entityName} project decisions`,
    `${entityName} status progress`,
    `${entityName} goals strategy`,
  ];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (collected.size >= TARGET_CHUNKS) break;

    const query = initialQueries[round] ?? entityName;
    if (queriesUsed.has(query)) break;
    queriesUsed.add(query);

    const results = await searchMemory(query, 8);
    for (const r of results) {
      if (!collected.has(r.id) && r.text.length > 30) {
        collected.set(r.id, r);
      }
    }

    // After round 2, use LLM to generate better queries if we don't have enough
    if (round === 2 && collected.size < 5) {
      const refinedQuery = await callLLM(
        SEARCH_MODEL,
        "Generate 3 short search queries (one per line) to find information about the given entity in a personal knowledge base. Return ONLY the queries, no explanation.",
        `Entity: ${entityName}\nAlready searched: ${Array.from(queriesUsed).join(", ")}`,
        100,
        0.3
      );
      if (refinedQuery) {
        const newQueries = refinedQuery.split("\n").map((q: string) => q.trim()).filter(Boolean);
        initialQueries.push(...newQueries.slice(0, 3));
      }
    }
  }

  // Sort by score, take top TARGET_CHUNKS
  return Array.from(collected.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, TARGET_CHUNKS);
}

// ── Synthesis ─────────────────────────────────────────────────────────────────

async function synthesize(entityName: string, chunks: MemoryChunk[]): Promise<string> {
  if (chunks.length === 0) {
    return `# ${entityName}\n\n*No memories found for this entity yet. Wiki will update as more context accumulates.*`;
  }

  const chunksText = chunks
    .map((c, i) => `[${i + 1}] (${c.type}, score: ${c.score.toFixed(2)})\n${c.text.slice(0, 600)}`)
    .join("\n\n---\n\n");

  const systemPrompt = `You are writing a concise wiki article for a personal knowledge base.
Write in third person, past/present tense. Be factual and concise.
Use inline citations like [1], [2] referencing the numbered sources provided.
Structure: brief lead paragraph → key facts → current status → decisions (if any).
Use markdown: ## headers, bullet points where helpful.
Do NOT invent details not in the sources. If sources conflict, note the discrepancy.
Max 400 words.`;

  const userMessage = `Write a wiki article about: **${entityName}**

Sources:
${chunksText}

Write the article now with inline citations.`;

  const article = await callLLM(SYNTHESIS_MODEL, systemPrompt, userMessage, 600, 0.3);

  if (!article) {
    // Fallback: simple summary from top chunks
    const summary = chunks
      .slice(0, 3)
      .map((c, i) => `[${i + 1}] ${c.text.slice(0, 200)}`)
      .join("\n\n");
    return `# ${entityName}\n\n*Auto-synthesis unavailable — showing top memory excerpts.*\n\n${summary}`;
  }

  return article;
}

// ── Store as doc ──────────────────────────────────────────────────────────────

async function storeWikiDoc(
  entityName: string,
  article: string,
  sources: MemoryChunk[]
): Promise<{ docId: string; created: boolean }> {
  const title = `Wiki: ${entityName}`;
  const metadata = {
    isWiki: true,
    wikiEntity: entityName,
    generatedAt: new Date().toISOString(),
    sourceCount: sources.length,
    sources: sources.slice(0, 10).map((s) => ({ id: s.id, type: s.type, score: s.score })),
  };

  // Try to find existing wiki doc for this entity
  const existing = await storage.getDocs({
    type: "reference",
    limit: 200,
    offset: 0,
  });

  const existingWiki = existing.find(
    (d: any) => d.metadata?.isWiki && d.metadata?.wikiEntity === entityName
  );

  if (existingWiki) {
    await storage.updateDoc(existingWiki.id, {
      body: article,
      metadata,
      tags: ["wiki", "auto-generated", entityName.toLowerCase().replace(/\s+/g, "-")],
    });
    return { docId: existingWiki.id, created: false };
  }

  // Create new wiki doc
  const { doc } = await storage.createDocIfNotExists({
    title,
    type: "reference",
    domain: "venture_ops",
    status: "active",
    body: article,
    metadata,
    tags: ["wiki", "auto-generated", entityName.toLowerCase().replace(/\s+/g, "-")],
  });

  return { docId: doc.id, created: true };
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function generateWiki(entityName: string): Promise<WikiResult> {
  logger.info({ entityName }, "Wiki synthesis: starting");

  const chunks = await collectChunks(entityName);
  logger.info({ entityName, chunkCount: chunks.length }, "Wiki synthesis: chunks collected");

  const article = await synthesize(entityName, chunks);

  const { docId, created } = await storeWikiDoc(entityName, article, chunks);
  logger.info({ entityName, docId, created }, "Wiki synthesis: stored");

  return {
    entityName,
    article,
    sources: chunks,
    docId,
    created,
  };
}

/**
 * Batch generate wiki articles for the top N entities by mention count.
 * Called by the Librarian nightly job.
 */
export async function generateWikiBatch(limit = 10): Promise<{ generated: number; updated: number; failed: number }> {
  let generated = 0;
  let updated = 0;
  let failed = 0;

  try {
    const { db } = await import("../../db");
    const { entityRelations } = await import("@shared/schema");
    const { desc, sql } = await import("drizzle-orm");

    // Top entities by mention count from Postgres
    const topEntities = await db
      .select({
        name: entityRelations.sourceName,
        mentionCount: sql<number>`sum(${entityRelations.mentionCount})`,
      })
      .from(entityRelations)
      .groupBy(entityRelations.sourceName)
      .orderBy(desc(sql<number>`sum(${entityRelations.mentionCount})`))
      .limit(limit);

    for (const entity of topEntities) {
      try {
        const result = await generateWiki(entity.name);
        if (result.created) generated++;
        else updated++;
      } catch (err) {
        logger.warn({ err, entity: entity.name }, "Wiki batch: entity failed");
        failed++;
      }
    }
  } catch (err) {
    logger.error({ err }, "Wiki batch: failed to fetch entities");
  }

  return { generated, updated, failed };
}
