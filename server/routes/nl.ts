/**
 * Natural Language Query Route
 * POST /api/nl/query
 *
 * Accepts a plain-English question or command and uses OpenAI function-calling
 * (gpt-4o-mini) to either answer the question or trigger an action.
 *
 * Intentionally uses direct OpenAI (not OpenRouter) for reliability and cost control.
 */
import { Router, Request, Response } from "express";
import OpenAI from "openai";
import { z } from "zod";
import { logger } from "../logger";
import { NL_TOOLS } from "../nl/tool-spec";

const router = Router();

// Instantiate directly — do NOT import getDirectOpenAIClient from model-manager
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// Lazy DB (same pattern as other route modules)
let db: any = null;
async function getStorage() {
  const { storage } = await import("../storage");
  return storage;
}

// Request body schema
const queryBodySchema = z.object({
  q: z.string().min(1).max(2000),
});

// ── Build mini world-state context ──────────────────────────────────────────

async function buildMiniContext(): Promise<string> {
  try {
    const storage = await getStorage();

    // Fetch active tasks (next + in_progress)
    const [activeTasks, goals] = await Promise.allSettled([
      storage.getTasks({ status: "next,in_progress", limit: 20 }),
      storage.getAllActiveGoalsWithProgress().catch(() => []),
    ]);

    const tasks =
      activeTasks.status === "fulfilled" ? activeTasks.value : [];
    const activeGoals = goals.status === "fulfilled" ? goals.value : [];

    const taskLines = tasks
      .slice(0, 15)
      .map(
        (t: any) =>
          `- [${t.priority || "P2"}] ${t.title} (status: ${t.status}${t.ventureId ? `, venture: ${t.ventureId}` : ""})`
      )
      .join("\n");

    const goalLines = activeGoals
      .slice(0, 8)
      .map((g: any) => {
        const krSummary =
          g.keyResults && g.keyResults.length > 0
            ? ` — ${g.keyResults.length} KRs`
            : "";
        return `- ${g.title} [${g.venture?.name ?? "unknown"}]${krSummary}`;
      })
      .join("\n");

    const parts: string[] = [];

    if (taskLines) {
      parts.push(`ACTIVE TASKS (next + in_progress):\n${taskLines}`);
    } else {
      parts.push("ACTIVE TASKS: none found");
    }

    if (goalLines) {
      parts.push(`ACTIVE GOALS / OKRs:\n${goalLines}`);
    } else {
      parts.push("ACTIVE GOALS: none found");
    }

    return parts.join("\n\n");
  } catch (err: any) {
    logger.warn({ err }, "[nl] Failed to build world state context");
    return "WORLD STATE: unavailable (DB error)";
  }
}

// ── Main route ───────────────────────────────────────────────────────────────

router.post("/query", async (req: Request, res: Response) => {
  // Guard: OpenAI not configured
  if (!openai) {
    return res.json({
      answer: "NL query requires OPENAI_API_KEY",
      action: null,
    });
  }

  // Validate body
  const parsed = queryBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      answer: "Invalid request: 'q' field is required",
      action: null,
    });
  }

  const { q } = parsed.data;

  try {
    const worldState = await buildMiniContext();

    const systemPrompt = `You are an AI assistant embedded in SB-OS, a personal operating system for a founder managing multiple ventures. You have access to the current world state below.

When the user asks a question, call answer_question with a clear, direct answer.
When the user wants to create a task, call create_task with the task details.
When the user asks about their current state or what's happening, call get_world_state.
When the user wants to delegate a task to an agent, call delegate_task with the task ID and agent slug.
When the user wants to update progress on a key result or metric, call update_kr_progress.
When the user wants to create a goal or OKR for a venture, call create_venture_goal.

CURRENT WORLD STATE:
${worldState}

Be concise. Use specific data from the world state when answering questions.`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: q },
      ],
      tools: NL_TOOLS,
      tool_choice: "auto",
      max_tokens: 512,
      temperature: 0.3,
    });

    const message = response.choices[0]?.message;

    if (!message) {
      return res.json({ answer: "No response from model", action: null });
    }

    // Handle tool calls
    if (message.tool_calls && message.tool_calls.length > 0) {
      const toolCall = message.tool_calls[0];
      const tc = toolCall as any;
      const toolName = tc.function.name as string;
      let toolArgs: Record<string, any> = {};

      try {
        toolArgs = JSON.parse(tc.function.arguments || "{}");
      } catch {
        toolArgs = {};
      }

      if (toolName === "answer_question") {
        return res.json({
          answer: toolArgs.answer || "Could not generate an answer.",
          action: null,
        });
      }

      if (toolName === "get_world_state") {
        // Format the world state as a human-readable answer
        const worldStateAnswer = await buildFormattedWorldState();
        return res.json({
          answer: worldStateAnswer,
          action: { type: "get_world_state", payload: {} },
        });
      }

      if (toolName === "create_task") {
        const { title, priority = "P2", ventureId } = toolArgs;

        if (!title) {
          return res.json({
            answer: "Could not extract a task title from your request.",
            action: null,
          });
        }

        try {
          const storage = await getStorage();
          const newTask = await storage.createTask({
            title: String(title),
            priority: priority as "P0" | "P1" | "P2" | "P3",
            status: "todo" as const,
            ...(ventureId ? { ventureId: String(ventureId) } : {}),
          });

          return res.json({
            answer: `Task created: "${title}" (${priority})`,
            action: {
              type: "create_task",
              payload: {
                id: newTask.id,
                title: newTask.title,
                priority: newTask.priority,
                ventureId: newTask.ventureId,
              },
            },
          });
        } catch (createErr: any) {
          logger.error({ createErr }, "[nl] Task creation failed");
          return res.json({
            answer: `Could not create task: ${createErr.message}`,
            action: null,
          });
        }
      }

      if (toolName === "delegate_task") {
        const { taskId, agentSlug } = toolArgs;
        if (!taskId || !agentSlug) {
          return res.json({ answer: "Need both a task ID and an agent slug to delegate.", action: null });
        }
        try {
          const { delegateFromUser } = await import("../agents/delegation-engine");
          const storage = await getStorage();
          const task = await storage.getTask(String(taskId));
          if (!task) return res.json({ answer: `Task ${taskId} not found.`, action: null });
          const result = await delegateFromUser(String(agentSlug), task.title, task.notes || '', 2);
          if (result.error) return res.json({ answer: `Delegation failed: ${result.error}`, action: null });
          // Mark task in_progress + agent-assigned
          const existingTags = Array.isArray(task.tags)
            ? task.tags
            : task.tags
            ? String(task.tags).split(',').map((s: string) => s.trim())
            : [];
          await storage.updateTask(String(taskId), {
            status: 'in_progress' as const,
            tags: [...existingTags, 'agent-assigned'],
          });
          return res.json({
            answer: `Task "${task.title}" delegated to ${agentSlug}.`,
            action: { type: "delegate_task", payload: { taskId, agentSlug, agentTaskId: result.taskId } },
          });
        } catch (err: any) {
          return res.json({ answer: `Delegation error: ${err.message}`, action: null });
        }
      }

      if (toolName === "update_kr_progress") {
        const { keyResultId, currentValue } = toolArgs;
        if (!keyResultId || currentValue === undefined) {
          return res.json({ answer: "Need keyResultId and currentValue to update progress.", action: null });
        }
        try {
          const storage = await getStorage();
          const updated = await storage.updateKeyResultProgress(String(keyResultId), Number(currentValue));
          if (!updated) return res.json({ answer: `Key result ${keyResultId} not found.`, action: null });
          return res.json({
            answer: `Key result progress updated to ${currentValue}${updated.unit ? ' ' + updated.unit : ''}.`,
            action: { type: "update_kr_progress", payload: { keyResultId, currentValue, status: updated.status } },
          });
        } catch (err: any) {
          return res.json({ answer: `KR update error: ${err.message}`, action: null });
        }
      }

      if (toolName === "create_venture_goal") {
        const { ventureId, period, periodStart, periodEnd, targetStatement, keyResults = [] } = toolArgs;
        if (!ventureId || !period || !periodStart || !periodEnd || !targetStatement) {
          return res.json({ answer: "Missing required fields to create a venture goal.", action: null });
        }
        try {
          const storage = await getStorage();
          const goal = await storage.createVentureGoal({
            ventureId: String(ventureId),
            period,
            periodStart,
            periodEnd,
            targetStatement,
            status: 'active',
          });
          const createdKRs = [];
          for (const kr of keyResults) {
            const created = await storage.createKeyResult({
              goalId: goal.id,
              title: kr.title,
              targetValue: Number(kr.targetValue),
              currentValue: 0,
              unit: kr.unit,
              status: 'on_track',
            });
            createdKRs.push(created);
          }
          return res.json({
            answer: `Goal created: "${targetStatement}" with ${createdKRs.length} key result${createdKRs.length !== 1 ? 's' : ''}.`,
            action: { type: "create_venture_goal", payload: { goalId: goal.id, keyResultIds: createdKRs.map((kr: any) => kr.id) } },
          });
        } catch (err: any) {
          return res.json({ answer: `Goal creation error: ${err.message}`, action: null });
        }
      }
    }

    // Fallback: plain text content (no tool call)
    const textContent = message.content;
    return res.json({
      answer: textContent || "I'm not sure how to answer that.",
      action: null,
    });
  } catch (err: any) {
    logger.error({ err }, "[nl] OpenAI call failed");
    return res.json({
      answer: `Query failed: ${err.message || "Unknown error"}`,
      action: null,
    });
  }
});

// ── Helper: formatted world state summary ────────────────────────────────────

async function buildFormattedWorldState(): Promise<string> {
  try {
    const storage = await getStorage();

    const [activeTasks, goals] = await Promise.allSettled([
      storage.getTasks({ status: "next,in_progress", limit: 10 }),
      storage.getAllActiveGoalsWithProgress().catch(() => []),
    ]);

    const tasks =
      activeTasks.status === "fulfilled" ? activeTasks.value : [];
    const activeGoals = goals.status === "fulfilled" ? goals.value : [];

    const lines: string[] = [];

    if (tasks.length > 0) {
      lines.push(`${tasks.length} active task${tasks.length !== 1 ? "s" : ""}:`);
      tasks.slice(0, 5).forEach((t: any) => {
        lines.push(`  • [${t.priority}] ${t.title}`);
      });
      if (tasks.length > 5) {
        lines.push(`  … and ${tasks.length - 5} more`);
      }
    } else {
      lines.push("No active tasks.");
    }

    if (activeGoals.length > 0) {
      lines.push(`\n${activeGoals.length} active goal${activeGoals.length !== 1 ? "s" : ""}:`);
      activeGoals.slice(0, 3).forEach((g: any) => {
        lines.push(`  • ${g.title} [${g.venture?.name ?? "unknown"}]`);
      });
    }

    return lines.join("\n");
  } catch {
    return "World state unavailable.";
  }
}

export default router;
