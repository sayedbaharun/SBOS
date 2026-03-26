/**
 * Reflector — Resonance Pentad Layer 3
 *
 * When 3+ observations accumulate during a task, the Reflector:
 * 1. Condenses them into a single coherent summary
 * 2. Routes high-value items to shared memory (Resonance dimension):
 *    - Decisions → Pinecone "decisions" namespace
 *    - Entities → FalkorDB knowledge graph
 *    - Full observation → Qdrant compacted_memories
 *
 * This creates cross-agent value: Agent A's compacted observations
 * become searchable by Agent B via semantic search.
 */

import { logger } from "../logger";
import type { ObservationOutput } from "./context-budget";

/**
 * Reflect on multiple observations, condense them, and route to shared memory.
 *
 * @param observations - Array of 3+ observations from Layer 2 compaction
 * @param agentId - UUID of the agent that generated these observations
 * @param agentSlug - Slug of the agent (for logging and tagging)
 * @returns The condensed observation, or null if reflection failed
 */
export async function reflectAndRoute(
  observations: ObservationOutput[],
  agentId: string,
  agentSlug: string,
): Promise<ObservationOutput | null> {
  if (observations.length < 2) return null;

  const startTime = Date.now();

  try {
    // 1. Condense observations into a single summary
    const condensed = await condenseObservations(observations);
    if (!condensed) return null;

    // 2. Route to shared memory stores (fire-and-forget, non-blocking)
    routeToSharedMemory(condensed, agentId, agentSlug).catch((err) =>
      logger.debug({ err: err.message }, "Resonance routing failed (non-critical)"),
    );

    logger.info(
      {
        agentSlug,
        inputObservations: observations.length,
        decisions: condensed.key_decisions.length,
        entities: condensed.key_entities.length,
        latencyMs: Date.now() - startTime,
      },
      "Reflector condensed observations and routed to shared memory",
    );

    return condensed;
  } catch (err: any) {
    logger.warn(
      { err: err.message, agentSlug },
      "Reflector failed to condense observations",
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Condensation
// ---------------------------------------------------------------------------

async function condenseObservations(
  observations: ObservationOutput[],
): Promise<ObservationOutput | null> {
  // Merge all observations deterministically (no LLM needed for simple merge)
  const merged: ObservationOutput = {
    summary: observations.map((o) => o.summary).join("\n\n---\n\n"),
    key_decisions: dedupeByText(
      observations.flatMap((o) => o.key_decisions),
    ),
    key_facts: Array.from(new Set(observations.flatMap((o) => o.key_facts))),
    key_entities: Array.from(new Set(observations.flatMap((o) => o.key_entities))),
    domain: observations[observations.length - 1].domain, // Use most recent domain
    action_items: Array.from(new Set(observations.flatMap((o) => o.action_items))),
    nextSteps: dedupeByText(
      observations.flatMap((o) => o.nextSteps),
    ),
    openQuestions: Array.from(new Set(observations.flatMap((o) => o.openQuestions))),
  };

  // If merged summary is too long, use LLM to condense
  if (merged.summary.length > 4000) {
    try {
      const { generateCompletion } = await import("../compaction/cerebras-client");
      const result = await generateCompletion(
        "You condense multiple observation summaries into a single coherent 2-4 paragraph summary. Preserve ALL key facts, decisions, and next steps.",
        `Condense these ${observations.length} observation summaries into one:\n\n${merged.summary}`,
        { temperature: 0.3, maxTokens: 2000 },
      );
      merged.summary = result.content;
    } catch {
      // If LLM fails, just truncate
      merged.summary = merged.summary.slice(0, 4000);
    }
  }

  return merged;
}

// ---------------------------------------------------------------------------
// Resonance Routing (shared memory)
// ---------------------------------------------------------------------------

async function routeToSharedMemory(
  observation: ObservationOutput,
  agentId: string,
  agentSlug: string,
): Promise<void> {
  const timestamp = Date.now();

  // 1. Qdrant: upsert full observation as compacted memory
  try {
    const { upsertCompactedMemory } = await import("../memory/qdrant-store");
    const { createHash } = await import("crypto");

    const checksum = createHash("sha256")
      .update(observation.summary)
      .digest("hex")
      .slice(0, 16);

    await upsertCompactedMemory({
      summary: observation.summary,
      source_session_ids: [agentId],
      source_count: 1,
      timestamp,
      time_range_start: timestamp - 3600000, // ~1hr range
      time_range_end: timestamp,
      domain: observation.domain as any,
      key_entities: observation.key_entities,
      key_decisions: observation.key_decisions.map((d) => d.text),
      key_facts: observation.key_facts,
      importance: 0.7,
      compaction_model: "reflector",
      version: 1,
      sync_status: "pending",
      archived: false,
      checksum,
    });

    logger.debug({ agentSlug }, "Observation routed to Qdrant compacted_memories");
  } catch (err: any) {
    logger.debug({ error: err.message }, "Qdrant upsert skipped");
  }

  // 2. FalkorDB: ingest entities to knowledge graph
  try {
    const { ingestCompactionToGraph } = await import("../memory/graph-store");

    await ingestCompactionToGraph({
      id: `reflection:${agentId}-${timestamp}`,
      summary: observation.summary,
      domain: observation.domain,
      importance: 0.7,
      timestamp,
      key_entities: observation.key_entities,
      key_decisions: observation.key_decisions.map((d) => d.text),
    });

    logger.debug({ agentSlug }, "Entities routed to FalkorDB graph");
  } catch (err: any) {
    logger.debug({ error: err.message }, "FalkorDB ingestion skipped");
  }

  // 3. Pinecone: upsert high-priority decisions
  try {
    const highPriorityDecisions = observation.key_decisions.filter(
      (d) => d.priority === "high",
    );

    if (highPriorityDecisions.length === 0) return;

    const { isPineconeConfigured, upsertToPinecone } = await import(
      "../memory/pinecone-store"
    );
    if (!isPineconeConfigured()) return;

    const records = highPriorityDecisions.map((d) => ({
      id: `${agentId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text: d.text,
      metadata: {
        agentId,
        agentSlug,
        type: "decision",
        scope: "shared",
        importance: 0.8,
        priority: d.priority,
        timestamp,
      },
    }));

    await upsertToPinecone("decisions", records);

    logger.debug(
      { agentSlug, count: records.length },
      "High-priority decisions routed to Pinecone",
    );
  } catch (err: any) {
    logger.debug({ error: err.message }, "Pinecone upsert skipped");
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dedupeByText<T extends { text: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.text.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
