/**
 * Telegram Channel Adapter
 *
 * Connects to Telegram Bot API using Telegraf, routes messages
 * to the agent system via the channel manager.
 *
 * Features:
 * - Access control via AUTHORIZED_TELEGRAM_CHAT_IDS
 * - Rate limiting per chat
 * - Text + photo message handling
 * - Agent routing via @mentions
 * - Proactive message sending (for scheduled briefings)
 * - Webhook support for production
 */

import { Telegraf } from "telegraf";
import { logger } from "../../logger";
import { processIncomingMessage } from "../channel-manager";
import { storage } from "../../storage";
import type {
  ChannelAdapter,
  ChannelStatus,
  IncomingMessage,
  OutgoingMessage,
} from "../types";
import { getUserDate } from "../../utils/dates";
import {
  applyNetworkTuning,
  runWithPollingResilience,
  monitorWebhookHealth,
  runServiceHealthMonitor,
  type ServiceCheck,
} from "../../infra/telegram-resilience";
import { safeSendChatAction, chatActionBreaker } from "../../infra/chat-action-circuit-breaker";

// ============================================================================
// CONFIG
// ============================================================================

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const AUTHORIZED_CHAT_IDS = (process.env.AUTHORIZED_TELEGRAM_CHAT_IDS || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

// Rate limiting
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60000;
const chatRateLimits = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(chatId: string): boolean {
  const now = Date.now();
  const limit = chatRateLimits.get(chatId);

  if (!limit || now > limit.resetAt) {
    chatRateLimits.set(chatId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
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
  chatRateLimits.forEach((limit, chatId) => {
    if (now > limit.resetAt) expired.push(chatId);
  });
  expired.forEach((chatId) => chatRateLimits.delete(chatId));
}, 5 * 60 * 1000);

// ============================================================================
// ADAPTER
// ============================================================================

class TelegramAdapter implements ChannelAdapter {
  platform = "telegram" as const;
  public bot: Telegraf | null = null;
  private connected = false;
  private startedAt: Date | null = null;
  private lastTasksList = new Map<string, (string | number)[]>();
  private abortController: AbortController | null = null;
  private stats = {
    messagesReceived: 0,
    messagesSent: 0,
    errors: 0,
    lastError: null as string | null,
    lastActivity: null as Date | null,
  };

  async start(): Promise<void> {
    if (!BOT_TOKEN) {
      logger.warn("TELEGRAM_BOT_TOKEN not set — Telegram adapter will not start");
      return;
    }

    this.bot = new Telegraf(BOT_TOKEN);

    // ---- Access Control Middleware ----
    this.bot.use((ctx, next) => {
      const chatId = ctx.chat?.id.toString();

      if (AUTHORIZED_CHAT_IDS.length === 0) {
        if (process.env.NODE_ENV === "production") {
          logger.error("AUTHORIZED_TELEGRAM_CHAT_IDS not set in production — blocking all");
          return ctx.reply("Bot is not configured for access. Contact administrator.");
        }
        return next();
      }

      if (!chatId || !AUTHORIZED_CHAT_IDS.includes(chatId)) {
        logger.warn({ chatId }, "Unauthorized Telegram access attempt");
        return ctx.reply("Unauthorized. This is a private assistant.");
      }

      return next();
    });

    // ---- Rate Limiting Middleware ----
    this.bot.use((ctx, next) => {
      const chatId = ctx.chat?.id.toString();
      if (!chatId) return ctx.reply("Error: Unable to identify chat.");

      if (!checkRateLimit(chatId)) {
        return ctx.reply("You're sending messages too quickly. Please wait a moment.");
      }

      return next();
    });

    // ---- /start Command ----
    this.bot.command("start", async (ctx) => {
      await ctx.reply(
        `SB-OS Agent System\n\n` +
        `Send me a message and I'll route it to the right agent.\n\n` +
        `Commands:\n` +
        `• Just type — routes to Chief of Staff\n` +
        `• @cmo <message> — talk to the CMO\n` +
        `• @cto <message> — talk to the CTO\n` +
        `• @<agent-slug> <message> — talk to any agent\n` +
        `• /agents — list available agents\n` +
        `• /briefing — get today's briefing\n` +
        `• /capture <text> — quick capture to inbox\n` +
        `• /today — today's summary\n` +
        `• /tasks — list active tasks\n` +
        `• /done <number> — mark task done\n` +
        `• /shop <item> [#category] — add to shopping list\n` +
        `• /clip <url> — clip article to Knowledge Hub\n\n` +
        `Tip: Send a bare URL to get a "Clip it?" prompt.`
      );
    });

    // ---- /agents Command ----
    this.bot.command("agents", async (ctx) => {
      try {
        const { loadAllAgents } = await import("../../agents/agent-registry");
        const allAgents = await loadAllAgents();
        const active = allAgents.filter((a) => a.isActive);

        const list = active
          .map((a) => `• @${a.slug} — ${a.name} (${a.role})`)
          .join("\n");

        await ctx.reply(`Available Agents:\n\n${list}\n\nUse @slug to route your message.`);
      } catch (error: any) {
        await ctx.reply("Failed to load agent list.");
        this.recordError(error.message);
      }
    });

    // ---- /briefing Command ----
    this.bot.command("briefing", async (ctx) => {
      try {
        await ctx.reply("Generating briefing...");
        const response = await this.routeToAgent(ctx, "chief-of-staff", "Generate my daily briefing for today.");
        await this.sendLongMessage(ctx.chat.id.toString(), response);
        this.saveMessageHistory(ctx.chat.id.toString(), "/briefing", response, "command").catch(() => {});
      } catch (error: any) {
        await ctx.reply("Failed to generate briefing.");
        this.recordError(error.message);
      }
    });

    // ---- /capture Command ----
    this.bot.command("capture", async (ctx) => {
      try {
        const text = ctx.message.text.replace(/^\/capture\s*/, "").trim();
        if (!text) {
          await ctx.reply("Usage: /capture <text>\nExample: /capture Research competitor pricing");
          return;
        }
        const capture = await storage.createCapture({
          title: text,
          type: "idea",
          source: "brain",
          domain: "work",
          notes: null,
          ventureId: null,
        } as any);
        const reply = `Captured: "${capture.title}"`;
        await ctx.reply(reply);
        this.saveMessageHistory(ctx.chat.id.toString(), `/capture ${text}`, reply, "command").catch(() => {});
      } catch (error: any) {
        await ctx.reply("Failed to capture.");
        this.recordError(error.message);
      }
    });

    // ---- /today Command ----
    this.bot.command("today", async (ctx) => {
      try {
        const today = getUserDate();
        const [day, todayTasks, urgentTasks, captures] = await Promise.all([
          storage.getDayOrCreate(today),
          storage.getTasksForToday(today),
          storage.getUrgentTasks(today, 5),
          storage.getCaptures({ clarified: false, limit: 100 }),
        ]);

        const lines: string[] = [];
        lines.push(`📅 ${today}`);

        if (day?.top3Outcomes) {
          lines.push("\n🎯 Top 3 Outcomes:");
          const outcomes = day.top3Outcomes as any[];
          if (Array.isArray(outcomes)) {
            outcomes.forEach((o: any, i: number) => {
              const check = o.completed ? "✅" : "⬜";
              lines.push(`${check} ${i + 1}. ${o.text || o}`);
            });
          }
        }

        if (urgentTasks.length > 0) {
          lines.push("\n🔥 Urgent:");
          urgentTasks.forEach((t) => lines.push(`- ${t.title} [${t.priority}]`));
        }

        const activeTasks = todayTasks.filter((t) => t.status !== "completed" && t.status !== "on_hold");
        if (activeTasks.length > 0) {
          lines.push(`\n📋 Tasks today: ${activeTasks.length}`);
          activeTasks.slice(0, 5).forEach((t) => lines.push(`- ${t.title} [${t.status}]`));
          if (activeTasks.length > 5) lines.push(`  ...and ${activeTasks.length - 5} more`);
        }

        lines.push(`\n📥 Inbox: ${captures.length} items`);

        const reply = lines.join("\n");
        await ctx.reply(reply);
        this.saveMessageHistory(ctx.chat.id.toString(), "/today", reply, "command").catch(() => {});
      } catch (error: any) {
        await ctx.reply("Failed to load today's summary.");
        this.recordError(error.message);
      }
    });

    // ---- /tasks Command ----
    this.bot.command("tasks", async (ctx) => {
      try {
        const tasks = await storage.getTasks({
          status: undefined,
          limit: 20,
        });
        const active = tasks.filter(
          (t) => t.status === "in_progress" || t.status === "todo"
        );
        const display = active.slice(0, 10);

        if (display.length === 0) {
          await ctx.reply("No active tasks (in_progress or todo).");
          return;
        }

        // Store task mapping for /done command
        const chatId = ctx.chat.id.toString();
        const taskMap = display.map((t) => t.id);
        this.lastTasksList.set(chatId, taskMap);

        const lines = ["📋 Active Tasks:\n"];
        display.forEach((t, i) => {
          const status = t.status === "in_progress" ? "🔵" : "⚪";
          lines.push(`${status} ${i + 1}. ${t.title} [${t.priority}]`);
        });
        lines.push("\nUse /done <number> to mark as done.");

        const reply = lines.join("\n");
        await ctx.reply(reply);
        this.saveMessageHistory(ctx.chat.id.toString(), "/tasks", reply, "command").catch(() => {});
      } catch (error: any) {
        await ctx.reply("Failed to load tasks.");
        this.recordError(error.message);
      }
    });

    // ---- /shop Command ----
    this.bot.command("shop", async (ctx) => {
      try {
        const text = ctx.message.text.replace(/^\/shop\s*/, "").trim();
        if (!text) {
          await ctx.reply("Usage: /shop <item> [#category]\nExample: /shop protein powder #groceries\nCategories: #groceries (default), #household, #personal, #business");
          return;
        }

        // Parse optional hashtag category
        const categoryMatch = text.match(/#(groceries|household|personal|business)\s*$/i);
        const category = categoryMatch ? categoryMatch[1].toLowerCase() : "groceries";
        const itemTitle = text.replace(/#(groceries|household|personal|business)\s*$/i, "").trim();

        if (!itemTitle) {
          await ctx.reply("Please provide an item name.");
          return;
        }

        const item = await storage.createShoppingItem({
          item: itemTitle,
          category: category as any,
          status: "to_buy",
          priority: "P2",
        } as any);

        await ctx.reply(`🛒 Added: "${item.item}" [${category}]`);

        // Log conversation (fire-and-forget)
        this.logCommandConversation(text, `Shopping item created: "${item.item}" [${category}]`).catch(() => {});
      } catch (error: any) {
        await ctx.reply("Failed to add shopping item.");
        this.recordError(error.message);
      }
    });

    // ---- /clip Command ----
    this.bot.command("clip", async (ctx) => {
      try {
        const url = ctx.message.text.replace(/^\/clip\s*/, "").trim();
        if (!url) {
          await ctx.reply("Usage: /clip <url>\nExample: /clip https://paulgraham.com/startupideas.html");
          return;
        }

        await ctx.reply("Clipping article...");
        const { clipUrl } = await import("../../web-clipper");
        const { processDocumentNow } = await import("../../embedding-jobs");
        const clipped = await clipUrl(url);

        const doc = await storage.createDoc({
          title: clipped.title,
          body: clipped.body,
          type: "reference",
          domain: "personal",
          status: "active",
          tags: ["telegram-clip"],
          metadata: clipped.metadata,
        });

        processDocumentNow(doc.id).catch(() => {});

        await ctx.reply(`📎 Clipped: "${clipped.title}"\nWords: ${clipped.metadata.wordCount}\nSaved to Knowledge Hub.`);

        this.logCommandConversation(`/clip ${url}`, `Clipped "${clipped.title}" (${clipped.metadata.wordCount} words)`).catch(() => {});
      } catch (error: any) {
        await ctx.reply(`Failed to clip: ${error.message}`);
        this.recordError(error.message);
      }
    });

    // ---- /done Command ----
    this.bot.command("done", async (ctx) => {
      try {
        const numStr = ctx.message.text.replace(/^\/done\s*/, "").trim();
        const num = parseInt(numStr, 10);
        if (isNaN(num) || num < 1) {
          await ctx.reply("Usage: /done <number>\nUse /tasks first to see numbered tasks.");
          return;
        }

        const chatId = ctx.chat.id.toString();
        const taskMap = this.lastTasksList.get(chatId);
        if (!taskMap || num > taskMap.length) {
          await ctx.reply("Run /tasks first to get a numbered list, then /done <number>.");
          return;
        }

        const taskId = taskMap[num - 1];
        const task = await storage.updateTask(String(taskId), { status: "completed", completedAt: new Date() } as any);
        if (!task) {
          await ctx.reply(`Task not found.`);
          return;
        }
        const reply = `✅ Done: "${task.title}"`;
        await ctx.reply(reply);
        this.saveMessageHistory(ctx.chat.id.toString(), `/done ${numStr}`, reply, "command").catch(() => {});
      } catch (error: any) {
        await ctx.reply("Failed to mark task as done.");
        this.recordError(error.message);
      }
    });

    // ---- Text Messages ----
    this.bot.on("text", async (ctx) => {
      try {
        this.stats.messagesReceived++;
        this.stats.lastActivity = new Date();

        // NLP intercept: handle natural language logging (rituals, workouts, nutrition)
        const { detectAndHandleLog } = await import("../telegram-nlp-handler.js");
        const nlpResult = await detectAndHandleLog(ctx.message.text);
        if (nlpResult.handled) {
          // Save raw NLP messages to telegram_messages table
          await this.saveMessageHistory(ctx.chat.id.toString(), ctx.message.text, nlpResult.response!, "nlp");
          await this.sendLongMessage(ctx.chat.id.toString(), nlpResult.response!);
          this.stats.messagesSent++;
          return;
        }

        // URL auto-detect: if message is a bare URL, offer to clip it
        const urlMatch = ctx.message.text.match(/^(https?:\/\/\S+)$/i);
        if (urlMatch) {
          await ctx.reply("Clip this to Knowledge Hub?", {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "📎 Yes, clip it", callback_data: `clip:${urlMatch[1]}` },
                  { text: "❌ No", callback_data: "clip:dismiss" },
                ],
              ],
            },
          });
          this.stats.messagesSent++;
          return;
        }

        const message = this.normalizeTextMessage(ctx);
        const response = await processIncomingMessage(message);

        // Save to message store for history
        await this.saveMessageHistory(ctx.chat.id.toString(), ctx.message.text, response, "agent_chat");

        // Send response (handle long messages)
        await this.sendLongMessage(ctx.chat.id.toString(), response);

        this.stats.messagesSent++;
      } catch (error: any) {
        logger.error({ error: error.message }, "Error processing Telegram text message");
        await ctx.reply("Sorry, I encountered an error. Please try again.");
        this.recordError(error.message);
      }
    });

    // ---- Voice Messages (Jarvis-style) ----
    this.bot.on("voice", async (ctx) => {
      try {
        this.stats.messagesReceived++;
        this.stats.lastActivity = new Date();

        const chatId = ctx.chat.id.toString();
        await ctx.reply("🎙️ Transcribing...");

        // Get voice file URL
        const voice = ctx.message.voice;
        const fileLink = await ctx.telegram.getFileLink(voice.file_id);
        const audioUrl = fileLink.href;

        // Transcribe with Whisper
        const { transcribeAudio } = await import("../../voice/voice-service");
        const transcription = await transcribeAudio(audioUrl);

        if (!transcription.text || transcription.text.trim().length === 0) {
          await ctx.reply("Couldn't understand the voice message. Please try again.");
          return;
        }

        const userText = transcription.text.trim();

        // Show what was heard
        await ctx.reply(`📝 "${userText}"`);

        // NLP intercept first (rituals, health, workouts)
        const { detectAndHandleLog } = await import("../telegram-nlp-handler.js");
        const nlpResult = await detectAndHandleLog(userText);

        let response: string;
        if (nlpResult.handled) {
          response = nlpResult.response!;
        } else {
          // Route to agent system
          const message: IncomingMessage = {
            channelMessageId: ctx.message.message_id.toString(),
            platform: "telegram",
            senderId: ctx.from.id.toString(),
            senderName: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" "),
            chatId,
            text: userText,
            messageType: "voice",
            timestamp: new Date(ctx.message.date * 1000),
            metadata: {
              voice: true,
              duration: voice.duration,
              transcription: userText,
            },
          };
          response = await processIncomingMessage(message);
        }

        // Try to send voice response back (TTS)
        try {
          const { textToSpeech, isVoiceAvailable } = await import("../../voice/voice-service");
          if (isVoiceAvailable() && response.length < 4000) {
            const tts = await textToSpeech(response);
            await ctx.replyWithVoice({
              source: tts.audioBuffer,
              filename: "response.opus",
            });
          }
        } catch (ttsError: any) {
          logger.debug({ error: ttsError.message }, "TTS failed, falling back to text");
        }

        // Always send text version too (for readability)
        await this.sendLongMessage(chatId, response);

        // Save history
        await this.saveMessageHistory(chatId, `[Voice] ${userText}`, response, "voice");

        // Broadcast to WebSocket for live dashboard
        import("../../ws/event-bus").then(({ broadcastTelegramMessage }) =>
          broadcastTelegramMessage(chatId, "voice")
        ).catch(() => {});

        this.stats.messagesSent++;
      } catch (error: any) {
        logger.error({ error: error.message }, "Error processing Telegram voice message");
        await ctx.reply("Sorry, I couldn't process your voice message. Please try again or type your message.");
        this.recordError(error.message);
      }
    });

    // ---- Photo Messages (Vision Processing) ----
    this.bot.on("photo", async (ctx) => {
      try {
        this.stats.messagesReceived++;
        this.stats.lastActivity = new Date();

        const chatId = ctx.chat.id.toString();
        const caption = ctx.message.caption || "";
        const photos = ctx.message.photo;
        const photo = photos[photos.length - 1]; // Highest resolution

        let mediaUrl: string | undefined;
        try {
          const fileLink = await ctx.telegram.getFileLink(photo.file_id);
          mediaUrl = fileLink.href;
        } catch {
          // File link may fail for large photos
        }

        if (!mediaUrl) {
          await ctx.reply("Couldn't download the photo. Please try again.");
          return;
        }

        await ctx.reply("👁️ Analyzing image...");

        // Use vision model to analyze the image
        const { analyzeImage } = await import("../../voice/image-service");
        const analysis = await analyzeImage(mediaUrl, caption);

        let response: string;

        // Check if this is a loggable intent (meal photo, receipt, etc.)
        if (analysis.intent === "meal" && analysis.structured) {
          // Try to log nutrition via NLP handler
          const mealText = `${analysis.structured.description}, ${analysis.structured.calories || ""} calories, ${analysis.structured.protein || ""}g protein`;
          const { detectAndHandleLog } = await import("../telegram-nlp-handler.js");
          const nlpResult = await detectAndHandleLog(mealText);
          if (nlpResult.handled) {
            response = `📸 ${analysis.description}\n\n${nlpResult.response}`;
          } else {
            response = `📸 ${analysis.description}`;
          }
        } else {
          // Route to agent with image context
          const imageContext = caption
            ? `[Photo: ${analysis.description}] ${caption}`
            : `[Photo: ${analysis.description}] What should I do with this?`;

          const message: IncomingMessage = {
            channelMessageId: ctx.message.message_id.toString(),
            platform: "telegram",
            senderId: ctx.from.id.toString(),
            senderName: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" "),
            chatId,
            text: imageContext,
            messageType: "photo",
            timestamp: new Date(ctx.message.date * 1000),
            mediaUrl,
            metadata: { imageAnalysis: analysis },
          };

          response = await processIncomingMessage(message);
        }

        await this.sendLongMessage(chatId, response);
        await this.saveMessageHistory(chatId, `[Photo] ${caption || analysis.description}`, response, "photo");

        this.stats.messagesSent++;
      } catch (error: any) {
        logger.error({ error: error.message }, "Error processing Telegram photo");
        await ctx.reply("Sorry, I couldn't process your photo.");
        this.recordError(error.message);
      }
    });

    // ---- Callback Queries (inline keyboard responses) ----
    this.bot.on("callback_query", async (ctx) => {
      try {
        const data = (ctx.callbackQuery as any).data as string;
        if (!data) return;

        if (data === "clip:dismiss") {
          await ctx.answerCbQuery("Dismissed");
          await ctx.editMessageReplyMarkup(undefined);
          return;
        }

        if (data.startsWith("clip:")) {
          const url = data.slice(5);
          await ctx.answerCbQuery("Clipping...");
          await ctx.editMessageReplyMarkup(undefined);

          try {
            const { clipUrl } = await import("../../web-clipper");
            const { processDocumentNow } = await import("../../embedding-jobs");
            const clipped = await clipUrl(url);

            const doc = await storage.createDoc({
              title: clipped.title,
              body: clipped.body,
              type: "reference",
              domain: "personal",
              status: "active",
              tags: ["telegram-clip"],
              metadata: clipped.metadata,
            });

            processDocumentNow(doc.id).catch(() => {});

            await this.sendLongMessage(
              ctx.chat!.id.toString(),
              `📎 Clipped: "${clipped.title}"\nWords: ${clipped.metadata.wordCount}\nSaved to Knowledge Hub.`
            );
          } catch (err: any) {
            await this.sendLongMessage(
              ctx.chat!.id.toString(),
              `Failed to clip: ${err.message}`
            );
          }
        }
      } catch (error: any) {
        logger.error({ error: error.message }, "Error handling callback query");
      }
    });

    // ---- Error Handler ----
    this.bot.catch((err: any) => {
      logger.error({ error: err.message || err }, "Telegraf error");
      this.recordError(err.message || "Unknown Telegraf error");
    });

    // ---- Network tuning ----
    applyNetworkTuning();

    // ---- Launch with resilience ----
    this.abortController = new AbortController();

    if (process.env.TELEGRAM_WEBHOOK_URL) {
      const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;
      const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
      await this.bot.telegram.setWebhook(webhookUrl, {
        secret_token: secret,
      });
      logger.info({ webhookUrl }, "Telegram bot started with webhook");

      // Start webhook health monitor in background
      if (BOT_TOKEN) {
        monitorWebhookHealth({
          botToken: BOT_TOKEN,
          expectedWebhookUrl: webhookUrl,
          webhookSecret: secret,
          checkIntervalMs: 5 * 60 * 1000,
          signal: this.abortController.signal,
        }).catch((err) => {
          logger.error({ error: (err as Error).message }, "Webhook health monitor stopped");
        });
      }
    } else {
      // Use polling with resilience loop (auto-restart on failure)
      const bot = this.bot;
      const adapter = this;
      runWithPollingResilience({
        startBot: async () => {
          await bot.launch();
        },
        stopBot: async () => {
          try { bot.stop("restart"); } catch {}
        },
        isConnected: () => adapter.connected,
        maxConsecutiveRestarts: 10,
        signal: this.abortController.signal,
      }).catch((err) => {
        logger.error({ error: (err as Error).message }, "Telegram polling resilience loop stopped");
        adapter.recordError((err as Error).message);
      });
      logger.info("Telegram bot started with resilient polling");
    }

    this.connected = true;
    this.startedAt = new Date();
  }

  async stop(): Promise<void> {
    // Signal all background monitors to stop
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    if (this.bot) {
      this.bot.stop("SIGTERM");
      this.connected = false;
      logger.info("Telegram bot stopped");
    }
  }

  async sendMessage(msg: OutgoingMessage): Promise<void> {
    if (!this.bot) {
      logger.warn("Cannot send message: Telegram bot not initialized");
      return;
    }

    try {
      await this.sendLongMessage(msg.chatId, msg.text, msg.parseMode);
      this.stats.messagesSent++;
      this.stats.lastActivity = new Date();
    } catch (error: any) {
      logger.error({ chatId: msg.chatId, error: error.message }, "Failed to send Telegram message");
      this.recordError(error.message);
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  getStatus(): ChannelStatus & { circuitBreaker?: ReturnType<typeof chatActionBreaker.getState> } {
    return {
      platform: "telegram",
      connected: this.connected,
      startedAt: this.startedAt?.toISOString() || null,
      messagesReceived: this.stats.messagesReceived,
      messagesSent: this.stats.messagesSent,
      errors: this.stats.errors,
      lastError: this.stats.lastError,
      lastActivity: this.stats.lastActivity?.toISOString() || null,
      circuitBreaker: chatActionBreaker.getState(),
    };
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  private normalizeTextMessage(ctx: any): IncomingMessage {
    return {
      channelMessageId: ctx.message.message_id.toString(),
      platform: "telegram",
      senderId: ctx.from.id.toString(),
      senderName: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" "),
      chatId: ctx.chat.id.toString(),
      text: ctx.message.text,
      messageType: "text",
      timestamp: new Date(ctx.message.date * 1000),
    };
  }

  private async routeToAgent(ctx: any, agentSlug: string, text: string): Promise<string> {
    const message: IncomingMessage = {
      channelMessageId: ctx.message?.message_id?.toString() || "0",
      platform: "telegram",
      senderId: ctx.from.id.toString(),
      senderName: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" "),
      chatId: ctx.chat.id.toString(),
      text: `@${agentSlug} ${text}`,
      messageType: "command",
      timestamp: new Date(),
    };

    return processIncomingMessage(message);
  }

  /**
   * Send a long message, splitting at 4096 char Telegram limit.
   */
  private async sendLongMessage(
    chatId: string,
    text: string,
    parseMode?: "html" | "markdown"
  ): Promise<void> {
    if (!this.bot) return;

    const maxLen = 4000; // Leave buffer below 4096 limit
    if (text.length <= maxLen) {
      await this.bot.telegram.sendMessage(chatId, text, {
        parse_mode: parseMode === "markdown" ? "MarkdownV2" : undefined,
      });
      return;
    }

    // Split into chunks at newline boundaries
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= maxLen) {
        chunks.push(remaining);
        break;
      }

      let splitAt = remaining.lastIndexOf("\n", maxLen);
      if (splitAt === -1 || splitAt < maxLen / 2) {
        splitAt = maxLen;
      }

      chunks.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt).trimStart();
    }

    for (const chunk of chunks) {
      await this.bot.telegram.sendMessage(chatId, chunk);
    }
  }

  private async saveMessageHistory(
    chatId: string,
    userText: string,
    aiResponse: string,
    messageType: "text" | "nlp" | "command" | "agent_chat" | "voice" | "photo" = "text"
  ): Promise<void> {
    try {
      await storage.createTelegramMessage({
        chatId,
        direction: "incoming",
        content: userText,
        sender: "user",
        messageType,
      });

      await storage.createTelegramMessage({
        chatId,
        direction: "outgoing",
        content: aiResponse,
        sender: "bot",
        messageType,
      });
    } catch (error: any) {
      // Non-critical — don't fail the response
      logger.warn({ error: error.message }, "Failed to save Telegram message history");
    }
  }

  /**
   * Log a command interaction as an agent conversation for memory/learning.
   */
  private async logCommandConversation(userMessage: string, assistantResponse: string): Promise<void> {
    try {
      const { loadAgent } = await import("../../agents/agent-registry");
      const agent = await loadAgent("chief-of-staff");
      if (!agent) return;

      const { storage: st } = await import("../../storage");
      const db = (st as any).db;
      const { agentConversations } = await import("@shared/schema");

      await db.insert(agentConversations).values({
        agentId: agent.id,
        role: "user" as const,
        content: userMessage,
        metadata: { source: "telegram-command", channel: "telegram" },
      });
      await db.insert(agentConversations).values({
        agentId: agent.id,
        role: "assistant" as const,
        content: assistantResponse,
        metadata: { source: "telegram-command", channel: "telegram" },
      });
    } catch {
      // Non-critical
    }
  }

  private recordError(message: string): void {
    this.stats.errors++;
    this.stats.lastError = message;
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const telegramAdapter = new TelegramAdapter();

/**
 * Get the authorized chat IDs for sending proactive messages.
 */
export function getAuthorizedChatIds(): string[] {
  return [...AUTHORIZED_CHAT_IDS];
}
