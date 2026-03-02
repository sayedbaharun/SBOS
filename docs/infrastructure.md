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

### Guidance (added 2026-03-02)

Each detector now includes a `guidance` field with structured explanations:

```typescript
guidance?: {
  explanation: string;    // Why this pattern is harmful
  suggestion: string;     // What the agent should do instead
  pattern_detected: string; // Detector name
}
```

| Detector | Explanation | Suggestion |
|----------|-------------|------------|
| `generic_repeat` | Same tool with identical args — no new information | Try a different approach or answer with what you have |
| `poll_no_progress` | Resource returning unchanged results | Use the data you already have |
| `ping_pong` | Two tools alternating without convergence | Synthesize what you know from both tools |

Guidance is injected into agent system messages at both `critical` and `circuit_breaker` severity levels:
```
[SYSTEM] Tool loop detected: {message}
Explanation: {guidance.explanation}
Suggestion: {guidance.suggestion}
```

At circuit breaker severity (7 repetitions), the system also forces a final response with no tools.

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

## Proactive Intelligence Engine (added 2026-03-02)

Cross-domain intelligence and event-driven automation. See also: [API Reference — Intelligence](api-reference.md#intelligence-10-endpoints).

### Daily Intelligence Synthesizer

**File**: `server/agents/intelligence-synthesizer.ts`

Runs at 8:45am Dubai via CoS schedule. Gathers 5 data sources in parallel:
1. Today's calendar events (Google Calendar)
2. Active/overdue tasks (storage)
3. Unread emails (Gmail)
4. Life context (health, nutrition, outcomes)
5. Yesterday's agent memory outcomes

Then detects conflicts:
- Calendar event overlaps
- P0 tasks with no calendar time blocked
- Overdue tasks
- Meeting-heavy days (>4 meetings)

Sends all data to GPT-4o-mini for synthesis → `daily_intelligence` table + Telegram + injected into morning briefing context.

### Email Triage

**File**: `server/agents/email-triage.ts`

Runs 3x/day (8am, 1pm, 6pm). Fetches unread via `gmail.ts`, batch-classifies via GPT-4o-mini with JSON response format. Classifications: `urgent`, `action_needed`, `informational`, `spam`, `delegatable`. Stores to `email_triage` table. Sends Telegram digest with counts per classification.

### Meeting Prep

**File**: `server/agents/meeting-prep.ts`

Runs every 15 minutes. For meetings with external attendees starting within 30 minutes:
1. Pulls event details from Google Calendar
2. Searches CRM (`people` table) for attendee matches
3. Searches vector memory (hybrid search) for prior mentions
4. Generates 3-5 bullet prep brief via GPT-4o-mini
5. Sends via Telegram, stores in `meeting_preps` table

### Proactive Event Triggers

**File**: `server/agents/proactive-triggers.ts`

Event-driven agent wiring with typed event system:

| Event | Trigger | Action |
|-------|---------|--------|
| `urgent_email_received` | Email classified as urgent | CoS agent assessment |
| `deadline_approaching` | Task due within 24h | Grouped alerts by venture |
| `calendar_conflict_detected` | Overlapping events | Telegram notification |
| `meeting_in_30min` | Meeting starting soon | Meeting prep agent |
| `cross_agent_flag` | Agent discovers cross-domain info | Broadcast via message bus |
