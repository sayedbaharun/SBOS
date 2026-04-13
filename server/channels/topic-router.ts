/**
 * Telegram Topic Router
 *
 * Resolves an event type + optional payload to a Telegram forum topic threadId.
 * Queries telegram_topic_map at runtime so topic IDs survive server restarts.
 *
 * Usage:
 *   const threadId = await resolveTopic("brief.morning.ready");
 *   await sendProactiveMessage("telegram", chatId, msg, threadId);
 *
 * Matching rules (most-specific first):
 *   1. Venture-scoped: ventureId in payload matches AND eventType in eventTypes
 *   2. Global: ventureId IS NULL AND eventType in eventTypes
 *   3. No match → undefined (sends to general chat)
 */

import { eq, and, isNull, sql } from "drizzle-orm";
import { logger } from "../logger";
import { storage } from "../storage";
import { telegramTopicMap } from "@shared/schema";

let db: any = null;
async function getDb() {
  if (!db) {
    db = (storage as any).db;
  }
  return db;
}

/**
 * Resolve which Telegram forum topic threadId a given event should go to.
 *
 * @param eventType  - The event type string (e.g. "brief.morning.ready")
 * @param payload    - Optional event payload; if it contains a `ventureId`,
 *                     venture-scoped topics are preferred.
 * @returns The message_thread_id to use, or undefined for the general chat.
 */
export async function resolveTopic(
  eventType: string,
  payload?: Record<string, any>
): Promise<number | undefined> {
  try {
    const database = await getDb();
    const ventureId: string | undefined = payload?.ventureId;

    // Fetch all active topic rows where this eventType is in the eventTypes array
    const rows: typeof telegramTopicMap.$inferSelect[] = await database
      .select()
      .from(telegramTopicMap)
      .where(
        and(
          eq(telegramTopicMap.active, true),
          sql`${eventType} = ANY(${telegramTopicMap.eventTypes})`
        )
      );

    if (!rows || rows.length === 0) return undefined;

    // Prefer venture-scoped match first
    if (ventureId) {
      const ventureMatch = rows.find((r) => r.ventureId === ventureId);
      if (ventureMatch) return ventureMatch.threadId;
    }

    // Fall back to global match (no ventureId filter on the row)
    const globalMatch = rows.find((r) => !r.ventureId);
    if (globalMatch) return globalMatch.threadId;

    // Any match as last resort
    return rows[0].threadId;
  } catch (err: any) {
    // Non-fatal: log and fall through to general chat
    logger.debug({ error: err?.message, eventType }, "topic-router: resolveTopic failed, using general chat");
    return undefined;
  }
}

/**
 * Look up a topic by its stable topicKey.
 * Useful for direct topic sends (e.g., "always send briefing to morning-loop").
 */
export async function resolveTopicByKey(topicKey: string): Promise<number | undefined> {
  try {
    const database = await getDb();
    const rows = await database
      .select()
      .from(telegramTopicMap)
      .where(
        and(
          eq(telegramTopicMap.active, true),
          eq(telegramTopicMap.topicKey, topicKey)
        )
      )
      .limit(1);

    return rows?.[0]?.threadId;
  } catch (err: any) {
    logger.debug({ error: err?.message, topicKey }, "topic-router: resolveTopicByKey failed");
    return undefined;
  }
}
