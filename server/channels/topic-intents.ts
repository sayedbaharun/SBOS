/**
 * topic-intents.ts
 *
 * Resolves Telegram inbound `message_thread_id` → semantic intent.
 * Used by telegram-adapter to auto-scope captures / NL queries / agent chat
 * based on which topic the user posted in.
 *
 * Example:
 *   - Post in 💼 SyntheLIQ topic → intent = { kind: 'venture', ventureId, topicKey }
 *   - Post in 📥 Inbox topic → intent = { kind: 'inbox', topicKey: 'inbox' }
 *   - Post in ☀️ Morning Loop → intent = { kind: 'morning-loop', topicKey }
 *   - DM (no threadId) → intent = { kind: 'dm' }
 */

import { logger } from "../logger";

export type TopicIntent =
  | { kind: "dm" }
  | { kind: "venture"; ventureId: string; topicKey: string; threadId: number }
  | { kind: "inbox"; topicKey: string; threadId: number }
  | { kind: "review-queue"; topicKey: string; threadId: number }
  | { kind: "on-fire"; topicKey: string; threadId: number }
  | { kind: "morning-loop"; topicKey: string; threadId: number }
  | { kind: "evening-review"; topicKey: string; threadId: number }
  | { kind: "agents"; topicKey: string; threadId: number }
  | { kind: "schedule"; topicKey: string; threadId: number }
  | { kind: "financials"; topicKey: string; threadId: number }
  | { kind: "health"; topicKey: string; threadId: number }
  | { kind: "unknown"; threadId: number };

// Simple in-memory cache (chatId:threadId → topicKey+ventureId) — 60s TTL.
// Thread IDs are stable within a supergroup, but a cache avoids hammering the DB.
interface CacheEntry {
  topicKey: string;
  ventureId: string | null;
  at: number;
}
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

async function lookupTopic(
  chatId: string,
  threadId: number
): Promise<{ topicKey: string; ventureId: string | null } | null> {
  const cacheKey = `${chatId}:${threadId}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { topicKey: cached.topicKey, ventureId: cached.ventureId };
  }

  try {
    const { telegramTopicMap } = await import("@shared/schema");
    const { and, eq } = await import("drizzle-orm");
    const { storage } = await import("../storage");
    const db = (storage as any).db as any;

    const rows = await db
      .select({
        topicKey: telegramTopicMap.topicKey,
        ventureId: telegramTopicMap.ventureId,
      })
      .from(telegramTopicMap)
      .where(
        and(
          eq(telegramTopicMap.chatId, String(chatId)),
          eq(telegramTopicMap.threadId, threadId),
          eq(telegramTopicMap.active, true)
        )
      )
      .limit(1);

    if (!rows?.[0]) {
      cache.set(cacheKey, { topicKey: "__unknown__", ventureId: null, at: Date.now() });
      return null;
    }

    const entry = { topicKey: rows[0].topicKey as string, ventureId: rows[0].ventureId as string | null };
    cache.set(cacheKey, { ...entry, at: Date.now() });
    return entry;
  } catch (err) {
    logger.warn({ err, chatId, threadId }, "Failed to lookup topic intent");
    return null;
  }
}

/**
 * Resolve an inbound Telegram message to a topic intent.
 * If `threadId` is undefined (DM or general chat), returns `{ kind: 'dm' }`.
 */
export async function resolveIntent(
  chatId: string,
  threadId: number | undefined
): Promise<TopicIntent> {
  if (threadId === undefined || threadId === null) {
    return { kind: "dm" };
  }

  const entry = await lookupTopic(chatId, threadId);
  if (!entry) {
    return { kind: "unknown", threadId };
  }

  const { topicKey, ventureId } = entry;

  // Venture topics always look like "venture:<slug>"
  if (topicKey.startsWith("venture:") && ventureId) {
    return { kind: "venture", ventureId, topicKey, threadId };
  }

  // Known operational topics — discriminate by topicKey
  switch (topicKey) {
    case "inbox":
      return { kind: "inbox", topicKey, threadId };
    case "review-queue":
      return { kind: "review-queue", topicKey, threadId };
    case "on-fire":
      return { kind: "on-fire", topicKey, threadId };
    case "morning-loop":
      return { kind: "morning-loop", topicKey, threadId };
    case "evening-review":
      return { kind: "evening-review", topicKey, threadId };
    case "agents":
      return { kind: "agents", topicKey, threadId };
    case "schedule":
      return { kind: "schedule", topicKey, threadId };
    case "financials":
      return { kind: "financials", topicKey, threadId };
    case "health":
      return { kind: "health", topicKey, threadId };
    default:
      return { kind: "unknown", threadId };
  }
}

/** Invalidate cache for a given chatId:threadId (use if topic is deleted/recreated). */
export function invalidateTopicCache(chatId: string, threadId: number): void {
  cache.delete(`${chatId}:${threadId}`);
}
