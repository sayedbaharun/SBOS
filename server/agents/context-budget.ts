/**
 * Context Budget Manager — Resonance Pentad Layer 1 & 2
 *
 * Manages token budgets for agent tool loops, preventing context overflow.
 *
 * Layer 1 (stripToolResults): Zero-cost, synchronous. Replaces older tool results
 * with compact references. ~30-50% token reduction.
 *
 * Layer 2 (compactWithObserver): LLM-powered. Generates structured observations
 * from older messages, preserving momentum. ~60-80% reduction.
 *
 * Layer 3 (reflection): Condenses multiple observations when 3+ accumulate.
 */

import type OpenAI from "openai";
import { logger } from "../logger";
import { estimateTokens } from "../chunking";

// ---------------------------------------------------------------------------
// Model context window limits (tokens)
// ---------------------------------------------------------------------------
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  // OpenRouter model IDs
  "anthropic/claude-3-opus": 200_000,
  "anthropic/claude-3.5-sonnet": 200_000,
  "anthropic/claude-3-sonnet": 200_000,
  "anthropic/claude-3-haiku": 200_000,
  "anthropic/claude-3.5-haiku": 200_000,
  "openai/gpt-4o": 128_000,
  "openai/gpt-4o-mini": 128_000,
  "openai/gpt-4-turbo": 128_000,
  "google/gemini-pro-1.5": 1_000_000,
};

const DEFAULT_CONTEXT_WINDOW = 128_000;
const COMPACTION_THRESHOLD = 0.75; // 75% triggers Layer 1
const KEEP_RECENT_EXCHANGES = 3; // Keep last 3 assistant+tool rounds

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompactionEvent {
  layer: 1 | 2 | 3;
  turnNumber: number;
  tokensBefore: number;
  tokensAfter: number;
  tokensSaved: number;
  latencyMs: number;
  compactionModel?: string;
  observation?: ObservationOutput;
}

export interface ObservationOutput {
  summary: string;
  key_decisions: Array<{ text: string; priority: "high" | "medium" | "low" }>;
  key_facts: string[];
  key_entities: string[];
  domain: string;
  action_items: string[];
  nextSteps: Array<{ text: string; priority: "high" | "medium" | "low" }>;
  openQuestions: string[];
}

export class ContextOverflowError extends Error {
  constructor(
    public tokenCount: number,
    public contextWindow: number,
  ) {
    super(
      `Context overflow: ${tokenCount} tokens exceeds ${contextWindow} window`,
    );
    this.name = "ContextOverflowError";
  }
}

// ---------------------------------------------------------------------------
// ContextBudget
// ---------------------------------------------------------------------------

export class ContextBudget {
  private contextWindow: number;
  private compactionEvents: CompactionEvent[] = [];
  private observations: ObservationOutput[] = [];

  constructor(modelId?: string) {
    this.contextWindow = modelId
      ? (MODEL_CONTEXT_WINDOWS[modelId] ?? DEFAULT_CONTEXT_WINDOW)
      : DEFAULT_CONTEXT_WINDOW;
  }

  /**
   * Estimate total tokens across all messages in the conversation.
   */
  estimateContextSize(
    messages: OpenAI.Chat.ChatCompletionMessageParam[],
  ): number {
    let total = 0;
    for (const msg of messages) {
      total += this.estimateMessageTokens(msg);
    }
    return total;
  }

  /**
   * Returns true when context exceeds threshold and compaction should run.
   */
  shouldCompact(
    messages: OpenAI.Chat.ChatCompletionMessageParam[],
  ): boolean {
    const tokens = this.estimateContextSize(messages);
    return tokens >= this.contextWindow * COMPACTION_THRESHOLD;
  }

  /**
   * Returns true when 3+ observations have accumulated and reflection should run.
   */
  shouldReflect(): boolean {
    return this.observations.length >= 3;
  }

  /**
   * Get the accumulated observations for reflection.
   */
  getObservations(): ObservationOutput[] {
    return [...this.observations];
  }

  /**
   * Add an observation from Layer 2 compaction.
   */
  addObservation(obs: ObservationOutput): void {
    this.observations.push(obs);
  }

  /**
   * Replace accumulated observations with a single reflected summary.
   */
  clearObservations(): void {
    this.observations = [];
  }

  /**
   * Get all compaction events for metrics.
   */
  getCompactionEvents(): CompactionEvent[] {
    return [...this.compactionEvents];
  }

  /**
   * Get context window size.
   */
  getContextWindow(): number {
    return this.contextWindow;
  }

  // =========================================================================
  // Layer 1: Strip Tool Results (synchronous, zero LLM cost)
  // =========================================================================

  /**
   * Replace older tool results with compact references.
   * Keeps the last KEEP_RECENT_EXCHANGES rounds intact.
   * Mutates the messages array in-place and returns token savings.
   */
  stripToolResults(
    messages: OpenAI.Chat.ChatCompletionMessageParam[],
    turn: number,
  ): CompactionEvent | null {
    const startTime = Date.now();
    const tokensBefore = this.estimateContextSize(messages);

    // Find tool messages (role === "tool") that are NOT in recent exchanges.
    // We keep the system message, then identify "rounds" by assistant messages
    // that have tool_calls followed by their tool result messages.
    const recentBoundary = this.findRecentBoundary(messages);

    let stripped = 0;
    for (let i = 0; i < recentBoundary; i++) {
      const msg = messages[i];
      if (msg.role === "tool" && typeof msg.content === "string") {
        const original = msg.content;
        if (original.length > 200) {
          // Find the corresponding tool call to get the function name
          const toolCallId = (msg as any).tool_call_id;
          const funcName = this.findToolName(messages, toolCallId, i);
          const firstLine = original.split("\n")[0].slice(0, 100);

          (msg as any).content = `[Tool: ${funcName || "unknown"}() → ${firstLine}... (${estimateTokens(original)} tokens stripped)]`;
          stripped++;
        }
      }
    }

    if (stripped === 0) return null;

    const tokensAfter = this.estimateContextSize(messages);
    const event: CompactionEvent = {
      layer: 1,
      turnNumber: turn,
      tokensBefore,
      tokensAfter,
      tokensSaved: tokensBefore - tokensAfter,
      latencyMs: Date.now() - startTime,
    };

    this.compactionEvents.push(event);

    logger.info(
      {
        layer: 1,
        turn,
        tokensBefore,
        tokensAfter,
        tokensSaved: event.tokensSaved,
        strippedCount: stripped,
        latencyMs: event.latencyMs,
      },
      "Layer 1 compaction: tool results stripped",
    );

    return event;
  }

  // =========================================================================
  // Layer 2: Observer Compaction (async, LLM-powered)
  // =========================================================================

  /**
   * Generate an observation from older messages, replace them with a
   * compacted context system message. Keeps recent exchanges intact.
   *
   * Returns the observation output for downstream routing.
   */
  async compactWithObserver(
    messages: OpenAI.Chat.ChatCompletionMessageParam[],
    turn: number,
  ): Promise<CompactionEvent | null> {
    const startTime = Date.now();
    const tokensBefore = this.estimateContextSize(messages);

    const recentBoundary = this.findRecentBoundary(messages);

    // Gather messages to compact (skip system messages at index 0)
    const systemMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    const toCompact: OpenAI.Chat.ChatCompletionMessageParam[] = [];

    for (let i = 0; i < recentBoundary; i++) {
      const msg = messages[i];
      if (msg.role === "system") {
        systemMessages.push(msg);
      } else {
        toCompact.push(msg);
      }
    }

    if (toCompact.length < 2) return null;

    // Generate observation via Observer
    const { generateObservation } = await import("./observer");
    const observation = await generateObservation(toCompact);

    if (!observation) return null;

    // Build compacted context message
    const compactedContent = this.formatObservation(observation);

    // Replace: keep system msgs + compacted summary + recent messages
    const recentMessages = messages.slice(recentBoundary);
    messages.length = 0;
    messages.push(
      ...systemMessages,
      { role: "system", content: compactedContent },
      ...recentMessages,
    );

    this.addObservation(observation);

    const tokensAfter = this.estimateContextSize(messages);
    const event: CompactionEvent = {
      layer: 2,
      turnNumber: turn,
      tokensBefore,
      tokensAfter,
      tokensSaved: tokensBefore - tokensAfter,
      latencyMs: Date.now() - startTime,
      compactionModel: "openai/gpt-4o-mini",
      observation,
    };

    this.compactionEvents.push(event);

    logger.info(
      {
        layer: 2,
        turn,
        tokensBefore,
        tokensAfter,
        tokensSaved: event.tokensSaved,
        latencyMs: event.latencyMs,
      },
      "Layer 2 compaction: observer generated observation",
    );

    return event;
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  private estimateMessageTokens(
    msg: OpenAI.Chat.ChatCompletionMessageParam,
  ): number {
    // Base overhead per message (role, formatting)
    let tokens = 4;

    if (typeof msg.content === "string") {
      tokens += estimateTokens(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if ("text" in part && typeof part.text === "string") {
          tokens += estimateTokens(part.text);
        }
      }
    }

    // Tool calls in assistant messages
    if ("tool_calls" in msg && Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        const fn = (tc as any).function;
        if (fn) {
          tokens += estimateTokens(fn.name || "");
          tokens += estimateTokens(fn.arguments || "");
        }
      }
    }

    return tokens;
  }

  /**
   * Find the index where "recent" messages start.
   * We keep the last KEEP_RECENT_EXCHANGES assistant+tool rounds.
   */
  private findRecentBoundary(
    messages: OpenAI.Chat.ChatCompletionMessageParam[],
  ): number {
    // Count assistant messages with tool_calls from the end
    let roundsSeen = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (
        msg.role === "assistant" &&
        "tool_calls" in msg &&
        msg.tool_calls &&
        msg.tool_calls.length > 0
      ) {
        roundsSeen++;
        if (roundsSeen >= KEEP_RECENT_EXCHANGES) {
          return i;
        }
      }
    }
    // If fewer rounds than threshold, keep everything after system messages
    let firstNonSystem = 0;
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].role !== "system") {
        firstNonSystem = i;
        break;
      }
    }
    return firstNonSystem;
  }

  /**
   * Walk backwards from tool message to find the assistant message with
   * the matching tool_call_id, then return the function name.
   */
  private findToolName(
    messages: OpenAI.Chat.ChatCompletionMessageParam[],
    toolCallId: string | undefined,
    fromIndex: number,
  ): string | null {
    if (!toolCallId) return null;
    for (let i = fromIndex - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === "assistant" && "tool_calls" in msg && msg.tool_calls) {
        for (const tc of msg.tool_calls as any[]) {
          if (tc.id === toolCallId) {
            return tc.function?.name || null;
          }
        }
      }
    }
    return null;
  }

  /**
   * Format an observation into a system message for context injection.
   */
  private formatObservation(obs: ObservationOutput): string {
    const sections: string[] = [
      "[COMPACTED CONTEXT — Prior conversation summarized by Observer]",
      "",
      obs.summary,
    ];

    if (obs.key_decisions.length > 0) {
      sections.push(
        "",
        "Key Decisions:",
        ...obs.key_decisions.map(
          (d) => `- [${d.priority}] ${d.text}`,
        ),
      );
    }

    if (obs.key_facts.length > 0) {
      sections.push("", "Key Facts:", ...obs.key_facts.map((f) => `- ${f}`));
    }

    if (obs.nextSteps.length > 0) {
      sections.push(
        "",
        "Next Steps:",
        ...obs.nextSteps.map(
          (s) => `- [${s.priority}] ${s.text}`,
        ),
      );
    }

    if (obs.openQuestions.length > 0) {
      sections.push(
        "",
        "Open Questions:",
        ...obs.openQuestions.map((q) => `- ${q}`),
      );
    }

    if (obs.action_items.length > 0) {
      sections.push(
        "",
        "Action Items:",
        ...obs.action_items.map((a) => `- ${a}`),
      );
    }

    return sections.join("\n");
  }
}

/**
 * Resolve context window for a model ID string.
 */
export function getContextWindow(modelId?: string): number {
  if (!modelId) return DEFAULT_CONTEXT_WINDOW;
  return MODEL_CONTEXT_WINDOWS[modelId] ?? DEFAULT_CONTEXT_WINDOW;
}
