/**
 * Email Triage — Automated Email Classification
 *
 * Runs 3x/day (8am, 1pm, 6pm Dubai).
 * Fetches unread emails, classifies them via GPT-4o-mini, stores results,
 * and sends a Telegram digest. Urgent emails trigger immediate notification.
 */

import { logger } from "../logger";
import { storage } from "../storage";
import { getUserDate } from "../utils/dates";

interface TriagedEmail {
  emailId: string;
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  classification: "urgent" | "action_needed" | "informational" | "spam" | "delegatable";
  summary: string;
  suggestedAction: string;
}

/**
 * Run the email triage process.
 * Fetches unread emails, classifies them, stores results, sends digest.
 */
export async function runEmailTriage(): Promise<{
  triaged: number;
  urgent: number;
  errors: string[];
}> {
  const errors: string[] = [];

  // Fetch unread emails
  let emails: any[];
  try {
    const { listMessages } = await import("../gmail");
    emails = await listMessages({ query: "is:unread", maxResults: 20 });
  } catch (err: any) {
    logger.error({ error: err.message }, "Email triage: Failed to fetch emails");
    return { triaged: 0, urgent: 0, errors: [`Fetch failed: ${err.message}`] };
  }

  if (emails.length === 0) {
    logger.info("Email triage: No unread emails");
    return { triaged: 0, urgent: 0, errors: [] };
  }

  // Filter out already-triaged emails
  const newEmails: any[] = [];
  for (const email of emails) {
    const existing = await storage.getEmailTriageByEmailId(email.id);
    if (!existing) {
      newEmails.push(email);
    }
  }

  if (newEmails.length === 0) {
    logger.info("Email triage: All unread emails already triaged");
    return { triaged: 0, urgent: 0, errors: [] };
  }

  // Classify emails via LLM
  let classifications: TriagedEmail[];
  try {
    classifications = await classifyEmails(newEmails);
  } catch (err: any) {
    logger.error({ error: err.message }, "Email triage: Classification failed");
    return { triaged: 0, urgent: 0, errors: [`Classification failed: ${err.message}`] };
  }

  // Store classifications
  let urgentCount = 0;
  for (const c of classifications) {
    try {
      const isUrgent = c.classification === "urgent";
      if (isUrgent) urgentCount++;

      await storage.createEmailTriage({
        emailId: c.emailId,
        threadId: c.threadId,
        fromAddress: c.from,
        subject: c.subject,
        snippet: c.snippet,
        classification: c.classification,
        summary: c.summary,
        suggestedAction: c.suggestedAction,
        isUrgent,
        triagedAt: new Date(),
      });
    } catch (err: any) {
      errors.push(`Store failed for ${c.emailId}: ${err.message}`);
    }
  }

  // Send Telegram digest
  try {
    const { sendProactiveMessage } = await import("../channels/channel-manager");
    const { getAuthorizedChatIds } = await import("../channels/adapters/telegram-adapter");

    const digest = formatTriageDigest(classifications);
    for (const chatId of getAuthorizedChatIds()) {
      await sendProactiveMessage("telegram", chatId, digest);
    }

    // Send immediate notification for urgent emails
    const urgentEmails = classifications.filter(c => c.classification === "urgent");
    for (const urgent of urgentEmails) {
      const urgentMsg = `🚨 Urgent Email\n\nFrom: ${urgent.from}\nSubject: ${urgent.subject}\n\n${urgent.summary}\n\nSuggested: ${urgent.suggestedAction}`;
      for (const chatId of getAuthorizedChatIds()) {
        await sendProactiveMessage("telegram", chatId, urgentMsg);
      }
    }
  } catch {
    // Telegram not configured — skip
  }

  logger.info(
    { triaged: classifications.length, urgent: urgentCount, errors: errors.length },
    "Email triage completed"
  );

  return { triaged: classifications.length, urgent: urgentCount, errors };
}

async function classifyEmails(emails: any[]): Promise<TriagedEmail[]> {
  const OpenAI = (await import("openai")).default;
  const openai = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
  });

  const emailSummaries = emails.map((e, i) => ({
    index: i,
    from: e.from,
    subject: e.subject,
    snippet: e.snippet?.slice(0, 200) || "",
    body: e.body?.slice(0, 500) || "",
  }));

  const completion = await openai.chat.completions.create({
    model: "openai/gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `You are an email triage assistant for Sayed, a founder running multiple businesses.

Classify each email into one of these categories:
- urgent: Requires immediate attention (client emergencies, payment issues, time-sensitive opportunities)
- action_needed: Needs a response but not time-critical (proposals, follow-ups, questions)
- informational: FYI only, no action needed (newsletters, notifications, updates)
- spam: Marketing spam, promotions, irrelevant (exclude legitimate business emails)
- delegatable: Can be handled by someone else or an AI agent

For each email, provide:
1. classification (one of the above)
2. summary (1 sentence)
3. suggestedAction (what to do — be specific)

Return JSON: { "emails": [{ "index": 0, "classification": "...", "summary": "...", "suggestedAction": "..." }, ...] }`,
      },
      {
        role: "user",
        content: JSON.stringify(emailSummaries),
      },
    ],
    temperature: 0.2,
    response_format: { type: "json_object" },
  });

  const content = completion.choices[0]?.message?.content || "{}";
  const parsed = JSON.parse(content);
  const classified = parsed.emails || [];

  return classified.map((c: any) => {
    const email = emails[c.index];
    return {
      emailId: email.id,
      threadId: email.threadId || "",
      from: email.from,
      subject: email.subject,
      snippet: email.snippet || "",
      classification: c.classification,
      summary: c.summary,
      suggestedAction: c.suggestedAction,
    };
  });
}

function formatTriageDigest(classifications: TriagedEmail[]): string {
  const lines: string[] = ["📧 Email Triage\n"];

  const counts: Record<string, number> = {};
  for (const c of classifications) {
    counts[c.classification] = (counts[c.classification] || 0) + 1;
  }

  const summary: string[] = [];
  if (counts.urgent) summary.push(`🔴 ${counts.urgent} urgent`);
  if (counts.action_needed) summary.push(`🟡 ${counts.action_needed} action needed`);
  if (counts.informational) summary.push(`🔵 ${counts.informational} info`);
  if (counts.delegatable) summary.push(`🟢 ${counts.delegatable} delegatable`);
  if (counts.spam) summary.push(`⚪ ${counts.spam} spam`);
  lines.push(summary.join(" | "));

  // Show urgent + action_needed details
  const actionable = classifications.filter(
    c => c.classification === "urgent" || c.classification === "action_needed"
  );
  if (actionable.length > 0) {
    lines.push("");
    for (const c of actionable) {
      const icon = c.classification === "urgent" ? "🔴" : "🟡";
      lines.push(`${icon} ${c.from.split("<")[0].trim()}`);
      lines.push(`  ${c.subject}`);
      lines.push(`  → ${c.suggestedAction}`);
    }
  }

  lines.push("\nUse /emails to see full triage.");
  return lines.join("\n");
}

/**
 * Get today's email triage summary for Telegram commands.
 */
export async function getTodayTriageSummary(): Promise<string> {
  const today = getUserDate();
  const triaged = await storage.getEmailTriage({ date: today });

  if (triaged.length === 0) {
    return "No emails triaged today. Next triage runs at 8am, 1pm, or 6pm.";
  }

  const lines: string[] = [`📧 Today's Email Triage (${triaged.length} emails)\n`];

  const byClass: Record<string, any[]> = {};
  for (const t of triaged) {
    if (!byClass[t.classification]) byClass[t.classification] = [];
    byClass[t.classification].push(t);
  }

  const order = ["urgent", "action_needed", "informational", "delegatable", "spam"];
  const icons: Record<string, string> = {
    urgent: "🔴",
    action_needed: "🟡",
    informational: "🔵",
    delegatable: "🟢",
    spam: "⚪",
  };

  for (const cls of order) {
    const items = byClass[cls];
    if (!items) continue;
    lines.push(`\n${icons[cls]} ${cls.replace("_", " ").toUpperCase()} (${items.length})`);
    for (const item of items.slice(0, 3)) {
      lines.push(`  ${item.fromAddress?.split("<")[0]?.trim() || "Unknown"}: ${item.subject}`);
      if (item.suggestedAction) lines.push(`    → ${item.suggestedAction}`);
    }
    if (items.length > 3) lines.push(`  ...and ${items.length - 3} more`);
  }

  return lines.join("\n");
}
