/**
 * Scheduled Jobs
 *
 * Predefined job handlers for agent scheduled execution.
 * Maps job names to execution logic — e.g., "daily_briefing" triggers
 * the Chief of Staff to generate and save a daily report.
 */

import { eq, gte, sql } from "drizzle-orm";
import { logger } from "../logger";
import { agents, agentConversations, sessionLogs, tasks, ventures, projects, deadLetterJobs, agentCompactionEvents, agentMemory, type Agent } from "@shared/schema";
import { dailyBriefing, weeklySummary, ventureStatus } from "./tools/report-generator";
import { executeAgentChat } from "./agent-runtime";
import { getAllAgentActivity } from "./conversation-manager";
import { messageBus } from "./message-bus";
import { getUserDate } from "../utils/dates";
import { msgHeader, msgSection, msgTruncate, formatMessage, escapeHtml } from "../infra/telegram-format";

// Lazy DB
let db: any = null;
async function getDb() {
  if (!db) {
    const { storage } = await import("../storage");
    db = (storage as any).db;
  }
  return db;
}

// ============================================================================
// JOB HANDLER TYPE
// ============================================================================

export type ScheduledJobHandler = (
  agentId: string,
  agentSlug: string
) => Promise<void>;

// ============================================================================
// JOB REGISTRY
// ============================================================================

const jobHandlers = new Map<string, ScheduledJobHandler>();

/**
 * Register a job handler by name.
 */
export function registerJobHandler(name: string, handler: ScheduledJobHandler): void {
  jobHandlers.set(name, handler);
}

/**
 * Execute a scheduled job by name.
 */
export async function executeScheduledJob(
  agentId: string,
  agentSlug: string,
  jobName: string
): Promise<void> {
  const handler = jobHandlers.get(jobName);

  if (!handler) {
    // Fallback: treat the job name as a prompt and run it through the agent's chat
    logger.info(
      { agentSlug, jobName },
      "No specific handler found, executing as chat prompt"
    );
    await executeAgentChat(agentSlug, `Execute your scheduled task: ${jobName}`, "scheduler");
    return;
  }

  await handler(agentId, agentSlug);
}

// ============================================================================
// BUILT-IN JOB HANDLERS
// ============================================================================

/**
 * Daily Briefing — Unified morning briefing combining intelligence synthesis + CoS agent.
 *
 * Step 1: Run intelligence synthesis (calendar, tasks, email, life context, yesterday)
 * Step 2: Gather system activity, blockers, outcomes
 * Step 3: Feed everything to CoS agent for a personality-driven briefing
 * Step 4: Send ONE formatted Telegram message
 *
 * Replaces the old separate daily_intelligence (8:45am) + daily_briefing (9am) two-step.
 */
registerJobHandler("daily_briefing", async (agentId: string, agentSlug: string) => {
  const database = await getDb();
  const { storage } = await import("../storage");
  const today = getUserDate();

  // Step 1: Run intelligence synthesis (stores to DB + returns structured data)
  let intelligenceSection = "";
  try {
    const { runDailyIntelligence } = await import("./intelligence-synthesizer");
    const intel = await runDailyIntelligence();
    intelligenceSection = `\n\n## Cross-Domain Intelligence\n${intel.synthesis}`;
    if (intel.conflicts.length > 0) {
      intelligenceSection += `\n\nConflicts detected: ${intel.conflicts.map((c: any) => c.description).join("; ")}`;
    }
    if (intel.priorities.length > 0) {
      intelligenceSection += `\n\nTop priorities: ${intel.priorities.map((p: any) => p.item).join("; ")}`;
    }
    logger.info(
      { conflicts: intel.conflicts.length, priorities: intel.priorities.length },
      "Intelligence synthesis completed as part of daily briefing"
    );
  } catch (err: any) {
    logger.warn({ error: err.message }, "Intelligence synthesis failed — proceeding without");
  }

  // Step 2a: Syntheliq cross-system check
  let syntheliqSection = "";
  try {
    const { getSyntheliqDashboard } = await import("../integrations/syntheliq-client.js");
    const dashboard = await getSyntheliqDashboard();
    const parts: string[] = [];
    if (dashboard.health) parts.push("System: online");
    else parts.push("System: unreachable");
    if (dashboard.pipeline && typeof dashboard.pipeline === "object") {
      const stages = Object.entries(dashboard.pipeline as Record<string, number>);
      if (stages.length > 0) parts.push("Pipeline: " + stages.map(([k, v]) => `${v} ${k}`).join(" → "));
    }
    if (Array.isArray(dashboard.runs) && dashboard.runs.length > 0) {
      const completed = dashboard.runs.filter((r: any) => r.status === "completed").length;
      const failed = dashboard.runs.filter((r: any) => r.status === "failed").length;
      parts.push(`Runs (24h): ${completed} completed, ${failed} failed, ${dashboard.runs.length} total`);
      const recentFailed = dashboard.runs.filter((r: any) => r.status === "failed").slice(0, 3);
      if (recentFailed.length > 0) {
        parts.push("Failed runs: " + recentFailed.map((r: any) => `${r.agentName}: ${r.summary || "no details"}`).join("; "));
      }
    }
    syntheliqSection = `\n\n## Syntheliq\n${parts.join("\n")}`;
    logger.info("Syntheliq data included in daily briefing");
  } catch (err: any) {
    syntheliqSection = "\n\n## Syntheliq\nUnavailable — " + (err.message || "unknown error");
  }

  // Step 2b: Gather briefing data
  const briefingResult = await dailyBriefing();
  const briefingData = JSON.parse(briefingResult.result);

  const agentActivity = await getAllAgentActivity(24);
  const activitySummary = agentActivity.length > 0
    ? `\n\n## Agent Activity (Last 24h)\n${agentActivity.map(
        (a) => `- **${a.agentName}**: ${a.messageCount} messages, last: "${a.lastMessage.slice(0, 100)}..."`
      ).join("\n")}`
    : "";

  // Detect blockers
  let blockerSection = "";
  try {
    const allTasks = await storage.getTasks({});
    const overdue = allTasks.filter(
      (t: any) => t.dueDate && t.dueDate < today && !["done", "cancelled"].includes(t.status)
    );
    const staleInProgress = allTasks.filter(
      (t: any) => t.status === "in_progress" && t.updatedAt &&
        (Date.now() - new Date(t.updatedAt).getTime()) > 48 * 60 * 60 * 1000
    );

    if (overdue.length > 0 || staleInProgress.length > 0) {
      blockerSection = "\n\n## ⚠️ Blockers & Attention Needed";
      if (overdue.length > 0) {
        blockerSection += `\n${overdue.length} overdue task${overdue.length > 1 ? "s" : ""}:`;
        for (const t of overdue.slice(0, 5)) {
          blockerSection += `\n- [OVERDUE] ${t.title} — due ${t.dueDate}`;
        }
      }
      if (staleInProgress.length > 0) {
        blockerSection += `\n${staleInProgress.length} stale in-progress task${staleInProgress.length > 1 ? "s" : ""} (no update in 48h):`;
        for (const t of staleInProgress.slice(0, 5)) {
          blockerSection += `\n- [STALE] ${t.title}`;
        }
      }
    }
  } catch {
    // Non-critical
  }

  // Agent-ready tasks + pending reviews
  let agentQueueSection = "";
  try {
    const allTasks = await storage.getTasks({});
    const doneSt = new Set(["done", "cancelled", "archived"]);
    const agentReadyCount = allTasks.filter((t: any) => {
      if (doneSt.has(t.status)) return false;
      const tags = Array.isArray(t.tags) ? t.tags : (t.tags ? String(t.tags).split(",").map((s: string) => s.trim()) : []);
      return tags.includes("agent-ready");
    }).length;

    let pendingReviewCount = 0;
    try {
      const { getDb } = await import("../db");
      const db = await getDb();
      const { agentTasks } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      const reviewRows = await db.select().from(agentTasks).where(eq(agentTasks.status, "needs_review"));
      pendingReviewCount = reviewRows.length;
    } catch { /* non-critical */ }

    const parts: string[] = [];
    if (agentReadyCount > 0) parts.push(`${agentReadyCount} task${agentReadyCount > 1 ? "s" : ""} tagged agent-ready (scout suggestions waiting)`);
    if (pendingReviewCount > 0) parts.push(`${pendingReviewCount} deliverable${pendingReviewCount > 1 ? "s" : ""} pending your review`);
    if (parts.length > 0) {
      agentQueueSection = `\n\n## 🤖 Agent Queue\n${parts.join("\n")}`;
    }
  } catch { /* non-critical */ }

  // Check outcomes
  let outcomesPrompt = "";
  try {
    const day = await storage.getDayOrCreate(today);
    const outcomes = day.top3Outcomes as Array<{ text: string; completed: boolean }> | null;
    if (!outcomes || outcomes.length === 0 || outcomes.every((o: any) => !o.text)) {
      outcomesPrompt = "\n\nEnd the briefing by asking: 'What are your top 3 outcomes for today? Reply with them and I'll set your day up.'";
    } else {
      outcomesPrompt = `\n\nToday's outcomes are already set: ${outcomes.map((o: any) => o.text).join(", ")}. Remind the founder of these.`;
    }
  } catch {
    outcomesPrompt = "\n\nEnd the briefing by asking: 'What are your top 3 outcomes for today?'";
  }

  // Step 3: Have the CoS agent synthesize everything into one briefing
  const prompt = `Generate your daily briefing for the founder. Here is the data:\n\n${briefingData.report}${activitySummary}${blockerSection}${agentQueueSection}${intelligenceSection}${syntheliqSection}\n\nPresent this as your daily briefing, with your personality and insights. Highlight what matters most today. Flag any blockers prominently. If there are agent-ready tasks or pending deliverables, mention them so the founder can delegate or review. If Syntheliq data is available, cross-reference with Syntheliq-related tasks and flag any potential matches.${outcomesPrompt}`;

  const result = await executeAgentChat(agentSlug, prompt, "scheduler");

  messageBus.broadcast(agentId, `[Daily Briefing] ${result.response.slice(0, 500)}`);

  // Step 4: Send ONE formatted Telegram message
  try {
    const { sendProactiveMessage } = await import("../channels/channel-manager");
    const { getAuthorizedChatIds } = await import("../channels/adapters/telegram-adapter");
    const { resolveTopicByKey } = await import("../channels/topic-router");
    const threadId = await resolveTopicByKey("morning-loop");
    for (const chatId of getAuthorizedChatIds()) {
      await sendProactiveMessage("telegram", chatId, formatMessage({
        header: msgHeader("☀️", "Daily Briefing"),
        body: msgTruncate(escapeHtml(result.response)),
        cta: "/today for outcomes · /tasks for full list · open dashboard to delegate",
      }), threadId);
    }
  } catch {
    // Telegram not configured — skip
  }

  // Persist brief to daily_briefs table for CC V4 morning brief widget
  try {
    const { dailyBriefs } = await import("@shared/schema");
    const { sql: sqlTag } = await import("drizzle-orm");
    const briefDb = await getDb();
    const todayDate = today; // already computed as getUserDate() result
    await briefDb.insert(dailyBriefs).values({
      date: todayDate,
      headline: briefingData.oneThing || "Your day is briefed — check Telegram for details.",
      bullets: [
        briefingData.taskSummary,
        briefingData.urgentCount > 0 ? `${briefingData.urgentCount} urgent items` : null,
        (() => {
          try {
            const allTasksForBrief: any[] = (database as any)._latestTasks || [];
            const doneSt = new Set(["done", "cancelled", "archived"]);
            const cnt = allTasksForBrief.filter((t: any) => {
              if (doneSt.has(t.status)) return false;
              const tags = Array.isArray(t.tags) ? t.tags : (t.tags ? String(t.tags).split(",").map((s: string) => s.trim()) : []);
              return tags.includes("agent-ready");
            }).length;
            return cnt > 0 ? `${cnt} tasks ready for agents` : null;
          } catch { return null; }
        })(),
      ].filter(Boolean) as string[],
      agentReadyCount: (() => {
        try {
          const allT = (database as any)._latestTasks || [];
          const doneSt = new Set(["done", "cancelled", "archived"]);
          return allT.filter((t: any) => {
            if (doneSt.has(t.status)) return false;
            const tags = Array.isArray(t.tags) ? t.tags : (t.tags ? String(t.tags).split(",").map((s: string) => s.trim()) : []);
            return tags.includes("agent-ready");
          }).length;
        } catch { return 0; }
      })(),
      reviewPendingCount: (() => {
        try {
          // agentQueueSection was computed above; use its pendingReviewCount if accessible
          // We re-derive a rough count from the agentQueueSection string
          const m = agentQueueSection.match(/(\d+) deliverable/);
          return m ? parseInt(m[1], 10) : 0;
        } catch { return 0; }
      })(),
      agentSlug,
    }).onConflictDoUpdate({
      target: dailyBriefs.date,
      set: {
        headline: sqlTag`excluded.headline`,
        bullets: sqlTag`excluded.bullets`,
        generatedAt: sqlTag`now()`,
      },
    });
    logger.info({ date: todayDate }, "Daily brief persisted to daily_briefs table");
  } catch (e: any) {
    logger.warn({ error: e.message }, "Failed to persist daily brief");
  }

  logger.info(
    { agentSlug, tokensUsed: result.tokensUsed },
    "Daily briefing generated (with integrated intelligence)"
  );

  // Publish event for reactive subscriptions
  try {
    const { publishEvent } = await import("../events/bus");
    await publishEvent("brief.morning.ready", {
      summary: result.response.slice(0, 500),
      date: today,
    });
  } catch { /* non-fatal */ }
});

/**
 * Weekly Report — CMO generates weekly marketing/business report.
 */
registerJobHandler("weekly_report", async (agentId: string, agentSlug: string) => {
  const weeklyResult = await weeklySummary();
  const weeklyData = JSON.parse(weeklyResult.result);

  const prompt = `Generate your weekly report for the founder. Here is the data:\n\n${weeklyData.report}\n\nAnalyze from your perspective as CMO. Include marketing insights, growth recommendations, and strategic priorities for next week.`;

  const result = await executeAgentChat(agentSlug, prompt, "scheduler");

  messageBus.broadcast(agentId, `[Weekly Report] ${result.response.slice(0, 500)}`);

  // Send to Telegram if configured
  try {
    const { sendProactiveMessage } = await import("../channels/channel-manager");
    const { getAuthorizedChatIds } = await import("../channels/adapters/telegram-adapter");
    const chatIds = getAuthorizedChatIds();
    for (const chatId of chatIds) {
      await sendProactiveMessage("telegram", chatId, formatMessage({
        header: msgHeader("📊", "Weekly Report"),
        body: msgTruncate(escapeHtml(result.response)),
      }));
    }
  } catch {
    // Telegram not configured — skip
  }

  logger.info(
    { agentSlug, tokensUsed: result.tokensUsed },
    "Weekly report generated"
  );
});

/**
 * Campaign Review — CMO reviews ongoing campaigns/projects.
 */
registerJobHandler("campaign_review", async (agentId: string, agentSlug: string) => {
  const prompt = `Review the current state of all marketing-related projects and campaigns. Use your tools to check project status and task progress. Provide a brief assessment of what's working, what's not, and what needs attention.`;

  await executeAgentChat(agentSlug, prompt, "scheduler");

  logger.info({ agentSlug }, "Campaign review completed");
});

/**
 * Tech Review — CTO reviews technical projects and architecture.
 */
registerJobHandler("tech_review", async (agentId: string, agentSlug: string) => {
  const prompt = `Review the current state of all technical projects. Use your tools to check project status and identify any blocked or at-risk items. Provide technical recommendations and flag any architectural concerns.`;

  await executeAgentChat(agentSlug, prompt, "scheduler");

  logger.info({ agentSlug }, "Tech review completed");
});

/**
 * Venture Status — Generate status report for a specific venture.
 * This is triggered with extra context in the schedule JSONB.
 */
registerJobHandler("venture_status_report", async (agentId: string, agentSlug: string) => {
  const database = await getDb();

  // Get the agent to find venture scope
  const [agent] = await database
    .select()
    .from(agents)
    .where(eq(agents.id, agentId));

  if (agent?.ventureId) {
    const statusResult = await ventureStatus(agent.ventureId);
    const statusData = JSON.parse(statusResult.result);

    const prompt = `Here is a venture status report. Synthesize it with your insights:\n\n${statusData.report}`;
    await executeAgentChat(agentSlug, prompt, "scheduler");
  } else {
    await executeAgentChat(
      agentSlug,
      "Generate a status report across all ventures you have visibility into.",
      "scheduler"
    );
  }

  logger.info({ agentSlug }, "Venture status report completed");
});

/**
 * Memory Cleanup — Periodic cleanup of expired agent memories.
 */
registerJobHandler("memory_cleanup", async (agentId: string, agentSlug: string) => {
  const { cleanupExpiredMemories } = await import("./agent-memory-manager");
  const result = await cleanupExpiredMemories();

  logger.info({ agentSlug, deleted: result.deleted }, "Memory cleanup completed");
});

/**
 * Memory Consolidation — Nightly job to merge duplicate memories,
 * decay stale ones, and boost confirmed patterns.
 * Runs for each agent + the shared memory pool.
 */
registerJobHandler("memory_consolidation", async (_agentId: string, agentSlug: string) => {
  const { consolidateAgentMemories, SHARED_MEMORY_AGENT_ID } = await import("./learning-extractor");
  const database = await getDb();

  // Get all active agents
  const allAgents = await database
    .select()
    .from(agents)
    .where(eq(agents.isActive, true));

  let totalMerged = 0;
  let totalDecayed = 0;

  // Consolidate each agent's memories
  for (const agent of allAgents) {
    try {
      const result = await consolidateAgentMemories(agent.id);
      totalMerged += result.merged;
      totalDecayed += result.decayed;
    } catch (err: any) {
      logger.warn({ agentSlug: agent.slug, error: err.message }, "Agent memory consolidation failed");
    }
  }

  // Consolidate shared memory pool
  try {
    const result = await consolidateAgentMemories(SHARED_MEMORY_AGENT_ID);
    totalMerged += result.merged;
    totalDecayed += result.decayed;
  } catch (err: any) {
    logger.warn({ error: err.message }, "Shared memory consolidation failed");
  }

  // Consolidate Claude Code memory pool
  const CLAUDE_CODE_AGENT_ID = "11111111-1111-1111-1111-111111111111";
  try {
    const result = await consolidateAgentMemories(CLAUDE_CODE_AGENT_ID);
    totalMerged += result.merged;
    totalDecayed += result.decayed;
  } catch {
    // Claude Code agent may not exist yet — skip
  }

  logger.info(
    { agentSlug, totalMerged, totalDecayed, agentCount: allAgents.length },
    "Memory consolidation completed"
  );

  // Run compaction tuner as part of nightly consolidation
  try {
    const { tuneAllAgentCompaction } = await import("./compaction-tuner");
    const tuneResult = await tuneAllAgentCompaction();
    logger.info(
      { agentsAnalyzed: tuneResult.agentsAnalyzed, configsUpdated: tuneResult.configsUpdated },
      "Compaction tuning completed"
    );
  } catch (err: any) {
    logger.debug({ error: err.message }, "Compaction tuning failed (non-critical)");
  }
});

/**
 * Morning Check-in — Sends a 10am Telegram prompt about morning ritual status.
 */
registerJobHandler("morning_checkin", async (_agentId: string, agentSlug: string) => {
  const today = new Date().toISOString().split("T")[0];
  const { storage } = await import("../storage");
  const day = await storage.getDayOrCreate(today);
  const rituals = day.morningRituals as Record<string, any> | null;

  // Skip entirely if morning rituals already completed
  if (rituals?.completedAt) {
    logger.info({ agentSlug }, "Morning check-in skipped — rituals already complete");
    return;
  }

  // Check individual habits
  const habitLabels: Record<string, string> = {
    pressUps: "Press-ups",
    squats: "Squats",
    water: "Water",
    supplements: "Supplements",
  };
  const missing: string[] = [];
  for (const [key, label] of Object.entries(habitLabels)) {
    if (!rituals?.[key]?.done) missing.push(label);
  }

  // Skip entirely if all habits done (even without completedAt flag)
  if (missing.length === 0) {
    logger.info({ agentSlug }, "Morning check-in skipped — all habits done");
    return;
  }

  // Check if outcomes are set
  const outcomes = day.top3Outcomes as Array<{ text: string; completed: boolean }> | null;
  const outcomesSet = outcomes?.some((o: any) => o.text);

  // Build sections
  const sections: string[] = [];
  sections.push(msgSection("⬜", "Still To Do", missing));

  if (!outcomesSet) {
    sections.push("What are your top 3 outcomes for today?");
  }

  // Append system health issues if any
  const healthIssues = await runSystemHealthCheck();
  if (healthIssues.length > 0) {
    sections.push(msgSection("⚠️", "System Issues", healthIssues));
  }

  const message = formatMessage({
    header: msgHeader("☀️", "Morning Check-in"),
    sections,
    cta: 'Text what you\'ve completed, or "morning done" to check off all.',
  });

  try {
    const { sendProactiveMessage } = await import("../channels/channel-manager");
    const { getAuthorizedChatIds } = await import("../channels/adapters/telegram-adapter");
    for (const chatId of getAuthorizedChatIds()) {
      await sendProactiveMessage("telegram", chatId, message);
    }
  } catch {
    // Telegram not configured — skip
  }

  logger.info({ agentSlug }, "Morning check-in sent");
});

/**
 * Evening Review — Sends a 6pm Dubai summary of the day + asks for reflection.
 * Part of the Autonomous Daily Execution Loop.
 */
registerJobHandler("evening_review", async (_agentId: string, agentSlug: string) => {
  const { storage } = await import("../storage");
  const today = getUserDate();

  // Gather day data
  const day = await storage.getDayOrCreate(today);
  const eveningRituals = day.eveningRituals as Record<string, any> | null;

  // Skip entirely if already reviewed or reflected
  if (eveningRituals?.reviewCompleted) {
    logger.info({ agentSlug }, "Evening review skipped — already reviewed");
    return;
  }
  if (day.reflectionPm) {
    logger.info({ agentSlug }, "Evening review skipped — reflection already logged");
    return;
  }

  const outcomes = day.top3Outcomes as Array<{ text: string; completed: boolean }> | null;
  const allTasks = await storage.getTasks({});
  const todayCompleted = allTasks.filter(
    (t: any) => t.status === "done" && t.completedAt &&
      new Date(t.completedAt).toISOString().slice(0, 10) === today
  );
  const todayInProgress = allTasks.filter(
    (t: any) => (t.focusDate === today || t.dueDate === today) && t.status !== "done" && t.status !== "cancelled"
  );

  // Check if outcomes are all complete
  const outcomesWithText = outcomes?.filter((o: any) => o.text) || [];
  const allOutcomesDone = outcomesWithText.length > 0 && outcomesWithText.every((o: any) => o.completed);

  // If everything is done (outcomes complete, no open tasks), skip or send brief congrats
  if (allOutcomesDone && todayInProgress.length === 0) {
    logger.info({ agentSlug }, "Evening review skipped — all outcomes and tasks done");
    return;
  }

  // Build formatted sections
  const msgSections: string[] = [];

  // Outcomes progress (only if there are incomplete ones)
  if (outcomesWithText.length > 0 && !allOutcomesDone) {
    const completed = outcomesWithText.filter((o: any) => o.completed).length;
    const incompleteItems = outcomesWithText
      .filter((o: any) => !o.completed)
      .map((o: any) => `⬜ ${escapeHtml(o.text)} — incomplete`);
    msgSections.push(msgSection("🎯", `Outcomes ${completed}/${outcomesWithText.length}`, incompleteItems));
  }

  // Only show open tasks
  if (todayInProgress.length > 0) {
    const openItems = todayInProgress.slice(0, 5).map((t: any) => escapeHtml(t.title));
    msgSections.push(msgSection("⬜", `${todayInProgress.length} Still Open`, openItems));
  }

  // Completed tasks summary (brief)
  if (todayCompleted.length > 0) {
    msgSections.push(`✅ ${todayCompleted.length} task${todayCompleted.length > 1 ? "s" : ""} closed today.`);
  }

  // Append system health issues if any
  const healthIssues = await runSystemHealthCheck();
  if (healthIssues.length > 0) {
    msgSections.push(msgSection("⚠️", "System Issues", healthIssues));
  }

  const message = formatMessage({
    header: msgHeader("🌙", "Evening Review"),
    sections: msgSections,
    cta: "How was today? A quick reflection closes the loop.",
  });

  try {
    const { sendProactiveMessage } = await import("../channels/channel-manager");
    const { getAuthorizedChatIds } = await import("../channels/adapters/telegram-adapter");
    const { resolveTopicByKey } = await import("../channels/topic-router");
    const threadId = await resolveTopicByKey("evening-review");
    for (const chatId of getAuthorizedChatIds()) {
      await sendProactiveMessage("telegram", chatId, message, threadId);
    }
  } catch {
    // Telegram not configured — skip
  }

  logger.info({ agentSlug }, "Evening review sent");

  // Publish event for reactive subscriptions
  try {
    const { publishEvent } = await import("../events/bus");
    await publishEvent("brief.evening.ready", {
      date: today,
    });
  } catch { /* non-fatal */ }
});

/**
 * Weekly Report — Chief of Staff generates Friday summary.
 * Covers: tasks completed, ventures progressed, health trends, wins.
 * Sent to Telegram + saved as Knowledge Hub doc.
 */
registerJobHandler("weekly_report_cos", async (agentId: string, agentSlug: string) => {
  const weeklyResult = await weeklySummary();
  const weeklyData = JSON.parse(weeklyResult.result);

  // Get health trends for the week
  const { storage } = await import("../storage");
  const today = new Date();
  const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  const weekAgoStr = weekAgo.toISOString().slice(0, 10);
  const todayStr = getUserDate();

  let healthTrend = "";
  try {
    const healthEntries = await storage.getHealthEntries({ dateGte: weekAgoStr, dateLte: todayStr });
    if (healthEntries.length > 0) {
      const avgSleep = healthEntries.reduce((sum: number, h: any) => sum + (h.sleepHours || 0), 0) / healthEntries.length;
      const avgEnergy = healthEntries.reduce((sum: number, h: any) => sum + (h.energyLevel || 0), 0) / healthEntries.length;
      const workoutDays = healthEntries.filter((h: any) => h.workoutDone).length;
      healthTrend = `\n\n## Health Trends (${healthEntries.length} days tracked)\n- Avg sleep: ${avgSleep.toFixed(1)}h\n- Avg energy: ${avgEnergy.toFixed(1)}/5\n- Workouts: ${workoutDays}/${healthEntries.length} days`;
    }
  } catch {
    // Non-critical
  }

  const prompt = `Generate a comprehensive weekly report for the founder. Here is the data:\n\n${weeklyData.report}${healthTrend}\n\nThis is a Friday wrap-up. Celebrate wins, flag concerns, and suggest focus areas for next week. Be encouraging but honest.`;

  const result = await executeAgentChat(agentSlug, prompt, "scheduler");

  messageBus.broadcast(agentId, `[Weekly Report] ${result.response.slice(0, 500)}`);

  // Save as Knowledge Hub doc
  try {
    await storage.createDocIfNotExists({
      title: `Weekly Report — ${todayStr}`,
      content: result.response,
      type: "note",
      tags: ["weekly-report", "auto-generated"],
    } as any);
  } catch {
    // Non-critical
  }

  // Send to Telegram
  try {
    const { sendProactiveMessage } = await import("../channels/channel-manager");
    const { getAuthorizedChatIds } = await import("../channels/adapters/telegram-adapter");
    for (const chatId of getAuthorizedChatIds()) {
      await sendProactiveMessage("telegram", chatId, formatMessage({
        header: msgHeader("📊", "Weekly Report"),
        body: msgTruncate(escapeHtml(result.response)),
      }));
    }
  } catch {
    // Telegram not configured — skip
  }

  logger.info({ agentSlug, tokensUsed: result.tokensUsed }, "Weekly report (CoS) generated");
});

/**
 * Session Log Extraction — Nightly processing of Claude Code session logs.
 * Extracts learnings, decisions, and preferences → agent_memory + Qdrant + Pinecone.
 * Runs at 10pm UTC (2am Dubai), 1 hour before memory_consolidation.
 */
registerJobHandler("session_log_extraction", async (_agentId: string, agentSlug: string) => {
  const { processSessionLogs } = await import("./session-log-processor");
  const result = await processSessionLogs();

  logger.info(
    { agentSlug, ...result },
    "Session log extraction completed"
  );
});

/**
 * Embedding Backfill — Catches memories that slipped through without embeddings.
 * Runs every 30 minutes. Processes up to 20 per run.
 */
registerJobHandler("embedding_backfill", async (_agentId: string, agentSlug: string) => {
  try {
    const { generateEmbeddingsForRecentMemories } = await import("./learning-extractor");
    await generateEmbeddingsForRecentMemories(_agentId);
    logger.info({ agentSlug }, "Embedding backfill completed");
  } catch (err: any) {
    logger.warn({ agentSlug, error: err.message }, "Embedding backfill failed");
  }
});

/**
 * Pipeline Health Check — Monitors the memory pipeline for failures.
 * Checks: session log ingestion, unprocessed backlog, Qdrant status, Pinecone status.
 * Runs every 4 hours. Sends a consolidated Telegram alert if any check fails.
 */
registerJobHandler("pipeline_health_check", async (_agentId: string, agentSlug: string) => {
  const result = await runPipelineHealthCheck();

  if (result.alerts.length > 0) {
    // Send consolidated Telegram alert
    const alertMessage = formatMessage({
      header: msgHeader("🔧", "Pipeline Health Alert"),
      sections: [msgSection("⚠️", "Issues", result.alerts.map(a => escapeHtml(a)))],
      cta: "<code>GET /api/health/pipeline</code> for full status.",
    });

    try {
      const { sendProactiveMessage } = await import("../channels/channel-manager");
      const { getAuthorizedChatIds } = await import("../channels/adapters/telegram-adapter");
      for (const chatId of getAuthorizedChatIds()) {
        await sendProactiveMessage("telegram", chatId, alertMessage);
      }
    } catch {
      // Telegram not configured — skip
    }
  }

  logger.info(
    { agentSlug, pass: result.overall === "pass", alertCount: result.alerts.length },
    "Pipeline health check completed"
  );
});

// ============================================================================
// SYNTHELIQ RECONCILE — cross-reference Syntheliq runs with SB-OS tasks
// ============================================================================

registerJobHandler("syntheliq_reconcile", async (agentId: string, agentSlug: string) => {
  const { storage } = await import("../storage");

  let runs: any[] = [];
  try {
    const { getSyntheliqRuns } = await import("../integrations/syntheliq-client.js");
    runs = await getSyntheliqRuns(6);
  } catch (err: any) {
    logger.info({ error: err.message }, "Syntheliq reconcile skipped — unavailable");
    return;
  }

  const completedRuns = runs.filter((r: any) => r.status === "completed");
  if (completedRuns.length === 0) {
    logger.info("Syntheliq reconcile: no completed runs in last 6h");
    return;
  }

  // Fetch Syntheliq venture tasks
  let syntheliqVentureId: string | null = null;
  try {
    const allVentures = await storage.getVentures();
    const syntheliqVenture = allVentures.find((v: any) =>
      v.name?.toLowerCase().includes("syntheliq") || v.name?.toLowerCase().includes("hikma")
    );
    if (syntheliqVenture) syntheliqVentureId = String(syntheliqVenture.id);
  } catch {
    // fallback
  }

  if (!syntheliqVentureId) {
    logger.info("Syntheliq reconcile: Syntheliq venture not found — skipping");
    return;
  }

  const allTasks = await storage.getTasks({ ventureId: syntheliqVentureId });
  const openTasks = allTasks.filter((t: any) =>
    ["todo", "next", "in_progress", "idea"].includes(t.status)
  );

  if (openTasks.length === 0) {
    logger.info("Syntheliq reconcile: no open Syntheliq tasks");
    return;
  }

  // Fuzzy match: keyword overlap between run agent+summary and task titles
  const matches: Array<{ task: any; run: any; overlap: number }> = [];

  for (const run of completedRuns) {
    const runWords = `${run.agentName || ""} ${run.summary || ""}`.toLowerCase().split(/\W+/).filter((w: string) => w.length > 3);
    for (const task of openTasks) {
      const taskWords = (task.title || "").toLowerCase().split(/\W+/).filter((w: string) => w.length > 3);
      const overlap = runWords.filter((w: string) => taskWords.includes(w)).length;
      if (overlap >= 2) {
        matches.push({ task, run, overlap });
      }
    }
  }

  if (matches.length === 0) {
    logger.info({ completedRuns: completedRuns.length, openTasks: openTasks.length }, "Syntheliq reconcile: no matches found");
    return;
  }

  // Sort by overlap descending, take top 5
  matches.sort((a, b) => b.overlap - a.overlap);
  const topMatches = matches.slice(0, 5);

  // Build a prompt for CoS to present matches
  const matchLines = topMatches.map((m) =>
    `- Task "${m.task.title}" (${m.task.status}) ↔ Syntheliq run "${m.run.agentName}" completed: "${m.run.summary}" (overlap: ${m.overlap} keywords)`
  ).join("\n");

  const prompt = `SYNTHELIQ RECONCILIATION: The following SB-OS tasks may have been completed by Syntheliq agent runs in the last 6 hours. Review each match and present them to Sayed for confirmation. Do NOT auto-complete any tasks.\n\n${matchLines}\n\nFor each match, explain why you think they might be related and ask Sayed to confirm.`;

  const result = await executeAgentChat(agentSlug, prompt, "scheduler");

  // Send to Telegram
  try {
    const { sendProactiveMessage } = await import("../channels/channel-manager");
    const { getAuthorizedChatIds } = await import("../channels/adapters/telegram-adapter");
    for (const chatId of getAuthorizedChatIds()) {
      await sendProactiveMessage("telegram", chatId, formatMessage({
        header: msgHeader("🔄", "Syntheliq Reconciliation"),
        body: msgTruncate(escapeHtml(result.response)),
        cta: "/syntheliq runs for details",
      }));
    }
  } catch {
    // Telegram not configured
  }

  logger.info(
    { matches: topMatches.length, agentSlug },
    "Syntheliq reconciliation completed"
  );
});

// ============================================================================
// SYSTEM HEALTH CHECK (used by morning check-in + evening review)
// ============================================================================

/**
 * Run a lightweight system health check across key subsystems.
 * Returns an array of issue strings (empty = all healthy).
 */
async function runSystemHealthCheck(): Promise<string[]> {
  const issues: string[] = [];

  try {
    // 1. Pipeline health (existing function)
    const pipeline = await runPipelineHealthCheck();
    if (pipeline.overall === "fail") {
      issues.push(...pipeline.alerts);
    }
  } catch {
    issues.push("Pipeline health check failed to run");
  }

  try {
    // 2. Embedding jobs — check for backlog
    const { getJobStatus } = await import("../embedding-jobs");
    const embedStatus = getJobStatus();
    if (embedStatus.totalErrors > 10) {
      issues.push(`Embedding jobs: ${embedStatus.totalErrors} total errors`);
    }
  } catch {
    // Non-critical
  }

  try {
    // 3. Agent scheduler — check for jobs with errors
    const { getScheduleStatus } = await import("./agent-scheduler");
    const scheduleStatus = getScheduleStatus();
    for (const job of scheduleStatus) {
      if (job.errorCount > 0) {
        issues.push(`${job.agentSlug}:${job.jobName} has ${job.errorCount} error${job.errorCount > 1 ? "s" : ""}`);
      }
    }
  } catch {
    // Non-critical
  }

  try {
    // 4. Telegram connection
    const { telegramAdapter } = await import("../channels/adapters/telegram-adapter");
    if (!telegramAdapter.isConnected()) {
      issues.push("Telegram bot disconnected!");
    }
  } catch {
    // Non-critical — Telegram may not be configured
  }

  return issues;
}

// ============================================================================
// PIPELINE HEALTH CHECK LOGIC (shared between job handler and API endpoint)
// ============================================================================

export interface PipelineHealthResult {
  overall: "pass" | "fail";
  timestamp: string;
  checks: {
    sessionLogIngestion: { status: "pass" | "fail" | "skip"; detail: string };
    unprocessedBacklog: { status: "pass" | "fail"; detail: string; count: number };
    qdrantStatus: { status: "pass" | "fail"; detail: string; collections?: Record<string, { count: number }> };
    pineconeStatus: { status: "pass" | "fail"; detail: string };
    embeddingCoverage: { status: "pass" | "fail"; detail: string; total: number; withEmbeddings: number; ratio: number };
    memoryStaleness: { status: "pass" | "fail" | "skip"; detail: string; lastMemoryAge?: number };
    compactionHealth: { status: "pass" | "fail"; detail: string };
  };
  alerts: string[];
}

export async function runPipelineHealthCheck(): Promise<PipelineHealthResult> {
  const database = await getDb();
  const alerts: string[] = [];

  // --- Check 1: Session log ingestion (during active hours 8am-midnight Dubai / UTC+4) ---
  // Alert only if the most recent session log is >8 hours old during active hours.
  // This avoids false positives from simply not talking to an agent for a few hours.
  let sessionLogCheck: PipelineHealthResult["checks"]["sessionLogIngestion"];
  const SESSION_LOG_GAP_HOURS = 8;
  try {
    const nowUTC = new Date();
    const dubaiHour = (nowUTC.getUTCHours() + 4) % 24;
    const isActiveHours = dubaiHour >= 8 && dubaiHour < 24;

    if (isActiveHours) {
      const rows = await database
        .select({ createdAt: sessionLogs.createdAt })
        .from(sessionLogs)
        .orderBy(sql`${sessionLogs.createdAt} DESC`)
        .limit(1);

      const lastLog = rows[0]?.createdAt;
      const gapMs = lastLog ? Date.now() - new Date(lastLog).getTime() : Infinity;
      const gapHours = Math.round(gapMs / 1000 / 3600);

      if (gapMs > SESSION_LOG_GAP_HOURS * 60 * 60 * 1000) {
        const detail = lastLog
          ? `Last session log was ${gapHours}h ago (threshold: ${SESSION_LOG_GAP_HOURS}h, Dubai hour: ${dubaiHour})`
          : `No session logs exist at all`;
        sessionLogCheck = { status: "fail", detail };
        alerts.push(`Session log ingestion: No new session_logs rows in last ${SESSION_LOG_GAP_HOURS} hours during active hours`);
        logger.warn({ dubaiHour, gapHours }, "Pipeline health: Session log gap exceeded threshold");
      } else {
        sessionLogCheck = { status: "pass", detail: `Last session log ${gapHours}h ago` };
      }
    } else {
      sessionLogCheck = { status: "skip", detail: `Outside active hours (Dubai hour: ${dubaiHour})` };
    }
  } catch (err: any) {
    sessionLogCheck = { status: "fail", detail: `Query failed: ${err.message}` };
    alerts.push(`Session log ingestion check failed: ${err.message}`);
    logger.warn({ error: err.message }, "Pipeline health: Session log check query failed");
  }

  // --- Check 2: Unprocessed backlog (>20 unprocessed session logs) ---
  let unprocessedCheck: PipelineHealthResult["checks"]["unprocessedBacklog"];
  try {
    const [{ count: unprocessedCount }] = await database
      .select({ count: sql`COUNT(*)::int` })
      .from(sessionLogs)
      .where(eq(sessionLogs.processed, false));

    if (unprocessedCount > 20) {
      unprocessedCheck = { status: "fail", detail: `${unprocessedCount} unprocessed session logs (threshold: 20)`, count: unprocessedCount };
      alerts.push(`Nightly cron backlog: ${unprocessedCount} unprocessed session logs piling up (>20)`);
      logger.warn({ unprocessedCount }, "Pipeline health: Unprocessed session logs exceeding threshold");
    } else {
      unprocessedCheck = { status: "pass", detail: `${unprocessedCount} unprocessed session log(s)`, count: unprocessedCount };
    }
  } catch (err: any) {
    unprocessedCheck = { status: "fail", detail: `Query failed: ${err.message}`, count: -1 };
    alerts.push(`Unprocessed backlog check failed: ${err.message}`);
    logger.warn({ error: err.message }, "Pipeline health: Unprocessed backlog check query failed");
  }

  // --- Check 3: Qdrant status ---
  let qdrantCheck: PipelineHealthResult["checks"]["qdrantStatus"];
  try {
    const { getQdrantStatus } = await import("../memory/qdrant-store");
    const qdrant = await getQdrantStatus();

    if (!qdrant.available) {
      qdrantCheck = { status: "fail", detail: `Qdrant unavailable: ${qdrant.error || "unknown"}` };
      alerts.push(`Qdrant unavailable: ${qdrant.error || "connection failed"}`);
      logger.warn({ error: qdrant.error }, "Pipeline health: Qdrant unavailable");
    } else {
      // Check if raw_memories has any points (basic sanity)
      const rawCount = qdrant.collections["raw_memories"]?.count || 0;
      qdrantCheck = { status: "pass", detail: `Qdrant available, raw_memories: ${rawCount} points`, collections: qdrant.collections };
    }
  } catch (err: any) {
    qdrantCheck = { status: "fail", detail: `Qdrant check failed: ${err.message}` };
    alerts.push(`Qdrant check error: ${err.message}`);
    logger.warn({ error: err.message }, "Pipeline health: Qdrant check threw");
  }

  // --- Check 4: Pinecone status ---
  let pineconeCheck: PipelineHealthResult["checks"]["pineconeStatus"];
  try {
    const { getPineconeStatus } = await import("../memory/pinecone-store");
    const pinecone = await getPineconeStatus();

    if (!pinecone.available) {
      pineconeCheck = { status: "fail", detail: `Pinecone unavailable: ${pinecone.error || "unknown"}` };
      alerts.push(`Pinecone disconnected: ${pinecone.error || "connection failed"}`);
      logger.warn({ error: pinecone.error }, "Pipeline health: Pinecone unavailable");
    } else {
      const totalRecords = pinecone.stats?.totalRecordCount || 0;
      if (totalRecords === 0) {
        pineconeCheck = { status: "fail", detail: `Pinecone connected but empty (0 records)` };
        alerts.push(`Pinecone empty: connected but 0 records — upsert pipeline not working`);
      } else {
        pineconeCheck = { status: "pass", detail: `Pinecone available, ${totalRecords} total records` };
      }
    }
  } catch (err: any) {
    pineconeCheck = { status: "fail", detail: `Pinecone check failed: ${err.message}` };
    alerts.push(`Pinecone check error: ${err.message}`);
    logger.warn({ error: err.message }, "Pipeline health: Pinecone check threw");
  }

  // --- Check 5: Embedding coverage (memories with embeddings vs total) ---
  let embeddingCoverageCheck: PipelineHealthResult["checks"]["embeddingCoverage"];
  try {
    const [{ total, withEmb }] = await database
      .select({
        total: sql`COUNT(*)::int`,
        withEmb: sql`COUNT(CASE WHEN embedding IS NOT NULL AND embedding != '' THEN 1 END)::int`,
      })
      .from(agentMemory);

    const ratio = total > 0 ? withEmb / total : 0;
    if (total > 10 && ratio < 0.5) {
      embeddingCoverageCheck = { status: "fail", detail: `Only ${withEmb}/${total} memories have embeddings (${(ratio * 100).toFixed(0)}%)`, total, withEmbeddings: withEmb, ratio };
      alerts.push(`Embedding coverage critical: ${withEmb}/${total} (${(ratio * 100).toFixed(0)}%) — vector search is degraded`);
      logger.warn({ total, withEmb, ratio }, "Pipeline health: Low embedding coverage");
    } else {
      embeddingCoverageCheck = { status: "pass", detail: `${withEmb}/${total} memories embedded (${(ratio * 100).toFixed(0)}%)`, total, withEmbeddings: withEmb, ratio };
    }
  } catch (err: any) {
    embeddingCoverageCheck = { status: "fail", detail: `Query failed: ${err.message}`, total: 0, withEmbeddings: 0, ratio: 0 };
    alerts.push(`Embedding coverage check failed: ${err.message}`);
  }

  // --- Check 6: Memory staleness (no new memories in 48+ hours) ---
  let stalenessCheck: PipelineHealthResult["checks"]["memoryStaleness"];
  try {
    const [latest] = await database
      .select({ maxDate: sql`MAX(created_at)` })
      .from(agentMemory);

    if (latest?.maxDate) {
      const lastDate = new Date(latest.maxDate as string);
      const hoursAgo = (Date.now() - lastDate.getTime()) / (1000 * 60 * 60);

      if (hoursAgo > 48) {
        stalenessCheck = { status: "fail", detail: `Last memory created ${hoursAgo.toFixed(0)}h ago — pipeline may be stalled`, lastMemoryAge: hoursAgo };
        alerts.push(`Memory pipeline stale: last memory was ${hoursAgo.toFixed(0)} hours ago (>48h threshold)`);
        logger.warn({ hoursAgo }, "Pipeline health: Memory pipeline stale");
      } else {
        stalenessCheck = { status: "pass", detail: `Last memory ${hoursAgo.toFixed(1)}h ago`, lastMemoryAge: hoursAgo };
      }
    } else {
      stalenessCheck = { status: "fail", detail: "No memories found at all" };
      alerts.push("Memory pipeline: No memories exist in database");
    }
  } catch (err: any) {
    stalenessCheck = { status: "fail", detail: `Query failed: ${err.message}` };
    alerts.push(`Memory staleness check failed: ${err.message}`);
  }

  // --- Check 7: Compaction health (compacted_memories should not be empty if raw_memories exists) ---
  let compactionCheck: PipelineHealthResult["checks"]["compactionHealth"];
  try {
    const rawCount = qdrantCheck?.collections?.["raw_memories"]?.count || 0;
    const compactedCount = qdrantCheck?.collections?.["compacted_memories"]?.count || 0;

    if (rawCount > 50 && compactedCount === 0) {
      compactionCheck = { status: "fail", detail: `${rawCount} raw memories but 0 compacted — compaction→Qdrant pipeline is broken` };
      alerts.push(`Compaction pipeline broken: ${rawCount} raw vectors in Qdrant but compacted_memories is empty`);
      logger.warn({ rawCount, compactedCount }, "Pipeline health: Compaction not reaching Qdrant");
    } else {
      compactionCheck = { status: "pass", detail: `raw: ${rawCount}, compacted: ${compactedCount}` };
    }
  } catch (err: any) {
    compactionCheck = { status: "fail", detail: `Check failed: ${err.message}` };
  }

  const overall = alerts.length > 0 ? "fail" : "pass";

  return {
    overall,
    timestamp: new Date().toISOString(),
    checks: {
      sessionLogIngestion: sessionLogCheck,
      unprocessedBacklog: unprocessedCheck,
      qdrantStatus: qdrantCheck,
      pineconeStatus: pineconeCheck,
      embeddingCoverage: embeddingCoverageCheck,
      memoryStaleness: stalenessCheck,
      compactionHealth: compactionCheck,
    },
    alerts,
  };
}

/**
 * Newsletter Digest — Summarise AI newsletters from SyntheLIQ inbox, send Telegram digest.
 * Runs daily at 8am Dubai.
 * Requires SYNTHELIQ_GMAIL_REFRESH_TOKEN env var.
 */
registerJobHandler("newsletter_digest", async (_agentId: string, agentSlug: string) => {
  const { runNewsletterDigest } = await import("./newsletter-digest");
  const result = await runNewsletterDigest();

  logger.info(
    { agentSlug, processed: result.processed, skipped: result.skipped },
    "Newsletter digest completed"
  );
});

/**
 * Email Triage — Classify unread emails and send Telegram digest.
 * Runs 3x/day: 8am, 1pm, 6pm Dubai.
 */
registerJobHandler("email_triage", async (_agentId: string, agentSlug: string) => {
  const { runEmailTriage } = await import("./email-triage");
  const result = await runEmailTriage();

  logger.info(
    { agentSlug, triaged: result.triaged, urgent: result.urgent, errors: result.errors.length },
    "Email triage completed"
  );
});

/**
 * Meeting Prep — Check for upcoming meetings and prepare briefs.
 * Runs every 15 minutes, triggers 30min before meetings with external attendees.
 */
registerJobHandler("meeting_prep", async (_agentId: string, agentSlug: string) => {
  const { checkAndPrepMeetings } = await import("./meeting-prep");
  const result = await checkAndPrepMeetings();

  logger.info(
    { agentSlug, prepped: result.prepped, skipped: result.skipped },
    "Meeting prep check completed"
  );
});

/**
 * Inbox Triage — Process unclarified captures and suggest actions.
 */
registerJobHandler("inbox_triage", async (agentId: string, agentSlug: string) => {
  const prompt = `Check the inbox for unclarified capture items. For each one, suggest whether it should be converted to a task, delegated to a specialist, or dismissed. List your recommendations.`;

  await executeAgentChat(agentSlug, prompt, "scheduler");

  logger.info({ agentSlug }, "Inbox triage completed");
});

// ============================================================================
// PROJECT HEALTH — MVP Builder checks for stalled projects/tasks
// ============================================================================

/**
 * Project Health — MVP Builder identifies blocked/stalled tasks and projects.
 * Runs MWF at 12pm Dubai. Queries tasks stuck >7 days, feeds to MVP Builder.
 */
registerJobHandler("project_health", async (_agentId: string, _agentSlug: string) => {
  const database = await getDb();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Find stale in-progress tasks (no update in 7+ days)
  const staleTasks = await database
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      priority: tasks.priority,
      updatedAt: tasks.updatedAt,
      projectId: tasks.projectId,
    })
    .from(tasks)
    .where(
      sql`${tasks.status} = 'in_progress' AND ${tasks.updatedAt} < ${sevenDaysAgo}`
    );

  // Find stale in-progress projects
  const staleProjects = await database
    .select({
      id: projects.id,
      name: projects.name,
      status: projects.status,
      updatedAt: projects.updatedAt,
      ventureId: projects.ventureId,
    })
    .from(projects)
    .where(
      sql`${projects.status} = 'in_progress' AND ${projects.updatedAt} < ${sevenDaysAgo}`
    );

  // Find on-hold tasks
  const blockedTasks = await database
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      priority: tasks.priority,
    })
    .from(tasks)
    .where(eq(tasks.status, "on_hold"));

  const prompt = `You are running your scheduled project health check. Here are the findings:

## Stale In-Progress Tasks (no update in 7+ days): ${staleTasks.length}
${staleTasks.length > 0 ? staleTasks.map((t: any) => `- [${t.priority || "P2"}] "${t.title}" (ID: ${t.id}, last updated: ${t.updatedAt})`).join("\n") : "None found — all tasks are progressing."}

## Stale In-Progress Projects (no update in 7+ days): ${staleProjects.length}
${staleProjects.length > 0 ? staleProjects.map((p: any) => `- "${p.name}" (ID: ${p.id}, last updated: ${p.updatedAt})`).join("\n") : "None found."}

## On-Hold Tasks: ${blockedTasks.length}
${blockedTasks.length > 0 ? blockedTasks.map((t: any) => `- [${t.priority || "P2"}] "${t.title}" (ID: ${t.id})`).join("\n") : "None found."}

---

For each stalled item:
1. If it can be unblocked, create an unblock task with \`create_task\`
2. If it needs CTO attention, flag it clearly
3. If it should be deprioritized or cancelled, recommend that

Be practical — focus on what moves the needle.`;

  await executeAgentChat("mvp-builder", prompt, "scheduler");

  logger.info(
    { staleTasks: staleTasks.length, staleProjects: staleProjects.length, blockedTasks: blockedTasks.length },
    "Project health check completed"
  );
});

// ============================================================================
// VENTURE HEALTH — Venture Architect reviews all ventures
// ============================================================================

/**
 * Venture Health — Venture Architect reviews all ventures for status vs plan.
 * Runs Thursdays at 2pm Dubai. Queries ventures with project/task counts.
 */
registerJobHandler("venture_health", async (_agentId: string, _agentSlug: string) => {
  const database = await getDb();

  // Get all ventures with project and task counts
  const allVentures = await database
    .select({
      id: ventures.id,
      name: ventures.name,
      status: ventures.status,
      domain: ventures.domain,
      oneLiner: ventures.oneLiner,
      updatedAt: ventures.updatedAt,
    })
    .from(ventures);

  // Get project counts per venture
  const projectCounts = await database
    .select({
      ventureId: projects.ventureId,
      count: sql<number>`COUNT(*)::int`,
      activeCount: sql<number>`COUNT(*) FILTER (WHERE ${projects.status} = 'in_progress')::int`,
    })
    .from(projects)
    .groupBy(projects.ventureId);

  // Get task counts per venture
  const taskCounts = await database
    .select({
      ventureId: tasks.ventureId,
      total: sql<number>`COUNT(*)::int`,
      done: sql<number>`COUNT(*) FILTER (WHERE ${tasks.status} = 'completed')::int`,
      inProgress: sql<number>`COUNT(*) FILTER (WHERE ${tasks.status} = 'in_progress')::int`,
    })
    .from(tasks)
    .groupBy(tasks.ventureId);

  const projectMap = new Map<string, any>(projectCounts.map((p: any) => [p.ventureId, p]));
  const taskMap = new Map<string, any>(taskCounts.map((t: any) => [t.ventureId, t]));

  const ventureSummaries = allVentures.map((v: any) => {
    const pc = projectMap.get(v.id) || { count: 0, activeCount: 0 };
    const tc = taskMap.get(v.id) || { total: 0, done: 0, inProgress: 0 };
    return `### ${v.name} (${v.status})
- Domain: ${v.domain} | Last updated: ${v.updatedAt || "never"}
- ${v.oneLiner || "No description"}
- Projects: ${pc.count} total, ${pc.activeCount} active
- Tasks: ${tc.total} total, ${tc.done} done, ${tc.inProgress} in progress`;
  });

  const prompt = `You are running your scheduled venture health review. Here is the current state of all ventures:

## Ventures Overview (${allVentures.length} total)

${ventureSummaries.join("\n\n")}

---

Review each venture and assess:
1. **Status vs reality** — Is the status accurate? Should any be updated?
2. **Missing structure** — Are there ventures without projects, phases, or tasks?
3. **Stalled ventures** — Any venture with no recent activity that should be addressed?
4. **Untracked work** — Based on your knowledge, are there ventures or projects that exist but aren't tracked here?

Submit your findings as a structured report via \`submit_deliverable\`.`;

  await executeAgentChat("venture-architect", prompt, "scheduler");

  logger.info(
    { ventureCount: allVentures.length },
    "Venture health review completed"
  );
});

// ============================================================================
// AGENT PERFORMANCE — Agent Engineer analyzes system health
// ============================================================================

/**
 * Agent Performance — Agent Engineer analyzes dead letters, failed jobs, conversation volume.
 * Runs Fridays at 3pm Dubai. Queries operational metrics and feeds to Agent Engineer.
 */
registerJobHandler("agent_performance", async (_agentId: string, _agentSlug: string) => {
  const database = await getDb();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Dead letters in last 7 days
  let deadLetters: any[] = [];
  try {
    deadLetters = await database
      .select({
        id: deadLetterJobs.id,
        jobName: deadLetterJobs.jobName,
        agentSlug: deadLetterJobs.agentSlug,
        error: deadLetterJobs.error,
        failedAt: deadLetterJobs.failedAt,
      })
      .from(deadLetterJobs)
      .where(gte(deadLetterJobs.failedAt, sevenDaysAgo));
  } catch {
    // Table may not exist yet
  }

  // Conversation counts per agent (last 7 days)
  const convoCounts = await database
    .select({
      agentId: agentConversations.agentId,
      messageCount: sql<number>`COUNT(*)::int`,
    })
    .from(agentConversations)
    .where(gte(agentConversations.createdAt, sevenDaysAgo))
    .groupBy(agentConversations.agentId);

  // Look up agent names
  const allAgents = await database
    .select({ id: agents.id, name: agents.name, slug: agents.slug })
    .from(agents)
    .where(eq(agents.isActive, true));
  const agentMap = new Map<string, any>(allAgents.map((a: any) => [a.id, a]));

  const convoSummary = convoCounts
    .map((c: any) => {
      const agent = agentMap.get(c.agentId);
      return `- ${agent?.name || c.agentId}: ${c.messageCount} messages`;
    })
    .join("\n");

  // Compaction events (last 7 days)
  let compactionStats = "";
  try {
    const compactions = await database
      .select({
        agentId: agentCompactionEvents.agentId,
        count: sql<number>`COUNT(*)::int`,
        totalSaved: sql<number>`SUM(${agentCompactionEvents.tokensSaved})::int`,
      })
      .from(agentCompactionEvents)
      .where(gte(agentCompactionEvents.createdAt, sevenDaysAgo))
      .groupBy(agentCompactionEvents.agentId);

    if (compactions.length > 0) {
      compactionStats = compactions
        .map((c: any) => {
          const agent = agentMap.get(c.agentId);
          return `- ${agent?.name || c.agentId}: ${c.count} compactions, ${c.totalSaved} tokens saved`;
        })
        .join("\n");
    }
  } catch {
    compactionStats = "Compaction data unavailable";
  }

  const prompt = `You are running your weekly agent performance analysis. Here are the metrics for the last 7 days:

## Dead Letter Jobs (failed jobs): ${deadLetters.length}
${deadLetters.length > 0 ? deadLetters.map((d: any) => `- ${d.agentSlug}:${d.jobName} — ${(d.error || "unknown error").slice(0, 200)} (${d.failedAt})`).join("\n") : "No failures — all jobs executed successfully."}

## Agent Conversation Volume
${convoSummary || "No agent conversations in the last 7 days."}

## Context Compaction Events
${compactionStats || "No compaction events recorded."}

## Active Agents: ${allAgents.length}
${allAgents.map((a: any) => `- ${a.name} (${a.slug})`).join("\n")}

---

Analyze these metrics and provide:
1. **Health assessment** — Are agents working as expected? Any silent failures?
2. **Optimization opportunities** — Are any agents over/under-utilized?
3. **Dead letter analysis** — Root cause patterns in failures
4. **Recommendations** — Specific improvements to agent configs, schedules, or tooling

Submit your analysis via \`submit_deliverable\`.`;

  await executeAgentChat("agent-engineer", prompt, "scheduler");

  logger.info(
    { deadLetters: deadLetters.length, activeAgents: allAgents.length },
    "Agent performance analysis completed"
  );
});

// ============================================================================
// MODEL COST REVIEW — Agent Engineer evaluates model pricing
// ============================================================================

/**
 * Model Cost Review — Agent Engineer checks OpenRouter for cheaper/better models.
 * Runs Mondays at 12pm Dubai. Fetches model list and compares to current usage.
 */
registerJobHandler("model_cost_review", async (_agentId: string, _agentSlug: string) => {
  const database = await getDb();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Count conversations per agent (proxy for token usage)
  const agentUsage = await database
    .select({
      agentId: agentConversations.agentId,
      messageCount: sql<number>`COUNT(*)::int`,
    })
    .from(agentConversations)
    .where(gte(agentConversations.createdAt, sevenDaysAgo))
    .groupBy(agentConversations.agentId);

  // Look up agent details
  const allAgents = await database
    .select({ id: agents.id, name: agents.name, slug: agents.slug, modelTier: agents.modelTier })
    .from(agents)
    .where(eq(agents.isActive, true));
  const agentMap = new Map<string, any>(allAgents.map((a: any) => [a.id, a]));

  const usageSummary = agentUsage
    .map((u: any) => {
      const agent = agentMap.get(u.agentId);
      return `- ${agent?.name || u.agentId} (${agent?.modelTier || "unknown"} tier): ${u.messageCount} messages/week`;
    })
    .join("\n");

  // Fetch OpenRouter model list
  let modelListSummary = "Could not fetch model list — check OpenRouter API key.";
  try {
    const resp = await fetch("https://openrouter.ai/api/v1/models");
    if (resp.ok) {
      const data = await resp.json();
      // Filter for fast/cheap models comparable to Haiku
      const relevantModels = (data.data || [])
        .filter((m: any) => {
          const pricing = m.pricing;
          if (!pricing) return false;
          const promptPrice = parseFloat(pricing.prompt || "999");
          // Under $1/M tokens (cheap tier)
          return promptPrice < 0.000001;
        })
        .slice(0, 20)
        .map((m: any) => `- ${m.id}: $${(parseFloat(m.pricing.prompt) * 1_000_000).toFixed(4)}/M prompt, $${(parseFloat(m.pricing.completion) * 1_000_000).toFixed(4)}/M completion, context: ${m.context_length || "?"}`);

      if (relevantModels.length > 0) {
        modelListSummary = relevantModels.join("\n");
      } else {
        modelListSummary = "No models found under $1/M tokens threshold.";
      }
    }
  } catch (err: any) {
    modelListSummary = `Fetch failed: ${err.message}`;
  }

  const prompt = `You are running your weekly model cost review. Here is the current state:

## Current Agent Usage (last 7 days)
${usageSummary || "No agent activity recorded."}

## Current Model Tiers
- **fast** (Haiku): Used by specialists — lowest cost, good for routine tasks
- **mid** (Sonnet): Used by executives — balanced cost/capability
- **top** (Opus): Used by CoS only — highest capability

## Available Cheap Models on OpenRouter (under $1/M tokens)
${modelListSummary}

---

Analyze and recommend:
1. **Cost comparison** — Estimate weekly spend based on message counts and model pricing
2. **Model alternatives** — Are there models that offer better price/performance for our use case?
3. **Tier optimization** — Should any agents move to a different tier based on their actual task complexity?
4. **Savings estimate** — What could we save monthly by switching?

Submit your analysis via \`submit_deliverable\`.`;

  await executeAgentChat("agent-engineer", prompt, "scheduler");

  logger.info("Model cost review completed");
});

// ============================================================================
// LIBRARIAN — Knowledge Extraction & Audit
// ============================================================================

/**
 * Knowledge Extraction — Mine agent conversations from the last 48h
 * and extract learnings, decisions, patterns into the Knowledge Hub.
 * Runs daily at 10pm UTC.
 */
registerJobHandler("knowledge_extraction", async (_agentId: string, _agentSlug: string) => {
  const database = await getDb();

  // 1. Query conversations from the last 48 hours (user + assistant only)
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const recentConversations = await database
    .select({
      id: agentConversations.id,
      agentId: agentConversations.agentId,
      role: agentConversations.role,
      content: agentConversations.content,
      createdAt: agentConversations.createdAt,
    })
    .from(agentConversations)
    .innerJoin(agents, eq(agents.id, agentConversations.agentId))
    .where(
      sql`${agentConversations.createdAt} > ${cutoff} AND ${agentConversations.role} IN ('user', 'assistant')`
    )
    .orderBy(agentConversations.createdAt);

  if (recentConversations.length === 0) {
    logger.info("Knowledge extraction: no conversations in the last 48h, skipping");
    return;
  }

  // 2. Group by agent and build summaries
  const byAgent = new Map<string, { agentId: string; messages: { role: string; content: string }[] }>();
  for (const row of recentConversations) {
    const key = row.agentId;
    if (!byAgent.has(key)) {
      byAgent.set(key, { agentId: key, messages: [] });
    }
    byAgent.get(key)!.messages.push({ role: row.role, content: row.content });
  }

  // 3. Build extraction prompt with conversation summaries
  const summaries: string[] = [];
  const entries = Array.from(byAgent.entries());
  for (const [agentId, data] of entries) {
    // Look up agent name
    const [agentRow] = await database.select({ name: agents.name, slug: agents.slug }).from(agents).where(eq(agents.id, agentId));
    const agentName = agentRow?.name || agentRow?.slug || agentId;
    const convoText = data.messages
      .map((m: { role: string; content: string }) => `[${m.role}]: ${m.content.slice(0, 1000)}`)
      .join("\n");
    summaries.push(`### ${agentName}\n${convoText}`);
  }

  const extractionPrompt = `You are running your scheduled knowledge extraction job. Below are conversation summaries from the last 48 hours across all agents. Your job:

1. **Extract small learnings/observations** → Use the \`remember\` tool (shared scope). These are facts, preferences, patterns.
2. **Extract decisions** → Create or update a "Decision Register" doc per venture via \`create_doc\`. Include who decided, context, rationale.
3. **Spot cross-venture patterns** → Submit via \`submit_deliverable\` as type \`recommendation\` for Sayed's review.
4. **Create synthesis docs or playbooks** → Submit via \`submit_deliverable\` as type \`document\` for review.

IMPORTANT: Before creating ANY document, search the Knowledge Hub first with \`search_knowledge_base\` to avoid duplication. Update existing docs when possible.

## Conversations (last 48h)

${summaries.join("\n\n---\n\n")}

---

Process these conversations now. Extract what's valuable, discard what's noise. Focus on actionable knowledge, not status updates.`;

  // 4. Execute through the Librarian agent
  await executeAgentChat("librarian", extractionPrompt, "scheduler");

  logger.info(
    { agentsScanned: byAgent.size, totalMessages: recentConversations.length },
    "Knowledge extraction completed"
  );
});

/**
 * Knowledge Audit — Scan the Knowledge Hub for stale, orphaned, and duplicate docs.
 * Runs Wednesdays at 10am UTC.
 */
registerJobHandler("knowledge_audit", async (_agentId: string, _agentSlug: string) => {
  const { storage } = await import("../storage");

  // 1. Get all docs
  const allDocs = await storage.getDocs({ status: "active" });

  if (allDocs.length === 0) {
    logger.info("Knowledge audit: no active docs found, skipping");
    return;
  }

  const now = new Date();
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  // 2. Find stale docs (not updated in 90+ days)
  const staleDocs = allDocs.filter((d: any) => {
    const updated = d.updatedAt ? new Date(d.updatedAt) : d.createdAt ? new Date(d.createdAt) : null;
    return updated && updated < ninetyDaysAgo;
  });

  // 3. Find orphaned docs (no venture, no project, no tags)
  const orphanedDocs = allDocs.filter(
    (d: any) => !d.ventureId && !d.projectId && (!d.tags || d.tags.trim() === "")
  );

  // 4. Find potential duplicates (similar titles)
  const potentialDupes: { docA: string; docB: string; titleA: string; titleB: string }[] = [];
  for (let i = 0; i < allDocs.length; i++) {
    for (let j = i + 1; j < allDocs.length; j++) {
      const a = (allDocs[i] as any).title?.toLowerCase().trim() || "";
      const b = (allDocs[j] as any).title?.toLowerCase().trim() || "";
      if (a && b && (a === b || a.includes(b) || b.includes(a))) {
        potentialDupes.push({
          docA: String((allDocs[i] as any).id),
          docB: String((allDocs[j] as any).id),
          titleA: (allDocs[i] as any).title,
          titleB: (allDocs[j] as any).title,
        });
      }
    }
  }

  // 5. Build audit prompt for the Librarian
  const auditPrompt = `You are running your scheduled knowledge audit. Here are the findings:

## KB Health Summary
- **Total active docs**: ${allDocs.length}
- **Stale docs (90+ days)**: ${staleDocs.length}
- **Orphaned docs (no venture/project/tags)**: ${orphanedDocs.length}
- **Potential duplicates**: ${potentialDupes.length}

## Stale Docs
${staleDocs.length > 0 ? staleDocs.slice(0, 20).map((d: any) => `- "${d.title}" (ID: ${d.id}, last updated: ${d.updatedAt || d.createdAt})`).join("\n") : "None found."}

## Orphaned Docs
${orphanedDocs.length > 0 ? orphanedDocs.slice(0, 20).map((d: any) => `- "${d.title}" (ID: ${d.id}, type: ${d.type || "unknown"})`).join("\n") : "None found."}

## Potential Duplicates
${potentialDupes.length > 0 ? potentialDupes.slice(0, 10).map((d) => `- "${d.titleA}" (${d.docA}) ↔ "${d.titleB}" (${d.docB})`).join("\n") : "None found."}

---

Generate a structured audit report and submit it via \`submit_deliverable\` as type \`document\` titled "Knowledge Hub Audit Report — ${now.toISOString().split("T")[0]}".

Include recommendations for each stale doc (archive, update, or keep), suggested tags/ventures for orphaned docs, and merge recommendations for duplicates.`;

  await executeAgentChat("librarian", auditPrompt, "scheduler");

  logger.info(
    { totalDocs: allDocs.length, stale: staleDocs.length, orphaned: orphanedDocs.length, dupes: potentialDupes.length },
    "Knowledge audit completed"
  );
});

// ============================================================================
// WIKI GENERATION (nightly via Librarian)
// ============================================================================

/**
 * Generate/refresh wiki articles for the top 10 entities.
 * Runs nightly via the Librarian agent schedule.
 */
registerJobHandler("wiki_generation", async (_agentId: string, _agentSlug: string) => {
  try {
    const { generateWikiBatch } = await import("../memory/wiki-synthesizer");
    const result = await generateWikiBatch(10);
    logger.info(result, "Wiki generation batch complete");
  } catch (err) {
    logger.error({ err }, "Wiki generation batch failed");
  }
});

// ============================================================================
// ENTITY DEDUP — Librarian merges near-duplicate entity names
// ============================================================================

/**
 * Find and merge duplicate entities in entity_relations.
 * Groups by normalized name (lowercased, spaces collapsed), keeps the
 * most-mentioned variant as canonical, re-attributes all mention counts.
 * Runs nightly at 3am via the Librarian schedule.
 */
registerJobHandler("entity_dedup", async (_agentId: string, _agentSlug: string) => {
  try {
    const database = await getDb();
    const { entityRelations } = await import("@shared/schema");
    const { sql, eq } = await import("drizzle-orm");

    // Fetch all entity names with total mention count
    const rows = await database
      .select({
        source: entityRelations.sourceName,
        target: entityRelations.targetName,
        count: sql<number>`sum(${entityRelations.mentionCount})`,
      })
      .from(entityRelations)
      .groupBy(entityRelations.sourceName, entityRelations.targetName);

    // Collect all unique entity names
    const allNames = new Set<string>();
    for (const r of rows) {
      allNames.add(r.source);
      allNames.add(r.target);
    }

    // Normalize: strip punctuation, lowercase, collapse spaces
    const normalize = (s: string) =>
      s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

    // Group by normalized form
    const groups = new Map<string, string[]>();
    for (const name of Array.from(allNames)) {
      const key = normalize(name);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(name);
    }

    // Find groups with more than one variant
    const duplicateGroups = Array.from(groups.entries()).filter(([, names]) => names.length > 1);

    if (duplicateGroups.length === 0) {
      logger.info("Entity dedup: no duplicates found");
      return;
    }

    // For each group, pick canonical = alphabetically first (stable sort)
    // In a future iteration this could use LLM to pick the "official" form
    let mergedCount = 0;
    for (const [, variants] of duplicateGroups) {
      const canonical = [...variants].sort()[0];
      const aliases = variants.filter(v => v !== canonical);

      for (const alias of aliases) {
        // Re-attribute rows where alias is the source
        await database
          .update(entityRelations)
          .set({ sourceName: canonical })
          .where(eq(entityRelations.sourceName, alias));

        // Re-attribute rows where alias is the target
        await database
          .update(entityRelations)
          .set({ targetName: canonical })
          .where(eq(entityRelations.targetName, alias));

        mergedCount++;
      }
    }

    logger.info({ mergedCount, groupsProcessed: duplicateGroups.length }, "Entity dedup complete");
  } catch (err) {
    logger.error({ err }, "Entity dedup failed");
  }
});

// ============================================================================
// CREDIT BALANCE MONITOR
// ============================================================================

/**
 * Check OpenRouter credit balance every 6 hours.
 * Sends Telegram alert if balance is low ($2) or critical ($0.50).
 */
registerJobHandler("check_credit_balance", async (_agentId: string, _agentSlug: string) => {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    logger.warn("check_credit_balance: OPENROUTER_API_KEY not set, skipping");
    return;
  }

  try {
    const res = await fetch("https://openrouter.ai/api/v1/auth/key", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) {
      logger.error({ status: res.status }, "check_credit_balance: Failed to fetch credit info");
      return;
    }

    const data = await res.json() as { data: { limit: number; usage: number; limit_remaining: number } };
    const remaining = data.data.limit_remaining;
    const limit = data.data.limit;
    const usage = data.data.usage;

    logger.info(
      { remaining, limit, usage },
      `OpenRouter credit check: $${(remaining / 100).toFixed(2)} remaining`
    );

    // Convert from credits (cents?) to dollars — OpenRouter returns dollars
    const remainingDollars = remaining;

    let alertLevel: "critical" | "warning" | null = null;
    if (remainingDollars < 0.50) {
      alertLevel = "critical";
    } else if (remainingDollars < 2) {
      alertLevel = "warning";
    }

    if (alertLevel) {
      const emoji = alertLevel === "critical" ? "🚨" : "⚠️";
      const urgency = alertLevel === "critical" ? "CRITICAL" : "LOW";
      const message = formatMessage({
        header: msgHeader(emoji, `${urgency}: OpenRouter Credits`),
        body: `<b>Remaining:</b> $${remainingDollars.toFixed(2)}\n<b>Used:</b> $${usage.toFixed(2)} of $${limit.toFixed(2)} limit\n\nTop up: https://openrouter.ai/settings/credits`,
      });

      try {
        const { sendProactiveMessage } = await import("../channels/channel-manager");
        const { getAuthorizedChatIds } = await import("../channels/adapters/telegram-adapter");
        for (const chatId of getAuthorizedChatIds()) {
          await sendProactiveMessage("telegram", chatId, message);
        }
      } catch {
        // Telegram not configured — log only
        logger.warn({ remainingDollars, alertLevel }, "OpenRouter credits low but Telegram not configured");
      }
    }
  } catch (err: any) {
    logger.error({ error: err.message }, "check_credit_balance: unexpected error");
  }
});

// ============================================================================
// CONTENT QUEUE — Venture-scoped social media draft production
// ============================================================================

registerJobHandler("content_queue", async (agentId: string, agentSlug: string) => {
  const database = await getDb();

  // Load agent to get ventureId
  const [agent] = await database
    .select()
    .from(agents)
    .where(eq(agents.id, agentId));

  if (!agent) {
    logger.warn({ agentId, agentSlug }, "content_queue: agent not found");
    return;
  }

  if (!agent.ventureId) {
    logger.warn({ agentSlug }, "content_queue: agent has no ventureId — skipping");
    return;
  }

  // Fetch venture context
  let ventureContext = "";
  try {
    const { getCachedOrBuildContext } = await import("../venture-context-builder");
    ventureContext = await getCachedOrBuildContext(agent.ventureId);
  } catch (err: any) {
    logger.debug({ err: err.message }, "content_queue: venture context fetch failed");
  }

  // Fetch venture name for the prompt
  let ventureName = "the venture";
  try {
    const [venture] = await database.select({ name: ventures.name }).from(ventures).where(eq(ventures.id, agent.ventureId));
    if (venture) ventureName = venture.name;
  } catch { /* fallback */ }

  const today = getUserDate();
  const dayOfWeek = new Date().toLocaleDateString("en-US", { weekday: "long" });

  const prompt = `You are producing this week's social media content batch for ${ventureName}. Today is ${dayOfWeek}, ${today}.

${ventureContext ? `## Venture Context\n${ventureContext}\n` : ""}

## Your Task
Create 3-5 platform-ready social media post drafts. For each draft, provide:

1. **Platform** (e.g., LinkedIn, X/Twitter, Instagram, TikTok)
2. **Post copy** — full ready-to-publish text including hooks, body, and CTA
3. **Visual direction** — describe the image/graphic/video concept (so a designer or AI tool can create it)
4. **Suggested posting time** — day and time slot optimized for the platform's audience
5. **Hashtags** — 3-8 relevant hashtags
6. **Content type** — educational, promotional, engagement, thought leadership, or behind-the-scenes

## Guidelines
- Match the brand voice defined in your soul
- Mix content types across the batch (don't make all posts the same type)
- Reference real venture activities, features, or milestones from the venture context
- Make posts specific and actionable, not generic
- Each post should stand alone and be ready for human review

Use the submit_deliverable tool to submit your drafts for review.`;

  try {
    await executeAgentChat(agentSlug, prompt, "scheduler");
    logger.info({ agentSlug, ventureId: agent.ventureId }, "content_queue: draft posts generated");
  } catch (err: any) {
    logger.error({ agentSlug, error: err.message }, "content_queue: failed to generate drafts");

    // Dead letter
    try {
      await database.insert(deadLetterJobs).values({
        agentId,
        agentSlug,
        jobName: "content_queue",
        error: err.message || "Unknown error",
        payload: { ventureId: agent.ventureId },
      });
    } catch { /* best effort */ }
  }
});

// ============================================================================
// MEMORY LIFECYCLE CRONS (Rasputin-inspired)
// ============================================================================

/**
 * Hot Commit — Pattern-match facts from recent conversations every 30 minutes.
 * No LLM needed, sub-100ms per message. Captures decisions, preferences, deadlines.
 */
registerJobHandler("hot_commit", async (_agentId: string, _agentSlug: string) => {
  const { hotCommitFacts } = await import("../memory/memory-lifecycle");
  const result = await hotCommitFacts();
  logger.info({ factsExtracted: result.factsExtracted }, "hot_commit job complete");
});

/**
 * Importance Enrichment — Re-score agent memories with default importance.
 * Uses GPT-4o-mini to batch-score up to 50 memories per run.
 * Runs nightly.
 */
registerJobHandler("importance_enrichment", async (_agentId: string, _agentSlug: string) => {
  const { enrichImportance } = await import("../memory/memory-lifecycle");
  const result = await enrichImportance();
  logger.info({ scored: result.scored }, "importance_enrichment job complete");
});

/**
 * Graph Deepening — Discover new entity relationships from co-occurrence patterns.
 * Finds entity pairs that appear together in memories but aren't linked in graph.
 * Runs weekly.
 */
registerJobHandler("graph_deepening", async (_agentId: string, _agentSlug: string) => {
  const { deepenGraph } = await import("../memory/memory-lifecycle");
  const result = await deepenGraph();
  logger.info({ newEdges: result.newEdges }, "graph_deepening job complete");
});

/**
 * Memory Cleanup — Prune stale, low-importance memories older than 90 days.
 * Keeps all memories with importance >= 0.7.
 * Runs weekly.
 */
registerJobHandler("memory_prune", async (_agentId: string, _agentSlug: string) => {
  const { cleanupMemories } = await import("../memory/memory-lifecycle");
  const result = await cleanupMemories();
  logger.info({ pruned: result.pruned }, "memory_prune job complete");
});

// ============================================================================
// PINECONE BACKFILL — One-time job, triggered on startup when Pinecone is empty
// ============================================================================

/**
 * Pinecone Backfill — Reads high-importance compacted memories from Qdrant
 * and upserts them to Pinecone in batches of 100.
 * Triggered automatically on startup if Pinecone has 0 records.
 */
registerJobHandler("pinecone_backfill", async (_agentId: string, _agentSlug: string) => {
  const { isPineconeReady, upsertToPinecone, getPineconeRecordCount } = await import("../memory/pinecone-store");
  const { scrollHighValueCompacted } = await import("../memory/qdrant-store");

  const ready = await isPineconeReady();
  if (!ready) {
    logger.warn("pinecone_backfill: Pinecone not reachable — skipping");
    return;
  }

  const existing = await getPineconeRecordCount();
  if (existing > 0) {
    logger.info({ existing }, "pinecone_backfill: Pinecone already has records — skipping");
    return;
  }

  let totalUpserted = 0;
  let offset: string | undefined = undefined;

  do {
    const { points, nextOffset } = await scrollHighValueCompacted(0.5, 100, offset);
    if (points.length === 0) break;

    const records = points.map((p) => ({
      id: p.id,
      text: p.payload.summary,
      metadata: {
        domain: p.payload.domain,
        importance: p.payload.importance,
        timestamp: p.payload.timestamp,
        key_entities: p.payload.key_entities,
        source: "qdrant-backfill",
      },
    }));

    await upsertToPinecone("compacted", records);
    totalUpserted += records.length;
    offset = nextOffset;
  } while (offset);

  logger.info({ totalUpserted }, "pinecone_backfill: Backfill complete");
});

// ============================================================================
// PINECONE NIGHTLY SYNC — Pushes pending compacted memories to Pinecone
// ============================================================================

/**
 * Pinecone Nightly Sync — Finds compacted memories with sync_status "pending"
 * and upserts them to Pinecone, then marks them as "synced".
 * Runs nightly at 23:00 UTC (3am Dubai).
 */
registerJobHandler("pinecone_nightly_sync", async (_agentId: string, _agentSlug: string) => {
  const { isPineconeReady, upsertToPinecone } = await import("../memory/pinecone-store");
  const { getCompactedMemoriesForSync, updateSyncStatus } = await import("../memory/qdrant-store");

  const ready = await isPineconeReady();
  if (!ready) {
    logger.warn("pinecone_nightly_sync: Pinecone not reachable — skipping");
    return;
  }

  const pending = await getCompactedMemoriesForSync(200);
  if (pending.length === 0) {
    logger.info("pinecone_nightly_sync: No pending memories to sync");
    return;
  }

  const records = pending.map((p) => ({
    id: p.id,
    text: p.payload.summary,
    metadata: {
      domain: p.payload.domain,
      importance: p.payload.importance,
      timestamp: p.payload.timestamp,
      key_entities: p.payload.key_entities,
      source: "nightly-sync",
    },
  }));

  await upsertToPinecone("compacted", records);

  // Mark all as synced
  for (const p of pending) {
    await updateSyncStatus(p.id, "synced").catch(() => {});
  }

  logger.info({ synced: pending.length }, "pinecone_nightly_sync: Sync complete");
});

// ============================================================================
// QDRANT ARCHIVE STALE — Weekly soft-delete of old low-importance memories
// ============================================================================

/**
 * Archive Stale Memories — Marks old, low-importance memories as archived=true.
 * Archived memories are excluded from search but not deleted — fully recoverable.
 * Runs weekly (Sunday 2am Dubai).
 *
 * Thresholds:
 * - Raw memories: older than 90 days AND importance < 0.4
 * - Compacted memories: older than 180 days AND importance < 0.5
 */
registerJobHandler("qdrant_archive_stale", async (_agentId: string, _agentSlug: string) => {
  const { getOldLowImportanceMemories, archiveMemory } = await import("../memory/qdrant-store");
  const { QDRANT_COLLECTIONS } = await import("../memory/schemas");

  let totalArchived = 0;

  // Archive old raw memories
  const staleRaw = await getOldLowImportanceMemories(
    QDRANT_COLLECTIONS.RAW_MEMORIES,
    90,   // older than 90 days
    0.4,  // importance < 0.4
    500
  );

  for (const id of staleRaw) {
    try {
      await archiveMemory(id, QDRANT_COLLECTIONS.RAW_MEMORIES);
      totalArchived++;
    } catch (err: any) {
      logger.debug({ id, error: err.message }, "Failed to archive raw memory");
    }
  }

  // Archive old compacted memories
  const staleCompacted = await getOldLowImportanceMemories(
    QDRANT_COLLECTIONS.COMPACTED_MEMORIES,
    180,  // older than 180 days
    0.5,  // importance < 0.5
    200
  );

  for (const id of staleCompacted) {
    try {
      await archiveMemory(id, QDRANT_COLLECTIONS.COMPACTED_MEMORIES);
      totalArchived++;
    } catch (err: any) {
      logger.debug({ id, error: err.message }, "Failed to archive compacted memory");
    }
  }

  logger.info(
    { totalArchived, rawArchived: staleRaw.length, compactedArchived: staleCompacted.length },
    "qdrant_archive_stale: Archive complete"
  );
});

// ============================================================================
// GITHUB ACTIONS SHA AUDIT — Weekly check that all workflow actions are pinned
// ============================================================================

const REPOS_TO_AUDIT = [
  { owner: "sayedbaharun", repo: "SBOS" },
  { owner: "sayedbaharun", repo: "SBMyDub.ai" },
  { owner: "aivantrealty", repo: "aivantprop_AI" },
  { owner: "aivantrealty", repo: "aivant-realty-website" },
  { owner: "qwibitai", repo: "nanoclaw" },
  { owner: "sayedbaharun", repo: "syntheliq" },
];

/**
 * GitHub Actions SHA Audit — scans all workflow files across repos via GitHub API.
 * Flags any `uses:` lines that reference a mutable tag (@v4, @main, @latest)
 * instead of an immutable commit SHA.
 * Sends a Telegram alert if anything is unpinned.
 * Runs weekly (Monday 9am Dubai).
 */
registerJobHandler("github_actions_sha_audit", async (_agentId: string, _agentSlug: string) => {
  const githubToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const issues: string[] = [];

  for (const { owner, repo } of REPOS_TO_AUDIT) {
    try {
      // List workflow files via GitHub API
      const headers: Record<string, string> = {
        "User-Agent": "sbos-security-audit",
        "Accept": "application/vnd.github.v3+json",
      };
      if (githubToken) headers["Authorization"] = `Bearer ${githubToken}`;

      const listUrl = `https://api.github.com/repos/${owner}/${repo}/contents/.github/workflows`;
      const listRes = await fetch(listUrl, { headers });
      if (!listRes.ok) continue; // Repo has no workflows — skip

      const files: Array<{ name: string; download_url: string }> = await listRes.json();

      for (const file of files) {
        if (!file.name.endsWith(".yml") && !file.name.endsWith(".yaml")) continue;

        const contentRes = await fetch(file.download_url, { headers });
        if (!contentRes.ok) continue;
        const content = await contentRes.text();

        // Find any uses: lines with mutable refs (@v1, @main, @latest, @master)
        const mutablePattern = /uses:\s+([^\s]+)@(v\d+(?:\.\d+)*|main|master|latest)/g;
        let match;
        while ((match = mutablePattern.exec(content)) !== null) {
          issues.push(`${owner}/${repo} → ${file.name}: \`${match[1]}@${match[2]}\` is unpinned`);
        }
      }
    } catch (err: any) {
      logger.debug({ owner, repo, error: err.message }, "SHA audit: could not check repo");
    }
  }

  if (issues.length === 0) {
    logger.info("github_actions_sha_audit: All workflow actions are SHA-pinned ✓");
    // Publish event even when clean — subscribers need to know the audit ran
    try {
      const { publishEvent } = await import("../events/bus");
      await publishEvent("audit.security.completed", {
        unpinnedCount: 0,
        date: getUserDate(),
      });
    } catch { /* non-fatal */ }
    return;
  }

  // Send Telegram alert
  logger.warn({ count: issues.length, issues }, "github_actions_sha_audit: Unpinned actions found");

  try {
    const { sendProactiveMessage } = await import("../channels/channel-manager");
    const { getAuthorizedChatIds } = await import("../channels/adapters/telegram-adapter");
    const { resolveTopicByKey } = await import("../channels/topic-router");
    const threadId = await resolveTopicByKey("on-fire");
    const body = [
      `Found ${issues.length} workflow${issues.length > 1 ? "s" : ""} using mutable action refs:`,
      "",
      ...issues.map((i) => `• ${i}`),
      "",
      "Fix: re-run the SHA pinning script or check Dependabot PRs.",
    ].join("\n");

    for (const chatId of getAuthorizedChatIds()) {
      await sendProactiveMessage("telegram", chatId, formatMessage({
        header: "⚠️ Security: Unpinned GitHub Actions",
        sections: [{ content: body }],
      }), threadId);
    }
  } catch (err: any) {
    logger.warn({ error: err.message }, "github_actions_sha_audit: Could not send Telegram alert");
  }

  // Publish event for reactive subscriptions
  try {
    const { publishEvent } = await import("../events/bus");
    await publishEvent("audit.security.completed", {
      unpinnedCount: issues.length,
      date: getUserDate(),
    });
  } catch { /* non-fatal */ }
});

// ============================================================================
// VENTURE DIGEST — Weekly per-venture status pushed to Telegram
// ============================================================================

/**
 * Builds and sends a concise venture digest to Telegram.
 * Skips archived and trading ventures.
 * Called by the scheduled job AND by the /ventures Telegram command.
 */
export async function buildAndSendVentureDigest(): Promise<string> {
  const { storage } = await import("../storage");
  const database = await getDb();
  const today = new Date();
  const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

  // All non-archived ventures, skip trading
  const allVentures = await storage.getVentures();
  const active = allVentures.filter(
    (v: any) => v.status !== "archived" && v.domain !== "trading"
  );

  if (active.length === 0) {
    return "No active non-trading ventures found.";
  }

  const lines: string[] = [];

  for (const venture of active) {
    const vid = String(venture.id);

    // Tasks for this venture
    const allTasks = await storage.getTasks({ ventureId: vid });
    const pending = allTasks.filter((t: any) => !["done", "completed", "cancelled"].includes(t.status));
    const overdue = pending.filter((t: any) => t.dueDate && new Date(t.dueDate) < today);
    const completedThisWeek = allTasks.filter(
      (t: any) => (t.status === "done" || t.status === "completed") && t.completedAt && new Date(t.completedAt) >= weekAgo
    );
    const blocked = pending.filter((t: any) => t.status === "blocked");

    // Top blocker: overdue P0/P1 first, then just overdue
    const topBlocker =
      overdue.find((t: any) => t.priority === "P0" || t.priority === "P1") ||
      overdue[0] ||
      blocked[0];

    // Projects
    const projects = await storage.getProjects({ ventureId: vid });
    const activeProjects = projects.filter((p: any) => p.status === "in_progress");
    const blockedProjects = projects.filter((p: any) => p.status === "blocked");

    // Captures (unclarified inbox)
    const captures = await storage.getCaptures({ ventureId: vid, clarified: false });

    // Build venture section
    const statusEmoji = venture.status === "building" ? "🔨" : venture.status === "planning" ? "📋" : venture.status === "ongoing" ? "🚀" : "⏸";
    lines.push(`${statusEmoji} <b>${escapeHtml(venture.name)}</b>`);

    if (activeProjects.length > 0 || blockedProjects.length > 0) {
      const projLine = [
        activeProjects.length > 0 ? `${activeProjects.length} active` : null,
        blockedProjects.length > 0 ? `${blockedProjects.length} blocked` : null,
      ].filter(Boolean).join(", ");
      lines.push(`  Projects: ${projLine}`);
    } else {
      lines.push(`  Projects: none active`);
    }

    lines.push(`  Tasks: ${pending.length} pending · ${completedThisWeek.length} done this week${overdue.length > 0 ? ` · ⚠️ ${overdue.length} overdue` : ""}`);

    if (captures.length > 0) {
      lines.push(`  Inbox: ${captures.length} unclarified`);
    }

    if (topBlocker) {
      lines.push(`  🔴 Top blocker: ${escapeHtml(topBlocker.title)} [${topBlocker.priority || "?"}]`);
    }

    lines.push(""); // spacing between ventures
  }

  return lines.join("\n").trim();
}

registerJobHandler("venture_digest", async (_agentId: string, _agentSlug: string) => {
  try {
    const digest = await buildAndSendVentureDigest();

    const { sendProactiveMessage } = await import("../channels/channel-manager");
    const { getAuthorizedChatIds } = await import("../channels/adapters/telegram-adapter");

    const message = formatMessage({
      header: msgHeader("📊", "Weekly Venture Digest"),
      body: digest,
    });

    for (const chatId of getAuthorizedChatIds()) {
      await sendProactiveMessage("telegram", chatId, message);
    }

    logger.info("venture_digest: sent weekly venture digest to Telegram");
  } catch (err: any) {
    logger.error({ error: err.message }, "venture_digest: failed");
  }
});

// ============================================================================
// FREE MODEL SCOUT — Every 5 days, check if better free models exist
// ============================================================================

/**
 * Checks OpenRouter's free model list every 5 days.
 * Compares against the current FREE_MINI_MODEL (meta-llama/llama-4-scout:free).
 * Only sends a Telegram message to Chief of Staff if a better option is found.
 * Silent if nothing actionable — no spam.
 */
registerJobHandler("free_model_scout", async (_agentId: string, _agentSlug: string) => {
  const CURRENT_FREE_MODEL = "meta-llama/llama-4-scout:free";

  // Known benchmark scores (MMLU / Arena Elo proxy) for comparison
  // Updated manually when this job finds something better
  const KNOWN_BENCHMARKS: Record<string, number> = {
    "meta-llama/llama-4-scout:free": 78,
    "meta-llama/llama-4-maverick:free": 82,
    "qwen/qwen3-235b:free": 85,
    "deepseek/deepseek-v3:free": 84,
    "google/gemma-4-27b:free": 80,
    "mistralai/mistral-nemo:free": 68,
  };

  const currentScore = KNOWN_BENCHMARKS[CURRENT_FREE_MODEL] ?? 0;

  try {
    const resp = await fetch("https://openrouter.ai/api/v1/models", {
      headers: process.env.OPENROUTER_API_KEY
        ? { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` }
        : {},
      signal: AbortSignal.timeout(10000),
    });

    if (!resp.ok) {
      logger.warn("free_model_scout: Could not fetch OpenRouter model list");
      return;
    }

    const data = await resp.json();
    const freeModels: Array<{ id: string; name: string; context_length: number }> = (data.data || [])
      .filter((m: any) => {
        const promptPrice = parseFloat(m.pricing?.prompt || "1");
        return promptPrice === 0;
      })
      .map((m: any) => ({ id: m.id, name: m.name || m.id, context_length: m.context_length || 0 }));

    if (freeModels.length === 0) {
      logger.info("free_model_scout: No free models found on OpenRouter");
      return;
    }

    // Find free models with known benchmark scores better than current
    const betterModels = freeModels
      .filter((m) => m.id !== CURRENT_FREE_MODEL && (KNOWN_BENCHMARKS[m.id] ?? 0) > currentScore)
      .sort((a, b) => (KNOWN_BENCHMARKS[b.id] ?? 0) - (KNOWN_BENCHMARKS[a.id] ?? 0));

    // Also flag any new free models we haven't seen before
    const newModels = freeModels.filter(
      (m) => !KNOWN_BENCHMARKS[m.id] && !m.id.includes("preview") && !m.id.includes("extended")
    ).slice(0, 5);

    if (betterModels.length === 0 && newModels.length === 0) {
      logger.info(`free_model_scout: Current model (${CURRENT_FREE_MODEL}) is still optimal — no action needed`);
      return;
    }

    // Build message — only sent when there's something actionable
    const lines: string[] = [];

    if (betterModels.length > 0) {
      lines.push("Better free models found on OpenRouter:");
      lines.push("");
      for (const m of betterModels.slice(0, 3)) {
        const score = KNOWN_BENCHMARKS[m.id];
        lines.push(`• <b>${m.id}</b> (score: ${score} vs current ${currentScore})`);
        lines.push(`  Context: ${(m.context_length / 1000).toFixed(0)}K tokens`);
      }
      lines.push("");
      lines.push(`Current: <code>${CURRENT_FREE_MODEL}</code>`);
      lines.push("To swap: update FREE_MINI_MODEL in server/model-manager.ts");
    }

    if (newModels.length > 0) {
      if (lines.length > 0) lines.push("");
      lines.push("New free models (not yet benchmarked):");
      for (const m of newModels) {
        lines.push(`• ${m.id}`);
      }
    }

    const { sendProactiveMessage } = await import("../channels/channel-manager");
    const { getAuthorizedChatIds } = await import("../channels/adapters/telegram-adapter");

    for (const chatId of getAuthorizedChatIds()) {
      await sendProactiveMessage("telegram", chatId, formatMessage({
        header: msgHeader("🤖", "Free Model Scout — Action Recommended"),
        sections: [{ content: lines.join("\n") }],
      }));
    }

    logger.info({ betterCount: betterModels.length, newCount: newModels.length }, "free_model_scout: Sent upgrade recommendation to Telegram");
  } catch (err: any) {
    logger.warn({ error: err.message }, "free_model_scout: Failed");
  }
});

// ============================================================================
// SCAN BACKLOG — Task Automation Scout tags tasks as 'agent-ready'
// Runs 3x/day (8am, 1pm, 6pm Dubai). After the scout runs, publishes
// task.agent_ready events for each recently-tagged task.
// ============================================================================

/**
 * Scan Backlog — Task Automation Scout evaluates all venture task backlogs,
 * tags actionable tasks with 'agent-ready', then publishes events for each.
 */
registerJobHandler("scan_backlog", async (agentId: string, agentSlug: string) => {
  const prompt = `Scan all venture task backlogs. For each todo/in_progress task, evaluate if an existing AI agent could carry it out autonomously. Tag matching tasks with 'agent-ready' using the update_task tool and note which agent should handle it in the task notes. Focus on tasks that are clearly defined and don't require human judgment or external access.`;

  const result = await executeAgentChat(agentSlug, prompt, "scheduler");
  logger.info({ agentSlug, response: result?.response?.slice(0, 200) }, "scan_backlog: scout run complete");

  // After scan completes, publish events for agent-ready tasks updated in last 10 minutes
  try {
    const { publishEvent } = await import("../events/bus");
    const { storage } = await import("../storage");
    const agentReadyTasks = await storage.getTasks({ limit: 20 } as any);
    const recentlyTagged = agentReadyTasks.filter((t: any) => {
      if (!t.tags || !Array.isArray(t.tags)) return false;
      if (!t.tags.includes("agent-ready")) return false;
      // Only tasks updated in the last 10 minutes
      const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
      return t.updatedAt && new Date(t.updatedAt) > tenMinAgo;
    });
    for (const task of recentlyTagged.slice(0, 5)) {
      await publishEvent("task.agent_ready", {
        taskId: task.id,
        title: task.title,
        ventureId: task.ventureId,
        priority: task.priority,
      });
    }
    logger.info({ count: recentlyTagged.length }, "scan_backlog: published task.agent_ready events");
  } catch (err) {
    logger.warn({ err }, "[scan_backlog] Failed to publish agent-ready events");
  }
});

// ============================================================================
// PROACTIVE MORNING LOOP — Auto-delegates agent-ready tasks at 7:30am Dubai
// ============================================================================
registerJobHandler("proactive_morning_loop", async (_agentId: string, _agentSlug: string) => {
  const { runProactiveMorningLoop } = await import("./proactive-loop");
  await runProactiveMorningLoop();
});
