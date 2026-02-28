/**
 * Infrastructure utilities — shared across SB-OS.
 * Barrel export for all infra modules.
 */

export {
  type BackoffPolicy,
  DEFAULT_BACKOFF,
  TELEGRAM_BACKOFF,
  FAST_BACKOFF,
  computeBackoff,
  sleepWithAbort,
  retryWithPolicy,
} from "./backoff";

export {
  type ErrorClassification,
  classifyError,
  isRecoverableError,
  isTelegramError,
  is401Error,
  is409Conflict,
} from "./network-errors";

export {
  ToolLoopDetector,
  type LoopDetectionResult,
  type LoopSeverity,
} from "./tool-loop-detector";

export {
  ChatActionCircuitBreaker,
  chatActionBreaker,
  safeSendChatAction,
} from "./chat-action-circuit-breaker";

export {
  applyNetworkTuning,
  runWithPollingResilience,
  monitorWebhookHealth,
  runServiceHealthMonitor,
  type PollingResilienceOptions,
  type WebhookHealthOptions,
  type ServiceCheck,
  type ServiceHealthMonitorOptions,
} from "./telegram-resilience";
