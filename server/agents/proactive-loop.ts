/**
 * Proactive Morning Loop — Track J, Wave 4
 *
 * Runs at 7:30am Dubai. Reads the latest daily brief, evaluates all
 * agent-ready tasks against auto-approve policies, auto-delegates where
 * approved, and sends a consolidated Telegram summary.
 *
 * Entry point: runProactiveMorningLoop()
 */

import { logger } from "../logger";
import { storage } from "../storage";
import {
  msgHeader,
  msgSection,
  formatMessage,
  escapeHtml,
} from "../infra/telegram-format";
import { evaluatePolicy } from "./approval-policy-evaluator";
import { delegateFromUser } from "./delegation-engine";
import { publishEvent } from "../events/bus";
// messageBus is imported dynamically (same pattern as scheduled-jobs.ts)

// ---------------------------------------------------------------------------
// Lazy DB handle — same pattern as approval-policy-evaluator.ts
// ---------------------------------------------------------------------------

let db: any = null;
async function getDb() {
  if (!db) {
    db = (storage as any).db;
  }
  return db;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parse the tags field which can be an array OR a comma-separated string
 * (depends on how the DB driver / ORM returns it).
 */
function parseTags(raw: any): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "string") {
    return raw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * Extract agent slug from scout notes.
 * Looks for "suggested agent: <slug>" or "suggested agent <slug>" (case-insensitive).
 * Falls back to 'chief-of-staff'.
 */
function extractAgentSlug(notes: string | null | undefined): string {
  if (!notes) return "chief-of-staff";
  const match = notes.match(/suggested\s+agent[:\s]+([a-z][a-z0-9-]+)/i);
  return match ? match[1].toLowerCase() : "chief-of-staff";
}

// ---------------------------------------------------------------------------
// Step 1: Read latest brief
// ---------------------------------------------------------------------------

async function getLatestBriefSummary(): Promise<string> {
  try {
    const database = await getDb();
    const { dailyBriefs } = await import("@shared/schema");
    const { desc } = await import("drizzle-orm");

    const rows = await database
      .select()
      .from(dailyBriefs)
      .orderBy(desc(dailyBriefs.generatedAt))
      .limit(1);

    if (!rows || rows.length === 0) return "";

    const brief = rows[0];
    // headline is the 1-sentence lead; bullets is string[]. Build a brief summary.
    const parts: string[] = [];
    if (brief.headline) parts.push(brief.headline);
    if (Array.isArray(brief.bullets) && brief.bullets.length > 0) {
      parts.push(brief.bullets.join(" · "));
    }
    return parts.join(" — ");
  } catch (err: any) {
    logger.warn({ error: err?.message }, "proactive-loop: failed to read daily brief");
    return "";
  }
}

// ---------------------------------------------------------------------------
// Step 2: Get agent-ready tasks
// ---------------------------------------------------------------------------

async function getAgentReadyTasks(): Promise<any[]> {
  try {
    const allTasks = await storage.getTasks({});
    const EXCLUDED_STATUSES = new Set(["done", "cancelled", "archived"]);
    return allTasks.filter((t: any) => {
      if (EXCLUDED_STATUSES.has(t.status)) return false;
      const tags = parseTags(t.tags);
      return tags.includes("agent-ready");
    });
  } catch (err: any) {
    logger.warn({ error: err?.message }, "proactive-loop: failed to load agent-ready tasks");
    return [];
  }
}

// ---------------------------------------------------------------------------
// Step 3: Evaluate + delegate each task
// ---------------------------------------------------------------------------

interface TaskOutcome {
  id: string;
  title: string;
  agentSlug: string;
}

async function processTask(task: any): Promise<{ delegated: boolean; item: TaskOutcome }> {
  const agentSlug = extractAgentSlug(task.notes);
  const ventureId: string | null = task.ventureId ?? null;
  const deliverableType = "task_execution" as const;

  const item: TaskOutcome = { id: task.id, title: task.title, agentSlug };

  try {
    const policyResult = await evaluatePolicy(deliverableType, agentSlug, ventureId, 0);

    if (!policyResult.autoApprove) {
      return { delegated: false, item };
    }

    // Auto-delegate
    const delegationResult = await delegateFromUser(
      agentSlug,
      task.title,
      task.notes || "",
      2,
    );

    if (delegationResult.error) {
      logger.warn(
        { taskId: task.id, agentSlug, error: delegationResult.error },
        "proactive-loop: delegation returned error",
      );
      return { delegated: false, item };
    }

    // Update task status + add 'agent-assigned' tag
    try {
      const existingTags = parseTags(task.tags);
      const newTags = existingTags.includes("agent-assigned")
        ? existingTags
        : [...existingTags, "agent-assigned"];

      await storage.updateTask(task.id, {
        status: "in_progress",
        tags: newTags,
      });
    } catch (updateErr: any) {
      logger.warn(
        { taskId: task.id, error: updateErr?.message },
        "proactive-loop: task update after delegation failed",
      );
    }

    return { delegated: true, item };
  } catch (err: any) {
    logger.warn(
      { taskId: task.id, error: err?.message },
      "proactive-loop: task processing error — skipping",
    );
    return { delegated: false, item };
  }
}

// ---------------------------------------------------------------------------
// Step 4: Fetch top-3 tasks (optional)
// ---------------------------------------------------------------------------

async function getTop3Titles(): Promise<string[]> {
  try {
    // Try the storage method if it exists
    const storageAny = storage as any;
    if (typeof storageAny.getTop3Tasks === "function") {
      const tasks = await storageAny.getTop3Tasks();
      return (tasks as any[]).map((t: any) => escapeHtml(t.title));
    }

    // Fallback: dashboard top3 endpoint data — query tasks with P0/P1, limit 3
    const urgentTasks = await storage.getTasks({});
    const top3 = urgentTasks
      .filter((t: any) => !["done", "cancelled", "archived"].includes(t.status))
      .filter((t: any) => t.priority === "P0" || t.priority === "P1")
      .sort((a: any, b: any) => {
        const order: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
        return (order[a.priority] ?? 9) - (order[b.priority] ?? 9);
      })
      .slice(0, 3);

    return top3.map((t: any) => escapeHtml(t.title));
  } catch (err: any) {
    logger.warn({ error: err?.message }, "proactive-loop: failed to fetch top-3 tasks");
    return [];
  }
}

// ---------------------------------------------------------------------------
// Step 5: Build + send Telegram message
// ---------------------------------------------------------------------------

async function sendSummary(
  briefSummary: string,
  delegated: TaskOutcome[],
  pending: TaskOutcome[],
  top3: string[],
): Promise<void> {
  const sections: string[] = [];

  // Brief 1-liner
  const briefLine = briefSummary.slice(0, 120);
  if (briefLine) {
    sections.push(msgSection("📋", "Today's Brief", [escapeHtml(briefLine)]));
  }

  // Auto-delegated
  sections.push(
    msgSection(
      "✅",
      `Auto-delegated (${delegated.length})`,
      delegated.length > 0
        ? delegated.map((t) => `${escapeHtml(t.title)} → <i>${t.agentSlug}</i>`)
        : ["Nothing delegated"],
    ),
  );

  // Pending (needs your call)
  sections.push(
    msgSection(
      "👤",
      `Needs your call (${pending.length})`,
      pending.length > 0
        ? pending.map((t) => `${escapeHtml(t.title)} <code>#${String(t.id).slice(0, 8)}</code>`)
        : ["All tasks handled"],
    ),
  );

  // Top 3
  if (top3.length > 0) {
    sections.push(msgSection("🎯", "Top 3 today", top3));
  }

  const message = formatMessage({
    header: msgHeader("☀️", "Morning Loop"),
    sections,
  });

  try {
    const { sendProactiveMessage } = await import("../channels/channel-manager");
    const { getAuthorizedChatIds } = await import("../channels/adapters/telegram-adapter");
    const { resolveTopicByKey } = await import("../channels/topic-router");
    const threadId = await resolveTopicByKey("morning-loop");
    const chatIds = getAuthorizedChatIds();
    for (const chatId of chatIds) {
      await sendProactiveMessage("telegram", chatId, message, threadId);
    }
  } catch (err: any) {
    logger.warn({ error: err?.message }, "proactive-loop: failed to send Telegram message");
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function runProactiveMorningLoop(): Promise<void> {
  logger.info("proactive-loop: starting morning loop");

  // Step 1: Read latest brief
  const briefSummary = await getLatestBriefSummary();

  // Step 2: Get agent-ready tasks
  const agentReadyTasks = await getAgentReadyTasks();
  logger.info({ count: agentReadyTasks.length }, "proactive-loop: agent-ready tasks found");

  // Step 3: Process each task
  const delegated: TaskOutcome[] = [];
  const pending: TaskOutcome[] = [];

  for (const task of agentReadyTasks) {
    const { delegated: wasDelegated, item } = await processTask(task);
    if (wasDelegated) {
      delegated.push(item);
    } else {
      pending.push(item);
    }
  }

  logger.info(
    { delegated: delegated.length, pending: pending.length },
    "proactive-loop: processing complete",
  );

  // Step 4: Fetch top-3
  const top3 = await getTop3Titles();

  // Step 5: Build + send Telegram
  await sendSummary(briefSummary, delegated, pending, top3);

  // Step 6: Publish completion event (fire-and-forget)
  publishEvent("morning.loop.completed", {
    delegated: delegated.length,
    pending: pending.length,
  }).catch(() => {});

  logger.info(
    { delegated: delegated.length, pending: pending.length },
    "proactive-loop: morning loop complete",
  );
}
