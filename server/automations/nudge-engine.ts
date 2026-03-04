/**
 * Nudge Engine — Event-Driven Proactive Notifications
 *
 * Checks conditions periodically and sends Telegram nudges when:
 * - Health data missing by afternoon
 * - High-priority tasks not started
 * - Task deadlines approaching today
 * - No meals logged by a certain time
 * - Fasting window ending
 *
 * Runs on a 30-minute cron cycle. Tracks sent nudges to avoid spam.
 */

import cron from "node-cron";
import { storage } from "../storage";
import { logger } from "../logger";
import { getUserDate } from "../utils/dates";
import { msgHeader, msgSection, formatMessage, escapeHtml } from "../infra/telegram-format";

// Track last run time for system health monitoring
export let lastNudgeRunAt: Date | null = null;

// Track nudges sent today to avoid duplicates
const sentNudges = new Map<string, Set<string>>();

function getNudgeKey(date: string, type: string): boolean {
  const dayNudges = sentNudges.get(date);
  return dayNudges?.has(type) || false;
}

function markNudgeSent(date: string, type: string): void {
  if (!sentNudges.has(date)) {
    sentNudges.set(date, new Set());
    // Clean up old dates
    Array.from(sentNudges.keys()).forEach((key) => {
      if (key !== date) sentNudges.delete(key);
    });
  }
  sentNudges.get(date)!.add(type);
}

// ============================================================================
// NUDGE CHECKS
// ============================================================================

interface NudgeResult {
  type: string;
  message: string;
  priority: "low" | "medium" | "high";
}

/**
 * Check for missing health data (after 2pm Dubai)
 */
async function checkHealthNudge(today: string): Promise<NudgeResult | null> {
  const now = new Date();
  const dubaiHour = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Dubai" })).getHours();

  if (dubaiHour < 14) return null; // Too early
  if (getNudgeKey(today, "health_missing")) return null;

  try {
    const entries = await storage.getHealthEntries({ dateGte: today, dateLte: today });
    const todayEntry = entries.find((e: any) => {
      const entryDate = typeof e.date === "string" ? e.date : new Date(e.date).toISOString().split("T")[0];
      return entryDate === today;
    });

    if (!todayEntry) {
      return {
        type: "health_missing",
        message: formatMessage({
          header: msgHeader("🏥", "Health Update Missing"),
          body: "No health data logged. A quick update keeps your metrics current.",
          cta: 'Say: "slept 7h good, energy 4"',
        }),
        priority: "medium",
      };
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * Check for overdue/urgent tasks
 */
async function checkTaskDeadlines(today: string): Promise<NudgeResult | null> {
  if (getNudgeKey(today, "task_deadlines")) return null;

  try {
    const urgent = await storage.getUrgentTasks(today, 5);
    const overdue = urgent.filter((t: any) => {
      if (!t.dueDate) return false;
      const due = typeof t.dueDate === "string" ? t.dueDate : new Date(t.dueDate).toISOString().split("T")[0];
      return due <= today && t.status !== "completed" && t.status !== "cancelled";
    });

    if (overdue.length > 0) {
      const taskItems = overdue
        .slice(0, 3)
        .map((t: any) => `${escapeHtml(t.title)} <code>${t.priority}</code>`);

      return {
        type: "task_deadlines",
        message: formatMessage({
          header: msgHeader("🔥", `${overdue.length} Task${overdue.length > 1 ? "s" : ""} Due`),
          sections: [msgSection("📋", "Overdue", taskItems)],
          cta: "/done to complete · /tasks for full list",
        }),
        priority: "high",
      };
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * Check for P0 tasks not started
 */
async function checkP0Tasks(today: string): Promise<NudgeResult | null> {
  const now = new Date();
  const dubaiHour = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Dubai" })).getHours();

  if (dubaiHour < 11) return null; // Give time to start work
  if (getNudgeKey(today, "p0_not_started")) return null;

  try {
    const tasks = await storage.getTasks({ status: undefined, limit: 50 });
    const p0NotStarted = tasks.filter(
      (t: any) =>
        t.priority === "P0" &&
        t.status === "todo" &&
        t.focusDate === today
    );

    if (p0NotStarted.length > 0) {
      const taskItems = p0NotStarted
        .slice(0, 3)
        .map((t: any) => `${escapeHtml(t.title)} <code>P0</code> — not started`);

      return {
        type: "p0_not_started",
        message: formatMessage({
          header: msgHeader("⚡", `${p0NotStarted.length} P0 Task${p0NotStarted.length > 1 ? "s" : ""} Unstarted`),
          sections: [msgSection("🎯", "Highest Priority", taskItems)],
          cta: "/tasks to take action",
        }),
        priority: "high",
      };
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * Check for no meals logged (after 1pm)
 */
async function checkNutritionNudge(today: string): Promise<NudgeResult | null> {
  const now = new Date();
  const dubaiHour = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Dubai" })).getHours();

  if (dubaiHour < 13) return null;
  if (getNudgeKey(today, "nutrition_missing")) return null;

  try {
    const day = await storage.getDayOrCreate(today);
    const nutrition = await storage.getNutritionEntries({ dayId: day.id });

    if (!nutrition || nutrition.length === 0) {
      return {
        type: "nutrition_missing",
        message: formatMessage({
          header: msgHeader("🍽️", "No Meals Logged"),
          body: "Tracking keeps your nutrition data accurate.",
          cta: 'Say: "lunch chicken rice 600 cal 40g protein"',
        }),
        priority: "low",
      };
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * Evening wind-down reminder (9pm)
 */
async function checkEveningReminder(today: string): Promise<NudgeResult | null> {
  const now = new Date();
  const dubaiHour = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Dubai" })).getHours();

  if (dubaiHour < 21 || dubaiHour > 22) return null;
  if (getNudgeKey(today, "evening_reminder")) return null;

  try {
    const day = await storage.getDayOrCreate(today);
    const hasEvening = day.eveningRituals && Object.keys(day.eveningRituals as any).length > 0;

    if (!hasEvening) {
      return {
        type: "evening_reminder",
        message: formatMessage({
          header: msgHeader("🌙", "Wind Down"),
          body: "Time for a quick evening review.",
          sections: [msgSection("📝", "Reflect", [
            "How did today go?",
            "What's tomorrow's top priority?",
            "Anything to capture?",
          ])],
          cta: "/today or just tell me here",
        }),
        priority: "low",
      };
    }
  } catch {
    return null;
  }

  return null;
}

// ============================================================================
// CONTEXT-AWARE GATING
// ============================================================================

/**
 * Check if currently in a meeting (suppress non-critical nudges during meetings).
 */
async function isInMeeting(): Promise<boolean> {
  try {
    const { listEvents } = await import("../google-calendar");
    const now = new Date();
    const soon = new Date(now.getTime() + 5 * 60 * 1000); // 5min buffer
    const events = await listEvents(new Date(now.getTime() - 5 * 60 * 1000), soon, 5);
    return events.some((e: any) => {
      const start = new Date(e.start?.dateTime || e.start?.date);
      const end = new Date(e.end?.dateTime || e.end?.date);
      return now >= start && now <= end;
    });
  } catch {
    return false; // If calendar unavailable, don't suppress
  }
}

/**
 * Check nudge response stats to auto-suppress low-action nudge types.
 */
async function getSuppressedNudgeTypes(): Promise<Set<string>> {
  const suppressed = new Set<string>();
  try {
    const stats = await storage.getNudgeResponseStats(14);
    for (const stat of stats) {
      // Suppress nudge types with <10% action rate after enough data (>10 nudges)
      if (stat.total >= 10 && stat.rate < 0.1) {
        suppressed.add(stat.nudgeType);
        logger.debug({ nudgeType: stat.nudgeType, rate: stat.rate }, "Nudge type auto-suppressed");
      }
    }
  } catch {
    // Non-critical
  }
  return suppressed;
}

// ============================================================================
// ENGINE
// ============================================================================

/**
 * Run all nudge checks and send any triggered nudges
 */
async function runNudgeChecks(): Promise<void> {
  lastNudgeRunAt = new Date();
  const today = getUserDate();

  const checks = await Promise.allSettled([
    checkHealthNudge(today),
    checkTaskDeadlines(today),
    checkP0Tasks(today),
    checkNutritionNudge(today),
    checkEveningReminder(today),
  ]);

  const nudges: NudgeResult[] = [];
  for (const check of checks) {
    if (check.status === "fulfilled" && check.value) {
      nudges.push(check.value);
    }
  }

  if (nudges.length === 0) return;

  // Context-aware gating: check if in a meeting
  const inMeeting = await isInMeeting();

  // Get auto-suppressed nudge types based on response tracking
  const suppressedTypes = await getSuppressedNudgeTypes();

  // Filter nudges based on context
  const contextFiltered = nudges.filter(nudge => {
    // Auto-suppress based on response tracking
    if (suppressedTypes.has(nudge.type)) return false;

    // During meetings: only allow high-priority nudges
    if (inMeeting && nudge.priority !== "high") {
      logger.debug({ type: nudge.type }, "Nudge suppressed — in meeting");
      return false;
    }

    return true;
  });

  if (contextFiltered.length === 0) return;

  // Sort by priority (high first)
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  contextFiltered.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  // Escalate deadline nudges if deadline is TODAY and task not started
  for (const nudge of contextFiltered) {
    if (nudge.type === "task_deadlines" && nudge.priority !== "high") {
      nudge.priority = "high";
      nudge.message = "🔥 " + nudge.message;
    }
  }

  // Send via Telegram (max 2 nudges per cycle to avoid spam)
  const toSend = contextFiltered.slice(0, 2);

  try {
    const { sendProactiveMessage } = await import("../channels/channel-manager");
    const { getAuthorizedChatIds } = await import("../channels/adapters/telegram-adapter");
    const chatIds = getAuthorizedChatIds();

    for (const nudge of toSend) {
      for (const chatId of chatIds) {
        await sendProactiveMessage("telegram", chatId, nudge.message);
      }
      markNudgeSent(today, nudge.type);

      // Record nudge for response tracking (starts as "ignored", updated when Sayed responds)
      try {
        await storage.createNudgeResponse({
          nudgeType: nudge.type,
          nudgeMessage: nudge.message,
          responseType: "ignored",
          date: today,
        });
      } catch {
        // Non-critical
      }

      logger.info({ type: nudge.type, priority: nudge.priority, inMeeting }, "Nudge sent");
    }
  } catch (error) {
    logger.error({ error }, "Failed to send nudges");
  }
}

/**
 * Schedule the nudge engine (runs every 30 minutes)
 */
export function scheduleNudgeEngine(): void {
  // Every 30 minutes
  cron.schedule("*/30 * * * *", () => {
    runNudgeChecks().catch((err) =>
      logger.error({ error: err.message }, "Nudge engine error")
    );
  });

  logger.info("Nudge engine scheduled (every 30 minutes)");
}

/**
 * Manually trigger nudge checks (for testing)
 */
export { runNudgeChecks };
