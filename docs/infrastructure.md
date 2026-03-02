# Infrastructure & Resilience

> Backoff policies, circuit breakers, tool loop detection, and service health monitoring.

All infrastructure code lives in `server/infra/`.

## Backoff Policies

**File**: `server/infra/backoff.ts`

Exponential backoff with ±25% jitter to prevent thundering herd.

### Pre-configured Policies

| Policy | Initial | Max | Factor | Use Case |
|--------|---------|-----|--------|----------|
| `DEFAULT_BACKOFF` | 1s | 30s | 2x | General retries |
| `TELEGRAM_BACKOFF` | 2s | 30s | 1.8x | Telegram reconnection |
| `FAST_BACKOFF` | 500ms | 5s | 2x | Transient network blips |

### Key Exports

```typescript
BackoffPolicy    // { initialMs, maxMs, factor, jitter }
computeBackoff(policy, attempt)  // → delay in ms with jitter
sleepWithAbort(ms, signal)       // → cancellable sleep (AbortSignal)
retryWithPolicy<T>(fn, options)  // → full retry loop
```

## Network Error Classification

**File**: `server/infra/network-errors.ts`

Walks the full error chain (`.cause`, `.reason`, `.errors[]`) to classify errors.

### Classification Result

```typescript
ErrorClassification {
  recoverable: boolean,
  reason: string,
  matchedCode?: string,
  httpStatus?: number,
  isTelegram?: boolean
}
```

### Recoverable vs. Permanent

| Category | Codes | Recoverable? |
|----------|-------|-------------|
| POSIX | ECONNRESET, ETIMEDOUT, ECONNREFUSED, ENOTFOUND | Yes |
| Undici | UND_ERR_CONNECT_TIMEOUT, UND_ERR_SOCKET | Yes |
| HTTP | 408, 429, 500, 502-504, 520-524 (Cloudflare) | Yes |
| HTTP | 401, 403 | No (auth failure) |
| Telegraf | 409 conflict, webhook issues | Special handling |

### Key Exports

```typescript
classifyError(error)      // → ErrorClassification
isRecoverableError(error) // → boolean
isTelegramError(error)    // → boolean
is401Error(error)         // → boolean (for circuit breaker)
is409Conflict(error)      // → Telegram polling conflict
```

## Tool Loop Detection

**File**: `server/infra/tool-loop-detector.ts`

Prevents agents from wasting tokens by calling the same tools repeatedly without progress.

### Three Detectors

| Detector | Pattern | Warning (3) | Critical (5) | Circuit Breaker (7) |
|----------|---------|-------------|---------------|---------------------|
| `generic_repeat` | Same tool+args called N times | Warn | Alert | Hard stop |
| `poll_no_progress` | Tool result identical N times | Warn | Alert | — |
| `ping_pong` | Alternating A→B→A→B pattern | Warn (3 cycles) | Alert (5 cycles) | — |

### How It Works

- SHA256 hashing of tool name+args (`callHash`) and tool name+args+result (`fullHash`)
- Sliding window of 30 calls (oldest drop off)
- Integrated into agent runtime: checked after every tool execution

### Severity Levels

| Severity | Action |
|----------|--------|
| `warning` | Log warning, continue execution |
| `critical` | Inject warning into tool result, continue |
| `circuit_breaker` | Force final response with no tools, exit loop |

At circuit breaker severity (7 repetitions), the system injects:
```
[SYSTEM] Tool loop detected. You must provide your final response now without making more tool calls.
```

## Chat Action Circuit Breaker

**File**: `server/infra/chat-action-circuit-breaker.ts`

Protects the Telegram bot from deletion by tracking consecutive 401 errors on `sendChatAction` (typing indicators).

### State Machine

- 0–10 consecutive 401s: exponential backoff (1s → 5min, factor 2)
- 10+ consecutive 401s: **suspended** (all typing indicators disabled)
- Any successful call: resets counter
- Non-401 errors: ignored (don't count)

### Key Exports

```typescript
ChatActionCircuitBreaker  // class
safeSendChatAction(telegram, chatId, action)  // wrapper
chatActionBreaker         // singleton instance
```

## Telegram Resilience

**File**: `server/infra/telegram-resilience.ts`

### Polling Auto-Restart

`runWithPollingResilience(options)`:
- Wraps polling with automatic restart on failure
- Exponential backoff between restarts (2s → 30s, factor 1.8)
- 409 Conflict handling: 60s backoff (another instance is polling)
- AbortSignal support for clean shutdown

### Webhook Health Monitor

`monitorWebhookHealth(options)`:
- Checks webhook status every 5 minutes
- Auto-re-registers webhook if dropped
- Monitors last delivery errors

### Service Health Monitor

`runServiceHealthMonitor(options)`:
- Generalized watchdog for any service
- Rate-limited restarts: 3 per hour per service
- 60s startup grace period
- Non-blocking, fire-and-forget

## DNS Tuning

`applyNetworkTuning()`:
- Sets DNS resolution to `ipv4first` for Node.js 22+ stability
- Prevents IPv6 resolution failures on networks that don't support it

## System Health Monitor

**File**: `server/agents/scheduled-jobs.ts` → `runSystemHealthCheck()`

Checks 5 subsystems (piggybacked on morning check-in + evening review):

| Check | What It Monitors | Alert Condition |
|-------|-----------------|-----------------|
| Pipeline health | Session log ingestion | No ingestion during active hours (8am-midnight Dubai) |
| Embedding errors | Embedding pipeline | >20 unprocessed logs in backlog |
| Scheduler | Cron job execution | Job errors in last 24h |
| Nudge engine | Nudge recency | Last nudge run >2 hours ago |
| Telegram | Bot connection | Connection status unhealthy |

Issues are appended to Telegram messages from morning check-in and evening review — not a standalone cron.
