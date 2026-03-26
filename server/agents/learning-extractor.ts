/**
 * Learning Extractor
 *
 * Automatically extracts structured learnings from agent conversations.
 * Runs async (fire-and-forget) after every conversation to build
 * persistent agent intelligence over time.
 *
 * Also handles nightly consolidation (merge duplicates, decay stale memories)
 * and task outcome learning (learn from delegation success/failure).
 */

import { eq, lt, and, desc, isNull, or, sql } from "drizzle-orm";
import { logger } from "../logger";
import * as modelManager from "../model-manager";
import { agentMemory, agents } from "@shared/schema";
import { generateEmbedding, serializeEmbedding } from "../embeddings";

// Sentinel agent ID for shared (cross-agent) memories
export const SHARED_MEMORY_AGENT_ID = "00000000-0000-0000-0000-000000000000";

// Ensure the shared memory sentinel agent row exists
let sentinelEnsured = false;
async function ensureSharedMemoryAgent(): Promise<void> {
  if (sentinelEnsured) return;
  const database = await getDb();
  const [existing] = await database
    .select()
    .from(agents)
    .where(eq(agents.id, SHARED_MEMORY_AGENT_ID));

  if (!existing) {
    await database.insert(agents).values({
      id: SHARED_MEMORY_AGENT_ID,
      name: "Shared Memory",
      slug: "_shared-memory",
      role: "specialist",
      soul: "Sentinel agent for shared cross-agent memories. Not an actual agent.",
      isActive: false,
    });
    logger.info("Created shared memory sentinel agent");
  }
  sentinelEnsured = true;
}

// Use a cheap fast model for extraction
const EXTRACTION_MODEL = "openai/gpt-4o-mini";

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
// EXTRACTION PROMPT
// ============================================================================

const EXTRACTION_SYSTEM_PROMPT = `You are a knowledge extraction engine. Given a conversation between a user and an AI agent, extract structured learnings.

Extract ONLY substantive information. Skip trivial exchanges, greetings, and small talk.

For each extraction, classify:
- type: "learning" (lessons, insights), "preference" (user likes/dislikes, style preferences), "context" (facts, business info, market data), "decision" (choices made, strategies chosen), "relationship" (people, connections, organizations)
- importance: 0.0-1.0 (0.3 = minor detail, 0.5 = useful context, 0.7 = important fact, 0.9 = critical decision/preference)
- scope: "agent" (only relevant to this specific agent), "shared" (relevant across all agents), "venture" (relevant to a specific venture)

Respond with JSON only:
{
  "extractions": [
    {
      "content": "concise statement of the learning",
      "type": "preference|learning|context|decision|relationship",
      "importance": 0.7,
      "scope": "shared|agent|venture",
      "tags": ["tag1", "tag2"]
    }
  ]
}

If nothing worth extracting, return: { "extractions": [] }`;

// ============================================================================
// CORE EXTRACTION
// ============================================================================

interface ExtractionResult {
  content: string;
  type: "learning" | "preference" | "context" | "decision" | "relationship";
  importance: number;
  scope: "agent" | "shared" | "venture";
  tags?: string[];
}

export async function extractConversationLearnings(params: {
  agentId: string;
  agentSlug: string;
  userMessage: string;
  assistantResponse: string;
  conversationId?: string;
  ventureId?: string;
  actions?: Array<{ actionType: string; entityType?: string }>;
  /** Optional: pre-computed observations from context compaction (avoids duplicate LLM call) */
  compactionObservations?: Array<{
    key_decisions: Array<{ text: string; priority: string }>;
    key_facts: string[];
    key_entities: string[];
    domain: string;
  }>;
}): Promise<void> {
  const { agentId, agentSlug, userMessage, assistantResponse, conversationId, ventureId, actions, compactionObservations } = params;

  // Skip trivial exchanges
  const combined = userMessage + assistantResponse;
  if (combined.length < 100) {
    return;
  }

  try {
    // If compaction observations are available, extract structured data from them
    // to enhance learning extraction without an extra LLM call
    let observationContext = "";
    if (compactionObservations && compactionObservations.length > 0) {
      const decisions = compactionObservations.flatMap(o => o.key_decisions);
      const facts = compactionObservations.flatMap(o => o.key_facts);
      const entities = compactionObservations.flatMap(o => o.key_entities);

      if (decisions.length > 0 || facts.length > 0) {
        observationContext = `\n\nPre-extracted observations from context compaction:` +
          (decisions.length > 0 ? `\nDecisions: ${decisions.map(d => `[${d.priority}] ${d.text}`).join("; ")}` : "") +
          (facts.length > 0 ? `\nFacts: ${facts.join("; ")}` : "") +
          (entities.length > 0 ? `\nEntities: ${entities.join(", ")}` : "");
      }
    }

    const actionSummary = actions && actions.length > 0
      ? `\nActions taken: ${actions.map(a => a.actionType).join(", ")}`
      : "";

    const { response } = await modelManager.chatCompletion(
      {
        messages: [
          { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
          {
            role: "user",
            content: `Agent: ${agentSlug}\n\nUser message:\n${userMessage.slice(0, 2000)}\n\nAssistant response:\n${assistantResponse.slice(0, 2000)}${actionSummary}${observationContext}`,
          },
        ],
        temperature: 0.1,
        max_tokens: 1000,
        response_format: { type: "json_object" },
      },
      "simple",
      EXTRACTION_MODEL
    );

    const content = response.choices[0]?.message?.content;
    if (!content) return;

    let parsed: { extractions: ExtractionResult[] };
    try {
      parsed = JSON.parse(content);
    } catch {
      logger.warn({ agentSlug, content: content.slice(0, 200) }, "Failed to parse extraction JSON");
      return;
    }

    if (!parsed.extractions || parsed.extractions.length === 0) return;

    const database = await getDb();

    // Ensure sentinel agent exists before inserting shared memories
    const hasShared = parsed.extractions.some(e => e.scope === "shared" || e.scope === "venture");
    if (hasShared) {
      await ensureSharedMemoryAgent();
    }

    for (const extraction of parsed.extractions) {
      // Determine which agent ID to store under
      const targetAgentId = extraction.scope === "shared" || extraction.scope === "venture"
        ? SHARED_MEMORY_AGENT_ID
        : agentId;

      const memoryType = extraction.type === "decision" ? "decision" as const : extraction.type;

      await database.insert(agentMemory).values({
        agentId: targetAgentId,
        memoryType,
        content: extraction.content,
        importance: Math.max(0, Math.min(1, extraction.importance)),
        scope: extraction.scope,
        ventureId: extraction.scope === "venture" ? ventureId : null,
        tags: extraction.tags || [],
        sourceConversationId: conversationId || null,
      });
    }

    // Generate embeddings async (non-blocking)
    generateEmbeddingsForRecentMemories(agentId).catch(err =>
      logger.warn({ err: err.message }, "Background embedding generation failed")
    );

    // Upsert raw conversation to Qdrant + compacted summaries to Pinecone (non-blocking)
    upsertToVectorStores({
      agentId,
      agentSlug,
      userMessage,
      assistantResponse,
      ventureId,
      extractions: parsed.extractions,
    }).catch(err =>
      logger.debug({ err: err.message }, "Vector store upsert deferred (non-critical)")
    );

    logger.info(
      { agentSlug, extractions: parsed.extractions.length },
      "Conversation learnings extracted"
    );
  } catch (error: any) {
    logger.warn(
      { agentSlug, error: error.message },
      "Learning extraction failed (non-critical)"
    );
  }
}

// ============================================================================
// EMBEDDING GENERATION
// ============================================================================

export async function generateEmbeddingsForRecentMemories(agentId: string): Promise<void> {
  const database = await getDb();

  // Find ALL memories without embeddings (not just for this agent)
  // The old query used eq(embedding, null) which doesn't work — use isNull() or empty string check
  const memoriesNeedingEmbeddings = await database
    .select()
    .from(agentMemory)
    .where(
      or(
        isNull(agentMemory.embedding),
        sql`${agentMemory.embedding} = ''`
      )
    )
    .orderBy(desc(agentMemory.createdAt))
    .limit(20);

  if (memoriesNeedingEmbeddings.length === 0) return;

  logger.info({ count: memoriesNeedingEmbeddings.length }, "Generating embeddings for memories without them");

  let embedded = 0;
  for (const memory of memoriesNeedingEmbeddings) {
    try {
      const result = await generateEmbedding(memory.content);
      await database
        .update(agentMemory)
        .set({
          embedding: serializeEmbedding(result.embedding),
          embeddingModel: result.model,
        })
        .where(eq(agentMemory.id, memory.id));
      embedded++;
    } catch (err: any) {
      logger.warn({ memoryId: memory.id, error: err.message }, "Failed to embed memory, skipping");
    }
  }

  if (embedded > 0) {
    logger.info({ embedded, attempted: memoriesNeedingEmbeddings.length }, "Embedding generation batch complete");
  }
}

// ============================================================================
// NIGHTLY CONSOLIDATION
// ============================================================================

export async function consolidateAgentMemories(agentId: string): Promise<{ merged: number; decayed: number }> {
  const database = await getDb();

  // Get all memories for this agent, sorted by importance
  const memories = await database
    .select()
    .from(agentMemory)
    .where(eq(agentMemory.agentId, agentId))
    .orderBy(desc(agentMemory.importance));

  if (memories.length < 2) return { merged: 0, decayed: 0 };

  // Find duplicate/similar memories using content comparison
  // Group by type for more focused comparison
  const grouped: Record<string, typeof memories> = {};
  for (const m of memories) {
    const key = m.memoryType;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(m);
  }

  let merged = 0;

  for (const [_type, mems] of Object.entries(grouped)) {
    if (mems.length < 2) continue;

    // Simple similarity: check for high overlap using normalized content
    const toMerge: Array<[any, any]> = [];

    for (let i = 0; i < mems.length; i++) {
      for (let j = i + 1; j < mems.length; j++) {
        const similarity = computeTextSimilarity(mems[i].content, mems[j].content);
        if (similarity > 0.8) {
          toMerge.push([mems[i], mems[j]]);
        }
      }
    }

    // Merge pairs (keep the higher-importance one, delete the other, boost importance)
    const deletedIds = new Set<string>();
    for (const [a, b] of toMerge) {
      if (deletedIds.has(a.id) || deletedIds.has(b.id)) continue;

      const keeper = (a.importance || 0) >= (b.importance || 0) ? a : b;
      const toDelete = keeper === a ? b : a;

      // Boost importance of keeper (confirmed pattern)
      const boostedImportance = Math.min(1, (keeper.importance || 0.5) + 0.1);
      await database
        .update(agentMemory)
        .set({ importance: boostedImportance })
        .where(eq(agentMemory.id, keeper.id));

      await database.delete(agentMemory).where(eq(agentMemory.id, toDelete.id));
      deletedIds.add(toDelete.id);
      merged++;
    }
  }

  // Decay old low-importance memories
  const decayed = await decayOldMemories(agentId);

  logger.info({ agentId, merged, decayed }, "Memory consolidation complete");
  return { merged, decayed };
}

// ============================================================================
// MEMORY DECAY
// ============================================================================

export async function decayOldMemories(agentId: string): Promise<number> {
  const database = await getDb();
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  // Delete memories >90 days old with importance < 0.3
  const veryOld = await database
    .select()
    .from(agentMemory)
    .where(
      and(
        eq(agentMemory.agentId, agentId),
        lt(agentMemory.createdAt, ninetyDaysAgo)
      )
    );

  let decayed = 0;
  for (const m of veryOld) {
    if ((m.importance || 0) < 0.3) {
      await database.delete(agentMemory).where(eq(agentMemory.id, m.id));
      decayed++;
    }
  }

  // Reduce importance by 0.05 for memories >30 days old with importance < 0.5
  const stale = await database
    .select()
    .from(agentMemory)
    .where(
      and(
        eq(agentMemory.agentId, agentId),
        lt(agentMemory.createdAt, thirtyDaysAgo)
      )
    );

  for (const m of stale) {
    if ((m.importance || 0) < 0.5 && (m.importance || 0) >= 0.3) {
      const newImportance = Math.max(0, (m.importance || 0.5) - 0.05);
      await database
        .update(agentMemory)
        .set({ importance: newImportance })
        .where(eq(agentMemory.id, m.id));
    }
  }

  return decayed;
}

// ============================================================================
// TASK OUTCOME LEARNING
// ============================================================================

export async function storeTaskOutcomeLearning(params: {
  agentId: string;
  agentSlug: string;
  taskTitle: string;
  taskDescription?: string;
  outcome: "completed" | "failed";
  response?: string;
  error?: string;
}): Promise<void> {
  const { agentId, agentSlug, taskTitle, outcome, response, error } = params;

  try {
    const database = await getDb();

    const content = outcome === "completed"
      ? `Successfully completed task "${taskTitle}". ${response ? `Approach: ${response.slice(0, 200)}` : ""}`
      : `Failed task "${taskTitle}". ${error ? `Error: ${error.slice(0, 200)}` : ""}`;

    const importance = outcome === "completed" ? 0.6 : 0.7; // Failures slightly more important to remember

    await database.insert(agentMemory).values({
      agentId,
      memoryType: "learning",
      content,
      importance,
      scope: "agent",
      tags: [outcome, "task_outcome"],
    });

    logger.debug({ agentSlug, outcome, taskTitle }, "Task outcome learning stored");
  } catch (err: any) {
    logger.warn({ agentSlug, error: err.message }, "Failed to store task outcome learning");
  }
}

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Simple text similarity using Jaccard similarity on word sets.
 * Returns 0-1 where 1 = identical.
 */
function computeTextSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 2));

  if (wordsA.size === 0 && wordsB.size === 0) return 1;
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const word of Array.from(wordsA)) {
    if (wordsB.has(word)) intersection++;
  }

  const union = wordsA.size + wordsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ============================================================================
// VECTOR STORE PIPELINE (Qdrant + Pinecone)
// ============================================================================

/**
 * Upsert raw conversation to Qdrant and compacted extractions to Pinecone.
 * Non-blocking — silently skips if vector stores are unavailable.
 */
async function upsertToVectorStores(params: {
  agentId: string;
  agentSlug: string;
  userMessage: string;
  assistantResponse: string;
  ventureId?: string;
  extractions: ExtractionResult[];
}): Promise<void> {
  const { agentId, agentSlug, userMessage, assistantResponse, ventureId, extractions } = params;
  const sessionId = agentId; // Use agent ID as session grouping

  // 1. Qdrant: upsert raw conversation
  try {
    const { upsertRawMemory } = await import("../memory/qdrant-store");
    const conversationText = `User: ${userMessage.slice(0, 1000)}\nAssistant: ${assistantResponse.slice(0, 1000)}`;

    await upsertRawMemory({
      text: conversationText,
      session_id: sessionId,
      timestamp: Date.now(),
      source: "conversation",
      domain: ventureId ? "business" : "personal",
      entities: extractions.flatMap(e => e.tags || []).slice(0, 10),
      importance: Math.max(...extractions.map(e => e.importance), 0.5),
    });

    logger.debug({ agentSlug }, "Raw memory upserted to Qdrant");
  } catch (err: any) {
    // Qdrant unavailable (local Ollama not running, Qdrant not reachable) — skip silently
    logger.debug({ error: err.message }, "Qdrant upsert skipped");
  }

  // 2. Qdrant: upsert compacted extractions to compacted_memories collection
  const highValue = extractions.filter(e =>
    e.importance >= 0.6 || e.type === "decision" || e.scope === "shared"
  );

  if (highValue.length > 0) {
    try {
      const { upsertCompactedMemory } = await import("../memory/qdrant-store");
      const { createHash } = await import("crypto");

      for (const e of highValue) {
        const checksum = createHash("sha256").update(e.content).digest("hex");
        await upsertCompactedMemory({
          summary: e.content,
          source_session_ids: [sessionId],
          source_count: 1,
          timestamp: Date.now(),
          time_range_start: Date.now(),
          time_range_end: Date.now(),
          domain: ventureId ? "business" : "personal",
          key_entities: e.tags || [],
          key_decisions: e.type === "decision" ? [e.content] : [],
          key_facts: e.type === "learning" ? [e.content] : [],
          importance: e.importance,
          compaction_model: "learning-extractor",
          version: 1,
          sync_status: "pending",
          archived: false,
          checksum,
        });
      }

      logger.debug({ agentSlug, count: highValue.length }, "Compacted extractions upserted to Qdrant");
    } catch (err: any) {
      logger.debug({ error: err.message }, "Qdrant compacted upsert skipped");
    }

    // 3. Pinecone: also upsert compacted extractions (backup store)
    try {
      const { isPineconeReady, upsertToPinecone } = await import("../memory/pinecone-store");
      if (await isPineconeReady()) {
        const records = highValue.map(e => ({
          id: `${agentId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          text: e.content,
          metadata: {
            agentId,
            agentSlug,
            type: e.type,
            scope: e.scope,
            importance: e.importance,
            tags: e.tags || [],
            ventureId: ventureId || "",
            timestamp: Date.now(),
          },
        }));

        const namespace = extractions.some(e => e.type === "decision") ? "decisions" : "compacted";
        await upsertToPinecone(namespace, records);

        logger.debug({ agentSlug, count: records.length, namespace }, "Extractions upserted to Pinecone");
      }
    } catch (err: any) {
      logger.warn({ error: err.message, agentSlug }, "Pinecone upsert failed — records not stored in cloud backup");
    }
  }
}
