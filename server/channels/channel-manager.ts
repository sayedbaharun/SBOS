/**
 * Channel Manager
 *
 * Routes incoming messages from any channel (Telegram, WhatsApp, web)
 * to the appropriate agent. Manages adapter lifecycle and message routing.
 */

import { logger } from "../logger";
import { executeAgentChat } from "../agents/agent-runtime";
import { loadAgent } from "../agents/agent-registry";
import type {
  ChannelAdapter,
  ChannelStatus,
  IncomingMessage,
  OutgoingMessage,
  RoutingRule,
} from "./types";
import { DEFAULT_AGENT_SLUG } from "./types";

// ============================================================================
// STATE
// ============================================================================

const adapters = new Map<string, ChannelAdapter>();
const routingRules: RoutingRule[] = [];

// ============================================================================
// ADAPTER MANAGEMENT
// ============================================================================

/**
 * Register a channel adapter.
 */
export function registerAdapter(adapter: ChannelAdapter): void {
  adapters.set(adapter.platform, adapter);
  logger.info({ platform: adapter.platform }, "Channel adapter registered");
}

/**
 * Start all registered adapters.
 */
export async function startAllAdapters(): Promise<void> {
  for (const [platform, adapter] of Array.from(adapters.entries())) {
    try {
      await adapter.start();
      logger.info({ platform }, "Channel adapter started");
    } catch (error: any) {
      logger.error({ platform, error: error.message }, "Failed to start channel adapter");
    }
  }
}

/**
 * Stop all adapters gracefully.
 */
export async function stopAllAdapters(): Promise<void> {
  for (const [platform, adapter] of Array.from(adapters.entries())) {
    try {
      await adapter.stop();
      logger.info({ platform }, "Channel adapter stopped");
    } catch (error: any) {
      logger.error({ platform, error: error.message }, "Failed to stop channel adapter");
    }
  }
}

/**
 * Get status of all adapters.
 */
export function getAllAdapterStatus(): ChannelStatus[] {
  const statuses: ChannelStatus[] = [];
  for (const adapter of Array.from(adapters.values())) {
    statuses.push(adapter.getStatus());
  }
  return statuses;
}

/**
 * Get a specific adapter by platform.
 */
export function getAdapter(platform: string): ChannelAdapter | undefined {
  return adapters.get(platform);
}

// ============================================================================
// ROUTING
// ============================================================================

/**
 * Add a routing rule for incoming messages.
 */
export function addRoutingRule(rule: RoutingRule): void {
  routingRules.push(rule);
  logger.info(
    { pattern: rule.pattern, agentSlug: rule.agentSlug },
    "Routing rule added"
  );
}

/**
 * Resolve which agent should handle an incoming message.
 * Checks routing rules first, falls back to Chief of Staff.
 */
function resolveAgent(message: IncomingMessage): string {
  // Check specific routing rules
  for (const rule of routingRules) {
    const [platform, chatId] = rule.pattern.split(":");
    if (platform === message.platform) {
      if (chatId === "*" || chatId === message.chatId) {
        return rule.agentSlug;
      }
    }
  }

  // Check if message contains an @agent mention
  const mentionMatch = message.text.match(/^@(\S+)\s/);
  if (mentionMatch) {
    return mentionMatch[1]; // e.g., "@cmo tell me about..." → "cmo"
  }

  // Default: route to Chief of Staff
  return DEFAULT_AGENT_SLUG;
}

// ============================================================================
// MESSAGE PROCESSING
// ============================================================================

/**
 * Process an incoming message from any channel.
 * Routes to the appropriate agent and returns the response.
 */
export async function processIncomingMessage(
  message: IncomingMessage
): Promise<string> {
  const agentSlug = resolveAgent(message);

  logger.info(
    {
      platform: message.platform,
      senderId: message.senderId,
      agentSlug,
      textLength: message.text.length,
    },
    "Processing incoming channel message"
  );

  try {
    // Check if the resolved agent exists, fall back to default
    const agent = await loadAgent(agentSlug);
    const targetSlug = agent ? agentSlug : DEFAULT_AGENT_SLUG;

    // Strip the @mention if present
    let cleanText = message.text;
    if (message.text.match(/^@\S+\s/)) {
      cleanText = message.text.replace(/^@\S+\s/, "").trim();
    }

    // Add channel context to the message
    const contextPrefix = `[via ${message.platform}, from ${message.senderName}] `;
    const fullMessage = contextPrefix + cleanText;

    // Execute via agent runtime
    const result = await executeAgentChat(
      targetSlug,
      fullMessage,
      `${message.platform}:${message.senderId}`
    );

    logger.info(
      {
        platform: message.platform,
        agentSlug: targetSlug,
        tokensUsed: result.tokensUsed,
      },
      "Channel message processed"
    );

    return result.response;
  } catch (error: any) {
    logger.error(
      {
        platform: message.platform,
        agentSlug,
        error: error.message,
      },
      "Failed to process channel message"
    );

    const msg = error.message || "";
    const hint = msg.includes("context_length") ? " (context overflow)"
      : msg.includes("ENOTFOUND") || msg.includes("ECONNREFUSED") ? " (service unreachable)"
      : msg.includes("rate_limit") ? " (rate limited — try again in a moment)"
      : msg.includes("timeout") || msg.includes("ETIMEDOUT") ? " (timed out)"
      : "";
    return `I encountered an error processing your message${hint}. Please try again.`;
  }
}

/**
 * Send a proactive message via a specific channel.
 * Messages are enqueued for reliable delivery with retry logic.
 * Use sendProactiveMessageDirect() for bypass (used by queue processor).
 *
 * @param threadId - Optional Telegram forum topic thread_id. Routes message into that topic.
 */
export async function sendProactiveMessage(
  platform: string,
  chatId: string,
  text: string,
  threadId?: number
): Promise<void> {
  try {
    const { storage } = await import("../storage");
    await storage.enqueueMessage({
      platform,
      chatId,
      text,
      parseMode: "html",
      ...(threadId !== undefined ? { threadId } : {}),
      status: "pending",
      attempts: 0,
      maxAttempts: 3,
      nextAttemptAt: new Date(),
    });
    logger.debug({ platform, chatId, threadId }, "Proactive message enqueued");
  } catch (err: any) {
    // Fallback to direct send if queue fails (DB down, etc.)
    logger.warn({ error: err.message }, "Queue enqueue failed, falling back to direct send");
    await sendProactiveMessageDirect(platform, chatId, text, "html", threadId);
  }
}

/**
 * Send a proactive message directly (bypasses queue).
 * Used by the queue processor and as fallback.
 *
 * @param threadId - Optional Telegram forum topic thread_id.
 */
export async function sendProactiveMessageDirect(
  platform: string,
  chatId: string,
  text: string,
  parseMode: "html" | "markdown" = "html",
  threadId?: number
): Promise<void> {
  const adapter = adapters.get(platform);
  if (!adapter) {
    logger.warn({ platform }, "No adapter found for proactive message");
    return;
  }

  await adapter.sendMessage({
    chatId,
    text,
    parseMode,
    threadId,
  });

  // Log proactive outgoing message
  if (platform === "telegram") {
    try {
      const { storage } = await import("../storage");
      await storage.createTelegramMessage({
        chatId,
        direction: "outgoing",
        content: text,
        sender: "bot",
        messageType: "proactive",
      });
    } catch (err: any) {
      logger.debug({ error: err.message }, "Failed to log proactive message (non-critical)");
    }
  }
}
