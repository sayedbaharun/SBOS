/**
 * Telegram Connection Resilience Layer
 *
 * Multi-layer restart loop for Telegraf polling mode:
 * 1. Inner: Telegraf's built-in error handling with our error classifier
 * 2. Middle: Outer monitor loop that restarts Telegraf with exponential backoff (2s→30s)
 * 3. Outer: Channel health watchdog — checks every 5 min, rate-limited restarts (3/hour)
 *
 * For webhook mode, this provides health monitoring and auto-re-registration.
 *
 * Also configures DNS/IPv6 tuning for Node 22+.
 */

import { logger } from "../logger";
import {
  computeBackoff,
  sleepWithAbort,
  TELEGRAM_BACKOFF,
  type BackoffPolicy,
} from "./backoff";
import { classifyError, isRecoverableError, is409Conflict } from "./network-errors";

// ============================================================================
// DNS / NETWORK TUNING
// ============================================================================

/**
 * Apply network tuning for better connection stability.
 * Call once at startup, before creating any Telegraf instances.
 */
export function applyNetworkTuning(): void {
  // Node 22+ supports dns result ordering preference
  try {
    const dns = require("dns");
    if (typeof dns.setDefaultResultOrder === "function") {
      dns.setDefaultResultOrder("ipv4first");
      logger.info("DNS result order set to ipv4first");
    }
  } catch {
    // dns module may not be available in some environments
  }
}

// ============================================================================
// POLLING RESILIENCE (for dev/non-webhook mode)
// ============================================================================

export interface PollingResilienceOptions {
  /** Function to call to start/restart the bot */
  startBot: () => Promise<void>;
  /** Function to call to stop the bot */
  stopBot: () => Promise<void>;
  /** Function to check if bot is connected */
  isConnected: () => boolean;
  /** Backoff policy for restart attempts */
  backoff?: BackoffPolicy;
  /** Maximum consecutive restart attempts before giving up (0 = never give up) */
  maxConsecutiveRestarts?: number;
  /** Abort signal to stop the resilience loop */
  signal?: AbortSignal;
}

/**
 * Wraps a Telegraf bot's polling mode with automatic restart on failure.
 * Uses exponential backoff between restart attempts.
 */
export async function runWithPollingResilience(
  options: PollingResilienceOptions
): Promise<void> {
  const {
    startBot,
    stopBot,
    isConnected,
    backoff = TELEGRAM_BACKOFF,
    maxConsecutiveRestarts = 10,
    signal,
  } = options;

  let consecutiveFailures = 0;

  while (!signal?.aborted) {
    try {
      logger.info(
        { attempt: consecutiveFailures + 1 },
        "Starting Telegram polling..."
      );

      await startBot();
      // If we get here, bot started successfully
      consecutiveFailures = 0;

      // Wait until the bot disconnects or we're signalled to stop
      while (isConnected() && !signal?.aborted) {
        await sleepWithAbort(5000, signal).catch(() => {});
      }

      if (signal?.aborted) break;

      // Bot disconnected — will restart
      logger.warn("Telegram bot disconnected, will attempt restart");
    } catch (error: unknown) {
      consecutiveFailures++;
      const classification = classifyError(error);

      logger.error(
        {
          error: (error as Error)?.message,
          recoverable: classification.recoverable,
          reason: classification.reason,
          attempt: consecutiveFailures,
        },
        "Telegram polling error"
      );

      // Stop the bot gracefully before restart
      try {
        await stopBot();
      } catch {
        // Ignore stop errors
      }

      // 409 Conflict = another instance is polling. Back off longer.
      if (is409Conflict(error)) {
        logger.warn(
          "409 Conflict: another getUpdates instance detected. Waiting 60s before retry."
        );
        await sleepWithAbort(60_000, signal).catch(() => {});
        continue;
      }

      if (!classification.recoverable) {
        logger.error(
          { reason: classification.reason },
          "Non-recoverable Telegram error — stopping resilience loop"
        );
        break;
      }

      if (
        maxConsecutiveRestarts > 0 &&
        consecutiveFailures >= maxConsecutiveRestarts
      ) {
        logger.error(
          { attempts: consecutiveFailures },
          "Max consecutive restart attempts reached — stopping resilience loop"
        );
        break;
      }
    }

    // Backoff before next restart
    const delay = computeBackoff(backoff, consecutiveFailures);
    logger.info(
      { delayMs: delay, attempt: consecutiveFailures },
      "Waiting before Telegram restart..."
    );
    await sleepWithAbort(delay, signal).catch(() => {});
  }
}

// ============================================================================
// WEBHOOK HEALTH MONITOR
// ============================================================================

export interface WebhookHealthOptions {
  /** Telegram bot token */
  botToken: string;
  /** Expected webhook URL */
  expectedWebhookUrl: string;
  /** Webhook secret for validation */
  webhookSecret?: string;
  /** Check interval in ms (default: 5 minutes) */
  checkIntervalMs?: number;
  /** Abort signal to stop monitoring */
  signal?: AbortSignal;
}

/**
 * Periodically verifies the webhook is still registered with Telegram.
 * Auto-re-registers if the webhook was dropped.
 */
export async function monitorWebhookHealth(
  options: WebhookHealthOptions
): Promise<void> {
  const {
    botToken,
    expectedWebhookUrl,
    webhookSecret,
    checkIntervalMs = 5 * 60 * 1000,
    signal,
  } = options;

  // Grace period: wait 1 minute before first check
  await sleepWithAbort(60_000, signal).catch(() => {});

  while (!signal?.aborted) {
    try {
      const info = await getWebhookInfo(botToken);

      if (info.url !== expectedWebhookUrl) {
        logger.warn(
          { expected: expectedWebhookUrl, actual: info.url },
          "Webhook URL mismatch — re-registering"
        );
        await setWebhook(botToken, expectedWebhookUrl, webhookSecret);
        logger.info("Webhook re-registered successfully");
      } else if (info.has_custom_certificate === false && info.last_error_date) {
        const errorAge = Date.now() / 1000 - info.last_error_date;
        if (errorAge < checkIntervalMs / 1000) {
          logger.warn(
            {
              lastError: info.last_error_message,
              errorAge: Math.round(errorAge),
            },
            "Recent webhook delivery error detected"
          );
        }
      }
    } catch (error: any) {
      logger.error(
        { error: error.message },
        "Failed to check webhook health"
      );
    }

    await sleepWithAbort(checkIntervalMs, signal).catch(() => {});
  }
}

async function getWebhookInfo(
  token: string
): Promise<{
  url: string;
  has_custom_certificate: boolean;
  pending_update_count: number;
  last_error_date?: number;
  last_error_message?: string;
}> {
  const res = await fetch(
    `https://api.telegram.org/bot${token}/getWebhookInfo`
  );
  const data = (await res.json()) as any;
  if (!data.ok) throw new Error(`getWebhookInfo failed: ${data.description}`);
  return data.result;
}

async function setWebhook(
  token: string,
  url: string,
  secret?: string
): Promise<void> {
  const body: Record<string, unknown> = { url };
  if (secret) body.secret_token = secret;

  const res = await fetch(
    `https://api.telegram.org/bot${token}/setWebhook`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  const data = (await res.json()) as any;
  if (!data.ok) throw new Error(`setWebhook failed: ${data.description}`);
}

// ============================================================================
// SERVICE HEALTH MONITOR (generalized watchdog)
// ============================================================================

export interface ServiceCheck {
  /** Service name for logging */
  name: string;
  /** Returns true if healthy */
  check: () => boolean | Promise<boolean>;
  /** Function to restart the service */
  restart: () => Promise<void>;
}

export interface ServiceHealthMonitorOptions {
  /** Services to monitor */
  services: ServiceCheck[];
  /** Check interval in ms (default: 5 minutes) */
  checkIntervalMs?: number;
  /** Max restarts per hour per service (default: 3) */
  maxRestartsPerHour?: number;
  /** Startup grace period in ms (default: 60s) */
  startupGraceMs?: number;
  /** Abort signal */
  signal?: AbortSignal;
}

/**
 * Generalized service health monitor.
 * Checks multiple services periodically and restarts unhealthy ones
 * with rate limiting.
 */
export async function runServiceHealthMonitor(
  options: ServiceHealthMonitorOptions
): Promise<void> {
  const {
    services,
    checkIntervalMs = 5 * 60 * 1000,
    maxRestartsPerHour = 3,
    startupGraceMs = 60_000,
    signal,
  } = options;

  // Track restart timestamps per service
  const restartHistory = new Map<string, number[]>();

  // Wait for startup grace period
  await sleepWithAbort(startupGraceMs, signal).catch(() => {});

  while (!signal?.aborted) {
    for (const service of services) {
      if (signal?.aborted) break;

      try {
        const healthy = await service.check();
        if (healthy) continue;

        // Check rate limit
        const history = restartHistory.get(service.name) || [];
        const hourAgo = Date.now() - 3600_000;
        const recentRestarts = history.filter((t) => t > hourAgo);

        if (recentRestarts.length >= maxRestartsPerHour) {
          logger.warn(
            {
              service: service.name,
              restarts: recentRestarts.length,
              maxPerHour: maxRestartsPerHour,
            },
            "Service unhealthy but restart rate limit reached"
          );
          continue;
        }

        logger.info({ service: service.name }, "Restarting unhealthy service");

        try {
          await service.restart();
          recentRestarts.push(Date.now());
          restartHistory.set(service.name, recentRestarts);
          logger.info({ service: service.name }, "Service restarted successfully");
        } catch (restartError: any) {
          logger.error(
            { service: service.name, error: restartError.message },
            "Failed to restart service"
          );
        }
      } catch (checkError: any) {
        logger.error(
          { service: service.name, error: checkError.message },
          "Service health check failed"
        );
      }
    }

    await sleepWithAbort(checkIntervalMs, signal).catch(() => {});
  }
}
