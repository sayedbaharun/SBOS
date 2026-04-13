/**
 * Outbound Message Queue Processor — Project Ironclad Phase 1
 *
 * Background processor that dequeues pending messages and sends them
 * via channel adapters with retry logic:
 *   Attempt 1: immediate
 *   Attempt 2: +30s
 *   Attempt 3: +2min
 *   Attempt 4 (final): +10min
 *
 * Messages expire after 2 hours.
 * Runs on a 30-second interval.
 */

import { logger } from "../logger";

// Retry delays in ms: 30s, 2min, 10min
const RETRY_DELAYS = [30_000, 120_000, 600_000];
const PROCESS_INTERVAL_MS = 30_000;
const EXPIRE_INTERVAL_MS = 300_000; // 5min
const BATCH_SIZE = 20;

let processTimer: ReturnType<typeof setInterval> | null = null;
let expireTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Process pending messages from the queue.
 */
async function processQueue(): Promise<void> {
  try {
    const { storage } = await import("../storage");
    const messages = await storage.dequeueMessages(BATCH_SIZE);

    if (messages.length === 0) return;

    logger.debug({ count: messages.length }, "Processing outbound message queue");

    // Lazy import to avoid circular deps
    const { sendProactiveMessageDirect } = await import("../channels/channel-manager");

    for (const msg of messages) {
      try {
        await sendProactiveMessageDirect(msg.platform, msg.chatId, msg.text, msg.parseMode || "html", msg.threadId ?? undefined);
        await storage.markMessageSent(msg.id);
        logger.debug({ id: msg.id, platform: msg.platform }, "Queued message sent");
      } catch (error: any) {
        const attempt = (msg.attempts || 0);
        const delayMs = RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)];
        const nextAttemptAt = new Date(Date.now() + delayMs);

        await storage.markMessageFailed(msg.id, error.message, nextAttemptAt);

        const isFinal = attempt + 1 >= msg.maxAttempts;
        if (isFinal) {
          logger.error(
            { id: msg.id, platform: msg.platform, attempts: attempt + 1, error: error.message },
            "Queued message permanently failed"
          );
        } else {
          logger.warn(
            { id: msg.id, platform: msg.platform, attempt: attempt + 1, nextAttemptAt: nextAttemptAt.toISOString() },
            "Queued message failed, will retry"
          );
        }
      }
    }
  } catch (error: any) {
    logger.error({ error: error.message }, "Message queue processor error");
  }
}

/**
 * Expire stale messages older than 2 hours.
 */
async function expireStale(): Promise<void> {
  try {
    const { storage } = await import("../storage");
    const expired = await storage.expireStaleMessages(2);
    if (expired > 0) {
      logger.info({ expired }, "Expired stale outbound messages");
    }
  } catch (error: any) {
    logger.error({ error: error.message }, "Message queue expire error");
  }
}

/**
 * Start the message queue processor.
 * Call once at server startup.
 */
export function startMessageQueueProcessor(): void {
  if (processTimer) return;

  processTimer = setInterval(processQueue, PROCESS_INTERVAL_MS);
  expireTimer = setInterval(expireStale, EXPIRE_INTERVAL_MS);

  // Run once immediately
  processQueue();

  logger.info(
    { intervalMs: PROCESS_INTERVAL_MS },
    "Outbound message queue processor started"
  );
}

/**
 * Stop the message queue processor.
 */
export function stopMessageQueueProcessor(): void {
  if (processTimer) {
    clearInterval(processTimer);
    processTimer = null;
  }
  if (expireTimer) {
    clearInterval(expireTimer);
    expireTimer = null;
  }
  logger.info("Outbound message queue processor stopped");
}
