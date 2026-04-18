/**
 * Telegram Topic Map Configuration
 *
 * Defines the topics to create in the SB-OS supergroup and which event types
 * route to each topic. Used by the provisioning script and topic-router.
 *
 * Prerequisite: Supergroup must have "Topics" enabled in Telegram settings.
 * Run: npx tsx server/scripts/provision-telegram-topics.ts
 */

// Telegram forum topic icon color integers (from Bot API docs)
export const TOPIC_COLORS = {
  BLUE:   7322096,   // #6FB9F0
  YELLOW: 16766590,  // #FFD67E
  PURPLE: 13338331,  // #CB86DB
  GREEN:  9367192,   // #8EEE98
  PINK:   16749490,  // #FF93B2
  RED:    16478047,  // #FB6F5F
} as const;

export interface TopicDefinition {
  /** Stable, unique key for this topic. Used in DB and as idempotency key. */
  topicKey: string;
  /** Display name in Telegram */
  name: string;
  /** Icon color from TOPIC_COLORS */
  iconColor: number;
  /** Event types (publishEvent eventType strings) that route messages here */
  eventTypes: string[];
  /**
   * If set, only events with a matching venture slug in the payload route here.
   * Used for per-venture topics. The slug is resolved to ventureId at provision time.
   */
  ventureSlug?: string;
}

export const TELEGRAM_TOPICS: TopicDefinition[] = [
  // ── Critical cluster ─────────────────────────────────────────────────────
  {
    topicKey: "on-fire",
    name: "🔥 On Fire",
    iconColor: TOPIC_COLORS.RED,
    eventTypes: ["kr.at_risk", "deliverable.rejected", "audit.security.failed", "audit.security.completed"],
  },
  {
    topicKey: "review-queue",
    name: "✅ Review Queue",
    iconColor: TOPIC_COLORS.GREEN,
    eventTypes: ["deliverable.needs_review", "deliverable.submitted"],
  },
  {
    topicKey: "morning-loop",
    name: "☀️ Morning Loop",
    iconColor: TOPIC_COLORS.YELLOW,
    eventTypes: [
      "brief.morning.ready",
      "morning.loop.completed",
      "proactive.morning.summary",
    ],
  },
  // ── Venture cluster ──────────────────────────────────────────────────────
  {
    topicKey: "venture:syntheliq",
    name: "💼 SyntheLIQ",
    iconColor: TOPIC_COLORS.BLUE,
    eventTypes: ["venture.update", "venture.task.completed", "venture.kr.updated"],
    ventureSlug: "syntheliq",
  },
  // ── Operational cluster ──────────────────────────────────────────────────
  {
    topicKey: "inbox",
    name: "📥 Inbox",
    iconColor: TOPIC_COLORS.YELLOW,
    eventTypes: ["capture.created", "inbox.new"],
  },
  {
    topicKey: "agents",
    name: "🤖 Agents",
    iconColor: TOPIC_COLORS.BLUE,
    eventTypes: [
      "task.delegated",
      "task.completed",
      "agent.task.started",
      "agent.task.failed",
    ],
  },
  {
    topicKey: "schedule",
    name: "📅 Schedule",
    iconColor: TOPIC_COLORS.GREEN,
    eventTypes: ["calendar.event.starting", "calendar.event.created", "meeting.reminder"],
  },
  // ── Ambient cluster ──────────────────────────────────────────────────────
  {
    topicKey: "financials",
    name: "💰 Financials",
    iconColor: TOPIC_COLORS.GREEN,
    eventTypes: ["financials.daily_summary", "financials.alert"],
  },
  {
    topicKey: "health",
    name: "🏋️ Health",
    iconColor: TOPIC_COLORS.PINK,
    eventTypes: ["health.whoop_sync", "health.daily_summary", "mantra.morning"],
  },
  // ── Evening review ────────────────────────────────────────────────────────
  {
    topicKey: "evening-review",
    name: "🌙 Evening Review",
    iconColor: TOPIC_COLORS.PURPLE,
    eventTypes: ["brief.evening.ready", "evening.review.completed"],
  },
  // ── Content publishing ────────────────────────────────────────────────────
  {
    topicKey: "content",
    name: "📣 Content",
    iconColor: TOPIC_COLORS.PINK,
    eventTypes: [
      "content.pending_review",
      "content.published",
      "content.failed",
      "content.scheduled",
    ],
  },
];
