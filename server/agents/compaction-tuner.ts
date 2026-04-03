/**
 * Compaction Tuner — Resonance Pentad Layer 4 (Adaptive Feedback)
 *
 * Learns which compaction strategies work best per agent by analyzing
 * compaction event history. Adjusts config (threshold, model, Layer 3 toggle)
 * based on success rates and cross-agent retrieval patterns.
 *
 * Runs as part of the nightly consolidation cycle (3am Dubai).
 */

import { eq, gte, sql } from "drizzle-orm";
import { logger } from "../logger";
import {
  agentCompactionEvents,
  agentCompactionConfig,
  agents,
} from "@shared/schema";

// Lazy DB
let db: any = null;
async function getDb() {
  if (!db) {
    const { storage } = await import("../storage");
    db = (storage as any).db;
  }
  return db;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AgentCompactionStats {
  agentId: string;
  agentSlug: string;
  totalEvents: number;
  layer1Events: number;
  layer2Events: number;
  layer3Events: number;
  avgTokensSaved: number;
  avgLatencyMs: number;
  totalTokensSaved: number;
  successRate: number; // % of tasks that completed after compaction
  avgCompactionsPerTask: number;
}

// ---------------------------------------------------------------------------
// Core: Tune compaction config per agent
// ---------------------------------------------------------------------------

/**
 * Analyze compaction history and adjust config for each agent.
 * Called nightly alongside memory consolidation.
 */
export async function tuneAllAgentCompaction(): Promise<{
  agentsAnalyzed: number;
  configsUpdated: number;
}> {
  const database = await getDb();
  let agentsAnalyzed = 0;
  let configsUpdated = 0;

  try {
    // Get all active agents
    const activeAgents = await database
      .select({ id: agents.id, slug: agents.slug })
      .from(agents)
      .where(eq(agents.isActive, true));

    for (const agent of activeAgents) {
      try {
        const updated = await tuneCompactionConfig(agent.id, agent.slug);
        agentsAnalyzed++;
        if (updated) configsUpdated++;
      } catch (err: any) {
        logger.debug(
          { agentSlug: agent.slug, error: err.message },
          "Failed to tune compaction config for agent",
        );
      }
    }

    logger.info(
      { agentsAnalyzed, configsUpdated },
      "Compaction tuning cycle complete",
    );
  } catch (err: any) {
    logger.warn({ error: err.message }, "Compaction tuner failed");
  }

  return { agentsAnalyzed, configsUpdated };
}

/**
 * Analyze and tune compaction config for a single agent.
 * Returns true if config was changed.
 */
async function tuneCompactionConfig(
  agentId: string,
  agentSlug: string,
): Promise<boolean> {
  const database = await getDb();

  // Get events from last 7 days
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const events = await database
    .select()
    .from(agentCompactionEvents)
    .where(
      sql`${agentCompactionEvents.agentId} = ${agentId} AND ${agentCompactionEvents.createdAt} >= ${sevenDaysAgo}`,
    );

  // Not enough data to tune
  if (events.length < 3) return false;

  // Compute metrics
  const layer1Events = events.filter((e: any) => e.layer === 1);
  const layer2Events = events.filter((e: any) => e.layer === 2);
  const avgLatency = events.reduce((sum: number, e: any) => sum + e.latencyMs, 0) / events.length;
  const avgTokensSaved = events.reduce((sum: number, e: any) => sum + e.tokensSaved, 0) / events.length;

  // Success rate: count tasks that completed successfully after compaction
  const tasksWithCompaction = new Set(events.filter((e: any) => e.taskId).map((e: any) => e.taskId));
  const completedTasks = events.filter(
    (e: any) => e.taskOutcome === "completed" || e.taskOutcome === "success",
  );
  const successRate =
    tasksWithCompaction.size > 0
      ? completedTasks.length / tasksWithCompaction.size
      : 1;

  // Get current config
  const existing = await database
    .select()
    .from(agentCompactionConfig)
    .where(eq(agentCompactionConfig.agentId, agentId));

  const currentConfig = existing[0] || {
    thresholdPct: 0.75,
    layer2Model: "meta-llama/llama-4-scout:free",
    maxObservationTokens: 2000,
    enableLayer3: false,
  };

  // Decide adjustments
  let changed = false;
  const newConfig = { ...currentConfig };

  // If success rate drops below 70%, compact less (raise threshold)
  if (successRate < 0.7 && events.length >= 5) {
    const newThreshold = Math.min(
      (currentConfig.thresholdPct ?? 0.75) + 0.05,
      0.9,
    );
    if (newThreshold !== currentConfig.thresholdPct) {
      newConfig.thresholdPct = newThreshold;
      changed = true;
      logger.info(
        { agentSlug, successRate, newThreshold },
        "Raising compaction threshold (success rate low)",
      );
    }
  }

  // If Layer 2 latency is consistently high (>5s avg), note it
  if (layer2Events.length >= 3) {
    const l2AvgLatency =
      layer2Events.reduce((sum: number, e: any) => sum + e.latencyMs, 0) /
      layer2Events.length;

    if (l2AvgLatency > 5000) {
      logger.info(
        { agentSlug, l2AvgLatency },
        "Layer 2 latency high — consider switching model",
      );
    }
  }

  // Enable Layer 3 if agent has frequent compactions (>5 events/week)
  // and observations are being generated regularly
  if (
    layer2Events.length >= 5 &&
    !currentConfig.enableLayer3
  ) {
    newConfig.enableLayer3 = true;
    changed = true;
    logger.info(
      { agentSlug, layer2Events: layer2Events.length },
      "Enabling Layer 3 (frequent compactions)",
    );
  }

  // If success rate is very high and threshold is above default, lower it back
  if (successRate > 0.9 && (currentConfig.thresholdPct ?? 0.75) > 0.75) {
    newConfig.thresholdPct = Math.max(
      (currentConfig.thresholdPct ?? 0.75) - 0.05,
      0.75,
    );
    changed = true;
  }

  // Save config if changed
  if (changed) {
    await database
      .insert(agentCompactionConfig)
      .values({
        agentId,
        thresholdPct: newConfig.thresholdPct,
        layer2Model: newConfig.layer2Model,
        maxObservationTokens: newConfig.maxObservationTokens,
        enableLayer3: newConfig.enableLayer3,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: agentCompactionConfig.agentId,
        set: {
          thresholdPct: newConfig.thresholdPct,
          layer2Model: newConfig.layer2Model,
          maxObservationTokens: newConfig.maxObservationTokens,
          enableLayer3: newConfig.enableLayer3,
          updatedAt: new Date(),
        },
      });
  }

  return changed;
}

// ---------------------------------------------------------------------------
// Stats API
// ---------------------------------------------------------------------------

/**
 * Get compaction stats for a specific agent.
 */
export async function getAgentCompactionStats(
  agentId: string,
): Promise<AgentCompactionStats | null> {
  const database = await getDb();

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const events = await database
    .select()
    .from(agentCompactionEvents)
    .where(
      sql`${agentCompactionEvents.agentId} = ${agentId} AND ${agentCompactionEvents.createdAt} >= ${sevenDaysAgo}`,
    );

  if (events.length === 0) return null;

  // Get agent slug
  const agentRows = await database
    .select({ slug: agents.slug })
    .from(agents)
    .where(eq(agents.id, agentId));

  const slug = agentRows[0]?.slug || "unknown";

  const layer1 = events.filter((e: any) => e.layer === 1);
  const layer2 = events.filter((e: any) => e.layer === 2);
  const layer3 = events.filter((e: any) => e.layer === 3);

  const uniqueSessions = new Set(events.map((e: any) => e.sessionId));
  const completedTasks = events.filter(
    (e: any) => e.taskOutcome === "completed" || e.taskOutcome === "success",
  );

  return {
    agentId,
    agentSlug: slug,
    totalEvents: events.length,
    layer1Events: layer1.length,
    layer2Events: layer2.length,
    layer3Events: layer3.length,
    avgTokensSaved:
      events.reduce((sum: number, e: any) => sum + e.tokensSaved, 0) / events.length,
    avgLatencyMs:
      events.reduce((sum: number, e: any) => sum + e.latencyMs, 0) / events.length,
    totalTokensSaved: events.reduce((sum: number, e: any) => sum + e.tokensSaved, 0),
    successRate:
      uniqueSessions.size > 0
        ? completedTasks.length / uniqueSessions.size
        : 1,
    avgCompactionsPerTask:
      uniqueSessions.size > 0
        ? events.length / uniqueSessions.size
        : 0,
  };
}

/**
 * Get aggregate compaction stats across all agents.
 */
export async function getAggregateCompactionStats(): Promise<{
  totalEvents: number;
  totalTokensSaved: number;
  agentBreakdown: AgentCompactionStats[];
}> {
  const database = await getDb();

  const activeAgents = await database
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.isActive, true));

  const breakdown: AgentCompactionStats[] = [];
  let totalEvents = 0;
  let totalTokensSaved = 0;

  for (const agent of activeAgents) {
    const stats = await getAgentCompactionStats(agent.id);
    if (stats) {
      breakdown.push(stats);
      totalEvents += stats.totalEvents;
      totalTokensSaved += stats.totalTokensSaved;
    }
  }

  return { totalEvents, totalTokensSaved, agentBreakdown: breakdown };
}
