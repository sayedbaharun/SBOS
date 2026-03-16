/**
 * WhatsApp Channel Adapter
 *
 * Connects to WhatsApp Business API (Cloud API) for bidirectional messaging.
 * Routes incoming messages to the agent system via the channel manager.
 *
 * Features:
 * - Webhook-based message reception
 * - Text + voice + image message handling
 * - Agent routing via @mentions
 * - Rate limiting per phone number
 * - Message splitting for long responses
 *
 * Requires:
 * - WHATSAPP_ACCESS_TOKEN: Meta Business API access token
 * - WHATSAPP_PHONE_NUMBER_ID: WhatsApp Business phone number ID
 * - WHATSAPP_VERIFY_TOKEN: Webhook verification token
 * - WHATSAPP_WEBHOOK_PATH: Express route path for webhook (default: /api/webhooks/whatsapp)
 */

import { logger } from "../../logger";
import { processIncomingMessage } from "../channel-manager";
import type {
  ChannelAdapter,
  ChannelStatus,
  IncomingMessage,
  OutgoingMessage,
} from "../types";
import { getCredential } from "../../infra/credential-proxy";

// ============================================================================
// CONFIG
// ============================================================================

const WHATSAPP_API_VERSION = "v21.0";
const WHATSAPP_API_BASE = `https://graph.facebook.com/${WHATSAPP_API_VERSION}`;
const MAX_MESSAGE_LENGTH = 4096;

// Rate limiting
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;
const phoneRateLimits = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(phoneId: string): boolean {
  const now = Date.now();
  const limit = phoneRateLimits.get(phoneId);

  if (!limit || now > limit.resetAt) {
    phoneRateLimits.set(phoneId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  if (limit.count >= RATE_LIMIT_MAX) {
    return false;
  }

  limit.count++;
  return true;
}

// Cleanup expired rate limits
setInterval(() => {
  const now = Date.now();
  const expired: string[] = [];
  phoneRateLimits.forEach((limit, id) => {
    if (now > limit.resetAt) expired.push(id);
  });
  expired.forEach((id) => phoneRateLimits.delete(id));
}, 5 * 60 * 1000);

// ============================================================================
// WHATSAPP API HELPERS
// ============================================================================

async function sendWhatsAppMessage(
  phoneNumberId: string,
  to: string,
  text: string,
  accessToken: string
): Promise<{ messageId: string } | null> {
  try {
    const response = await fetch(
      `${WHATSAPP_API_BASE}/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "text",
          text: { body: text },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      logger.error({ status: response.status, error }, "WhatsApp send failed");
      return null;
    }

    const data = await response.json();
    return { messageId: data.messages?.[0]?.id || "unknown" };
  } catch (error: any) {
    logger.error({ error: error.message }, "WhatsApp send error");
    return null;
  }
}

async function markAsRead(
  phoneNumberId: string,
  messageId: string,
  accessToken: string
): Promise<void> {
  try {
    await fetch(`${WHATSAPP_API_BASE}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
      }),
    });
  } catch {
    // Non-critical — don't fail the response
  }
}

// ============================================================================
// ADAPTER
// ============================================================================

class WhatsAppAdapter implements ChannelAdapter {
  platform = "whatsapp" as const;
  capabilities = {
    supportsEditing: false, // WhatsApp doesn't support editing sent messages
    supportsInlineKeyboards: false, // WhatsApp has buttons but different format
    supportsStreaming: false,
    maxMessageLength: MAX_MESSAGE_LENGTH,
  };

  private connected = false;
  private startedAt: Date | null = null;
  private stats = {
    messagesReceived: 0,
    messagesSent: 0,
    errors: 0,
    lastError: null as string | null,
    lastActivity: null as Date | null,
  };

  async start(): Promise<void> {
    const accessToken = getCredential("whatsapp");
    const phoneNumberId = getCredential("whatsapp_phone_id");

    if (!accessToken || !phoneNumberId) {
      logger.warn("WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID not set — WhatsApp adapter disabled");
      return;
    }

    // Verify credentials by checking the phone number
    try {
      const response = await fetch(
        `${WHATSAPP_API_BASE}/${phoneNumberId}`,
        {
          headers: { "Authorization": `Bearer ${accessToken}` },
        }
      );

      if (!response.ok) {
        logger.error({ status: response.status }, "WhatsApp credential verification failed");
        return;
      }

      const data = await response.json();
      logger.info(
        { phoneNumber: data.display_phone_number, qualityRating: data.quality_rating },
        "WhatsApp adapter connected"
      );
    } catch (error: any) {
      logger.error({ error: error.message }, "WhatsApp startup failed");
      return;
    }

    this.connected = true;
    this.startedAt = new Date();
    logger.info("WhatsApp adapter started (webhook mode)");
  }

  async stop(): Promise<void> {
    this.connected = false;
    logger.info("WhatsApp adapter stopped");
  }

  /**
   * Handle incoming webhook event from WhatsApp Cloud API.
   * Called by the Express route handler.
   */
  async handleWebhook(body: any): Promise<void> {
    if (!body?.entry) return;

    for (const entry of body.entry) {
      const changes = entry.changes || [];
      for (const change of changes) {
        if (change.field !== "messages") continue;

        const value = change.value;
        if (!value?.messages) continue;

        const contacts = value.contacts || [];
        const metadata = value.metadata || {};

        for (const msg of value.messages) {
          await this.processMessage(msg, contacts, metadata);
        }
      }
    }
  }

  private async processMessage(
    msg: any,
    contacts: any[],
    metadata: any
  ): Promise<void> {
    try {
      this.stats.messagesReceived++;
      this.stats.lastActivity = new Date();

      const from = msg.from; // Phone number (e.g., "971501234567")
      const contact = contacts.find((c: any) => c.wa_id === from);
      const senderName = contact?.profile?.name || from;
      const phoneNumberId = metadata.phone_number_id;

      // Rate limit
      if (!checkRateLimit(from)) {
        logger.warn({ from }, "WhatsApp rate limit exceeded");
        return;
      }

      // Mark as read
      const accessToken = getCredential("whatsapp");
      if (accessToken) {
        markAsRead(phoneNumberId, msg.id, accessToken);
      }

      let text = "";
      let messageType: IncomingMessage["messageType"] = "text";

      if (msg.type === "text") {
        text = msg.text?.body || "";
      } else if (msg.type === "audio" || msg.type === "voice") {
        // Transcribe voice message
        messageType = "voice";
        try {
          const mediaUrl = await this.getMediaUrl(msg.audio?.id || msg.voice?.id);
          if (mediaUrl) {
            const { transcribeAudio } = await import("../../voice/voice-service");
            const result = await transcribeAudio(mediaUrl);
            text = result.text || "";

            // Notify user what was heard
            if (text && accessToken) {
              await sendWhatsAppMessage(
                phoneNumberId, from,
                `Heard: "${text}"`,
                accessToken
              );
            }
          }
        } catch (err: any) {
          logger.warn({ error: err.message }, "WhatsApp voice transcription failed");
          text = "[Voice message — transcription failed]";
        }
      } else if (msg.type === "image") {
        messageType = "photo";
        text = msg.image?.caption || "[Image received]";
      } else {
        // Unsupported message type
        logger.debug({ type: msg.type }, "Unsupported WhatsApp message type");
        return;
      }

      if (!text.trim()) return;

      // Build normalized message
      const incomingMessage: IncomingMessage = {
        channelMessageId: msg.id,
        platform: "whatsapp",
        senderId: from,
        senderName,
        chatId: from, // In WhatsApp, chatId = phone number for 1:1 chats
        text,
        messageType,
        timestamp: new Date(parseInt(msg.timestamp) * 1000),
        metadata: { whatsappMessageType: msg.type },
      };

      // Route to agent system
      const response = await processIncomingMessage(incomingMessage);

      // Send response
      if (accessToken) {
        await this.sendLongMessage(from, response);
      }

      this.stats.messagesSent++;
    } catch (error: any) {
      logger.error({ error: error.message }, "Error processing WhatsApp message");
      this.stats.errors++;
      this.stats.lastError = error.message;
    }
  }

  async sendMessage(msg: OutgoingMessage): Promise<void> {
    const accessToken = getCredential("whatsapp");
    const phoneNumberId = getCredential("whatsapp_phone_id");

    if (!accessToken || !phoneNumberId) {
      logger.warn("Cannot send WhatsApp message: not configured");
      return;
    }

    await this.sendLongMessage(msg.chatId, msg.text);
    this.stats.messagesSent++;
    this.stats.lastActivity = new Date();
  }

  isConnected(): boolean {
    return this.connected;
  }

  getStatus(): ChannelStatus {
    return {
      platform: "whatsapp",
      connected: this.connected,
      startedAt: this.startedAt?.toISOString() || null,
      messagesReceived: this.stats.messagesReceived,
      messagesSent: this.stats.messagesSent,
      errors: this.stats.errors,
      lastError: this.stats.lastError,
      lastActivity: this.stats.lastActivity?.toISOString() || null,
    };
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  /**
   * Get media download URL from WhatsApp media ID.
   */
  private async getMediaUrl(mediaId: string): Promise<string | null> {
    const accessToken = getCredential("whatsapp");
    if (!accessToken || !mediaId) return null;

    try {
      // Step 1: Get media URL
      const response = await fetch(
        `${WHATSAPP_API_BASE}/${mediaId}`,
        { headers: { "Authorization": `Bearer ${accessToken}` } }
      );

      if (!response.ok) return null;
      const data = await response.json();
      return data.url || null;
    } catch {
      return null;
    }
  }

  /**
   * Send a long message, splitting at WhatsApp's limit.
   */
  private async sendLongMessage(to: string, text: string): Promise<void> {
    const accessToken = getCredential("whatsapp");
    const phoneNumberId = getCredential("whatsapp_phone_id");

    if (!accessToken || !phoneNumberId) return;

    const maxLen = MAX_MESSAGE_LENGTH - 100; // Buffer
    if (text.length <= maxLen) {
      await sendWhatsAppMessage(phoneNumberId, to, text, accessToken);
      return;
    }

    // Split into chunks at newline boundaries
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= maxLen) {
        await sendWhatsAppMessage(phoneNumberId, to, remaining, accessToken);
        break;
      }

      let splitAt = remaining.lastIndexOf("\n", maxLen);
      if (splitAt === -1 || splitAt < maxLen / 2) {
        splitAt = maxLen;
      }

      await sendWhatsAppMessage(phoneNumberId, to, remaining.slice(0, splitAt), accessToken);
      remaining = remaining.slice(splitAt).trimStart();
    }
  }
}

// ============================================================================
// SINGLETON + WEBHOOK ROUTE
// ============================================================================

export const whatsappAdapter = new WhatsAppAdapter();

/**
 * Express route handler for WhatsApp webhook verification (GET).
 */
export function whatsappWebhookVerify(req: any, res: any): void {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

  if (mode === "subscribe" && token === verifyToken) {
    logger.info("WhatsApp webhook verified");
    res.status(200).send(challenge);
  } else {
    logger.warn("WhatsApp webhook verification failed");
    res.sendStatus(403);
  }
}

/**
 * Express route handler for WhatsApp webhook events (POST).
 */
export async function whatsappWebhookHandler(req: any, res: any): Promise<void> {
  // WhatsApp requires a 200 response within 5 seconds
  res.sendStatus(200);

  // Process asynchronously
  whatsappAdapter.handleWebhook(req.body).catch((err: any) => {
    logger.error({ error: err.message }, "WhatsApp webhook processing failed");
  });
}
