/**
 * Agent Memory Manager
 *
 * Per-agent persistent memory CRUD with importance scoring and TTL cleanup.
 * Supports shared memories (cross-agent), semantic search via embeddings,
 * and relevant memory context for proactive recall.
 */

import { eq, desc, lt, or } from "drizzle-orm";
import { logger } from "../logger";
import { agentMemory, type AgentMemoryEntry } from "@shared/schema";
import { SHARED_MEMORY_AGENT_ID } from "./learning-extractor";

type AgentMemory = AgentMemoryEntry;

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
// MEMORY CRUD
// ============================================================================

export async function storeMemory(params: {
  agentId: string;
  memoryType: "learning" | "preference" | "context" | "relationship" | "decision";
  content: string;
  importance?: number;
  expiresAt?: Date;
  scope?: "agent" | "shared" | "venture";
  ventureId?: string;
  tags?: string[];
}): Promise<AgentMemory> {
  const database = await getDb();

  const [memory] = await database
    .insert(agentMemory)
    .values({
      agentId: params.agentId,
      memoryType: params.memoryType,
      content: params.content,
      importance: params.importance ?? 0.5,
      expiresAt: params.expiresAt,
      scope: params.scope ?? "agent",
      ventureId: params.ventureId ?? null,
      tags: params.tags ?? [],
    })
    .returning();

  logger.debug(
    { agentId: params.agentId, type: params.memoryType, scope: params.scope },
    "Memory stored"
  );

  // Generate embedding async (non-blocking)
  generateAndStoreEmbedding(memory.id, params.content).catch(err =>
    logger.debug({ err: err.message }, "Embedding generation failed (non-critical)")
  );

  return memory;
}

export async function getMemories(
  agentId: string,
  options: {
    memoryType?: string;
    limit?: number;
    minImportance?: number;
  } = {}
): Promise<AgentMemory[]> {
  const database = await getDb();
  const { limit = 20, minImportance = 0 } = options;

  const results: AgentMemory[] = await database
    .select()
    .from(agentMemory)
    .where(eq(agentMemory.agentId, agentId))
    .orderBy(desc(agentMemory.importance))
    .limit(limit);

  let filtered = results;
  if (options.memoryType) {
    filtered = filtered.filter((m) => m.memoryType === options.memoryType);
  }
  if (minImportance > 0) {
    filtered = filtered.filter((m) => (m.importance || 0) >= minImportance);
  }

  return filtered;
}

export async function updateImportance(
  memoryId: string,
  importance: number
): Promise<void> {
  const database = await getDb();

  await database
    .update(agentMemory)
    .set({ importance: Math.max(0, Math.min(1, importance)) })
    .where(eq(agentMemory.id, memoryId));
}

export async function deleteMemory(memoryId: string): Promise<void> {
  const database = await getDb();

  await database
    .delete(agentMemory)
    .where(eq(agentMemory.id, memoryId));
}

export async function clearMemories(
  agentId: string,
  memoryType?: string
): Promise<{ deleted: number }> {
  const database = await getDb();

  if (memoryType) {
    const all = await database
      .select()
      .from(agentMemory)
      .where(eq(agentMemory.agentId, agentId));

    const toDelete = all.filter((m: AgentMemory) => m.memoryType === memoryType);
    if (toDelete.length > 0) {
      for (const m of toDelete) {
        await database.delete(agentMemory).where(eq(agentMemory.id, m.id));
      }
    }
    return { deleted: toDelete.length };
  }

  const all = await database
    .select()
    .from(agentMemory)
    .where(eq(agentMemory.agentId, agentId));

  await database
    .delete(agentMemory)
    .where(eq(agentMemory.agentId, agentId));

  return { deleted: all.length };
}

// ============================================================================
// MEMORY SEARCH (Hybrid: semantic + keyword fallback)
// ============================================================================

export async function searchMemories(
  agentId: string,
  query: string,
  limit: number = 10
): Promise<AgentMemory[]> {
  const database = await getDb();

  // Get agent-specific + shared memories
  const all: AgentMemory[] = await database
    .select()
    .from(agentMemory)
    .where(
      or(
        eq(agentMemory.agentId, agentId),
        eq(agentMemory.agentId, SHARED_MEMORY_AGENT_ID)
      )
    )
    .orderBy(desc(agentMemory.importance));

  // Try semantic search if embeddings available
  try {
    const { generateEmbedding, cosineSimilarity, parseEmbedding } = await import("../embeddings");
    const queryEmbedding = await generateEmbedding(query);

    const memoriesWithEmbeddings = all.filter((m: any) => m.embedding);

    if (memoriesWithEmbeddings.length > 0) {
      const scored = memoriesWithEmbeddings.map((m: any) => {
        const memEmbedding = parseEmbedding(m.embedding);
        if (!memEmbedding) return { memory: m, score: 0 };

        const similarity = cosineSimilarity(queryEmbedding.embedding, memEmbedding);
        const score = similarity * 0.7 + (m.importance || 0) * 0.3;
        return { memory: m, score };
      });

      scored.sort((a, b) => b.score - a.score);

      // Update lastAccessedAt for returned memories
      const results = scored.slice(0, limit).map(s => s.memory);
      updateAccessTracking(results.map((r: any) => r.id)).catch(() => {});
      return results;
    }
  } catch {
    // Embedding generation failed, fall back to keyword search
  }

  // Keyword fallback
  const queryLower = query.toLowerCase();
  const keywordResults = all
    .filter((m: AgentMemory) => m.content.toLowerCase().includes(queryLower))
    .slice(0, limit);

  updateAccessTracking(keywordResults.map(r => r.id)).catch(() => {});
  return keywordResults;
}

async function updateAccessTracking(memoryIds: string[]): Promise<void> {
  if (memoryIds.length === 0) return;
  const database = await getDb();

  for (const id of memoryIds) {
    await database
      .update(agentMemory)
      .set({
        lastAccessedAt: new Date(),
        accessCount: (await database.select().from(agentMemory).where(eq(agentMemory.id, id)))[0]?.accessCount + 1 || 1,
      })
      .where(eq(agentMemory.id, id));
  }
}

// ============================================================================
// MEMORY CONTEXT BUILDER (with shared memories)
// ============================================================================

export async function buildMemoryContext(
  agentId: string,
  maxTokens: number = 2000
): Promise<string> {
  const database = await getDb();
  const charBudget = maxTokens * 4;

  // 60% budget → agent-specific memories
  const agentBudget = Math.floor(charBudget * 0.6);
  // 30% budget → shared organization-wide memories
  const sharedBudget = Math.floor(charBudget * 0.3);
  // 10% budget → venture-specific shared memories
  const ventureBudget = Math.floor(charBudget * 0.1);

  // Agent-specific memories
  const agentMemories = await getMemories(agentId, { limit: 30, minImportance: 0.3 });

  // Shared memories
  const sharedMemories: AgentMemory[] = await database
    .select()
    .from(agentMemory)
    .where(eq(agentMemory.agentId, SHARED_MEMORY_AGENT_ID))
    .orderBy(desc(agentMemory.importance))
    .limit(15);

  // Filter shared vs venture-specific
  const orgShared = sharedMemories.filter((m: any) => m.scope === "shared" || !m.ventureId);
  const ventureShared = sharedMemories.filter((m: any) => m.scope === "venture" && m.ventureId);

  if (agentMemories.length === 0 && orgShared.length === 0) return "";

  const sections: string[] = [];

  // Agent-specific section
  if (agentMemories.length > 0) {
    sections.push("## Your Memory");
    let chars = 0;

    const grouped: Record<string, AgentMemory[]> = {};
    for (const m of agentMemories) {
      if (!grouped[m.memoryType]) grouped[m.memoryType] = [];
      grouped[m.memoryType].push(m);
    }

    const typeLabels: Record<string, string> = {
      learning: "Lessons Learned",
      preference: "User Preferences",
      context: "Contextual Knowledge",
      relationship: "Relationships & People",
      decision: "Decisions Made",
    };

    for (const [type, mems] of Object.entries(grouped)) {
      const label = typeLabels[type] || type;
      sections.push(`\n### ${label}`);

      for (const m of mems) {
        const line = `- ${m.content}`;
        chars += line.length;
        if (chars > agentBudget) break;
        sections.push(line);
      }
      if (chars > agentBudget) break;
    }
  }

  // Shared knowledge section
  if (orgShared.length > 0) {
    sections.push("\n## Shared Knowledge (across all agents)");
    let chars = 0;
    for (const m of orgShared) {
      const line = `- ${m.content}`;
      chars += line.length;
      if (chars > sharedBudget) break;
      sections.push(line);
    }
  }

  // Venture-specific shared section
  if (ventureShared.length > 0) {
    sections.push("\n## Venture Context");
    let chars = 0;
    for (const m of ventureShared) {
      const line = `- ${m.content}`;
      chars += line.length;
      if (chars > ventureBudget) break;
      sections.push(line);
    }
  }

  return sections.join("\n");
}

// ============================================================================
// RELEVANT MEMORY CONTEXT (semantic search against current message)
// ============================================================================

export async function buildRelevantMemoryContext(
  agentId: string,
  currentMessage: string,
  maxTokens: number = 1000
): Promise<string> {
  if (!currentMessage || currentMessage.length < 20) return "";

  try {
    const results = await searchMemories(agentId, currentMessage, 10);
    if (results.length === 0) return "";

    const charBudget = maxTokens * 4;
    let chars = 0;
    const lines: string[] = ["## Relevant Past Context"];

    for (const m of results) {
      const age = getTimeAgo(m.createdAt);
      const line = `- (${age}, ${m.memoryType}) ${m.content}`;
      chars += line.length;
      if (chars > charBudget) break;
      lines.push(line);
    }

    return lines.length > 1 ? lines.join("\n") : "";
  } catch (error: any) {
    logger.debug({ error: error.message }, "Failed to build relevant memory context");
    return "";
  }
}

function getTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - new Date(date).getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  return `${Math.floor(diffDays / 30)} months ago`;
}

// ============================================================================
// EMBEDDING GENERATION (async after storeMemory)
// ============================================================================

async function generateAndStoreEmbedding(memoryId: string, content: string): Promise<void> {
  try {
    const { generateEmbedding, serializeEmbedding } = await import("../embeddings");
    const result = await generateEmbedding(content);
    const database = await getDb();

    await database
      .update(agentMemory)
      .set({
        embedding: serializeEmbedding(result.embedding),
        embeddingModel: result.model,
      })
      .where(eq(agentMemory.id, memoryId));
  } catch {
    // Non-critical — memory still works without embeddings
  }
}

// ============================================================================
// CLEANUP
// ============================================================================

export async function cleanupExpiredMemories(): Promise<{ deleted: number }> {
  const database = await getDb();
  const now = new Date();

  const expired = await database
    .select()
    .from(agentMemory)
    .where(lt(agentMemory.expiresAt, now));

  if (expired.length === 0) return { deleted: 0 };

  for (const m of expired) {
    await database.delete(agentMemory).where(eq(agentMemory.id, m.id));
  }

  logger.info({ count: expired.length }, "Cleaned up expired agent memories");
  return { deleted: expired.length };
}

export async function getMemoryStats(agentId: string): Promise<{
  total: number;
  byType: Record<string, number>;
  avgImportance: number;
}> {
  const memories = await getMemories(agentId, { limit: 1000 });

  const byType: Record<string, number> = {};
  let totalImportance = 0;

  for (const m of memories) {
    byType[m.memoryType] = (byType[m.memoryType] || 0) + 1;
    totalImportance += m.importance || 0;
  }

  return {
    total: memories.length,
    byType,
    avgImportance: memories.length > 0 ? totalImportance / memories.length : 0,
  };
}
