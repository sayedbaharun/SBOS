/**
 * Circuit breaker for Telegram sendChatAction (typing indicators).
 *
 * Prevents Telegram from deleting the bot by tracking consecutive 401 errors
 * on sendChatAction calls. Exponential backoff from 1s to 5min, and after
 * 10 consecutive 401s, suspends ALL typing indicators until manual reset.
 *
 * Why this matters: Telegram will delete bots that keep sending requests
 * with invalid tokens. Typing indicators are the most common source of
 * these repeated invalid requests.
 */

import { computeBackoff, type BackoffPolicy } from "./backoff";
import { logger } from "../logger";

const TYPING_BACKOFF: BackoffPolicy = {
  initialMs: 1000,
  maxMs: 300_000, // 5 minutes
  factor: 2,
  jitter: 0.1,
};

/** After this many consecutive 401s, suspend all typing indicators */
const SUSPEND_THRESHOLD = 10;

export class ChatActionCircuitBreaker {
  private consecutive401s = 0;
  private suspended = false;
  private lastFailureAt: number | null = null;
  private backoffUntil = 0;

  /**
   * Check if typing indicators should be sent.
   * Returns false if circuit is open (too many 401s or in backoff).
   */
  canSend(): boolean {
    if (this.suspended) return false;
    if (Date.now() < this.backoffUntil) return false;
    return true;
  }

  /**
   * Record a successful sendChatAction. Resets the failure counter.
   */
  recordSuccess(): void {
    this.consecutive401s = 0;
    this.backoffUntil = 0;
  }

  /**
   * Record a 401 error from sendChatAction.
   * Triggers backoff and eventually suspension.
   */
  record401(): void {
    this.consecutive401s++;
    this.lastFailureAt = Date.now();

    if (this.consecutive401s >= SUSPEND_THRESHOLD) {
      this.suspended = true;
      logger.error(
        { consecutive401s: this.consecutive401s },
        "ChatAction circuit breaker SUSPENDED — too many 401 errors. " +
        "Typing indicators disabled to prevent bot deletion. " +
        "Check TELEGRAM_BOT_TOKEN validity."
      );
      return;
    }

    // Apply exponential backoff
    const delay = computeBackoff(TYPING_BACKOFF, this.consecutive401s - 1);
    this.backoffUntil = Date.now() + delay;

    logger.warn(
      {
        consecutive401s: this.consecutive401s,
        backoffMs: delay,
        threshold: SUSPEND_THRESHOLD,
      },
      "ChatAction 401 — backing off"
    );
  }

  /**
   * Record a non-401 error (network issue, etc). Does NOT count toward suspension.
   */
  recordOtherError(): void {
    // Non-401 errors don't count toward the circuit breaker.
    // The token is fine; it's just a transient issue.
  }

  /**
   * Manually reset the circuit breaker (e.g., after token rotation).
   */
  reset(): void {
    this.consecutive401s = 0;
    this.suspended = false;
    this.backoffUntil = 0;
    this.lastFailureAt = null;
    logger.info("ChatAction circuit breaker reset");
  }

  /** Get current state for health monitoring */
  getState(): {
    consecutive401s: number;
    suspended: boolean;
    lastFailureAt: number | null;
    backoffUntil: number;
    canSend: boolean;
  } {
    return {
      consecutive401s: this.consecutive401s,
      suspended: this.suspended,
      lastFailureAt: this.lastFailureAt,
      backoffUntil: this.backoffUntil,
      canSend: this.canSend(),
    };
  }
}

/** Singleton instance */
export const chatActionBreaker = new ChatActionCircuitBreaker();

/**
 * Safe wrapper for sendChatAction that respects the circuit breaker.
 * Use this instead of calling ctx.telegram.sendChatAction directly.
 */
export async function safeSendChatAction(
  telegram: { sendChatAction: (chatId: string | number, action: string) => Promise<boolean> },
  chatId: string | number,
  action: string = "typing"
): Promise<boolean> {
  if (!chatActionBreaker.canSend()) {
    return false;
  }

  try {
    await telegram.sendChatAction(chatId, action);
    chatActionBreaker.recordSuccess();
    return true;
  } catch (error: any) {
    const status =
      error?.response?.status ||
      error?.status ||
      error?.code;

    if (status === 401 || /401.*Unauthorized/i.test(String(error?.message || ""))) {
      chatActionBreaker.record401();
    } else {
      chatActionBreaker.recordOtherError();
    }
    return false;
  }
}
