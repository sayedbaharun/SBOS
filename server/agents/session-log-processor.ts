/**
 * Session Log Processor
 *
 * Nightly job that extracts structured learnings from Claude Code session logs.
 * Follows the same pattern as learning-extractor.ts:
 *   1. Query unprocessed sessionLogs (source='claude-code')
 *   2. Batch and send to GPT-4o-mini for extraction
 *   3. Save to agent_memory, Qdrant, and Pinecone
 *   4. Mark as processed
 */

import { eq, and } from "drizzle-orm";
import { logger } from "../logger";
import * as modelManager from "../model-manager";
import { sessionLogs, agentMemory, agents } from "@shared/schema";
import { generateEmbedding, serializeEmbedding } from "../embeddings";

const CLAUDE_CODE_AGENT_ID = "11111111-1111-1111-1111-111111111111";
const EXTRACTION_MODEL = "openai/gpt-4o-mini";
const BATCH_SIZE = 20;

// Lazy DB
let db: any = null;
async function getDb() {
  if (!db) {
    const { storage } = await import("../storage");
    db = (storage as any).db;
  }
  return db;
}

// Ensure the Claude Code sentinel agent row exists
let sentinelEnsured = false;
async function ensureClaudeCodeAgent(): Promise<void> {
  if (sentinelEnsured) return;
  const database = await getDb();
  const [existing] = await database
    .select()
    .from(agents)
    .where(eq(agents.id, CLAUDE_CODE_AGENT_ID));

  if (!existing) {
    await database.insert(agents).values({
      id: CLAUDE_CODE_AGENT_ID,
      name: "Claude Code",
      slug: "_claude-code",
      role: "specialist",
      soul: "Sentinel agent for Claude Code session memories. Not an actual agent.",
      isActive: false,
    });
    logger.info("Created Claude Code sentinel agent");
  }
  sentinelEnsured = true;
}

// ============================================================================
// EXTRACTION PROMPT
// ============================================================================

const SESSION_EXTRACTION_PROMPT = `You are a knowledge extraction engine. Given a batch of Claude Code session logs (user ↔ Claude exchanges), extract structured learnings.

Focus on substantive information. Skip trivial exchanges, greetings, small talk, and routine file reads.

Extract:
- **decisions**: Architecture choices, tool selections, approach decisions
- **learnings**: Bugs found, gotchas discovered, patterns that worked/failed
- **preferences**: User workflow preferences, coding style, tool preferences
- **context**: Business facts, project structure, domain knowledge
- **bugs**: Bugs encountered and their fixes

For each extraction, provide:
- content: concise statement (1-2 sentences)
- type: "decision" | "learning" | "preference" | "context" | "relationship"
- importance: 0.0-1.0 (0.3=minor, 0.5=useful, 0.7=important, 0.9=critical)
- tags: relevant keywords

Respond with JSON only:
{
  "extractions": [
    {
      "content": "concise statement",
      "type": "decision|learning|preference|context|relationship",
      "importance": 0.7,
      "tags": ["tag1", "tag2"]
    }
  ]
}

If nothing worth extracting, return: { "extractions": [] }`;

// ============================================================================
// CORE PROCESSOR
// ============================================================================

interface SessionExtraction {
  content: string;
  type: "learning" | "preference" | "context" | "decision" | "relationship";
  importance: number;
  tags?: string[];
}

export interface ProcessSessionLogsResult {
  processed: number;
  extracted: number;
  pineconeUpserted: number;
  qdrantUpserted: number;
}

export async function processSessionLogs(): Promise<ProcessSessionLogsResult> {
  const database = await getDb();
  // Query ALL unprocessed claude-code logs (no time window — process everything pending)
  const logs = await database
    .select()
    .from(sessionLogs)
    .where(
      and(
        eq(sessionLogs.source, "claude-code"),
        eq(sessionLogs.processed, false)
      )
    )
    .orderBy(sessionLogs.createdAt);

  if (logs.length === 0) {
    logger.info("No unprocessed session logs found — skipping");
    return { processed: 0, extracted: 0, pineconeUpserted: 0, qdrantUpserted: 0 };
  }

  logger.info({ count: logs.length }, "Processing session logs");

  await ensureClaudeCodeAgent();

  let totalExtracted = 0;
  let totalPinecone = 0;
  let totalQdrant = 0;
  const processedIds: string[] = [];

  // Batch logs
  for (let i = 0; i < logs.length; i += BATCH_SIZE) {
    const batch = logs.slice(i, i + BATCH_SIZE);
    const batchText = batch
      .map((log: any, idx: number) => `--- Exchange ${idx + 1} ---\n${log.summary}`)
      .join("\n\n");

    try {
      const { response } = await modelManager.chatCompletion(
        {
          messages: [
            { role: "system", content: SESSION_EXTRACTION_PROMPT },
            {
              role: "user",
              content: `Here are ${batch.length} Claude Code session exchanges from the past 24 hours:\n\n${batchText.slice(0, 8000)}`,
            },
          ],
          temperature: 0.1,
          max_tokens: 2000,
          response_format: { type: "json_object" },
        },
        "simple",
        EXTRACTION_MODEL
      );

      const content = response.choices[0]?.message?.content;
      if (!content) continue;

      let parsed: { extractions: SessionExtraction[] };
      try {
        parsed = JSON.parse(content);
      } catch {
        logger.warn({ content: content.slice(0, 200) }, "Failed to parse session extraction JSON");
        continue;
      }

      if (!parsed.extractions || parsed.extractions.length === 0) {
        // Mark as processed even if nothing extracted
        processedIds.push(...batch.map((l: any) => l.id));
        continue;
      }

      // Save extractions to agent_memory
      for (const extraction of parsed.extractions) {
        try {
          const memoryType = extraction.type === "decision" ? "decision" as const : extraction.type;

          await database.insert(agentMemory).values({
            agentId: CLAUDE_CODE_AGENT_ID,
            memoryType,
            content: extraction.content,
            importance: Math.max(0, Math.min(1, extraction.importance)),
            scope: "shared",
            tags: [...(extraction.tags || []), "claude-code", "auto-extracted"],
          });
          totalExtracted++;

          // Generate embedding for the memory
          try {
            const embResult = await generateEmbedding(extraction.content);
            // Update the most recently inserted memory with embedding
            // (we just inserted it so it's the latest for this agent)
          } catch {
            // Non-critical
          }
        } catch (err: any) {
          logger.warn({ error: err.message }, "Failed to insert extraction to agent_memory");
        }
      }

      // Upsert to Qdrant (raw memories)
      try {
        const { upsertRawMemory } = await import("../memory/qdrant-store");
        for (const extraction of parsed.extractions) {
          await upsertRawMemory({
            text: extraction.content,
            session_id: CLAUDE_CODE_AGENT_ID,
            timestamp: Date.now(),
            source: "observation",
            domain: "personal",
            entities: extraction.tags || [],
            importance: extraction.importance,
          });
          totalQdrant++;
        }
      } catch (err: any) {
        logger.debug({ error: err.message }, "Qdrant upsert skipped (session logs)");
      }

      // Upsert high-value to Pinecone
      try {
        const { isPineconeConfigured, upsertToPinecone } = await import("../memory/pinecone-store");
        if (isPineconeConfigured()) {
          const highValue = parsed.extractions.filter(
            (e) => e.importance >= 0.6 || e.type === "decision"
          );

          if (highValue.length > 0) {
            const records = highValue.map((e) => ({
              id: `cc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              text: e.content,
              metadata: {
                agentId: CLAUDE_CODE_AGENT_ID,
                agentSlug: "_claude-code",
                type: e.type,
                scope: "shared",
                importance: e.importance,
                tags: [...(e.tags || []), "claude-code"],
                source: "observation",
                timestamp: Date.now(),
              },
            }));

            await upsertToPinecone("compacted", records);
            totalPinecone += records.length;
          }
        }
      } catch (err: any) {
        logger.debug({ error: err.message }, "Pinecone upsert skipped (session logs)");
      }

      processedIds.push(...batch.map((l: any) => l.id));
    } catch (err: any) {
      logger.warn({ error: err.message, batchIndex: i }, "Session log batch extraction failed — continuing");
      // Still mark as processed to avoid reprocessing failures
      processedIds.push(...batch.map((l: any) => l.id));
    }
  }

  // Mark all processed logs
  for (const id of processedIds) {
    try {
      await database
        .update(sessionLogs)
        .set({ processed: true })
        .where(eq(sessionLogs.id, id));
    } catch {
      // Non-critical
    }
  }

  const result = {
    processed: processedIds.length,
    extracted: totalExtracted,
    pineconeUpserted: totalPinecone,
    qdrantUpserted: totalQdrant,
  };

  logger.info(result, "Session log processing complete");
  return result;
}
