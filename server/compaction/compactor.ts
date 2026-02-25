/**
 * Session Compactor
 *
 * Full compaction pipeline:
 * 1. Extract messages from context monitor
 * 2. Store raw messages in Qdrant
 * 3. Summarize via Cerebras (fallback: Ollama)
 * 4. Parse structured output
 * 5. Store compacted memory in Qdrant
 * 6. Update entities in entity index
 * 7. Replace session context
 */

import { logger } from "../logger";
import { randomUUID } from "crypto";
import {
  getCompactableMessages,
  replaceAfterCompaction,
  type TrackedMessage,
} from "./context-monitor";
import { generateCompletion } from "./cerebras-client";
import { COMPACTION_SYSTEM_PROMPT, buildCompactionPrompt, buildEntityExtractionPrompt } from "./prompts";
import {
  compactionOutputSchema,
  type CompactionOutput,
  type CompactedMemoryPayload,
  type EntityPayload,
} from "../memory/schemas";
import {
  upsertRawMemories,
  markAsCompacted,
  upsertCompactedMemory,
  upsertEntity,
  findEntityByName,
  updateEntityMention,
} from "../memory/qdrant-store";
import { createHash } from "crypto";

export interface CompactionResult {
  sessionId: string;
  compactedId: string;
  rawMemoryIds: string[];
  summary: string;
  model: string;
  entitiesProcessed: number;
}

/**
 * Run full compaction pipeline for a session
 */
export async function compactSession(
  sessionId: string
): Promise<CompactionResult | null> {
  const startTime = Date.now();

  try {
    // Step 1: Get compactable messages
    const { toCompact, toKeep } = getCompactableMessages(sessionId);

    if (toCompact.length === 0) {
      logger.debug({ sessionId }, "No messages to compact");
      return null;
    }

    logger.info(
      { sessionId, messageCount: toCompact.length },
      "Starting session compaction"
    );

    // Step 2: Store raw messages in Qdrant
    const rawMemoryInputs = toCompact.map((msg) => ({
      text: `[${msg.role}] ${msg.content}`,
      session_id: sessionId,
      timestamp: msg.timestamp,
      source: "conversation" as const,
      domain: "personal" as const, // Will be updated by compaction
      entities: [] as string[],
      importance: msg.role === "user" ? 0.6 : 0.4,
    }));

    const rawMemoryIds = await upsertRawMemories(rawMemoryInputs);

    // Step 3: Summarize via Cerebras/Ollama
    const messageTexts = toCompact.map(
      (msg) => `[${msg.role.toUpperCase()}]: ${msg.content}`
    );
    const userPrompt = buildCompactionPrompt(messageTexts);

    const completion = await generateCompletion(
      COMPACTION_SYSTEM_PROMPT,
      userPrompt,
      { temperature: 0.3, maxTokens: 2000, jsonMode: true }
    );

    // Step 4: Parse structured output
    let parsed: CompactionOutput;
    try {
      const rawParsed = JSON.parse(completion.content);
      parsed = compactionOutputSchema.parse(rawParsed);
    } catch (parseError) {
      logger.error({ parseError, raw: completion.content.slice(0, 500) }, "Failed to parse compaction output");
      // Create a basic fallback
      parsed = {
        summary: completion.content.slice(0, 2000),
        key_decisions: [],
        key_facts: [],
        key_entities: [],
        domain: "personal",
        action_items: [],
        emotional_tone: "neutral",
      };
    }

    // Step 5: Compute timestamps and store compacted memory
    const timestamps = toCompact.map((m) => m.timestamp);
    const checksum = createHash("sha256").update(parsed.summary).digest("hex");

    const compactedPayload: CompactedMemoryPayload = {
      summary: parsed.summary,
      source_session_ids: [sessionId],
      source_count: toCompact.length,
      timestamp: Date.now(),
      time_range_start: Math.min(...timestamps),
      time_range_end: Math.max(...timestamps),
      domain: parsed.domain,
      key_entities: parsed.key_entities,
      key_decisions: parsed.key_decisions,
      key_facts: parsed.key_facts,
      importance: 0.7,
      compaction_model: completion.model,
      version: 1,
      sync_status: "pending",
      checksum,
    };

    const compactedId = await upsertCompactedMemory(compactedPayload);

    // Step 6: Mark raw memories as compacted
    await markAsCompacted(rawMemoryIds);

    // Step 7: Process entities
    let entitiesProcessed = 0;
    for (const entityName of parsed.key_entities) {
      try {
        await processEntity(entityName, parsed.domain, Date.now());
        entitiesProcessed++;
      } catch (error) {
        logger.warn({ error, entityName }, "Failed to process entity");
      }
    }

    // Step 7b: Ingest to FalkorDB graph (non-blocking)
    import("../memory/graph-store").then(({ ingestCompactionToGraph }) =>
      ingestCompactionToGraph({
        id: compactedId,
        summary: parsed.summary,
        domain: parsed.domain,
        importance: compactedPayload.importance,
        timestamp: compactedPayload.timestamp,
        key_entities: parsed.key_entities,
        key_decisions: parsed.key_decisions,
      }).catch(() => {})
    );

    // Step 8: Replace session context
    replaceAfterCompaction(sessionId, parsed.summary, toKeep);

    const duration = Date.now() - startTime;
    logger.info(
      {
        sessionId,
        compactedId,
        rawCount: rawMemoryIds.length,
        model: completion.model,
        duration,
        entitiesProcessed,
      },
      "Session compaction complete"
    );

    return {
      sessionId,
      compactedId,
      rawMemoryIds,
      summary: parsed.summary,
      model: completion.model,
      entitiesProcessed,
    };
  } catch (error) {
    logger.error({ error, sessionId }, "Session compaction failed");
    throw error;
  }
}

/**
 * Process a single entity - create or update in entity index
 */
async function processEntity(
  name: string,
  domain: string,
  timestamp: number
): Promise<void> {
  const existing = await findEntityByName(name);

  if (existing) {
    await updateEntityMention(existing.id, {
      last_seen: timestamp,
      domain,
    });
  } else {
    const checksum = createHash("sha256").update(name).digest("hex");
    const payload: EntityPayload = {
      name,
      entity_type: "concept", // Default; could be refined with AI
      description: `Entity mentioned in ${domain} context`,
      first_seen: timestamp,
      last_seen: timestamp,
      mention_count: 1,
      related_domains: [domain],
      attributes: {},
      version: 1,
      checksum,
    };
    await upsertEntity(payload);
  }
}

/**
 * Manual compaction of specific messages (not tied to context monitor)
 */
export async function compactMessages(
  messages: Array<{ role: string; content: string; timestamp?: number }>,
  sessionId?: string
): Promise<{
  compactedId: string;
  summary: string;
  model: string;
}> {
  const sid = sessionId || randomUUID();
  const messageTexts = messages.map(
    (msg) => `[${msg.role.toUpperCase()}]: ${msg.content}`
  );

  const userPrompt = buildCompactionPrompt(messageTexts);
  const completion = await generateCompletion(
    COMPACTION_SYSTEM_PROMPT,
    userPrompt,
    { temperature: 0.3, maxTokens: 2000, jsonMode: true }
  );

  let parsed: CompactionOutput;
  try {
    parsed = compactionOutputSchema.parse(JSON.parse(completion.content));
  } catch {
    parsed = {
      summary: completion.content.slice(0, 2000),
      key_decisions: [],
      key_facts: [],
      key_entities: [],
      domain: "personal",
      action_items: [],
      emotional_tone: "neutral",
    };
  }

  const checksum = createHash("sha256").update(parsed.summary).digest("hex");
  const now = Date.now();

  const compactedPayload: CompactedMemoryPayload = {
    summary: parsed.summary,
    source_session_ids: [sid],
    source_count: messages.length,
    timestamp: now,
    time_range_start: messages[0]?.timestamp || now,
    time_range_end: messages[messages.length - 1]?.timestamp || now,
    domain: parsed.domain,
    key_entities: parsed.key_entities,
    key_decisions: parsed.key_decisions,
    key_facts: parsed.key_facts,
    importance: 0.7,
    compaction_model: completion.model,
    version: 1,
    sync_status: "pending",
    checksum,
  };

  const compactedId = await upsertCompactedMemory(compactedPayload);

  return { compactedId, summary: parsed.summary, model: completion.model };
}
