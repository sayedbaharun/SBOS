/**
 * Newsletter Digest Agent
 *
 * Reads unread emails from the SyntheLIQ newsletter inbox, summarises them
 * via GPT-4o-mini, and sends a formatted digest to Telegram.
 *
 * Runs daily at 8am Dubai. Powers the SyntheLIQ AI newsletter pipeline.
 *
 * Pre-requisites (one-time manual setup):
 * 1. Create a SyntheLIQ Google Workspace email for newsletters
 * 2. Set SYNTHELIQ_GMAIL_REFRESH_TOKEN in Railway env vars
 * 3. Forward AI newsletters from personal Gmail to that address
 */

import { logger } from "../logger";
import { getUserDate } from "../utils/dates";
import { escapeHtml } from "../infra/telegram-format";

interface NewsletterSummary {
  headline: string;
  summary: string;
  takeaway: string;
  source: string;
  subject: string;
  from: string;
  emailId: string;
}

export async function runNewsletterDigest(): Promise<{
  processed: number;
  skipped: number;
}> {
  // Fetch unread emails from SyntheLIQ newsletter inbox
  let emails: any[];
  try {
    const { listMessages } = await import("../gmail");
    emails = await listMessages({
      query: "is:unread",
      maxResults: 15,
      account: "syntheliq",
    });
  } catch (err: any) {
    logger.error({ error: err.message }, "Newsletter digest: Failed to fetch emails");
    return { processed: 0, skipped: 0 };
  }

  if (emails.length === 0) {
    logger.info("Newsletter digest: No unread newsletters");
    return { processed: 0, skipped: 0 };
  }

  // Summarise via LLM
  let summaries: NewsletterSummary[];
  try {
    summaries = await summariseNewsletters(emails);
  } catch (err: any) {
    logger.error({ error: err.message }, "Newsletter digest: LLM summarisation failed");
    return { processed: 0, skipped: emails.length };
  }

  if (summaries.length === 0) {
    logger.info("Newsletter digest: Nothing worth summarising");
    return { processed: 0, skipped: emails.length };
  }

  // Send Telegram digest
  try {
    const { sendProactiveMessage } = await import("../channels/channel-manager");
    const { getAuthorizedChatIds } = await import("../channels/adapters/telegram-adapter");

    const digest = formatDigest(summaries);
    for (const chatId of getAuthorizedChatIds()) {
      await sendProactiveMessage("telegram", chatId, digest);
    }
  } catch (err: any) {
    logger.warn({ error: err.message }, "Newsletter digest: Telegram send failed");
  }

  // Mark processed emails as read
  try {
    const { markAsRead } = await import("../gmail");
    await markAsRead(summaries.map((s) => s.emailId), "syntheliq");
  } catch (err: any) {
    logger.warn({ error: err.message }, "Newsletter digest: Failed to mark emails as read");
  }

  logger.info({ processed: summaries.length, total: emails.length }, "Newsletter digest completed");
  return { processed: summaries.length, skipped: emails.length - summaries.length };
}

async function summariseNewsletters(emails: any[]): Promise<NewsletterSummary[]> {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY not configured");
  }

  const OpenAI = (await import("openai")).default;
  const openai = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
  });

  const emailInputs = emails.map((e, i) => ({
    index: i,
    from: e.from?.split("<")[0].trim() || e.from || "Unknown",
    subject: e.subject || "(no subject)",
    body: (e.body || e.snippet || "").slice(0, 2000),
  }));

  const completion = await openai.chat.completions.create({
    model: "google/gemini-2.0-flash-exp:free",
    messages: [
      {
        role: "system",
        content: `You are a newsletter curator for SyntheLIQ AI, a Dubai-based AI automation agency.
Summarise each newsletter for a busy founder who wants actionable AI insights.

Focus on: new AI tools, business applications, Gulf/MENA relevance, automation opportunities.
Skip (return skip: true): marketing fluff, pure fundraising announcements, overly technical ML papers, unsubscribe confirmations, receipts.

For each email worth including, return:
{
  "index": 0,
  "skip": false,
  "headline": "Short punchy headline (max 10 words)",
  "summary": "2-3 sentences on what matters for business owners",
  "takeaway": "One actionable insight or opportunity",
  "source": "Newsletter or sender name"
}

Return JSON: { "newsletters": [...] }`,
      },
      {
        role: "user",
        content: JSON.stringify(emailInputs),
      },
    ],
    temperature: 0.3,
    response_format: { type: "json_object" },
    max_tokens: 1200,
  });

  const raw = completion.choices[0]?.message?.content || "{}";
  const parsed = JSON.parse(raw);
  const results = (parsed.newsletters || []) as any[];

  return results
    .filter((r: any) => !r.skip)
    .map((r: any) => {
      const email = emails[r.index];
      return {
        headline: String(r.headline || email.subject),
        summary: String(r.summary || ""),
        takeaway: String(r.takeaway || ""),
        source: String(r.source || email.from || ""),
        subject: email.subject,
        from: email.from,
        emailId: email.id,
      };
    });
}

function formatDigest(summaries: NewsletterSummary[]): string {
  const today = getUserDate();
  const dateFormatted = new Date(today + "T00:00:00+04:00").toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Asia/Dubai",
  });

  const lines: string[] = [
    `<b>🗞 AI Newsletter Digest — ${dateFormatted}</b>`,
    `<i>${summaries.length} newsletter${summaries.length !== 1 ? "s" : ""} curated for SyntheLIQ</i>`,
    "",
  ];

  summaries.forEach((s, i) => {
    lines.push(`<b>${i + 1}. ${escapeHtml(s.headline)}</b>`);
    lines.push(escapeHtml(s.summary));
    if (s.takeaway) {
      lines.push(`💡 <i>${escapeHtml(s.takeaway)}</i>`);
    }
    lines.push(`📰 ${escapeHtml(s.source)}`);
    lines.push("");
  });

  lines.push("─────────────────");
  lines.push(`☕ <i>Curated by SyntheLIQ AI · ${today}</i>`);

  return lines.join("\n");
}
