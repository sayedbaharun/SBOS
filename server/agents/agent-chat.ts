/**
 * Agent Chat Execution
 *
 * Main entry point for direct user→agent conversation.
 * Multi-turn tool calling loop with context budget management,
 * quality gate, and learning extraction.
 */

import OpenAI from "openai";
import { eq } from "drizzle-orm";
import { logger } from "../logger";
import * as modelManager from "../model-manager";
import {
  agents,
  agentConversations,
  type AgentConversation,
} from "@shared/schema";
import { resolveAgentModel } from "./types";
import type { AgentChatResult } from "./types";
import { storage } from "../storage";
import { buildMemoryContext, buildRelevantMemoryContext } from "./agent-memory-manager";
import { extractConversationLearnings } from "./learning-extractor";
import { getConversationHistory } from "./conversation-manager";
import { scoreResponse, getEscalationModel, scrubCredentials } from "./response-quality-gate";
import { ToolLoopDetector } from "../infra/tool-loop-detector";
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
 * Execute a chat turn with an agent.
 * This is the main entry point for direct user→agent conversation.
 *
 * @param userId - Session identifier for conversation isolation (e.g. "telegram:123456", "web:user-uuid").
 *   Conversations are scoped by this ID so concurrent users don't see each other's history.
 */
export async function executeAgentChat(
  agentSlug: string,
  userMessage: string,
  userId: string
): Promise<AgentChatResult> {
  const database = await getDb();

  // Load agent
  const [agent] = await database
    .select()
    .from(agents)
    .where(eq(agents.slug, agentSlug));

  if (!agent) {
    throw new Error(`Agent not found: ${agentSlug}`);
  }

  if (!agent.isActive) {
    throw new Error(`Agent "${agentSlug}" is inactive`);
  }

  // Get conversation history with smart token-budget windowing
  // Scoped by userId (session isolation) so concurrent callers don't see each other's history
  const history = await getConversationHistory(agent.id, {
    limit: 20,
    maxTokens: 8000,
    includeDelegation: true,
    sessionId: userId,
  });

  // Get agent memory — split between static context and relevant context
  const memoryBudget = agent.maxContextTokens || 2000;
  const [staticMemory, relevantMemory] = await Promise.all([
    buildMemoryContext(agent.id, Math.floor(memoryBudget * 0.5)),
    buildRelevantMemoryContext(agent.id, userMessage, Math.floor(memoryBudget * 0.5)),
  ]);

  const memoryContext = [staticMemory, relevantMemory].filter(Boolean).join("\n\n");

  // Fetch venture context if agent is venture-scoped
  let ventureContext: string | undefined;
  if (agent.ventureId) {
    try {
      const { getCachedOrBuildContext } = await import("../venture-context-builder");
      ventureContext = await getCachedOrBuildContext(agent.ventureId);
    } catch (err: any) {
      logger.debug({ err: err.message, agentSlug }, "Failed to fetch venture context (non-critical)");
    }
  }

  // Build system prompt
  const systemPrompt = buildSystemPrompt(agent, undefined, ventureContext) + (memoryContext ? `\n\n${memoryContext}` : "");

  // Build permissions from agent config
  const permissions = (agent.actionPermissions as string[]) || ["read"];

  // Build tools
  const tools = buildCoreTools(agent, permissions);

  // Build message array
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...history.map((msg: AgentConversation) => ({
      role: msg.role === "delegation" ? "system" as const : msg.role as "user" | "assistant" | "system",
      content: msg.content,
    })),
    { role: "user", content: userMessage },
  ];

  // Save user message (scoped by session)
  await database.insert(agentConversations).values({
    agentId: agent.id,
    sessionId: userId,
    role: "user",
    content: userMessage,
  });

  // Multi-turn tool calling loop
  const actions: AgentChatResult["actions"] = [];
  const delegations: AgentChatResult["delegations"] = [];
  let conversationMessages = [...messages];
  let finalResponse = "";
  let tokensUsed = 0;
  let modelUsed = "";
  const maxTurns = 10;
  const loopDetector = new ToolLoopDetector();

  const preferredModel = resolveAgentModel(agent);
  const contextBudget = new ContextBudget(preferredModel);

  for (let turn = 0; turn < maxTurns; turn++) {
    // --- Context Budget: check and compact before LLM call ---
    if (turn > 0 && contextBudget.shouldCompact(conversationMessages)) {
      // Layer 1: strip older tool results (synchronous, <5ms)
      contextBudget.stripToolResults(conversationMessages, turn);

      // Layer 2: if still over threshold, run observer compaction
      if (contextBudget.shouldCompact(conversationMessages)) {
        // Layer 3: if 3+ observations accumulated, reflect first to condense them
        if (contextBudget.shouldReflect()) {
          import("./reflector").then(({ reflectAndRoute }) => {
            reflectAndRoute(contextBudget.getObservations(), agent.id, agent.slug)
              .then(() => contextBudget.clearObservations())
              .catch(err => logger.debug({ err: err.message }, "Reflection failed (non-critical)"));
          }).catch(() => {});
        }

        const l2Event = await contextBudget.compactWithObserver(conversationMessages, turn);

        // Fire-and-forget: rescue memories from compacted messages
        if (l2Event?.observation) {
          import("../compaction/memory-rescue").then(({ rescueMemories }) => {
            const texts = conversationMessages
              .filter(m => typeof m.content === "string" && m.role !== "system")
              .map(m => m.content as string);
            if (texts.length > 0) {
              rescueMemories(`agent-${agent.id}-${turn}`, texts).catch(err =>
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
      // Catch context length exceeded errors and trigger emergency compaction
      if (
        error?.status === 400 &&
        (error?.message?.includes("context_length_exceeded") ||
         error?.message?.includes("maximum context length") ||
         error?.message?.includes("too many tokens"))
      ) {
        logger.warn(
          { agentSlug: agent.slug, turn, error: error.message },
          "Context overflow detected — running emergency compaction"
        );
        // Emergency: strip all tool results + run observer
        contextBudget.stripToolResults(conversationMessages, turn);
        await contextBudget.compactWithObserver(conversationMessages, turn);

        // Retry once after emergency compaction
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
    if (!choice?.message) {
      throw new Error("No response from AI");
    }

    // No tool calls → final response
    if (!choice.message.tool_calls || choice.message.tool_calls.length === 0) {
      const rawContent = choice.message.content || "I'm ready to help. What would you like me to work on?";

      // Quality gate: score the response and escalate if needed
      const quality = scoreResponse(rawContent, { agentSlug: agent.slug });

      if (quality.shouldEscalate && turn < maxTurns - 1) {
        const escalationModel = getEscalationModel(modelUsed);
        if (escalationModel) {
          logger.info(
            { agentSlug: agent.slug, score: quality.score, issues: quality.issues, escalatingTo: escalationModel },
            "Quality gate triggered escalation"
          );
          // Retry with higher-tier model on next turn
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

    // Add assistant message with tool calls
    conversationMessages.push(choice.message);

    // Process tool calls
    const toolResults: OpenAI.Chat.ChatCompletionToolMessageParam[] = [];

    for (const toolCall of choice.message.tool_calls) {
      if (toolCall.type !== "function") continue;

      const args = JSON.parse(toolCall.function.arguments);
      const toolResult = await executeTool(agent, toolCall.function.name, args);

      if (toolResult.action) {
        actions.push({
          actionType: toolResult.action.actionType,
          entityType: toolResult.action.entityType,
          entityId: toolResult.action.entityId,
          status: toolResult.action.status,
        });

        if (toolResult.action.actionType === "delegate") {
          delegations.push({
            taskId: toolResult.action.entityId || "",
            toAgentSlug: args.to_agent,
            status: toolResult.action.status,
          });
        }
      }

      toolResults.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: toolResult.result,
      });

      // Tool loop detection: check for repetitive behavior
      const loopCheck = loopDetector.recordAndCheck(
        toolCall.function.name,
        args,
        toolResult.result
      );

      if (loopCheck.detected) {
        logger.warn(
          {
            agentSlug: agent.slug,
            detector: loopCheck.detector,
            severity: loopCheck.severity,
            count: loopCheck.count,
            message: loopCheck.message,
          },
          "Tool loop detected"
        );

        if (loopCheck.severity === "circuit_breaker") {
          // Hard stop: inject a system message and force exit
          toolResults.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: `[SYSTEM] Tool loop detected: ${loopCheck.message}. You must provide your final response now without making more tool calls.${loopCheck.guidance ? `\nExplanation: ${loopCheck.guidance.explanation}\nSuggestion: ${loopCheck.guidance.suggestion}` : ''}`,
          });
          conversationMessages.push(...toolResults);
          // Force one more turn to get a final response, but with no tools
          const { response: exitResponse, metrics: exitMetrics } = await modelManager.chatCompletion(
            {
              messages: conversationMessages,
              temperature: agent.temperature || 0.7,
              max_tokens: agent.maxTokens || 4096,
            },
            "complex",
            preferredModel
          );
          tokensUsed += exitMetrics.tokensUsed || 0;
          modelUsed = exitMetrics.modelUsed;
          finalResponse = scrubCredentials(exitResponse.choices[0]?.message?.content || "I encountered an issue and need to stop processing.");
          // Jump out of the outer loop
          turn = maxTurns;
          break;
        }

        if (loopCheck.severity === "critical") {
          // Inject a warning into the tool result to steer the model
          toolResults[toolResults.length - 1] = {
            role: "tool",
            tool_call_id: toolCall.id,
            content: toolResult.result + `\n\n[SYSTEM WARNING] ${loopCheck.message}. Try a different approach or provide your final response.${loopCheck.guidance ? `\nExplanation: ${loopCheck.guidance.explanation}\nSuggestion: ${loopCheck.guidance.suggestion}` : ''}`,
          };
        }
      }
    }

    conversationMessages.push(...toolResults);
  }

  // Save assistant response (scoped by session)
  await database.insert(agentConversations).values({
    agentId: agent.id,
    sessionId: userId,
    role: "assistant",
    content: finalResponse,
    metadata: {
      model: modelUsed,
      tokensUsed,
      actionsTaken: actions.map((a) => a.actionType),
      delegations: delegations.map((d) => d.toAgentSlug),
    },
  });

  // Fire-and-forget: extract learnings from this conversation (enhanced with compaction observations)
  const compactionObservations = contextBudget.getObservations();
  extractConversationLearnings({
    agentId: agent.id,
    agentSlug: agent.slug,
    userMessage,
    assistantResponse: finalResponse,
    ventureId: agent.ventureId || undefined,
    actions,
    compactionObservations: compactionObservations.length > 0 ? compactionObservations : undefined,
  }).catch(err => logger.debug({ err: err.message }, "Learning extraction failed (non-critical)"));

  // Fire-and-forget: extract entity relationships
  import("../memory/entity-extractor").then(({ extractEntities }) =>
    extractEntities(userMessage, finalResponse, agent.ventureId ? "business" : "personal")
      .catch(err => logger.debug({ err: err.message }, "Entity extraction failed (non-critical)"))
  ).catch(() => {});

  logger.info(
    {
      agentSlug,
      model: modelUsed,
      tokensUsed,
      actions: actions.length,
      delegations: delegations.length,
    },
    "Agent chat completed"
  );

  return {
    response: finalResponse,
    agentId: agent.id,
    agentSlug: agent.slug,
    actions,
    delegations,
    tokensUsed,
    model: modelUsed,
  };
}
