/**
 * Scheduled Jobs
 *
 * Predefined job handlers for agent scheduled execution.
 * Maps job names to execution logic — e.g., "daily_briefing" triggers
 * the Chief of Staff to generate and save a daily report.
 */

import { eq, gte, sql } from "drizzle-orm";
import { logger } from "../logger";
import { agents, agentConversations, sessionLogs, type Agent } from "@shared/schema";
import { dailyBriefing, weeklySummary, ventureStatus } from "./tools/report-generator";
import { executeAgentChat } from "./agent-runtime";
import { getAllAgentActivity } from "./conversation-manager";
import { messageBus } from "./message-bus";
import { getUserDate } from "../utils/dates";

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
 * Daily Briefing — Chief of Staff generates morning briefing.
 * Gathers system-wide activity, tasks, and produces an actionable summary.
 */
registerJobHandler("daily_briefing", async (agentId: string, agentSlug: string) => {
  const database = await getDb();
  const { storage } = await import("../storage");
  const today = getUserDate();

  // Generate the briefing using the report tool
  const briefingResult = await dailyBriefing();
  const briefingData = JSON.parse(briefingResult.result);

  // Get recent agent activity for the briefing
  const agentActivity = await getAllAgentActivity(24);
  const activitySummary = agentActivity.length > 0
    ? `\n\n## Agent Activity (Last 24h)\n${agentActivity.map(
        (a) => `- **${a.agentName}**: ${a.messageCount} messages, last: "${a.lastMessage.slice(0, 100)}..."`
      ).join("\n")}`
    : "";

  // Detect blockers: overdue tasks and stale in-progress items
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

  // Check if today's outcomes are already set
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

  // Have the agent synthesize the briefing with personality
  const prompt = `Generate your daily briefing for the founder. Here is the data:\n\n${briefingData.report}${activitySummary}${blockerSection}\n\nPresent this as your daily briefing, with your personality and insights. Highlight what matters most today. Flag any blockers prominently.${outcomesPrompt}`;

  const result = await executeAgentChat(agentSlug, prompt, "scheduler");

  // Broadcast to message bus so other agents can see the briefing
  messageBus.broadcast(agentId, `[Daily Briefing] ${result.response.slice(0, 500)}`);

  // Send to Telegram if configured
  try {
    const { sendProactiveMessage } = await import("../channels/channel-manager");
    const { getAuthorizedChatIds } = await import("../channels/adapters/telegram-adapter");
    const chatIds = getAuthorizedChatIds();
    for (const chatId of chatIds) {
      await sendProactiveMessage("telegram", chatId, `☀️ Daily Briefing\n\n${result.response}`);
    }
  } catch {
    // Telegram not configured — skip
  }

  logger.info(
    { agentSlug, tokensUsed: result.tokensUsed },
    "Daily briefing generated"
  );
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
      await sendProactiveMessage("telegram", chatId, `Weekly Report\n\n${result.response}`);
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
});

/**
 * Morning Check-in — Sends a 10am Telegram prompt about morning ritual status.
 */
registerJobHandler("morning_checkin", async (_agentId: string, agentSlug: string) => {
  const today = new Date().toISOString().split("T")[0];
  const { storage } = await import("../storage");
  const day = await storage.getDayOrCreate(today);
  const rituals = day.morningRituals as Record<string, any> | null;

  let message: string;
  if (rituals?.completedAt) {
    message = "Morning ritual already complete — great start!";
  } else {
    const done: string[] = [];
    const missing: string[] = [];
    const habitLabels: Record<string, string> = {
      pressUps: "Press-ups",
      squats: "Squats",
      water: "Water",
      supplements: "Supplements",
    };
    for (const [key, label] of Object.entries(habitLabels)) {
      if (rituals?.[key]?.done) done.push(label);
      else missing.push(label);
    }
    if (done.length === 0 && missing.length === 0) {
      message = `How's the morning going? Quick update:\n- How many press-ups did you do?\n- How many squats?\n- Have you taken your supplements?\n- Have you had your water?\n\nJust text me naturally, e.g. "Did 20 press ups, 15 squats, took supplements and had my water"\n\nOr just say "morning done" to check everything off!`;
    } else {
      const doneStr = done.length > 0 ? `\n\nAlready done: ${done.join(", ")} ✅` : "";
      message = `How's the morning going?${doneStr}\n\nStill to do: ${missing.join(", ")}\n\nJust text me what you've completed.\n\nOr just say "morning done" to check everything off!`;
    }
  }

  try {
    const { sendProactiveMessage } = await import("../channels/channel-manager");
    const { getAuthorizedChatIds } = await import("../channels/adapters/telegram-adapter");
    for (const chatId of getAuthorizedChatIds()) {
      await sendProactiveMessage("telegram", chatId, `☀️ Morning Check-in\n\n${message}`);
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
  const outcomes = day.top3Outcomes as Array<{ text: string; completed: boolean }> | null;
  const allTasks = await storage.getTasks({});
  const todayCompleted = allTasks.filter(
    (t: any) => t.status === "done" && t.completedAt &&
      new Date(t.completedAt).toISOString().slice(0, 10) === today
  );
  const todayInProgress = allTasks.filter(
    (t: any) => (t.focusDate === today || t.dueDate === today) && t.status !== "done" && t.status !== "cancelled"
  );

  // Health data
  const healthEntries = await storage.getHealthEntries({ dateGte: today, dateLte: today });
  const health = healthEntries[0];

  // Build summary
  const sections: string[] = [];

  // Outcomes progress
  if (outcomes && outcomes.length > 0 && outcomes.some((o: any) => o.text)) {
    const completed = outcomes.filter((o: any) => o.completed).length;
    const total = outcomes.filter((o: any) => o.text).length;
    sections.push(`Outcomes: ${completed}/${total} completed`);
    for (const o of outcomes) {
      if (o.text) sections.push(`  ${o.completed ? "✅" : "⬜"} ${o.text}`);
    }
  }

  // Tasks
  if (todayCompleted.length > 0) {
    sections.push(`\nTasks completed today: ${todayCompleted.length}`);
    for (const t of todayCompleted.slice(0, 5)) {
      sections.push(`  ✅ ${t.title}`);
    }
  }
  if (todayInProgress.length > 0) {
    sections.push(`\nStill open: ${todayInProgress.length}`);
    for (const t of todayInProgress.slice(0, 5)) {
      sections.push(`  ⬜ ${t.title}`);
    }
  }

  // Health snapshot
  if (health) {
    const healthParts: string[] = [];
    if (health.workoutDone) healthParts.push(`Workout: ${health.workoutType || "done"} (${health.workoutDurationMin || "?"}min)`);
    if (health.steps) healthParts.push(`Steps: ${health.steps.toLocaleString()}`);
    if (health.stressLevel) healthParts.push(`Stress: ${health.stressLevel}`);
    if (healthParts.length > 0) sections.push(`\nHealth: ${healthParts.join(" | ")}`);
  }

  // One thing to ship
  if (day.oneThingToShip) {
    sections.push(`\nOne thing to ship: ${day.oneThingToShip}`);
  }

  const summaryData = sections.join("\n");

  // Build Telegram message directly (no LLM needed for this)
  let message = `🌙 Evening Review\n\n${summaryData}\n\n`;
  message += "How was your day? Reply with a quick reflection — or just say 'done' to close the day.";

  try {
    const { sendProactiveMessage } = await import("../channels/channel-manager");
    const { getAuthorizedChatIds } = await import("../channels/adapters/telegram-adapter");
    for (const chatId of getAuthorizedChatIds()) {
      await sendProactiveMessage("telegram", chatId, message);
    }
  } catch {
    // Telegram not configured — skip
  }

  logger.info({ agentSlug }, "Evening review sent");
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
    await storage.createDoc({
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
      await sendProactiveMessage("telegram", chatId, `📊 Weekly Report\n\n${result.response}`);
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
 * Pipeline Health Check — Monitors the memory pipeline for failures.
 * Checks: session log ingestion, unprocessed backlog, Qdrant status, Pinecone status.
 * Runs every 4 hours. Sends a consolidated Telegram alert if any check fails.
 */
registerJobHandler("pipeline_health_check", async (_agentId: string, agentSlug: string) => {
  const result = await runPipelineHealthCheck();

  if (result.alerts.length > 0) {
    // Send consolidated Telegram alert
    const alertMessage = `Pipeline Health Alert\n\n${result.alerts.map((a) => `- ${a}`).join("\n")}\n\nRun GET /api/health/pipeline for full status.`;

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
  };
  alerts: string[];
}

export async function runPipelineHealthCheck(): Promise<PipelineHealthResult> {
  const database = await getDb();
  const alerts: string[] = [];

  // --- Check 1: Session log ingestion (during active hours 8am-midnight Dubai / UTC+4) ---
  let sessionLogCheck: PipelineHealthResult["checks"]["sessionLogIngestion"];
  try {
    const nowUTC = new Date();
    const dubaiHour = (nowUTC.getUTCHours() + 4) % 24;
    const isActiveHours = dubaiHour >= 8 && dubaiHour < 24;

    if (isActiveHours) {
      const [{ count: recentCount }] = await database
        .select({ count: sql`COUNT(*)::int` })
        .from(sessionLogs)
        .where(gte(sessionLogs.createdAt, new Date(Date.now() - 4 * 60 * 60 * 1000)));

      if (recentCount === 0) {
        sessionLogCheck = { status: "fail", detail: `No session logs in last 4 hours (active hours, Dubai hour: ${dubaiHour})` };
        alerts.push(`Session log ingestion: No new session_logs rows in last 4 hours during active hours`);
        logger.warn({ dubaiHour }, "Pipeline health: No session logs in last 4 hours during active hours");
      } else {
        sessionLogCheck = { status: "pass", detail: `${recentCount} session log(s) in last 4 hours` };
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
      pineconeCheck = { status: "pass", detail: `Pinecone available, ${totalRecords} total records` };
    }
  } catch (err: any) {
    pineconeCheck = { status: "fail", detail: `Pinecone check failed: ${err.message}` };
    alerts.push(`Pinecone check error: ${err.message}`);
    logger.warn({ error: err.message }, "Pipeline health: Pinecone check threw");
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
    },
    alerts,
  };
}

/**
 * Inbox Triage — Process unclarified captures and suggest actions.
 */
registerJobHandler("inbox_triage", async (agentId: string, agentSlug: string) => {
  const prompt = `Check the inbox for unclarified capture items. For each one, suggest whether it should be converted to a task, delegated to a specialist, or dismissed. List your recommendations.`;

  await executeAgentChat(agentSlug, prompt, "scheduler");

  logger.info({ agentSlug }, "Inbox triage completed");
});
