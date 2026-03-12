/**
 * Review Actions — Shared logic for approving/rejecting/amending deliverables.
 * Used by both Express routes (review.ts) and Telegram callbacks.
 */
import { eq } from "drizzle-orm";
import { agentTasks } from "@shared/schema";
import { storage } from "../storage";
import { logger } from "../logger";

let db: any = null;
async function getDb() {
  if (!db) {
    db = (storage as any).db;
  }
  return db;
}

export interface ApproveResult {
  success: boolean;
  promotedTo: Array<{ type: string; id: string }>;
  error?: string;
}

export async function approveDeliverable(
  taskId: string,
  feedback?: string
): Promise<ApproveResult> {
  const database = await getDb();

  const [task] = await database
    .select()
    .from(agentTasks)
    .where(eq(agentTasks.id, taskId));

  if (!task) {
    return { success: false, promotedTo: [], error: "Deliverable not found" };
  }

  if (task.status !== "needs_review") {
    return { success: false, promotedTo: [], error: `Cannot approve task with status: ${task.status}` };
  }

  const result = task.result as Record<string, any>;
  if (!result || !result.type) {
    return { success: false, promotedTo: [], error: "Deliverable has no structured result" };
  }

  const promotedTo: Array<{ type: string; id: string }> = [];

  logger.info({ taskId, resultType: result.type }, "Approving deliverable");

  switch (result.type) {
    case "document": {
      if (!result.title) {
        return { success: false, promotedTo: [], error: "Document deliverable missing title" };
      }
      const { doc } = await storage.createDocIfNotExists({
        title: result.title,
        body: result.body || "",
        type: result.docType || "page",
        domain: result.domain,
        ventureId: result.ventureId || undefined,
        status: "active",
      });
      promotedTo.push({ type: "doc", id: String(doc.id) });
      break;
    }

    case "recommendation": {
      if (result.suggestedAction === "create_task") {
        const details = result.actionDetails || {};
        const newTask = await storage.createTask({
          title: result.title,
          notes: `${result.summary}\n\n**Rationale:** ${result.rationale}`,
          priority: details.priority || "P2",
          status: "todo",
          ventureId: details.ventureId,
          createdByAgentId: task.agentId || undefined,
        } as any);
        promotedTo.push({ type: "task", id: String(newTask.id) });
      } else if (result.suggestedAction === "create_doc") {
        const { doc } = await storage.createDocIfNotExists({
          title: result.title,
          body: `## Summary\n${result.summary}\n\n## Rationale\n${result.rationale}`,
          type: "research",
          status: "active",
        });
        promotedTo.push({ type: "doc", id: String(doc.id) });
      }
      break;
    }

    case "action_items": {
      const items = result.items || [];
      for (const item of items) {
        const newTask = await storage.createTask({
          title: item.title,
          notes: item.notes,
          priority: item.priority || "P2",
          status: "todo",
          ventureId: item.ventureId || undefined,
          projectId: item.projectId || undefined,
          dueDate: item.dueDate,
          createdByAgentId: task.agentId || undefined,
        } as any);
        promotedTo.push({ type: "task", id: String(newTask.id) });
      }
      break;
    }

    case "code": {
      const lang = result.language || "typescript";
      const body = `${result.description ? `${result.description}\n\n` : ""}\`\`\`${lang}\n${result.code}\n\`\`\``;
      const { doc } = await storage.createDocIfNotExists({
        title: result.title,
        body,
        type: "tech_doc",
        ventureId: result.ventureId || undefined,
        status: "active",
      });
      promotedTo.push({ type: "doc", id: String(doc.id) });
      break;
    }

    default:
      return { success: false, promotedTo: [], error: `Unknown deliverable type: ${result.type}` };
  }

  await database
    .update(agentTasks)
    .set({
      status: "completed",
      promotedTo,
      completedAt: new Date(),
      reviewFeedback: feedback || null,
    })
    .where(eq(agentTasks.id, taskId));

  logger.info({ taskId, promotedTo }, "Deliverable approved");
  return { success: true, promotedTo };
}

export async function rejectDeliverable(
  taskId: string,
  feedback?: string
): Promise<{ success: boolean; error?: string }> {
  const database = await getDb();

  const [task] = await database
    .select()
    .from(agentTasks)
    .where(eq(agentTasks.id, taskId));

  if (!task) {
    return { success: false, error: "Deliverable not found" };
  }

  await database
    .update(agentTasks)
    .set({
      status: "failed",
      reviewFeedback: feedback || "Rejected",
      completedAt: new Date(),
    })
    .where(eq(agentTasks.id, taskId));

  logger.info({ taskId }, "Deliverable rejected");
  return { success: true };
}

export async function requestChanges(
  taskId: string,
  feedback: string
): Promise<{ success: boolean; error?: string }> {
  const database = await getDb();

  if (!feedback) {
    return { success: false, error: "Feedback is required when requesting changes" };
  }

  const [task] = await database
    .select()
    .from(agentTasks)
    .where(eq(agentTasks.id, taskId));

  if (!task) {
    return { success: false, error: "Deliverable not found" };
  }

  await database
    .update(agentTasks)
    .set({
      status: "pending",
      reviewFeedback: feedback,
    })
    .where(eq(agentTasks.id, taskId));

  logger.info({ taskId }, "Changes requested on deliverable");
  return { success: true };
}
