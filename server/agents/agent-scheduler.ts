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
    const database = await getDb();
    const allAgents: Agent[] = await database
      .select()
      .from(agents)
      .where(eq(agents.isActive, true));

    let jobCount = 0;

    for (const agent of allAgents) {
      const schedule = agent.schedule as Record<string, string> | null;
      if (!schedule || Object.keys(schedule).length === 0) continue;

      for (const [jobName, cronExpr] of Object.entries(schedule)) {
        if (!cron.validate(cronExpr)) {
          logger.warn(
            { agentSlug: agent.slug, jobName, cronExpr },
            "Invalid cron expression, skipping"
          );
          continue;
        }

        registerJob(agent, jobName, cronExpr);
        jobCount++;
      }
    }

    isInitialized = true;
    logger.info({ jobCount, agentCount: allAgents.length }, "Agent scheduler initialized");
  } catch (error: any) {
    logger.error({ error: error.message }, "Failed to initialize agent scheduler");
  }
}

/**
 * Register a single cron job for an agent.
 */
function registerJob(agent: Agent, jobName: string, cronExpression: string): void {
  const jobKey = `${agent.slug}:${jobName}`;

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
  });

  activeJobs.set(jobKey, {
    agentId: agent.id,
    agentSlug: agent.slug,
    jobName,
    cronExpression,
    task,
    lastRun: null,
    nextRun: null,
    runCount: 0,
    errorCount: 0,
  });

  logger.debug(
    { agentSlug: agent.slug, jobName, cronExpression },
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

  try {
    await executeScheduledJob(agent.id, agentSlug, jobName);

    // Update run tracking if job is registered
    const jobKey = `${agentSlug}:${jobName}`;
    const job = activeJobs.get(jobKey);
    if (job) {
      job.lastRun = new Date();
      job.runCount++;
    }

    return { success: true };
  } catch (error: any) {
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
  lastRun: string | null;
  runCount: number;
  errorCount: number;
}> {
  const status: Array<{
    agentSlug: string;
    jobName: string;
    cronExpression: string;
    lastRun: string | null;
    runCount: number;
    errorCount: number;
  }> = [];

  for (const job of Array.from(activeJobs.values())) {
    status.push({
      agentSlug: job.agentSlug,
      jobName: job.jobName,
      cronExpression: job.cronExpression,
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
