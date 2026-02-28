/**
 * Universal backoff primitive — used across all retry logic.
 * Inspired by OpenClaw's battle-tested backoff utility.
 */

export interface BackoffPolicy {
  /** Initial delay in ms (default: 1000) */
  initialMs: number;
  /** Maximum delay in ms (default: 30000) */
  maxMs: number;
  /** Exponential factor (default: 2) */
  factor: number;
  /** Jitter factor 0-1 — randomizes delay to prevent thundering herd (default: 0.25) */
  jitter: number;
}

export const DEFAULT_BACKOFF: BackoffPolicy = {
  initialMs: 1000,
  maxMs: 30000,
  factor: 2,
  jitter: 0.25,
};

/** Telegram-specific: faster initial, slower max, gentler curve */
export const TELEGRAM_BACKOFF: BackoffPolicy = {
  initialMs: 2000,
  maxMs: 30000,
  factor: 1.8,
  jitter: 0.25,
};

/** Aggressive retry for transient network blips */
export const FAST_BACKOFF: BackoffPolicy = {
  initialMs: 500,
  maxMs: 5000,
  factor: 1.5,
  jitter: 0.1,
};

/**
 * Compute the delay for a given attempt using exponential backoff + jitter.
 * @param policy - Backoff configuration
 * @param attempt - Zero-based attempt number
 * @returns Delay in milliseconds
 */
export function computeBackoff(policy: BackoffPolicy, attempt: number): number {
  const base = Math.min(
    policy.initialMs * Math.pow(policy.factor, attempt),
    policy.maxMs
  );
  // Apply jitter: delay = base * (1 - jitter + random * 2 * jitter)
  const jitterRange = base * policy.jitter;
  const delay = base - jitterRange + Math.random() * 2 * jitterRange;
  return Math.max(0, Math.round(delay));
}

/**
 * Sleep that can be cancelled via AbortSignal.
 * @param ms - Duration in milliseconds
 * @param signal - Optional AbortSignal to cancel the sleep early
 * @returns Promise that resolves after the delay or rejects on abort
 */
export function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    const timer = setTimeout(resolve, ms);

    if (signal) {
      const onAbort = () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      // Clean up listener when timer fires
      const originalResolve = resolve;
      resolve = () => {
        signal.removeEventListener("abort", onAbort);
        originalResolve();
      };
    }
  });
}

/**
 * Retry a function with configurable backoff policy.
 * Replaces the old retryWithBackoff from retry-utils.ts with a more robust version.
 *
 * @param fn - Async function to retry
 * @param options - Retry configuration
 * @returns Result of the successful call
 */
export async function retryWithPolicy<T>(
  fn: () => Promise<T>,
  options: {
    policy?: BackoffPolicy;
    maxAttempts?: number;
    shouldRetry?: (error: unknown, attempt: number) => boolean;
    onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
    signal?: AbortSignal;
  } = {}
): Promise<T> {
  const {
    policy = DEFAULT_BACKOFF,
    maxAttempts = 4,
    shouldRetry = () => true,
    onRetry,
    signal,
  } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === maxAttempts - 1 || !shouldRetry(error, attempt)) {
        throw error;
      }

      const delay = computeBackoff(policy, attempt);
      onRetry?.(error, attempt, delay);

      await sleepWithAbort(delay, signal);
    }
  }

  throw lastError;
}
