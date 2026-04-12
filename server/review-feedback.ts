/**
 * Review Feedback — writes agent-learning memory when a deliverable is rejected
 * or sent back for changes, so the originating agent can learn from it.
 *
 * This module is intentionally fire-and-forget: callers should wrap invocations
 * in `.catch()` so a failure here never blocks the review response.
 */
import { eq } from "drizzle-orm";
import { agentTasks, agentMemory } from "@shared/schema";
import { storage } from "./storage";
import { logger } from "./logger";

export async function recordReviewFeedback(
  agentTaskId: string,
  feedback: string,
  outcome: "rejected" | "changes_requested"
): Promise<void> {
  const db = (storage as any).db;

  // 1. Look up the agent task to get the owner agent UUID + metadata
  const [task] = await db
    .select()
    .from(agentTasks)
    .where(eq(agentTasks.id, agentTaskId));

  if (!task) {
    logger.warn(
      { agentTaskId },
      "recordReviewFeedback: agentTask not found, skipping memory write"
    );
    return;
  }

  const effectiveFeedback = feedback.trim() || "No feedback provided";
  const deliverableType: string = task.deliverableType ?? "unknown";
  const title: string = task.title ?? "Untitled";

  const content = `[${outcome}] Deliverable '${title}' (${deliverableType}): ${effectiveFeedback}`;

  // 2. Insert a learning memory row for the originating agent
  await db.insert(agentMemory).values({
    agentId: task.assignedTo,
    memoryType: "learning" as const,
    content,
    importance: 0.7,
    scope: "agent" as const,
    tags: ["review_feedback", outcome, deliverableType],
  });

  logger.info(
    { agentTaskId, agentId: task.assignedTo, outcome },
    "Review feedback written to agent memory"
  );
}
