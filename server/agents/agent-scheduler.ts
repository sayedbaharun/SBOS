/**
 * Agent Scheduler
 *
 * Cron-based proactive agent execution. Each agent can have scheduled
 * jobs defined in their `schedule` JSONB field (e.g., weekly_report: "0 17 * * 5").
 *
 * The scheduler reads agent schedules from DB and fires jobs at the
 * configured times, executing the appropriate job handler.
 */

import cron from "node-cron";
import { CronExpressionParser } from "cron-parser";
import { eq } from "drizzle-orm";
import { logger } from "../logger";
import { agents, type Agent } from "@shared/schema";
import { executeScheduledJob, type ScheduledJobHandler } from "./scheduled-jobs";
import { msgHeader, formatMessage } from "../infra/telegram-format";

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
// SCHEDULER STATE
// ============================================================================

interface ScheduledCronJob {
  agentId: string;
  agentSlug: string;
  jobName: string;
  cronExpression: string;
  timezone: string;
  task: ReturnType<typeof cron.schedule>;
  lastRun: Date | null;
  nextRun: Date | null;
  runCount: number;
  errorCount: number;
}

const activeJobs = new Map<string, ScheduledCronJob>();
let isInitialized = false;

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initialize the agent scheduler.
 * Loads all active agents with schedules and sets up cron jobs.
 * Call this once at server startup.
 */
export async function initializeScheduler(): Promise<void> {
  if (isInitialized) {
    logger.warn("Agent scheduler already initialized");
    return;
  }

  logger.info("Initializing agent scheduler...");

  try {
    logger.info("Scheduler: acquiring DB connection");
    const database = await getDb();

    logger.info("Scheduler: querying agents table");
    // Protects against a hung pg query (network stall etc.).
    // Does NOT help with OOM/SIGKILL — kernel kills the event loop before this timer can fire.
    const allAgents: Agent[] = await Promise.race([
      database.select().from(agents).where(eq(agents.isActive, true)),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Scheduler DB query timed out after 15s")), 15000)
      ),
    ]);
    logger.info({ count: allAgents.length }, "Scheduler: agents fetched");

    let jobCount = 0;

    for (const agent of allAgents) {
      const schedule = agent.schedule as Record<string, unknown> | null;
      if (!schedule || Object.keys(schedule).length === 0) continue;

      for (const [jobName, cronExpr] of Object.entries(schedule)) {
        try {
          if (typeof cronExpr !== "string") {
            logger.warn(
              { agentSlug: agent.slug, jobName },
              "Schedule value is not a string, skipping"
            );
            continue;
          }
          if (!cron.validate(cronExpr)) {
            logger.warn(
              { agentSlug: agent.slug, jobName, cronExpr },
              "Invalid cron expression, skipping"
            );
            continue;
          }
          registerJob(agent, jobName, cronExpr);
          jobCount++;
        } catch (jobErr: any) {
          logger.warn({ agentSlug: agent.slug, jobName, error: jobErr.message }, "registerJob failed, skipping");
        }
      }
    }

    isInitialized = true;
    logger.info({ jobCount, agentCount: allAgents.length }, "Agent scheduler initialized");

    // Catch-up: fire any jobs missed during downtime (Railway restarts, etc.)
    // Run async so it doesn't block server startup
    runCatchUpJobs(allAgents).catch((err) =>
      logger.error({ error: err.message }, "Catch-up scheduler error")
    );
  } catch (error: any) {
    logger.error({ error: error.message }, "Failed to initialize agent scheduler");
  }
}

// Jobs to skip on catch-up restart.
// Rule: any job that makes LLM calls, external API calls, or loads large datasets
// must skip catch-up. These jobs fire at boot BEFORE memory systems are warm,
// causing OOM or unhandled rejections that crash the container before completion
// is recorded — creating a perpetual restart loop.
// Let them run on their next scheduled tick instead.
const SKIP_CATCHUP_JOBS = new Set([
  // High-frequency — next tick handles it
  "embedding_backfill",
  "drain_scheduled_posts",
  "post_analytics_backfill",
  "proactive_morning_loop",
  // LLM/external API — crash boot if run before memory is warm
  "daily_briefing",
  "weekly_report",
  "weekly_report_cos",
  "campaign_review",
  "tech_review",
  "venture_status_report",
  "morning_checkin",
  "evening_review",
  "email_triage",
  "newsletter_digest",
  "meeting_prep",
  "inbox_triage",
  "project_health",
  "venture_health",
  "agent_performance",
  "model_cost_review",
  "knowledge_extraction",
  "knowledge_audit",
  "wiki_generation",
  "entity_dedup",
  "content_queue",
  "github_actions_sha_audit",
  "venture_digest",
  "free_model_scout",
  "scan_backlog",
  "session_log_extraction",
  "graph_deepening",
  "importance_enrichment",
  "memory_prune",
  "memory_cleanup",
  "memory_consolidation",
  "pinecone_nightly_sync",
  "qdrant_archive_stale",
  "syntheliq_reconcile",
  "check_credit_balance",
  "pipeline_health_check",
  "pinecone_backfill",
]);

/**
 * After startup, check each registered job's last run against the previous
 * scheduled time. If the job was supposed to run while the server was down,
 * fire it immediately as a catch-up run.
 */
async function runCatchUpJobs(allAgents: Agent[]): Promise<void> {
  const { storage } = await import("../storage");
  let catchUpCount = 0;

  for (const agent of allAgents) {
    const schedule = agent.schedule as Record<string, string> | null;
    if (!schedule) continue;

    const tz = (agent as any).scheduleTimezone || "Asia/Dubai";

    for (const [jobName, cronExpr] of Object.entries(schedule)) {
      if (SKIP_CATCHUP_JOBS.has(jobName)) continue;
      if (!cron.validate(cronExpr)) continue;

      try {
        // When was this job last supposed to run?
        const interval = CronExpressionParser.parse(cronExpr, { tz });
        const lastScheduled = interval.prev().toDate();

        // When did it actually last run?
        const lastRun = await storage.getLastJobRun(agent.slug, jobName);

        if (!lastRun || lastRun < lastScheduled) {
          logger.info(
            { agentSlug: agent.slug, jobName, lastRun, lastScheduled },
            "Catch-up: job was missed during downtime — firing now"
          );

          catchUpCount++;
          const startedAt = Date.now();
          try {
            await executeScheduledJob(agent.id, agent.slug, jobName);
            await storage.recordJobRun(agent.slug, jobName, "success", "catchup", Date.now() - startedAt);

            // Update in-memory lastRun
            const job = activeJobs.get(`${agent.slug}:${jobName}`);
            if (job) { job.lastRun = new Date(); job.runCount++; }
          } catch (err: any) {
            logger.warn({ agentSlug: agent.slug, jobName, error: err.message }, "Catch-up job failed");
            await storage.recordJobRun(agent.slug, jobName, "failure", "catchup", Date.now() - startedAt);
          }
        }
      } catch (err: any) {
        logger.warn({ agentSlug: agent.slug, jobName, error: err.message }, "Catch-up check failed");
      }
    }
  }

  if (catchUpCount > 0) {
    logger.info({ catchUpCount }, "Catch-up scheduler complete");

    // Notify via Telegram
    try {
      const { sendProactiveMessage } = await import("../channels/channel-manager");
      const { getAuthorizedChatIds } = await import("../channels/adapters/telegram-adapter");
      const msg = formatMessage({
        header: msgHeader("🔄", "Scheduler Catch-Up"),
        body: `${catchUpCount} job(s) were missed during downtime and have been re-run automatically.`,
      });
      for (const chatId of getAuthorizedChatIds()) {
        await sendProactiveMessage("telegram", chatId, msg);
      }
    } catch { /* non-critical */ }
  } else {
    logger.info("Catch-up scheduler: no missed jobs");
  }
}

/**
 * Register a single cron job for an agent.
 */
function registerJob(agent: Agent, jobName: string, cronExpression: string, timezone?: string): void {
  const jobKey = `${agent.slug}:${jobName}`;
  const tz = timezone || (agent as any).scheduleTimezone || "Asia/Dubai";

  // Stop existing job if re-registering
  if (activeJobs.has(jobKey)) {
    activeJobs.get(jobKey)!.task.stop();
    activeJobs.delete(jobKey);
  }

  const task = cron.schedule(cronExpression, async () => {
    const job = activeJobs.get(jobKey);
    if (!job) return;

    logger.info(
      { agentSlug: agent.slug, jobName },
      "Executing scheduled agent job"
    );

    const startedAt = Date.now();
    try {
      // Retry with FAST_BACKOFF (3 attempts: 500ms, 750ms, 1.1s)
      const { retryWithPolicy, FAST_BACKOFF } = await import("../infra/backoff");
      await retryWithPolicy(
        () => executeScheduledJob(agent.id, agent.slug, jobName),
        {
          policy: FAST_BACKOFF,
          maxAttempts: 3,
          onRetry: (err: unknown, attempt: number, delayMs: number) => {
            logger.warn(
              { agentSlug: agent.slug, jobName, attempt: attempt + 1, delayMs, error: (err as Error).message },
              "Scheduled job failed, retrying"
            );
          },
        }
      );
      job.lastRun = new Date();
      job.runCount++;

      // Persist run record for catch-up scheduler
      try {
        const { storage } = await import("../storage");
        await storage.recordJobRun(agent.slug, jobName, "success", "scheduler", Date.now() - startedAt);
      } catch { /* non-critical */ }

      logger.info(
        { agentSlug: agent.slug, jobName, runCount: job.runCount },
        "Scheduled agent job completed"
      );
    } catch (error: any) {
      job.errorCount++;
      logger.error(
        { agentSlug: agent.slug, jobName, error: error.message },
        "Scheduled agent job failed after all retries"
      );

      // Persist failure record
      try {
        const { storage } = await import("../storage");
        await storage.recordJobRun(agent.slug, jobName, "failure", "scheduler", Date.now() - startedAt);
      } catch { /* non-critical */ }

      // Dead letter + Telegram alert (Project Ironclad Phase 2)
      try {
        const { storage } = await import("../storage");
        await storage.createDeadLetterJob({
          jobName,
          agentSlug: agent.slug,
          error: error.message || String(error),
          payload: { agentId: agent.id, cronExpression },
        });

        const { sendProactiveMessage } = await import("../channels/channel-manager");
        const { getAuthorizedChatIds } = await import("../channels/adapters/telegram-adapter");
        const alertText = formatMessage({
          header: msgHeader("⚠️", "Dead Letter Alert"),
          body: `Job <code>${jobName}</code> for agent <code>${agent.slug}</code> failed after 3 retries.\n\nError: ${error.message}`,
          cta: "<code>/api/admin/dead-letters</code> for details.",
        });
        for (const chatId of getAuthorizedChatIds()) {
          await sendProactiveMessage("telegram", chatId, alertText);
        }
      } catch (dlErr: any) {
        logger.error({ error: dlErr.message }, "Failed to create dead letter entry");
      }
    }
  }, { timezone: tz });

  activeJobs.set(jobKey, {
    agentId: agent.id,
    agentSlug: agent.slug,
    jobName,
    cronExpression,
    timezone: tz,
    task,
    lastRun: null,
    nextRun: null,
    runCount: 0,
    errorCount: 0,
  });

  logger.debug(
    { agentSlug: agent.slug, jobName, cronExpression, timezone: tz },
    "Registered scheduled job"
  );
}

// ============================================================================
// MANAGEMENT
// ============================================================================

/**
 * Manually trigger a scheduled job for an agent (outside of cron schedule).
 */
export async function triggerJob(
  agentSlug: string,
  jobName: string
): Promise<{ success: boolean; error?: string }> {
  const database = await getDb();

  const [agent] = await database
    .select()
    .from(agents)
    .where(eq(agents.slug, agentSlug));

  if (!agent) {
    return { success: false, error: `Agent not found: ${agentSlug}` };
  }

  const startedAt = Date.now();
  try {
    await executeScheduledJob(agent.id, agentSlug, jobName);

    // Update run tracking
    const jobKey = `${agentSlug}:${jobName}`;
    const job = activeJobs.get(jobKey);
    if (job) {
      job.lastRun = new Date();
      job.runCount++;
    }

    // Persist for catch-up scheduler
    try {
      const { storage } = await import("../storage");
      await storage.recordJobRun(agentSlug, jobName, "success", "manual", Date.now() - startedAt);
    } catch { /* non-critical */ }

    return { success: true };
  } catch (error: any) {
    try {
      const { storage } = await import("../storage");
      await storage.recordJobRun(agentSlug, jobName, "failure", "manual", Date.now() - startedAt);
    } catch { /* non-critical */ }
    return { success: false, error: error.message };
  }
}

/**
 * Reload schedules for a specific agent (e.g., after schedule update).
 */
export async function reloadAgentSchedule(agentSlug: string): Promise<void> {
  const database = await getDb();

  // Remove existing jobs for this agent
  const entries = Array.from(activeJobs.entries());
  for (const [key, job] of entries) {
    if (job.agentSlug === agentSlug) {
      job.task.stop();
      activeJobs.delete(key);
    }
  }

  const [agent] = await database
    .select()
    .from(agents)
    .where(eq(agents.slug, agentSlug));

  if (!agent || !agent.isActive) return;

  const schedule = agent.schedule as Record<string, string> | null;
  if (!schedule) return;

  for (const [jobName, cronExpr] of Object.entries(schedule)) {
    if (!cron.validate(cronExpr)) continue;
    registerJob(agent, jobName, cronExpr);
  }

  logger.info({ agentSlug, jobs: Object.keys(schedule).length }, "Agent schedule reloaded");
}

/**
 * Get status of all scheduled jobs.
 */
export function getScheduleStatus(): Array<{
  agentSlug: string;
  jobName: string;
  cronExpression: string;
  timezone: string;
  lastRun: string | null;
  runCount: number;
  errorCount: number;
}> {
  const status: Array<{
    agentSlug: string;
    jobName: string;
    cronExpression: string;
    timezone: string;
    lastRun: string | null;
    runCount: number;
    errorCount: number;
  }> = [];

  for (const job of Array.from(activeJobs.values())) {
    status.push({
      agentSlug: job.agentSlug,
      jobName: job.jobName,
      cronExpression: job.cronExpression,
      timezone: job.timezone,
      lastRun: job.lastRun?.toISOString() || null,
      runCount: job.runCount,
      errorCount: job.errorCount,
    });
  }

  return status;
}

/**
 * Stop all scheduled jobs (for graceful shutdown).
 */
export function stopAllJobs(): void {
  for (const [_key, job] of Array.from(activeJobs.entries())) {
    job.task.stop();
  }
  activeJobs.clear();
  isInitialized = false;
  logger.info("Agent scheduler stopped");
}
