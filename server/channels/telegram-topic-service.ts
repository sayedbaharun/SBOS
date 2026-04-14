/**
 * telegram-topic-service.ts
 *
 * Shared helpers for creating and managing Telegram forum topics
 * tied to SB-OS ventures. Used by:
 *   - server/routes/ventures.ts  (auto-create on new venture)
 *   - server/scripts/provision-telegram-topics.ts  (bulk provisioning)
 *   - server/scripts/pin-critical-topics.ts  (pin critical topics)
 */

import { logger } from "../logger";

const VENTURE_EVENT_TYPES = [
  "venture.update",
  "venture.task.completed",
  "venture.kr.updated",
];

// Telegram forum icon colors (Bot API integers)
export const TOPIC_ICON_COLORS = {
  BLUE:   7322096,
  YELLOW: 16766590,
  PURPLE: 13338331,
  GREEN:  9367192,
  PINK:   16749490,
  RED:    16478047,
} as const;

// Cycling color palette for new venture topics
const VENTURE_COLORS = [
  TOPIC_ICON_COLORS.BLUE,
  TOPIC_ICON_COLORS.GREEN,
  TOPIC_ICON_COLORS.YELLOW,
  TOPIC_ICON_COLORS.PINK,
  TOPIC_ICON_COLORS.PURPLE,
];

export function ventureTopicKey(ventureName: string): string {
  return `venture:${ventureName.toLowerCase().replace(/[\s_]+/g, "-").replace(/[^a-z0-9-]/g, "")}`;
}

function pickColor(index: number): number {
  return VENTURE_COLORS[index % VENTURE_COLORS.length];
}

// ── Bot API helpers ────────────────────────────────────────────────────────────

function getTelegramConfig(): { token: string; chatId: string } | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = (process.env.AUTHORIZED_TELEGRAM_CHAT_IDS || "")
    .split(",")[0]
    ?.trim();

  if (!token || !chatId) {
    logger.warn("TELEGRAM_BOT_TOKEN or AUTHORIZED_TELEGRAM_CHAT_IDS not set — skipping topic operation");
    return null;
  }
  return { token, chatId };
}

async function tgPost(
  token: string,
  method: string,
  body: Record<string, any>
): Promise<any> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as any;
  if (!json.ok) {
    throw new Error(`Telegram API error (${method}): ${JSON.stringify(json)}`);
  }
  return json.result;
}

// ── DB helper (lazy import to avoid circular deps) ─────────────────────────────

async function getDb() {
  const { storage } = await import("../storage");
  return (storage as any).db as any;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Creates a Telegram forum topic for a venture and records it in telegram_topic_map.
 * Returns the threadId on success, null if Telegram is not configured or topic already exists.
 */
export async function createTopicForVenture(venture: {
  id: string;
  name: string;
}): Promise<number | null> {
  const cfg = getTelegramConfig();
  if (!cfg) return null;

  const { telegramTopicMap } = await import("@shared/schema");
  const { eq } = await import("drizzle-orm");
  const db = await getDb();
  const topicKey = ventureTopicKey(venture.name);

  // Idempotency guard — skip if already exists
  const existing = await db
    .select({ threadId: telegramTopicMap.threadId })
    .from(telegramTopicMap)
    .where(eq(telegramTopicMap.ventureId, venture.id))
    .limit(1);

  if (existing?.length > 0) {
    logger.info({ ventureId: venture.id, threadId: existing[0].threadId }, "Telegram topic already exists for venture");
    return existing[0].threadId as number;
  }

  // Pick a color based on current topic count
  const countRows = await db.select({ topicKey: telegramTopicMap.topicKey }).from(telegramTopicMap);
  const colorIndex = (countRows?.length ?? 0) % VENTURE_COLORS.length;
  const iconColor = pickColor(colorIndex);

  // Create forum topic via Bot API
  const result = await tgPost(cfg.token, "createForumTopic", {
    chat_id: cfg.chatId,
    name: venture.name,
    icon_color: iconColor,
  });
  const threadId = result.message_thread_id as number;

  // Persist to DB
  await db.insert(telegramTopicMap).values({
    chatId: cfg.chatId,
    topicKey,
    threadId,
    ventureId: venture.id,
    eventTypes: VENTURE_EVENT_TYPES,
    iconColor,
    active: true,
  });

  logger.info({ ventureId: venture.id, topicKey, threadId }, "Created Telegram topic for venture");
  return threadId;
}

/**
 * Pins a topic by thread ID in the supergroup.
 * Sends a silent marker message first (required — you can only pin messages, not topics directly).
 */
export async function pinTopic(threadId: number, label: string): Promise<void> {
  const cfg = getTelegramConfig();
  if (!cfg) return;

  // Send a silent marker message into the topic
  const msg = await tgPost(cfg.token, "sendMessage", {
    chat_id: cfg.chatId,
    message_thread_id: threadId,
    text: `📌 ${label}`,
    disable_notification: true,
  });

  // Pin it
  await tgPost(cfg.token, "pinChatMessage", {
    chat_id: cfg.chatId,
    message_id: msg.message_id,
    disable_notification: true,
  });
}

/**
 * Gets the existing Telegram topic row for a venture (if any).
 */
export async function getTopicForVenture(ventureId: string): Promise<{ threadId: number; topicKey: string } | null> {
  const { telegramTopicMap } = await import("@shared/schema");
  const { eq } = await import("drizzle-orm");
  const db = await getDb();

  const rows = await db
    .select({ threadId: telegramTopicMap.threadId, topicKey: telegramTopicMap.topicKey })
    .from(telegramTopicMap)
    .where(eq(telegramTopicMap.ventureId, ventureId))
    .limit(1);

  return rows?.[0] ?? null;
}
