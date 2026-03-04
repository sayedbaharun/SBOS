/**
 * Sub-Agent Spawning — Project Ironclad Phase 4
 *
 * Allows spawning temporary task-focused agents from Telegram.
 * Sub-agents run with a 5-minute timeout, store their result,
 * and send it back via the message queue.
 */

import { logger } from "../logger";
import { executeAgentChat } from "./agent-runtime";

export interface SubAgentOptions {
  name: string;
  task: string;
  chatId: string;
  /** Agent slug to use (defaults to chief-of-staff) */
  agentSlug?: string;
  /** Timeout in ms (default 5 minutes) */
  timeoutMs?: number;
}

/**
 * Spawn a sub-agent that runs a focused task asynchronously.
 * Returns the run ID immediately. Result is sent to Telegram when done.
 */
export async function spawnSubAgent(options: SubAgentOptions): Promise<string> {
  const { name, task, chatId, agentSlug = "chief-of-staff", timeoutMs = 300_000 } = options;
  const { storage } = await import("../storage");

  // Create audit trail
  const run = await storage.createSubAgentRun({
    name,
    task,
    chatId,
    status: "running",
  });

  // Execute async — don't await
  executeSubAgent(run.id, agentSlug, task, chatId, timeoutMs).catch((err) => {
    logger.error({ runId: run.id, error: err.message }, "Sub-agent execution error (unhandled)");
  });

  return run.id;
}

async function executeSubAgent(
  runId: string,
  agentSlug: string,
  task: string,
  chatId: string,
  timeoutMs: number
): Promise<void> {
  const { storage } = await import("../storage");
  const { sendProactiveMessage } = await import("../channels/channel-manager");
  const { getAuthorizedChatIds } = await import("../channels/adapters/telegram-adapter");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Build a focused prompt for the sub-agent
    const focusedPrompt = `[SUB-AGENT TASK] You are executing a focused sub-task. Be concise and direct.\n\nTask: ${task}\n\nProvide a clear, actionable answer.`;

    const resultPromise = executeAgentChat(agentSlug, focusedPrompt, `sub-agent:${runId}`);

    // Race with timeout
    const result = await Promise.race([
      resultPromise,
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener("abort", () =>
          reject(new Error("Sub-agent timed out after " + Math.round(timeoutMs / 1000) + "s"))
        );
      }),
    ]);

    clearTimeout(timeout);

    // Update run record
    await storage.updateSubAgentRun(runId, {
      status: "completed",
      result: result.response,
      completedAt: new Date(),
    });

    // Send result to Telegram via queue
    const responseText = `🤖 <b>Sub-Agent Complete</b>\n\n<b>Task:</b> ${escapeHtml(task)}\n\n${result.response}`;
    const targetChatIds = chatId ? [chatId] : getAuthorizedChatIds();
    for (const cid of targetChatIds) {
      await sendProactiveMessage("telegram", cid, responseText);
    }
  } catch (error: any) {
    clearTimeout(timeout);

    const isTimeout = error.message?.includes("timed out");
    await storage.updateSubAgentRun(runId, {
      status: isTimeout ? "timeout" : "failed",
      error: error.message,
      completedAt: new Date(),
    });

    // Notify about failure
    const errorText = `❌ <b>Sub-Agent Failed</b>\n\n<b>Task:</b> ${escapeHtml(task)}\n<b>Error:</b> ${escapeHtml(error.message)}`;
    const targetChatIds = chatId ? [chatId] : getAuthorizedChatIds();
    for (const cid of targetChatIds) {
      await sendProactiveMessage("telegram", cid, errorText);
    }

    logger.error({ runId, error: error.message }, "Sub-agent execution failed");
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
