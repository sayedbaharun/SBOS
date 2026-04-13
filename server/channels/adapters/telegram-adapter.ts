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

// Deliverable notification batching — 5-second window per agent
const DELIVERABLE_BATCH_WINDOW_MS = 5000;
interface PendingDeliverable {
  taskId: string;
  title: string;
  type: string;
  driveUrl?: string;
  vercelUrl?: string;
}
const deliverableBatchBuffer = new Map<string, { items: PendingDeliverable[]; timer: ReturnType<typeof setTimeout> }>();

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

// ============================================================================
// CONVERSATION CONTEXT WINDOW (multi-turn memory)
// ============================================================================

const conversationContext = new Map<string, Array<{ role: "user" | "assistant"; text: string; timestamp: number }>>();
const MAX_CONTEXT_MESSAGES = 10; // last 5 exchanges (5 user + 5 assistant)
const CONTEXT_TTL_MS = 30 * 60 * 1000; // 30 minutes

function addToContext(chatId: string, role: "user" | "assistant", text: string): void {
  if (!conversationContext.has(chatId)) conversationContext.set(chatId, []);
  const ctx = conversationContext.get(chatId)!;
  ctx.push({ role, text: text.slice(0, 500), timestamp: Date.now() });
  // Keep only recent messages
  while (ctx.length > MAX_CONTEXT_MESSAGES) ctx.shift();
}

function getContextPrefix(chatId: string): string {
  const ctx = conversationContext.get(chatId);
  if (!ctx || ctx.length === 0) return "";

  // Filter out stale messages
  const now = Date.now();
  const recent = ctx.filter(m => now - m.timestamp < CONTEXT_TTL_MS);
  if (recent.length === 0) return "";

  const lines = recent.map(m => `${m.role === "user" ? "User" : "Bot"}: ${m.text}`);
  return `[Recent conversation context]\n${lines.join("\n")}\n[End context]\n\n`;
}

// Pending amend feedback: maps chatId → taskId awaiting feedback text
const pendingAmendFeedback = new Map<string, string>();

// Pending debrief confirmations: maps key → parsed debrief awaiting confirm/cancel
const pendingDebriefs = new Map<string, import("../debrief-handler").ParsedDebrief>();

class TelegramAdapter implements ChannelAdapter {
  platform = "telegram" as const;
  capabilities = {
    supportsEditing: true,
    supportsInlineKeyboards: true,
    supportsStreaming: false, // Telegram doesn't support true streaming, but we can edit messages
    maxMessageLength: 4096,
  };
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

    this.bot = new Telegraf(BOT_TOKEN, { handlerTimeout: 300_000 }); // 5 min — agent tool loops can be slow via Kilo fallback

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
        `• /morning — mark all morning habits done\n` +
        `• /shop <item> [#category] — add to shopping list\n` +
        `• /clip <url> — clip article to Knowledge Hub\n` +
        `• /btw <question> — side question (no history)\n` +
        `• /idea <description> — validate a business idea\n` +
        `• /contact Name, email, phone — quick contact capture\n` +
        `• /debrief <what you did today> — log end-of-day work as completed tasks\n` +
        `• /ventures — weekly digest of all active ventures\n` +
        `• /review — review pending deliverables\n` +
        `• /delegate @<slug> <task> — delegate to agent\n\n` +
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

        const { doc, created } = await storage.createDocIfNotExists({
          title: clipped.title,
          body: clipped.body,
          type: "reference",
          domain: "personal",
          status: "active",
          tags: ["telegram-clip"],
          metadata: clipped.metadata,
        });

        if (created) {
          processDocumentNow(doc.id).catch(() => {});
        }

        await ctx.reply(created
          ? `📎 Clipped: "${clipped.title}"\nWords: ${clipped.metadata.wordCount}\nSaved to Knowledge Hub.`
          : `📎 Already exists: "${clipped.title}" — skipped duplicate.`);

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

    // ---- /morning Command (One-Tap Done) ----
    this.bot.command("morning", async (ctx) => {
      try {
        const today = getUserDate();
        const day = await storage.getDayOrCreate(today);

        // Fetch habit config
        const prefs = await storage.getUserPreferences("00000000-0000-0000-0000-000000000001");
        const habitConfig = (prefs as any)?.morningRitualConfig?.habits || [];
        const enabledHabits = habitConfig.filter((h: any) => h.enabled);

        // Build morningRituals with all enabled habits set to done
        const morningRituals: Record<string, any> = {};
        for (const habit of enabledHabits) {
          morningRituals[habit.key] = { done: true };
        }
        morningRituals.completedAt = new Date().toISOString();

        await storage.updateDay(today, { morningRituals } as any);

        const reply = `Morning routine complete. ${enabledHabits.length} habits marked done.`;
        await ctx.reply(reply);
        this.saveMessageHistory(ctx.chat.id.toString(), "/morning", reply, "command").catch(() => {});
      } catch (error: any) {
        await ctx.reply("Failed to complete morning routine.");
        this.recordError(error.message);
      }
    });

    // ---- /emails Command ----
    this.bot.command("emails", async (ctx) => {
      try {
        const { getTodayTriageSummary } = await import("../../agents/email-triage");
        const summary = await getTodayTriageSummary();
        await this.sendLongMessage(ctx.chat.id.toString(), summary);
        this.saveMessageHistory(ctx.chat.id.toString(), "/emails", summary, "command").catch(() => {});
      } catch (error: any) {
        await ctx.reply("Email triage not available. Check Gmail configuration.");
        this.recordError(error.message);
      }
    });

    // ---- /email <id> Command ----
    this.bot.command("email", async (ctx) => {
      try {
        const emailId = ctx.message.text.replace(/^\/email\s*/, "").trim();
        if (!emailId) {
          await ctx.reply("Usage: /email <email_id>\nUse /emails to see triaged emails.");
          return;
        }

        const triage = await storage.getEmailTriageById(emailId);
        if (!triage) {
          // Try by email ID
          const byEmailId = await storage.getEmailTriageByEmailId(emailId);
          if (!byEmailId) {
            await ctx.reply("Email not found in triage. Use /emails to see available.");
            return;
          }
          const reply = `📧 ${byEmailId.subject}\nFrom: ${byEmailId.fromAddress}\nClassification: ${byEmailId.classification}\n\n${byEmailId.summary || byEmailId.snippet}\n\nSuggested: ${byEmailId.suggestedAction || "N/A"}`;
          await ctx.reply(reply);
          this.saveMessageHistory(ctx.chat.id.toString(), `/email ${emailId}`, reply, "command").catch(() => {});
          return;
        }

        const reply = `📧 ${triage.subject}\nFrom: ${triage.fromAddress}\nClassification: ${triage.classification}\n\n${triage.summary || triage.snippet}\n\nSuggested: ${triage.suggestedAction || "N/A"}`;
        await ctx.reply(reply);
        this.saveMessageHistory(ctx.chat.id.toString(), `/email ${emailId}`, reply, "command").catch(() => {});
      } catch (error: any) {
        await ctx.reply("Failed to fetch email details.");
        this.recordError(error.message);
      }
    });

    // ---- /reply <emailId> <message> Command ----
    this.bot.command("reply", async (ctx) => {
      try {
        const args = ctx.message.text.replace(/^\/reply\s*/, "").trim();
        const spaceIndex = args.indexOf(" ");
        if (spaceIndex === -1) {
          await ctx.reply("Usage: /reply <email_id> <your message>");
          return;
        }

        const emailId = args.slice(0, spaceIndex).trim();
        const replyText = args.slice(spaceIndex + 1).trim();

        // Find the triage entry to get thread context
        const triage = await storage.getEmailTriageByEmailId(emailId);
        if (!triage) {
          await ctx.reply("Email not found. Use /emails to see available.");
          return;
        }

        const { sendEmail } = await import("../../gmail");
        const result = await sendEmail({
          to: triage.fromAddress,
          subject: `Re: ${triage.subject}`,
          body: replyText,
          threadId: triage.threadId || undefined,
        });

        if (result.success) {
          const reply = `✅ Reply sent to ${triage.fromAddress}`;
          await ctx.reply(reply);
          this.saveMessageHistory(ctx.chat.id.toString(), `/reply ${emailId}`, reply, "command").catch(() => {});
        } else {
          await ctx.reply(`Failed to send reply: ${result.error}`);
        }
      } catch (error: any) {
        await ctx.reply("Failed to send reply. Check Gmail configuration.");
        this.recordError(error.message);
      }
    });

    // ---- Sub-Agent Commands (Project Ironclad Phase 4) ----
    this.bot.command("spawn", async (ctx) => {
      try {
        const args = ctx.message.text.replace(/^\/spawn\s*/, "").trim();
        // Parse: /spawn <name> "<task>" or /spawn <name> <task>
        const quoteMatch = args.match(/^(\S+)\s+"([^"]+)"$/);
        const simpleMatch = args.match(/^(\S+)\s+(.+)$/);
        const match = quoteMatch || simpleMatch;

        if (!match) {
          await ctx.reply('Usage: /spawn <name> "<task>"\nExample: /spawn researcher "What is UAE AI agency market size?"');
          return;
        }

        const name = match[1];
        const task = match[2];

        const { spawnSubAgent } = await import("../../agents/sub-agent");
        const runId = await spawnSubAgent({
          name,
          task,
          chatId: ctx.chat.id.toString(),
        });

        await ctx.reply(`🚀 Spawning sub-agent <b>${name}</b>\n\n<b>Task:</b> ${task}\n<b>Run ID:</b> <code>${runId.slice(0, 8)}</code>\n\nI'll send the result when it's done (5min timeout).`, { parse_mode: "HTML" });
      } catch (error: any) {
        await ctx.reply("Failed to spawn sub-agent: " + error.message);
        this.recordError(error.message);
      }
    });

    this.bot.command("subagents", async (ctx) => {
      try {
        const runs = await storage.getSubAgentRuns({ chatId: ctx.chat.id.toString(), limit: 10 });
        if (runs.length === 0) {
          await ctx.reply("No sub-agent runs found. Use /spawn to create one.");
          return;
        }

        const statusIcon: Record<string, string> = { running: "⏳", completed: "✅", failed: "❌", timeout: "⏰" };
        const lines = runs.map((r, i) =>
          `${i + 1}. ${statusIcon[r.status] || "❓"} <b>${r.name}</b> — ${r.task.slice(0, 60)}${r.task.length > 60 ? "..." : ""}\n   <code>${r.id.slice(0, 8)}</code> • ${r.status}`
        );

        await ctx.reply(`📋 <b>Recent Sub-Agents</b>\n\n${lines.join("\n\n")}`, { parse_mode: "HTML" });
      } catch (error: any) {
        await ctx.reply("Failed to list sub-agents: " + error.message);
        this.recordError(error.message);
      }
    });

    this.bot.command("subagent", async (ctx) => {
      try {
        const idPrefix = ctx.message.text.replace(/^\/subagent\s*/, "").trim();
        if (!idPrefix) {
          await ctx.reply("Usage: /subagent <id>");
          return;
        }

        // Find by prefix match
        const runs = await storage.getSubAgentRuns({ chatId: ctx.chat.id.toString(), limit: 50 });
        const run = runs.find(r => r.id.startsWith(idPrefix));

        if (!run) {
          await ctx.reply("Sub-agent run not found. Use /subagents to list.");
          return;
        }

        const statusIcon: Record<string, string> = { running: "⏳", completed: "✅", failed: "❌", timeout: "⏰" };
        let text = `${statusIcon[run.status] || "❓"} <b>${run.name}</b>\n\n<b>Task:</b> ${run.task}\n<b>Status:</b> ${run.status}\n<b>Started:</b> ${run.startedAt.toISOString()}`;

        if (run.result) {
          text += `\n\n<b>Result:</b>\n${run.result.slice(0, 3000)}`;
        }
        if (run.error) {
          text += `\n\n<b>Error:</b> ${run.error}`;
        }

        await this.sendLongMessage(ctx.chat.id.toString(), text, "html");
      } catch (error: any) {
        await ctx.reply("Failed to get sub-agent: " + error.message);
        this.recordError(error.message);
      }
    });

    // ---- Syntheliq Bridge ----
    this.bot.command("syntheliq", async (ctx) => {
      try {
        const subcommand = ctx.message.text.replace(/^\/syntheliq\s*/, "").trim().toLowerCase();
        const timeAgo = (d: Date) => {
          const mins = Math.floor((Date.now() - d.getTime()) / 60000);
          if (mins < 60) return `${mins}m ago`;
          const hrs = Math.floor(mins / 60);
          if (hrs < 24) return `${hrs}h ago`;
          return `${Math.floor(hrs / 24)}d ago`;
        };
        const {
          getSyntheliqDashboard,
          getSyntheliqRuns,
          getSyntheliqLeads,
          getSyntheliqPipeline,
          getSyntheliqProposals,
          getSyntheliqEscalations,
        } = await import("../../integrations/syntheliq-client.js");

        if (subcommand === "leads") {
          const pipeline = await getSyntheliqPipeline().catch(() => null);
          const leads = await getSyntheliqLeads().catch(() => []);
          let text = "<b>SYNTHELIQ LEADS</b>\n\n";
          if (pipeline && typeof pipeline === "object") {
            const stages = Object.entries(pipeline as Record<string, number>);
            if (stages.length > 0) {
              text += "<b>Pipeline:</b> " + stages.map(([k, v]) => `${v} ${k}`).join(" → ") + "\n\n";
            }
          }
          if (Array.isArray(leads) && leads.length > 0) {
            text += "<b>Recent:</b>\n";
            leads.slice(0, 10).forEach((l: any) => {
              text += `• ${l.company || l.company_name || l.name || "Unknown"} — ${l.status || "new"}${(l.score ?? l.match_score) ? ` (${l.score ?? l.match_score})` : ""}\n`;
            });
          } else {
            text += "No leads found.";
          }
          await this.sendLongMessage(ctx.chat.id.toString(), text, "html");
        } else if (subcommand === "runs") {
          const runs = await getSyntheliqRuns(24).catch(() => []);
          let text = "<b>SYNTHELIQ RUNS</b> (24h)\n\n";
          if (Array.isArray(runs) && runs.length > 0) {
            runs.slice(0, 10).forEach((r: any) => {
              const icon = r.status === "completed" ? "✓" : r.status === "failed" ? "✗" : "⏳";
              const ago = (r.startedAt || r.started_at) ? timeAgo(new Date(r.startedAt || r.started_at)) : "";
              text += `• ${r.agentName || r.agent_name || r.agent || "Agent"} (${ago}) ${icon} ${r.summary || r.output_data?.summary || r.result?.slice(0, 60) || ""}\n`;
            });
          } else {
            text += "No runs in the last 24h.";
          }
          await this.sendLongMessage(ctx.chat.id.toString(), text, "html");
        } else if (subcommand === "proposals") {
          const proposals = await getSyntheliqProposals().catch(() => []);
          let text = "<b>SYNTHELIQ PROPOSALS</b>\n\n";
          if (Array.isArray(proposals) && proposals.length > 0) {
            proposals.slice(0, 10).forEach((p: any) => {
              text += `• ${p.company || p.company_name || p.contact_name || p.leadName || "Unknown"} — ${p.status || "draft"}${(p.value ?? p.monthly_rate) ? ` ($${p.value ?? p.monthly_rate})` : ""}\n`;
            });
          } else {
            text += "No active proposals.";
          }
          await this.sendLongMessage(ctx.chat.id.toString(), text, "html");
        } else if (subcommand === "escalations") {
          const escalations = await getSyntheliqEscalations().catch(() => []);
          let text = "<b>SYNTHELIQ ESCALATIONS</b>\n\n";
          if (Array.isArray(escalations) && escalations.length > 0) {
            escalations.forEach((e: any) => {
              text += `• ${e.type || "Issue"}: ${e.message || e.description || "No details"}\n`;
            });
          } else {
            text += "No open escalations.";
          }
          await this.sendLongMessage(ctx.chat.id.toString(), text, "html");
        } else {
          // Default: overview
          const [dashboard, runs, escalations] = await Promise.all([
            getSyntheliqDashboard().catch(() => null),
            getSyntheliqRuns(24).catch(() => []),
            getSyntheliqEscalations().catch(() => []),
          ]);

          let text = "<b>SYNTHELIQ STATUS</b>";

          if (dashboard) {
            text += " ✓\n\n";
            if (dashboard.pipeline && typeof dashboard.pipeline === "object") {
              const stages = Object.entries(dashboard.pipeline as Record<string, number>);
              if (stages.length > 0) {
                text += "<b>Pipeline:</b> " + stages.map(([k, v]) => `${v} ${k}`).join(" → ") + "\n\n";
              }
            }
          } else {
            text += " (unreachable)\n\n";
          }

          text += "<b>Recent Runs:</b>\n";
          if (Array.isArray(runs) && runs.length > 0) {
            runs.slice(0, 3).forEach((r: any) => {
              const icon = r.status === "completed" ? "✓" : r.status === "failed" ? "✗" : "⏳";
              const ago = (r.startedAt || r.started_at) ? timeAgo(new Date(r.startedAt || r.started_at)) : "";
              text += `• ${r.agentName || r.agent_name || r.agent || "Agent"} (${ago}) ${icon} ${r.summary || r.output_data?.summary || r.result?.slice(0, 50) || ""}\n`;
            });
          } else {
            text += "None in 24h\n";
          }

          text += "\n<b>Escalations:</b> ";
          if (Array.isArray(escalations) && escalations.length > 0) {
            text += `${escalations.length} open\n`;
            escalations.slice(0, 3).forEach((e: any) => {
              text += `• ${e.type || "Issue"}: ${e.message || e.description || "No details"}\n`;
            });
          } else {
            text += "None";
          }

          await this.sendLongMessage(ctx.chat.id.toString(), text, "html");
        }
      } catch (error: any) {
        const msg = error.message?.includes("not configured")
          ? "Syntheliq bridge not configured. Set SYNTHELIQ_URL env var."
          : `Syntheliq error: ${error.message}`;
        await ctx.reply(msg);
        this.recordError(error.message);
      }
    });

    // ---- /review Command ----
    this.bot.command("review", async (ctx) => {
      try {
        const { escapeHtml } = await import("../../infra/telegram-format.js");
        const database = (storage as any).db;
        const { agentTasks, agents: agentsTable } = await import("@shared/schema");
        const { eq, and, desc, sql } = await import("drizzle-orm");

        const rows = await database
          .select({
            task: agentTasks,
            agentName: agentsTable.name,
          })
          .from(agentTasks)
          .leftJoin(agentsTable, eq(agentTasks.assignedTo, agentsTable.id))
          .where(
            and(
              sql`${agentTasks.deliverableType} IS NOT NULL`,
              eq(agentTasks.status, "needs_review")
            )
          )
          .orderBy(desc(agentTasks.createdAt))
          .limit(5);

        if (rows.length === 0) {
          await ctx.reply("No pending deliverables. All clear!");
          return;
        }

        const typeIcons: Record<string, string> = {
          document: "\u{1F4C4}",
          recommendation: "\u{1F4A1}",
          action_items: "\u{1F4CB}",
          code: "\u{1F4BB}",
        };

        for (const row of rows) {
          const t = row.task;
          const agent = row.agentName || "Unknown";
          const icon = typeIcons[t.deliverableType] || "\u{1F4CB}";
          const mins = Math.floor((Date.now() - new Date(t.createdAt).getTime()) / 60000);
          const ago = mins < 60 ? `${mins}m` : mins < 1440 ? `${Math.floor(mins / 60)}h` : `${Math.floor(mins / 1440)}d`;

          await this.bot!.telegram.sendMessage(ctx.chat.id.toString(),
            `${icon} <b>${escapeHtml(t.deliverableType)}</b> from ${escapeHtml(agent)}\n` +
            `"${escapeHtml((t.title || "").slice(0, 200))}" — ${ago} ago`,
            {
              parse_mode: "HTML",
              reply_markup: {
                inline_keyboard: [[
                  { text: "\u2705 Approve", callback_data: `review:approve:${t.id}` },
                  { text: "\u270F\uFE0F Amend", callback_data: `review:amend:${t.id}` },
                  { text: "\u274C Reject", callback_data: `review:reject:${t.id}` },
                ]],
              },
            }
          );
        }
      } catch (error: any) {
        await ctx.reply("Error fetching review queue: " + error.message);
        this.recordError(error.message);
      }
    });

    // ---- /delegate Command ----
    this.bot.command("delegate", async (ctx) => {
      try {
        const args = ctx.message.text.replace(/^\/delegate\s*/, "").trim();

        if (!args) {
          const { loadAllAgents } = await import("../../agents/agent-registry");
          const allAgents = await loadAllAgents();
          const active = allAgents
            .filter((a: any) => a.status === "active" && !a.slug.startsWith("_"))
            .map((a: any) => `  @${a.slug}`)
            .join("\n");
          await ctx.reply(
            `Usage: /delegate @<agent-slug> <task description>\n\nAvailable agents:\n${active}`
          );
          return;
        }

        const match = args.match(/^@?([\w-]+)\s+([\s\S]+)$/);
        if (!match) {
          await ctx.reply("Usage: /delegate @<agent-slug> <task description>");
          return;
        }

        const [, slug, taskText] = match;
        const { delegateFromUser } = await import("../../agents/delegation-engine");
        const result = await delegateFromUser(slug, taskText, taskText);

        if (result.error) {
          await ctx.reply(`Failed: ${result.error}`);
          return;
        }

        await ctx.reply(`Task delegated to @${slug}\nID: ${result.taskId}`);
      } catch (error: any) {
        await ctx.reply("Error delegating: " + error.message);
        this.recordError(error.message);
      }
    });

    // ---- /btw Command (Side Question — no history) ----
    this.bot.command("btw", async (ctx) => {
      try {
        const question = ctx.message.text.replace(/^\/btw\s*/, "").trim();
        if (!question) {
          await ctx.reply("Usage: /btw <question>\nAsk a one-off question that won't enter conversation history.");
          return;
        }

        const chatId = ctx.chat.id.toString();

        // Route to Chief of Staff but DON'T save to conversation context or history.
        // This prevents context pollution from tangential questions.
        const { executeAgentChat } = await import("../../agents/agent-chat");
        const result = await executeAgentChat(
          "chief-of-staff",
          `[Side question — do not reference this in future conversation]\n${question}`,
          ctx.from.id.toString()
        );

        // Send response but do NOT add to conversation context or save to history
        await this.sendLongMessage(chatId, `(btw) ${result.response}`);
        this.stats.messagesSent++;
      } catch (error: any) {
        await ctx.reply("Failed to process side question.");
        this.recordError(error.message);
      }
    });

    // ---- /idea Command (Autonomous Venture Pipeline) ----
    this.bot.command("idea", async (ctx) => {
      try {
        const rawInput = ctx.message.text.replace(/^\/idea\s*/, "").trim();
        const isDeep = rawInput.startsWith("-deep ");
        const description = isDeep ? rawInput.replace(/^-deep\s+/, "").trim() : rawInput;
        if (!description) {
          await ctx.reply("Usage: /idea <description>\n  /idea -deep <description> (thorough research)\nExample: /idea AI-powered invoice parser for SMBs in UAE");
          return;
        }

        const chatId = ctx.chat.id.toString();

        // Create venture idea in DB
        const idea = await storage.createVentureIdea({
          name: description.slice(0, 100),
          description,
          status: "idea",
        });

        await ctx.reply(
          `Idea captured. Running ${isDeep ? "deep" : "standard"} research + validation.\n` +
          "I'll notify you only if both AI reviewers agree it's viable."
        );

        // Fire-and-forget: start the autonomous pipeline
        const { startVenturePipeline } = await import("../../agents/venture-pipeline");
        startVenturePipeline(idea.id, chatId, { deep: isDeep }).catch((err: any) => {
          logger.error({ err: err.message, ideaId: idea.id }, "Venture pipeline failed (unhandled)");
        });

        this.saveMessageHistory(chatId, `/idea ${description}`, "Pipeline started", "command").catch(() => {});
      } catch (error: any) {
        await ctx.reply("Error processing idea: " + error.message);
        this.recordError(error.message);
      }
    });

    // ---- /contact Command ----
    this.bot.command("contact", async (ctx) => {
      try {
        const text = ctx.message.text.replace(/^\/contact\s*/, "").trim();
        if (!text) {
          await ctx.reply(
            "Usage: /contact Full Name, email@example.com, +971XXXXXXXXX\n" +
            "Name is required. Email and phone are optional."
          );
          return;
        }

        const parts = text.split(",").map((p: string) => p.trim());
        const name = parts[0];
        if (!name) {
          await ctx.reply("Please provide at least a name.");
          return;
        }

        let email: string | undefined;
        let phone: string | undefined;
        for (const part of parts.slice(1)) {
          if (part.includes("@")) {
            email = part;
          } else if (/^\+?\d[\d\s\-]{6,}/.test(part)) {
            phone = part;
          }
        }

        const person = await storage.createPerson({
          name,
          email: email || null,
          phone: phone || null,
          needsEnrichment: true,
        } as any);

        const baseUrl = process.env.APP_URL || "https://sbaura.up.railway.app";
        const summary = [name, email, phone].filter(Boolean).join(" | ");
        await ctx.reply(`Contact saved: ${summary}\n\nEnrich: ${baseUrl}/people`);

        this.saveMessageHistory(
          ctx.chat.id.toString(),
          `/contact ${text}`,
          `Contact created: "${person.name}" (id: ${person.id})`,
          "command"
        ).catch(() => {});
      } catch (error: any) {
        await ctx.reply("Failed to save contact.");
        this.recordError(error.message);
      }
    });

    // ---- /debrief Command ----
    this.bot.command("debrief", async (ctx) => {
      try {
        const text = ctx.message.text.replace(/^\/debrief\s*/, "").trim();
        if (!text) {
          await ctx.reply(
            "Usage: /debrief <what you did today>\n\n" +
            "Example: /debrief shipped MyDub landing page, 3 Aivant sales calls, reviewed trading journal, gym 1hr"
          );
          return;
        }

        const chatId = ctx.chat.id.toString();
        await ctx.reply("Parsing your day...");

        const { parseDebrief } = await import("../debrief-handler");
        const parsed = await parseDebrief(text);

        if (!parsed.items.length) {
          await ctx.reply("Couldn't extract any tasks from that. Try being a bit more specific.");
          return;
        }

        // Build preview message
        const lines = parsed.items.map((item, i) =>
          `${i + 1}. <b>${item.title}</b>\n   ${item.ventureName} · ${item.type} · ${item.priority}`
        );
        const preview =
          `<b>End-of-Day Debrief</b>\n\n` +
          lines.join("\n\n") +
          `\n\n<i>${parsed.sessionSummary}</i>\n\n` +
          `Create ${parsed.items.length} completed task${parsed.items.length !== 1 ? "s" : ""}?`;

        // Store under a key: chatId + timestamp
        const key = `${chatId}_${Date.now()}`;
        pendingDebriefs.set(key, parsed);
        // Auto-expire after 10 minutes
        setTimeout(() => pendingDebriefs.delete(key), 10 * 60 * 1000);

        await ctx.reply(preview, {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [[
              { text: "Confirm", callback_data: `debrief:confirm:${key}` },
              { text: "Cancel", callback_data: `debrief:cancel:${key}` },
            ]],
          },
        } as any);

        this.saveMessageHistory(
          chatId,
          `/debrief ${text}`,
          `Debrief parsed: ${parsed.items.length} items across ${new Set(parsed.items.map(i => i.ventureName)).size} ventures`,
          "command"
        ).catch(() => {});
      } catch (error: any) {
        if (error.message?.includes("JSON")) {
          await ctx.reply("Couldn't parse that debrief. Try rewording — e.g. 'worked on X for Aivant, gym session, 2 calls'");
        } else {
          await ctx.reply("Failed to parse debrief.");
        }
        this.recordError(error.message);
      }
    });

    // ---- /ventures Command ----
    this.bot.command("ventures", async (ctx) => {
      try {
        await ctx.reply("Building venture digest...");
        const { buildAndSendVentureDigest } = await import("../../agents/scheduled-jobs");
        const digest = await buildAndSendVentureDigest();
        await this.sendLongMessage(ctx.chat.id.toString(), `<b>📊 Venture Digest</b>\n\n${digest}`, "html");
      } catch (error: any) {
        await ctx.reply("Failed to build venture digest.");
        this.recordError(error.message);
      }
    });

    // ---- Text Messages ----
    this.bot.on("text", async (ctx) => {
      try {
        this.stats.messagesReceived++;
        this.stats.lastActivity = new Date();

        // Pending amend feedback: if user is replying with amendment text
        const chatId = ctx.chat.id.toString();
        const pendingTaskId = pendingAmendFeedback.get(chatId);
        if (pendingTaskId) {
          pendingAmendFeedback.delete(chatId);
          try {
            const { requestChanges } = await import("../../routes/review-actions");
            const result = await requestChanges(pendingTaskId, ctx.message.text);
            if (result.success) {
              await ctx.reply("Amendments sent. The agent will revise and resubmit.");
            } else {
              await ctx.reply(`Failed: ${result.error}`);
            }
          } catch (err: any) {
            await ctx.reply("Error sending amendments: " + err.message);
          }
          this.stats.messagesSent++;
          return;
        }

        // NLP intercept: handle natural language logging (rituals, workouts, nutrition)
        const { detectAndHandleLog } = await import("../telegram-nlp-handler.js");
        const nlpResult = await detectAndHandleLog(ctx.message.text);
        if (nlpResult.handled) {
          // Save raw NLP messages to telegram_messages table
          await this.saveMessageHistory(chatId, ctx.message.text, nlpResult.response!, "nlp");
          await this.sendLongMessage(chatId, nlpResult.response!);
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

        // Add user message to conversation context
        addToContext(chatId, "user", ctx.message.text);

        // Inject conversation context for multi-turn awareness
        const message = this.normalizeTextMessage(ctx);
        const contextPrefix = getContextPrefix(chatId);
        if (contextPrefix) {
          message.text = contextPrefix + message.text;
        }

        // Partial streaming: send "thinking" placeholder, then edit with real response
        const thinkingMsg = await ctx.reply("💭 Thinking...");
        const startTime = Date.now();

        const response = await processIncomingMessage(message);
        const elapsed = Date.now() - startTime;

        // Track assistant response in context
        addToContext(chatId, "assistant", response);

        // Save to message store for history
        await this.saveMessageHistory(chatId, ctx.message.text, response, "agent_chat");

        // If response is short enough and came within 5s, just edit the thinking message
        if (response.length <= 4000 && elapsed < 30_000) {
          try {
            await this.bot!.telegram.editMessageText(
              chatId,
              thinkingMsg.message_id,
              undefined,
              response
            );
          } catch {
            // Fallback if edit fails
            await this.sendLongMessage(chatId, response);
          }
        } else {
          // Delete thinking message and send full response
          try { await this.bot!.telegram.deleteMessage(chatId, thinkingMsg.message_id); } catch {}
          await this.sendLongMessage(chatId, response);
        }

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

        // Debrief confirm/cancel
        if (data.startsWith("debrief:")) {
          const parts = data.split(":");
          const action = parts[1]; // confirm or cancel
          const key = parts.slice(2).join(":"); // the full key (chatId_timestamp)

          if (action === "cancel") {
            pendingDebriefs.delete(key);
            await ctx.answerCbQuery("Cancelled");
            await ctx.editMessageReplyMarkup(undefined);
            return;
          }

          if (action === "confirm") {
            const parsed = pendingDebriefs.get(key);
            if (!parsed) {
              await ctx.answerCbQuery("Expired — please run /debrief again");
              return;
            }
            pendingDebriefs.delete(key);
            await ctx.answerCbQuery("Creating tasks...");

            try {
              const { executeDebrief } = await import("../debrief-handler");
              const result = await executeDebrief(parsed, "telegram");

              const breakdown = Object.entries(result.ventureBreakdown)
                .map(([name, count]) => `• ${name}: ${count}`)
                .join("\n");

              const originalText = (ctx.callbackQuery as any).message?.text || "";
              await ctx.editMessageText(
                originalText + `\n\n✅ <b>Done — ${result.created} task${result.created !== 1 ? "s" : ""} logged</b>\n${breakdown}`,
                { parse_mode: "HTML" }
              );
            } catch (err: any) {
              await ctx.reply("Failed to create tasks. Please try again.");
              this.recordError(err.message);
            }
            return;
          }
        }

        // Review actions: approve/amend/reject deliverables
        if (data.startsWith("review:")) {
          const parts = data.split(":");
          const action = parts[1];
          const taskId = parts[2];

          if (!taskId) {
            await ctx.answerCbQuery("Invalid action");
            return;
          }

          const {
            approveDeliverable: approveDel,
            rejectDeliverable: rejectDel,
            requestChanges: reqChanges,
          } = await import("../../routes/review-actions");

          const originalText = (ctx.callbackQuery as any).message?.text || "";

          if (action === "approve") {
            const result = await approveDel(taskId);
            if (result.success) {
              const created = result.promotedTo.map(p => `${p.type} #${p.id}`).join(", ");
              await ctx.answerCbQuery("Approved");
              await ctx.editMessageText(
                originalText + `\n\n\u2705 <b>Approved</b>${created ? ` \u2014 Created: ${created}` : ""}`,
                { parse_mode: "HTML" }
              );
            } else {
              await ctx.answerCbQuery(result.error || "Failed");
            }
          } else if (action === "reject") {
            const result = await rejectDel(taskId, "Rejected via Telegram");
            if (result.success) {
              await ctx.answerCbQuery("Rejected");
              await ctx.editMessageText(
                originalText + "\n\n\u274C <b>Rejected</b>",
                { parse_mode: "HTML" }
              );
            } else {
              await ctx.answerCbQuery(result.error || "Failed");
            }
          } else if (action === "amend") {
            const chatIdStr = String(ctx.chat?.id);
            pendingAmendFeedback.set(chatIdStr, taskId);
            await ctx.answerCbQuery("Reply with your feedback");
            await ctx.reply("Reply with your amendment feedback:", {
              reply_parameters: { message_id: (ctx.callbackQuery as any).message?.message_id },
            } as any);
          }
          return;
        }

        // Venture pipeline actions: GO/KILL from double-yes check
        if (data.startsWith("venture:")) {
          const parts = data.split(":");
          const action = parts[1]; // go or kill
          const ideaId = parts[2];

          if (!ideaId) {
            await ctx.answerCbQuery("Invalid action");
            return;
          }

          const originalText = (ctx.callbackQuery as any).message?.text || "";

          if (action === "go") {
            await ctx.answerCbQuery("Launching pipeline...");
            await ctx.editMessageText(
              originalText + "\n\n\uD83D\uDE80 <b>GO — Pipeline launching...</b>",
              { parse_mode: "HTML" }
            );
            const { handleUserDecision } = await import("../../agents/venture-pipeline");
            handleUserDecision(ideaId, "yes").catch((err: any) => {
              logger.error({ err: err.message, ideaId }, "Venture pipeline GO failed");
            });
          } else if (action === "kill") {
            await ctx.answerCbQuery("Idea killed");
            await ctx.editMessageText(
              originalText + "\n\n\uD83D\uDDD1\uFE0F <b>KILLED</b>",
              { parse_mode: "HTML" }
            );
            const { handleUserDecision } = await import("../../agents/venture-pipeline");
            handleUserDecision(ideaId, "no").catch((err: any) => {
              logger.error({ err: err.message, ideaId }, "Venture pipeline KILL failed");
            });
          }
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

            const { doc, created } = await storage.createDocIfNotExists({
              title: clipped.title,
              body: clipped.body,
              type: "reference",
              domain: "personal",
              status: "active",
              tags: ["telegram-clip"],
              metadata: clipped.metadata,
            });

            if (created) {
              processDocumentNow(doc.id).catch(() => {});
            }

            await this.sendLongMessage(
              ctx.chat!.id.toString(),
              created
                ? `📎 Clipped: "${clipped.title}"\nWords: ${clipped.metadata.wordCount}\nSaved to Knowledge Hub.`
                : `📎 Already exists: "${clipped.title}" — skipped duplicate.`
            );
          } catch (err: any) {
            await this.sendLongMessage(
              ctx.chat!.id.toString(),
              `Failed to clip: ${err.message}`
            );
          }
        }

        // Nudge response actions
        if (data.startsWith("nudge:")) {
          const parts = data.split(":");
          const action = parts[1]; // acted, snoozed, dismissed
          const nudgeType = parts[2] || "unknown";
          await ctx.answerCbQuery(action === "acted" ? "Marked as done" : action === "snoozed" ? "Snoozed 1h" : "Dismissed");
          await ctx.editMessageReplyMarkup(undefined);

          try {
            const { getUserDate } = await import("../../utils/dates");
            await storage.createNudgeResponse({
              nudgeType,
              responseType: action as any,
              date: getUserDate(),
            });
          } catch {
            // Non-critical
          }
        }

        // Email actions
        if (data.startsWith("email:")) {
          const parts = data.split(":");
          const action = parts[1]; // flag, archive
          const emailId = parts[2] || "";
          await ctx.answerCbQuery(action === "flag" ? "Flagged" : "Archived");
          await ctx.editMessageReplyMarkup(undefined);

          if (action === "archive" && emailId) {
            try {
              const { markAsRead } = await import("../../gmail");
              await markAsRead([emailId]);
              await this.sendLongMessage(ctx.chat!.id.toString(), "📧 Email archived (marked as read)");
            } catch {
              // Non-critical
            }
          }
        }

        // Task actions
        if (data.startsWith("task:")) {
          const parts = data.split(":");
          const action = parts[1]; // done, snooze
          const taskId = parts[2] || "";
          await ctx.answerCbQuery(action === "done" ? "Task completed" : "Snoozed to tomorrow");
          await ctx.editMessageReplyMarkup(undefined);

          if (action === "done" && taskId) {
            try {
              await storage.updateTask(taskId, { status: "completed", completedAt: new Date() } as any);
              await this.sendLongMessage(ctx.chat!.id.toString(), "✅ Task marked as done!");
            } catch {
              // Non-critical
            }
          } else if (action === "snooze" && taskId) {
            try {
              const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split("T")[0];
              await storage.updateTask(taskId, { focusDate: tomorrow } as any);
              await this.sendLongMessage(ctx.chat!.id.toString(), `📅 Task moved to ${tomorrow}`);
            } catch {
              // Non-critical
            }
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
      await this.sendLongMessage(msg.chatId, msg.text, msg.parseMode, msg.threadId);
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
   * If threadId is provided, sends into the specified forum topic.
   */
  private async sendLongMessage(
    chatId: string,
    text: string,
    parseMode?: "html" | "markdown",
    threadId?: number
  ): Promise<void> {
    if (!this.bot) return;

    // Map parse mode to Telegram API values
    const tgParseMode = parseMode === "html" ? "HTML"
      : parseMode === "markdown" ? "MarkdownV2"
      : undefined;

    const extra: Record<string, any> = { parse_mode: tgParseMode };
    if (threadId !== undefined && threadId !== null) {
      extra.message_thread_id = threadId;
    }

    const maxLen = 4000; // Leave buffer below 4096 limit
    if (text.length <= maxLen) {
      await this.bot.telegram.sendMessage(chatId, text, extra);
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
      await this.bot.telegram.sendMessage(chatId, chunk, extra);
    }
  }

  /**
   * Edit a previously sent message (used for partial streaming pattern).
   */
  async editMessage(chatId: string, messageId: string, text: string, parseMode?: "html" | "markdown"): Promise<void> {
    if (!this.bot) return;
    try {
      await this.bot.telegram.editMessageText(
        chatId,
        parseInt(messageId, 10),
        undefined,
        text,
        { parse_mode: parseMode === "html" ? "HTML" : parseMode === "markdown" ? "MarkdownV2" : undefined }
      );
    } catch (error: any) {
      // Telegram returns error if message content unchanged — ignore
      if (!error.message?.includes("message is not modified")) {
        throw error;
      }
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
 * Get the Telegraf bot instance for direct API calls (inline keyboards, etc.)
 */
export function getTelegramBot(): Telegraf | null {
  return telegramAdapter.bot;
}

/**
 * Get the authorized chat IDs for sending proactive messages.
 */
export function getAuthorizedChatIds(): string[] {
  return [...AUTHORIZED_CHAT_IDS];
}

/**
 * Queue a deliverable notification into the batch buffer.
 * After 5 seconds of no new deliverables from the same agent, flushes as ONE consolidated message.
 * Uses sendProactiveMessage (queued) instead of direct bot.telegram.sendMessage.
 */
export async function notifyDeliverableSubmitted(
  taskId: string,
  title: string,
  type: string,
  agentName: string,
  driveUrl?: string,
  vercelUrl?: string
): Promise<void> {
  const bot = telegramAdapter.bot;
  if (!bot) return;

  const item: PendingDeliverable = { taskId, title, type, driveUrl, vercelUrl };
  const existing = deliverableBatchBuffer.get(agentName);

  if (existing) {
    // Add to existing batch and reset timer
    clearTimeout(existing.timer);
    existing.items.push(item);
    existing.timer = setTimeout(() => flushDeliverableBatch(agentName), DELIVERABLE_BATCH_WINDOW_MS);
  } else {
    // Start a new batch
    const timer = setTimeout(() => flushDeliverableBatch(agentName), DELIVERABLE_BATCH_WINDOW_MS);
    deliverableBatchBuffer.set(agentName, { items: [item], timer });
  }
}

async function flushDeliverableBatch(agentName: string): Promise<void> {
  const batch = deliverableBatchBuffer.get(agentName);
  deliverableBatchBuffer.delete(agentName);
  if (!batch || batch.items.length === 0) return;

  const { escapeHtml } = await import("../../infra/telegram-format.js");
  const { sendProactiveMessage } = await import("../channel-manager");

  const typeIcons: Record<string, string> = {
    document: "\u{1F4C4}",
    recommendation: "\u{1F4A1}",
    action_items: "\u{1F4CB}",
    code: "\u{1F4BB}",
    idea_validation: "\u{1F4A1}",
  };

  if (batch.items.length === 1) {
    // Single deliverable — send with inline keyboard for quick review
    const d = batch.items[0];
    const icon = typeIcons[d.type] || "\u{1F4CB}";
    const viewUrl = d.vercelUrl || d.driveUrl;
    const viewLabel = d.vercelUrl ? "\u{1F310} Preview Site" : "\u{1F4C2} View in Drive";
    const bot = telegramAdapter.bot;

    const inlineKeyboard: any[][] = [];
    if (viewUrl) {
      inlineKeyboard.push([{ text: viewLabel, url: viewUrl }]);
    }
    inlineKeyboard.push([
      { text: "\u2705 Approve", callback_data: `review:approve:${d.taskId}` },
      { text: "\u270F\uFE0F Amend", callback_data: `review:amend:${d.taskId}` },
      { text: "\u274C Reject", callback_data: `review:reject:${d.taskId}` },
    ]);

    // Single item still uses direct send for inline keyboard support
    for (const chatId of getAuthorizedChatIds()) {
      try {
        await bot!.telegram.sendMessage(chatId,
          `\u{1F4CB} <b>New Deliverable</b>\n\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n` +
          `${icon} <b>${escapeHtml(d.type)}</b> from ${escapeHtml(agentName)}\n\n` +
          `"${escapeHtml(d.title.slice(0, 200))}"`,
          {
            parse_mode: "HTML",
            reply_markup: { inline_keyboard: inlineKeyboard },
          }
        );
      } catch (err) {
        logger.error({ err, chatId }, "Failed to send deliverable notification");
      }
    }
    return;
  }

  // Multiple deliverables — send ONE consolidated message via queue
  const lines = batch.items.map((d, i) => {
    const icon = typeIcons[d.type] || "\u{1F4CB}";
    const viewUrl = d.vercelUrl || d.driveUrl;
    const link = viewUrl ? ` — <a href="${escapeHtml(viewUrl)}">View</a>` : "";
    return `${i + 1}. ${icon} ${escapeHtml(d.title.slice(0, 150))}${link}`;
  });

  const message =
    `\u{1F4CB} <b>${batch.items.length} Deliverables from ${escapeHtml(agentName)}</b>\n` +
    `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n\n` +
    lines.join("\n") +
    `\n\nReview: /review`;

  for (const chatId of getAuthorizedChatIds()) {
    try {
      await sendProactiveMessage("telegram", chatId, message);
    } catch (err) {
      logger.error({ err, chatId }, "Failed to send batched deliverable notification");
    }
  }
}
