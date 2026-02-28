/**
 * Recoverable network error classifier.
 * Comprehensive error classification adapted from OpenClaw's production patterns.
 * Walks the full error chain (.cause, .reason, .errors[]) for deep classification.
 */

/** Known recoverable POSIX/Node.js error codes */
const RECOVERABLE_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "EPIPE",
  "ETIMEDOUT",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ERR_SOCKET_CONNECTION_TIMEOUT",
]);

/** Undici-specific error codes (Node.js built-in fetch) */
const UNDICI_RECOVERABLE_CODES = new Set([
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_REQ_RETRY",
]);

/** HTTP status codes that are transient and retryable */
const RETRYABLE_HTTP_STATUSES = new Set([
  408, // Request Timeout
  429, // Too Many Requests
  500, // Internal Server Error
  502, // Bad Gateway
  503, // Service Unavailable
  504, // Gateway Timeout
  520, // Cloudflare: Web Server Returned Unknown Error
  521, // Cloudflare: Web Server Is Down
  522, // Cloudflare: Connection Timed Out
  523, // Cloudflare: Origin Is Unreachable
  524, // Cloudflare: A Timeout Occurred
]);

/** Message patterns that indicate transient failures */
const RECOVERABLE_MESSAGE_PATTERNS = [
  /timed?\s*out/i,
  /network/i,
  /ECONNREFUSED/i,
  /socket hang up/i,
  /fetch failed/i,
  /request.*abort/i,
  /connection.*closed/i,
  /broken pipe/i,
  /read ECONNRESET/i,
  /getaddrinfo/i,
  /Too Many Requests/i,
  /Service Unavailable/i,
  /Bad Gateway/i,
  /Gateway Timeout/i,
];

/** Telegraf-specific error patterns */
const TELEGRAF_RECOVERABLE_PATTERNS = [
  /409.*Conflict.*terminated by other getUpdates/i,
  /409.*Conflict.*webhook/i,
  /ETELEGRAM.*restart/i,
  /polling.*error/i,
];

export type ErrorClassification = {
  /** Whether this error is recoverable (should retry) */
  recoverable: boolean;
  /** Human-readable reason for the classification */
  reason: string;
  /** The specific code or pattern that matched, if any */
  matchedCode?: string;
  /** HTTP status if applicable */
  httpStatus?: number;
  /** Whether this is a Telegram-specific error */
  isTelegram?: boolean;
};

/**
 * Classify an error as recoverable or permanent.
 * Walks the full error chain to find any recoverable indicator.
 */
export function classifyError(error: unknown): ErrorClassification {
  const visited = new WeakSet<object>();
  return walkErrorChain(error, visited);
}

/**
 * Simple boolean check — is this error worth retrying?
 */
export function isRecoverableError(error: unknown): boolean {
  return classifyError(error).recoverable;
}

/**
 * Check if an error is specifically a Telegram API error.
 */
export function isTelegramError(error: unknown): boolean {
  const classification = classifyError(error);
  return classification.isTelegram === true;
}

/**
 * Check if an error indicates a 401 Unauthorized (critical for circuit breaker).
 */
export function is401Error(error: unknown): boolean {
  const err = error as any;
  return (
    err?.response?.status === 401 ||
    err?.status === 401 ||
    err?.statusCode === 401 ||
    err?.code === 401 ||
    /401.*Unauthorized/i.test(String(err?.message || ""))
  );
}

/**
 * Check if an error indicates a 409 Conflict (Telegram polling conflict).
 */
export function is409Conflict(error: unknown): boolean {
  const err = error as any;
  return (
    (err?.response?.status === 409 || err?.status === 409 || err?.code === 409) &&
    /conflict/i.test(String(err?.message || err?.description || ""))
  );
}

function walkErrorChain(error: unknown, visited: WeakSet<object>): ErrorClassification {
  if (error == null) {
    return { recoverable: false, reason: "null/undefined error" };
  }

  // Prevent infinite loops in circular error chains
  if (typeof error === "object" && visited.has(error)) {
    return { recoverable: false, reason: "circular error chain" };
  }
  if (typeof error === "object" && error !== null) {
    visited.add(error);
  }

  const err = error as any;

  // Check error code (POSIX / Node.js)
  if (err.code && typeof err.code === "string") {
    if (RECOVERABLE_CODES.has(err.code)) {
      return { recoverable: true, reason: `POSIX error code: ${err.code}`, matchedCode: err.code };
    }
    if (UNDICI_RECOVERABLE_CODES.has(err.code)) {
      return { recoverable: true, reason: `Undici error: ${err.code}`, matchedCode: err.code };
    }
  }

  // Check HTTP status
  const status = err.response?.status || err.status || err.statusCode;
  if (typeof status === "number") {
    if (RETRYABLE_HTTP_STATUSES.has(status)) {
      return {
        recoverable: true,
        reason: `HTTP ${status}`,
        httpStatus: status,
        matchedCode: `HTTP_${status}`,
      };
    }
    // 401 is NOT recoverable (permanent auth failure)
    if (status === 401) {
      return { recoverable: false, reason: "HTTP 401 Unauthorized", httpStatus: 401 };
    }
    // 403 is NOT recoverable
    if (status === 403) {
      return { recoverable: false, reason: "HTTP 403 Forbidden", httpStatus: 403 };
    }
  }

  // Check message patterns
  const message = String(err.message || err.description || "");

  // Telegraf-specific patterns
  for (const pattern of TELEGRAF_RECOVERABLE_PATTERNS) {
    if (pattern.test(message)) {
      return {
        recoverable: true,
        reason: `Telegraf pattern: ${pattern.source}`,
        matchedCode: "TELEGRAF",
        isTelegram: true,
      };
    }
  }

  // General recoverable patterns
  for (const pattern of RECOVERABLE_MESSAGE_PATTERNS) {
    if (pattern.test(message)) {
      return {
        recoverable: true,
        reason: `Message pattern: ${pattern.source}`,
        matchedCode: pattern.source,
      };
    }
  }

  // Walk .cause chain
  if (err.cause) {
    const causeResult = walkErrorChain(err.cause, visited);
    if (causeResult.recoverable) {
      return { ...causeResult, reason: `via .cause: ${causeResult.reason}` };
    }
  }

  // Walk .reason (some promise libraries)
  if (err.reason) {
    const reasonResult = walkErrorChain(err.reason, visited);
    if (reasonResult.recoverable) {
      return { ...reasonResult, reason: `via .reason: ${reasonResult.reason}` };
    }
  }

  // Walk .errors[] (AggregateError)
  if (Array.isArray(err.errors)) {
    for (const subError of err.errors) {
      const subResult = walkErrorChain(subError, visited);
      if (subResult.recoverable) {
        return { ...subResult, reason: `via .errors[]: ${subResult.reason}` };
      }
    }
  }

  return { recoverable: false, reason: `Unclassified error: ${message.slice(0, 100)}` };
}
