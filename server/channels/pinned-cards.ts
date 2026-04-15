/**
 * pinned-cards.ts
 *
 * Maintains a live pinned KR-progress card in each venture's Telegram topic.
 * Called fire-and-forget after any KR progress update.
 *
 * Throttle: one Bot API edit per venture per 60 seconds max,
 * so rapid-fire progress updates don't hit rate limits.
 */

import { logger } from "../logger";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// In-memory state: ventureId → pinned message ID in its topic
const pinnedMessageIds = new Map<string, number>();

// Throttle: ventureId → timestamp of last edit
const lastEditAt = new Map<string, number>();
const THROTTLE_MS = 60_000;

// Pending timeout handles for coalescing bursts
const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

async function tgPost(method: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${TG_API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

/** Build the card text for a venture's KR progress. */
async function buildCardText(ventureId: string): Promise<string | null> {
  try {
    const { storage } = await import("../storage");
    const venture = await (storage as any).getVenture(ventureId);
    if (!venture) return null;

    const goals = await (storage as any).getVentureGoals(ventureId);
    const activeGoal = goals?.find((g: any) => g.status === "active");
    if (!activeGoal) return null;

    const krs = await (storage as any).getKeyResults(activeGoal.id);
    if (!krs?.length) return null;

    const krLines = krs.map((kr: any) => {
      const pct = kr.targetValue > 0
        ? Math.round((kr.currentValue / kr.targetValue) * 100)
        : 0;
      const bar = buildBar(pct);
      const statusEmoji = { on_track: "✅", at_risk: "⚠️", behind: "🔴", completed: "🏁" }[kr.status as string] ?? "⬜";
      return `${statusEmoji} <b>${kr.title}</b>\n${bar} ${kr.currentValue}/${kr.targetValue} ${kr.unit ?? ""}`;
    });

    return [
      `📊 <b>${venture.name} — KR Progress</b>`,
      `<i>${activeGoal.targetStatement}</i>`,
      "",
      ...krLines,
      "",
      `<i>Updated: ${new Date().toLocaleString("en-AE", { timeZone: "Asia/Dubai" })}</i>`,
    ].join("\n");
  } catch (err) {
    logger.warn({ err, ventureId }, "[pinned-cards] Failed to build card text");
    return null;
  }
}

function buildBar(pct: number): string {
  const filled = Math.round(pct / 10);
  return "█".repeat(filled) + "░".repeat(10 - filled) + ` ${pct}%`;
}

/** Resolve the Telegram topic thread ID for a venture. */
async function getVentureThreadId(ventureId: string): Promise<{ chatId: string; threadId: number } | null> {
  try {
    const { telegramTopicMap } = await import("@shared/schema");
    const { and, eq, like } = await import("drizzle-orm");
    const { storage } = await import("../storage");
    const db = (storage as any).db;

    const rows = await db
      .select({ chatId: telegramTopicMap.chatId, threadId: telegramTopicMap.threadId })
      .from(telegramTopicMap)
      .where(
        and(
          eq(telegramTopicMap.ventureId, ventureId),
          eq(telegramTopicMap.active, true)
        )
      )
      .limit(1);

    if (!rows?.[0]) return null;
    return { chatId: rows[0].chatId as string, threadId: rows[0].threadId as number };
  } catch (err) {
    logger.warn({ err, ventureId }, "[pinned-cards] Failed to resolve topic thread ID");
    return null;
  }
}

async function doUpsert(ventureId: string): Promise<void> {
  if (!BOT_TOKEN) return;

  const topic = await getVentureThreadId(ventureId);
  if (!topic) return;

  const text = await buildCardText(ventureId);
  if (!text) return;

  const existingMsgId = pinnedMessageIds.get(ventureId);

  if (existingMsgId) {
    // Try to edit the existing pinned message
    const editResult = await tgPost("editMessageText", {
      chat_id: topic.chatId,
      message_id: existingMsgId,
      text,
      parse_mode: "HTML",
    });

    if (editResult.ok) {
      lastEditAt.set(ventureId, Date.now());
      return;
    }
    // If edit failed (message deleted etc.), fall through to send a new one
    pinnedMessageIds.delete(ventureId);
  }

  // Send a new message in the topic and pin it
  const sendResult = await tgPost("sendMessage", {
    chat_id: topic.chatId,
    message_thread_id: topic.threadId,
    text,
    parse_mode: "HTML",
  });

  if (!sendResult.ok || !sendResult.result?.message_id) {
    logger.warn({ sendResult, ventureId }, "[pinned-cards] Failed to send KR card");
    return;
  }

  const newMsgId: number = sendResult.result.message_id;
  pinnedMessageIds.set(ventureId, newMsgId);
  lastEditAt.set(ventureId, Date.now());

  // Pin it (non-fatal — bot needs admin)
  await tgPost("pinChatMessage", {
    chat_id: topic.chatId,
    message_id: newMsgId,
    disable_notification: true,
  }).catch(() => {});
}

/**
 * Fire-and-forget: update the venture's pinned KR card with throttling + coalescing.
 * Safe to call after every KR progress update.
 */
export function upsertVenturePinnedCard(ventureId: string): void {
  if (!BOT_TOKEN) return;

  const now = Date.now();
  const last = lastEditAt.get(ventureId) ?? 0;
  const remaining = THROTTLE_MS - (now - last);

  // Clear any pending coalesced timer
  const existing = pendingTimers.get(ventureId);
  if (existing) clearTimeout(existing);

  if (remaining <= 0) {
    // Enough time has passed — run immediately
    doUpsert(ventureId).catch((err) =>
      logger.warn({ err, ventureId }, "[pinned-cards] upsert error")
    );
  } else {
    // Schedule after throttle window — coalesces rapid-fire updates
    const timer = setTimeout(() => {
      pendingTimers.delete(ventureId);
      doUpsert(ventureId).catch((err) =>
        logger.warn({ err, ventureId }, "[pinned-cards] deferred upsert error")
      );
    }, remaining);
    pendingTimers.set(ventureId, timer);
  }
}
