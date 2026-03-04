/**
 * Channel Types
 *
 * Shared types for all messaging channel adapters (Telegram, WhatsApp, etc.).
 * Normalizes incoming messages into a common format for agent routing.
 */

// ============================================================================
// INCOMING MESSAGES (normalized from any channel)
// ============================================================================

export interface IncomingMessage {
  /** Unique message ID from the channel */
  channelMessageId: string;
  /** Channel platform */
  platform: "telegram" | "whatsapp" | "web";
  /** Sender's ID on the platform */
  senderId: string;
  /** Sender's display name */
  senderName: string;
  /** Chat/conversation ID on the platform */
  chatId: string;
  /** Message content (text extracted from any format) */
  text: string;
  /** Original message type */
  messageType: "text" | "photo" | "voice" | "document" | "command";
  /** Timestamp */
  timestamp: Date;
  /** Any media URLs */
  mediaUrl?: string;
  /** Raw metadata from the channel */
  metadata?: Record<string, unknown>;
}

// ============================================================================
// OUTGOING MESSAGES
// ============================================================================

export interface OutgoingMessage {
  /** Chat/conversation ID to send to */
  chatId: string;
  /** Message text (markdown supported) */
  text: string;
  /** Parse mode for formatting */
  parseMode?: "html" | "markdown";
  /** Whether this is a reply to a specific message */
  replyToMessageId?: string;
}

// ============================================================================
// CHANNEL ADAPTER INTERFACE
// ============================================================================

export interface ChannelCapabilities {
  /** Can the adapter edit previously sent messages */
  supportsEditing: boolean;
  /** Does the adapter support inline keyboard buttons */
  supportsInlineKeyboards: boolean;
  /** Can the adapter stream partial responses */
  supportsStreaming: boolean;
  /** Maximum message length in characters */
  maxMessageLength: number;
}

export interface ChannelAdapter {
  /** Platform name */
  platform: "telegram" | "whatsapp";
  /** Platform capabilities */
  capabilities: ChannelCapabilities;
  /** Start the adapter (begin listening for messages) */
  start(): Promise<void>;
  /** Stop the adapter gracefully */
  stop(): Promise<void>;
  /** Send a message to a chat */
  sendMessage(msg: OutgoingMessage): Promise<void>;
  /** Edit a previously sent message (if supported) */
  editMessage?(chatId: string, messageId: string, text: string, parseMode?: "html" | "markdown"): Promise<void>;
  /** Check if the adapter is connected and healthy */
  isConnected(): boolean;
  /** Get adapter status info */
  getStatus(): ChannelStatus;
}

export interface ChannelStatus {
  platform: string;
  connected: boolean;
  startedAt: string | null;
  messagesReceived: number;
  messagesSent: number;
  errors: number;
  lastError: string | null;
  lastActivity: string | null;
}

// ============================================================================
// ROUTING
// ============================================================================

/** How to route incoming messages to agents */
export interface RoutingRule {
  /** Channel + chat ID pattern (e.g., "telegram:*" or "telegram:12345") */
  pattern: string;
  /** Agent slug to route to */
  agentSlug: string;
  /** Whether to use the Chief of Staff for triage first */
  triageFirst: boolean;
}

/** Default routing: messages go to Chief of Staff for triage */
export const DEFAULT_AGENT_SLUG = "chief-of-staff";
