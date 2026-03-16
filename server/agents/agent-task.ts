/**
 * Agent Task Execution
 *
 * Handles delegated task execution for agents.
 * Called by the delegation engine when a task is assigned.
 */

import OpenAI from "openai";
import { eq } from "drizzle-orm";
import { logger } from "../logger";
import * as modelManager from "../model-manager";
import {
  agents,
  agentConversations,
  agentTasks,
  type Agent,
} from "@shared/schema";
import { resolveAgentModel } from "./types";
import type { AgentChatResult, DelegationContext } from "./types";
import { completeDelegation } from "./delegation-engine";
import { storage } from "../storage";
import { storeTaskOutcomeLearning } from "./learning-extractor";
import { scoreResponse, getEscalationModel, scrubCredentials } from "./response-quality-gate";
import { ContextBudget, ContextOverflowError } from "./context-budget";
import { buildSystemPrompt } from "./agent-prompt";
import { buildCoreTools } from "./agent-tools";
import { executeTool } from "./agent-tool-handlers";

// Lazy DB
let db: any = null;
async function getDb() {
  if (!db) {
    db = (storage as any).db;
  }
  return db;
}

/**
 * Execute a delegated task for an agent.
 * Called by the delegation engine when a task is assigned.
 */
export async function executeAgentTask(
  taskId: string
): Promise<AgentChatResult | null> {
  const database = await getDb();

  // Load the task
  const [task] = await database
    .select()
    .from(agentTasks)
    .where(eq(agentTasks.id, taskId));

  if (!task) {
    logger.error({ taskId }, "Agent task not found");
    return null;
  }

  // Load the assigned agent
  const [agent] = await database
    .select()
    .from(agents)
    .where(eq(agents.id, task.assignedTo));

  if (!agent) {
    logger.error({ taskId, assignedTo: task.assignedTo }, "Assigned agent not found");
    return null;
  }

  // Load the delegating agent (for context)
  let parentAgent: Agent | null = null;
  if (task.assignedBy !== "user") {
    const [parent] = await database
      .select()
      .from(agents)
      .where(eq(agents.id, task.assignedBy));
    parentAgent = parent || null;
  }

  // Mark task as in progress
  await database
    .update(agentTasks)
    .set({ status: "in_progress", startedAt: new Date() })
    .where(eq(agentTasks.id, taskId));

  // Build delegation context
  const delegationContext: DelegationContext | undefined = parentAgent
    ? {
        task,
        parentAgent,
        delegationChain: (task.delegationChain as string[]) || [],
        grantedPermissions: (task.grantedPermissions as string[]) || [],
        grantedTools: (task.grantedTools as string[]) || [],
        depth: task.depth || 0,
      }
    : undefined;

  // Build system prompt with delegation context
  const systemPrompt = buildSystemPrompt(agent, delegationContext);

  // Build tools (filtered by granted tools if delegated)
  const effectivePermissions = delegationContext
    ? delegationContext.grantedPermissions
    : (agent.actionPermissions as string[]) || ["read"];
  const tools = buildCoreTools(agent, effectivePermissions);

  // Build the task message
  const taskMessage = `${task.title}\n\n${task.description || "Please complete this task."}`;

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: taskMessage },
  ];

  // Execute
  const actions: AgentChatResult["actions"] = [];
  const delegations: AgentChatResult["delegations"] = [];
  let conversationMessages = [...messages];
  let finalResponse = "";
  let tokensUsed = 0;
  let modelUsed = "";
  const maxTurns = 10;

  const preferredModel = resolveAgentModel(agent);
  const contextBudget = new ContextBudget(preferredModel);

  try {
    for (let turn = 0; turn < maxTurns; turn++) {
      // --- Context Budget: check and compact before LLM call ---
      if (turn > 0 && contextBudget.shouldCompact(conversationMessages)) {
        contextBudget.stripToolResults(conversationMessages, turn);

        if (contextBudget.shouldCompact(conversationMessages)) {
          // Layer 3: reflect if 3+ observations accumulated
          if (contextBudget.shouldReflect()) {
            import("./reflector").then(({ reflectAndRoute }) => {
              reflectAndRoute(contextBudget.getObservations(), agent.id, agent.slug)
                .then(() => contextBudget.clearObservations())
                .catch(err => logger.debug({ err: err.message }, "Reflection failed (non-critical)"));
            }).catch(() => {});
          }

          const l2Event = await contextBudget.compactWithObserver(conversationMessages, turn);

          if (l2Event?.observation) {
            import("../compaction/memory-rescue").then(({ rescueMemories }) => {
              const texts = conversationMessages
                .filter(m => typeof m.content === "string" && m.role !== "system")
                .map(m => m.content as string);
              if (texts.length > 0) {
                rescueMemories(`task-${taskId}-${turn}`, texts).catch(err =>
                  logger.debug({ err: err.message }, "Memory rescue failed (non-critical)")
                );
              }
            }).catch(() => {});
          }
        }
      }

      let response: OpenAI.Chat.ChatCompletion;
      let metrics: any;
      try {
        ({ response, metrics } = await modelManager.chatCompletion(
          {
            messages: conversationMessages,
            tools: tools.length > 0 ? tools : undefined,
            temperature: agent.temperature || 0.7,
            max_tokens: agent.maxTokens || 4096,
          },
          "complex",
          preferredModel
        ));
      } catch (error: any) {
        if (
          error?.status === 400 &&
          (error?.message?.includes("context_length_exceeded") ||
           error?.message?.includes("maximum context length") ||
           error?.message?.includes("too many tokens"))
        ) {
          logger.warn(
            { agentSlug: agent.slug, taskId, turn, error: error.message },
            "Context overflow in task — running emergency compaction"
          );
          contextBudget.stripToolResults(conversationMessages, turn);
          await contextBudget.compactWithObserver(conversationMessages, turn);

          try {
            ({ response, metrics } = await modelManager.chatCompletion(
              {
                messages: conversationMessages,
                tools: tools.length > 0 ? tools : undefined,
                temperature: agent.temperature || 0.7,
                max_tokens: agent.maxTokens || 4096,
              },
              "complex",
              preferredModel
            ));
          } catch (retryError: any) {
            throw new ContextOverflowError(
              contextBudget.estimateContextSize(conversationMessages),
              contextBudget.getContextWindow(),
            );
          }
        } else {
          throw error;
        }
      }

      tokensUsed += metrics.tokensUsed || 0;
      modelUsed = metrics.modelUsed;

      const choice = response.choices[0];
      if (!choice?.message) break;

      if (!choice.message.tool_calls || choice.message.tool_calls.length === 0) {
        const rawContent = choice.message.content || "";

        // Quality gate for delegated task responses
        const quality = scoreResponse(rawContent, { agentSlug: agent.slug });

        if (quality.shouldEscalate && turn < maxTurns - 1) {
          const escalationModel = getEscalationModel(modelUsed);
          if (escalationModel) {
            logger.info(
              { agentSlug: agent.slug, taskId, score: quality.score, issues: quality.issues, escalatingTo: escalationModel },
              "Quality gate triggered escalation (task execution)"
            );
            const { response: retryResponse, metrics: retryMetrics } = await modelManager.chatCompletion(
              {
                messages: conversationMessages,
                tools: tools.length > 0 ? tools : undefined,
                temperature: agent.temperature || 0.7,
                max_tokens: agent.maxTokens || 4096,
              },
              "complex",
              escalationModel
            );
            tokensUsed += retryMetrics.tokensUsed || 0;
            modelUsed = retryMetrics.modelUsed;
            const retryChoice = retryResponse.choices[0];
            if (retryChoice?.message?.content) {
              finalResponse = scrubCredentials(retryChoice.message.content);
              break;
            }
          }
        }

        finalResponse = scrubCredentials(rawContent);
        break;
      }

      conversationMessages.push(choice.message);

      const toolResults: OpenAI.Chat.ChatCompletionToolMessageParam[] = [];
      for (const toolCall of choice.message.tool_calls) {
        if (toolCall.type !== "function") continue;
        const args = JSON.parse(toolCall.function.arguments);
        const toolResult = await executeTool(agent, toolCall.function.name, args, delegationContext);

        if (toolResult.action) {
          actions.push({
            actionType: toolResult.action.actionType,
            entityType: toolResult.action.entityType,
            entityId: toolResult.action.entityId,
            status: toolResult.action.status,
          });
        }

        toolResults.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: toolResult.result,
        });
      }

      conversationMessages.push(...toolResults);
    }

    // Mark task completed
    await completeDelegation(taskId, {
      response: finalResponse,
      actions,
      tokensUsed,
      model: modelUsed,
    });

    // Store task outcome learning (fire-and-forget)
    storeTaskOutcomeLearning({
      agentId: agent.id,
      agentSlug: agent.slug,
      taskTitle: task.title,
      taskDescription: task.description || undefined,
      outcome: "completed",
      response: finalResponse,
    }).catch(err => logger.debug({ err: err.message }, "Task outcome learning failed"));

    // Save conversation
    await database.insert(agentConversations).values({
      agentId: agent.id,
      role: "delegation",
      content: `[Delegated Task: ${task.title}]\n\n${finalResponse}`,
      delegationFrom: task.assignedBy !== "user" ? task.assignedBy : undefined,
      delegationTaskId: taskId,
      metadata: { model: modelUsed, tokensUsed },
    });

    return {
      response: finalResponse,
      agentId: agent.id,
      agentSlug: agent.slug,
      actions,
      delegations,
      tokensUsed,
      model: modelUsed,
    };
  } catch (error: any) {
    logger.error({ taskId, agentSlug: agent.slug, error: error.message }, "Agent task execution failed");

    await database
      .update(agentTasks)
      .set({ status: "failed", error: error.message, completedAt: new Date() })
      .where(eq(agentTasks.id, taskId));

    // Store failure learning (fire-and-forget)
    storeTaskOutcomeLearning({
      agentId: agent.id,
      agentSlug: agent.slug,
      taskTitle: task.title,
      taskDescription: task.description || undefined,
      outcome: "failed",
      error: error.message,
    }).catch(() => {});

    return null;
  }
}
