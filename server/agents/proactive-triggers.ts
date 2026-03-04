/**
 * Proactive Agent Triggers — Event-Driven Agent Wiring
 *
 * Listens for cross-domain events and triggers appropriate agent responses:
 * - urgent_email_received → CoS agent assesses and decides
 * - deadline_approaching → relevant venture agent runs status check
 * - cross-agent memory sharing via message bus
 */

import { logger } from "../logger";
import { storage } from "../storage";
import { executeAgentChat } from "./agent-runtime";
import { messageBus } from "./message-bus";
import { getUserDate } from "../utils/dates";
import { msgHeader, msgSection, msgTruncate, formatMessage, escapeHtml } from "../infra/telegram-format";

// ============================================================================
// EVENT TYPES
// ============================================================================

export type ProactiveEventType =
  | "urgent_email_received"
  | "deadline_approaching"
  | "calendar_conflict_detected"
  | "venture_milestone_reached"
  | "cross_agent_flag";

interface ProactiveEvent {
  type: ProactiveEventType;
  source: string;
  data: Record<string, any>;
  timestamp: Date;
}

// ============================================================================
// EVENT HANDLERS
// ============================================================================

/**
 * Handle an urgent email by notifying the CoS agent.
 */
async function handleUrgentEmail(event: ProactiveEvent): Promise<void> {
  const { from, subject, summary, suggestedAction } = event.data;

  const prompt = `URGENT EMAIL ALERT:
From: ${from}
Subject: ${subject}
Summary: ${summary}
Suggested action: ${suggestedAction}

Assess this urgent email. Should Sayed respond immediately? Is there a business risk? Recommend the best course of action.`;

  try {
    const result = await executeAgentChat("chief-of-staff", prompt, "proactive-trigger");

    // Send CoS assessment to Telegram
    const { sendProactiveMessage } = await import("../channels/channel-manager");
    const { getAuthorizedChatIds } = await import("../channels/adapters/telegram-adapter");

    const message = formatMessage({
      header: msgHeader("🚨", "CoS Assessment — Urgent Email"),
      body: `<b>${escapeHtml(from)}</b>\nRe: ${escapeHtml(subject)}\n\n${msgTruncate(escapeHtml(result.response), 600)}`,
    });
    for (const chatId of getAuthorizedChatIds()) {
      await sendProactiveMessage("telegram", chatId, message);
    }

    logger.info({ from, subject }, "Urgent email handled by CoS");
  } catch (err: any) {
    logger.error({ error: err.message }, "Failed to handle urgent email trigger");
  }
}

/**
 * Handle approaching deadlines by triggering status checks.
 */
async function handleDeadlineApproaching(event: ProactiveEvent): Promise<void> {
  const { tasks } = event.data;
  if (!tasks || tasks.length === 0) return;

  // Group by venture for efficient agent runs
  const byVenture = new Map<string, any[]>();
  for (const task of tasks) {
    const ventureId = task.ventureId || "unassigned";
    if (!byVenture.has(ventureId)) byVenture.set(ventureId, []);
    byVenture.get(ventureId)!.push(task);
  }

  const alerts: string[] = [];
  for (const [ventureId, ventureTasks] of Array.from(byVenture.entries())) {
    const taskList = ventureTasks.map((t: any) => `- ${t.title} (due: ${t.dueDate})`).join("\n");
    alerts.push(`${ventureTasks.length} task(s) due within 24h:\n${taskList}`);
  }

  if (alerts.length > 0) {
    try {
      const { sendProactiveMessage } = await import("../channels/channel-manager");
      const { getAuthorizedChatIds } = await import("../channels/adapters/telegram-adapter");

      const message = formatMessage({
        header: msgHeader("⏰", "Deadline Alert — 24h"),
        sections: alerts.map(a => escapeHtml(a)),
      });
      for (const chatId of getAuthorizedChatIds()) {
        await sendProactiveMessage("telegram", chatId, message);
      }
    } catch {
      // Non-critical
    }
  }

  logger.info({ taskCount: tasks.length }, "Deadline approaching trigger handled");
}

/**
 * Handle calendar conflicts by notifying via Telegram.
 */
async function handleCalendarConflict(event: ProactiveEvent): Promise<void> {
  const { conflicts } = event.data;
  if (!conflicts || conflicts.length === 0) return;

  try {
    const { sendProactiveMessage } = await import("../channels/channel-manager");
    const { getAuthorizedChatIds } = await import("../channels/adapters/telegram-adapter");

    const conflictItems = conflicts.map((c: any) => escapeHtml(c.description));
    const message = formatMessage({
      header: msgHeader("📅", "Calendar Conflicts"),
      sections: [msgSection("⚠️", "Overlaps", conflictItems)],
    });
    for (const chatId of getAuthorizedChatIds()) {
      await sendProactiveMessage("telegram", chatId, message);
    }
  } catch {
    // Non-critical
  }
}

/**
 * Handle cross-agent flags (one agent flagging something for another).
 */
async function handleCrossAgentFlag(event: ProactiveEvent): Promise<void> {
  const { fromAgent, toAgent, message: flagMessage, context } = event.data;

  // Broadcast on message bus for the target agent to pick up
  messageBus.broadcast(
    fromAgent,
    `[Cross-Agent Flag from ${fromAgent}] ${flagMessage}\nContext: ${context || "none"}`
  );

  logger.info({ fromAgent, toAgent, flagMessage }, "Cross-agent flag delivered");
}

// ============================================================================
// EVENT DISPATCHER
// ============================================================================

const eventHandlers: Record<ProactiveEventType, (event: ProactiveEvent) => Promise<void>> = {
  urgent_email_received: handleUrgentEmail,
  deadline_approaching: handleDeadlineApproaching,
  calendar_conflict_detected: handleCalendarConflict,
  venture_milestone_reached: async () => {}, // Placeholder
  cross_agent_flag: handleCrossAgentFlag,
};

/**
 * Emit a proactive event for handling.
 */
export async function emitProactiveEvent(
  type: ProactiveEventType,
  source: string,
  data: Record<string, any>
): Promise<void> {
  const event: ProactiveEvent = {
    type,
    source,
    data,
    timestamp: new Date(),
  };

  const handler = eventHandlers[type];
  if (!handler) {
    logger.warn({ type }, "No handler for proactive event type");
    return;
  }

  try {
    await handler(event);
  } catch (err: any) {
    logger.error({ type, error: err.message }, "Proactive event handler failed");
  }
}

/**
 * Check for deadline-approaching events.
 * Called periodically (e.g., every 4 hours).
 */
export async function checkDeadlineApproaching(): Promise<void> {
  const today = getUserDate();
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  try {
    const allTasks = await storage.getTasks({});
    const approaching = allTasks.filter(
      (t: any) =>
        t.dueDate &&
        t.dueDate <= tomorrow &&
        t.dueDate >= today &&
        t.status !== "completed" &&
        t.status !== "cancelled" &&
        t.status !== "done"
    );

    if (approaching.length > 0) {
      await emitProactiveEvent("deadline_approaching", "deadline-checker", {
        tasks: approaching.slice(0, 10),
      });
    }
  } catch (err: any) {
    logger.error({ error: err.message }, "Deadline check failed");
  }
}
