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
