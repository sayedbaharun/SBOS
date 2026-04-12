/**
 * Decision Recorder
 *
 * Fire-and-forget recorder for agent tool invocations.
 * Inserts into the `decisions` table asynchronously.
 * Never throws — errors are silently logged.
 */

import { logger } from "../logger";
import { storage } from "../storage";
import { decisions } from "@shared/schema";

// Lazy DB handle — mirrors the pattern used in agent-tool-handlers.ts
let db: any = null;
async function getDb() {
  if (!db) {
    db = (storage as any).db;
  }
  return db;
}

export interface DecisionRecord {
  agentSlug: string;
  conversationId?: string;
  action: string;
  inputs?: Record<string, any>;
  reasoning?: string;
  outputs?: Record<string, any>;
  tokensUsed?: number;
  costUSD?: number;
}

async function _insert(record: DecisionRecord): Promise<void> {
  const database = await getDb();
  await database.insert(decisions).values({
    agentSlug: record.agentSlug,
    conversationId: record.conversationId ?? null,
    action: record.action,
    inputs: record.inputs ?? null,
    reasoning: record.reasoning ?? null,
    outputs: record.outputs ?? null,
    tokensUsed: record.tokensUsed ?? null,
    costUSD: record.costUSD ?? null,
  });
}

/**
 * Record a decision asynchronously. Never throws, never blocks.
 */
export function recordDecision(record: DecisionRecord): void {
  _insert(record).catch((err) => {
    logger.warn({ err, agentSlug: record.agentSlug, action: record.action }, "recordDecision: DB insert failed");
  });
}
