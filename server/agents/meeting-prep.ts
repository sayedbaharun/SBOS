/**
 * Meeting Prep — Auto-generated briefings before meetings
 *
 * Runs every 15 minutes via scheduled job.
 * For any meeting with external attendees starting within 30 minutes:
 * 1. Pulls event details
 * 2. Searches memory for prior interactions with attendees
 * 3. Searches web for attendee context if no prior data
 * 4. Generates a 3-bullet prep brief
 * 5. Sends via Telegram
 */

import { logger } from "../logger";
import { storage } from "../storage";
import { msgHeader, msgTruncate, formatMessage, escapeHtml } from "../infra/telegram-format";

/**
 * Check for upcoming meetings and prepare briefs.
 */
export async function checkAndPrepMeetings(): Promise<{
  prepped: number;
  skipped: number;
  errors: string[];
}> {
  const errors: string[] = [];

  // Get events in the next 45 minutes
  let events: any[];
  try {
    const { listEvents } = await import("../google-calendar");
    const now = new Date();
    const soon = new Date(now.getTime() + 45 * 60 * 1000);
    events = await listEvents(now, soon, 10);
  } catch (err: any) {
    return { prepped: 0, skipped: 0, errors: [`Calendar: ${err.message}`] };
  }

  let prepped = 0;
  let skipped = 0;

  for (const event of events) {
    const eventId = event.id;
    if (!eventId) continue;

    // Skip if already prepped
    const existing = await storage.getMeetingPrep(eventId);
    if (existing) {
      // If not yet notified and within 30 min, send notification
      if (!existing.notified) {
        const eventStart = new Date(event.start?.dateTime || event.start?.date);
        const minutesUntil = (eventStart.getTime() - Date.now()) / 60000;
        if (minutesUntil <= 30 && minutesUntil > 0) {
          await sendPrepNotification(existing.brief, event.summary, minutesUntil);
          await storage.updateMeetingPrep(existing.id, { notified: true });
        }
      }
      skipped++;
      continue;
    }

    // Only prep for meetings with attendees (not solo events)
    const attendees = event.attendees || [];
    if (attendees.length === 0) {
      skipped++;
      continue;
    }

    // Skip all-day events
    if (!event.start?.dateTime) {
      skipped++;
      continue;
    }

    const eventStart = new Date(event.start.dateTime);
    const minutesUntil = (eventStart.getTime() - Date.now()) / 60000;

    // Only prep if within 30 minutes
    if (minutesUntil > 35 || minutesUntil < 0) {
      skipped++;
      continue;
    }

    try {
      const brief = await generateMeetingBrief(event, attendees);

      await storage.createMeetingPrep({
        eventId,
        eventTitle: event.summary || "Untitled Meeting",
        eventStart,
        attendees: attendees.map((a: any) => ({
          email: a.email,
          name: a.displayName,
        })),
        brief,
        notified: true,
      });

      await sendPrepNotification(brief, event.summary, minutesUntil);
      prepped++;
    } catch (err: any) {
      errors.push(`Prep failed for "${event.summary}": ${err.message}`);
      logger.error({ eventId, error: err.message }, "Meeting prep failed");
    }
  }

  if (prepped > 0) {
    logger.info({ prepped, skipped }, "Meeting prep completed");
  }

  return { prepped, skipped, errors };
}

async function generateMeetingBrief(event: any, attendees: any[]): Promise<string> {
  // Search memory for prior context with attendees
  const attendeeContext: string[] = [];

  for (const attendee of attendees.slice(0, 5)) {
    const email = attendee.email;
    const name = attendee.displayName || email.split("@")[0];

    // Search CRM (people table)
    try {
      const people = await storage.getPeople({} as any);
      const match = people.find((p: any) =>
        p.email?.toLowerCase() === email.toLowerCase() ||
        p.name?.toLowerCase().includes(name.toLowerCase())
      );
      if (match) {
        attendeeContext.push(`${name} (${email}): Known contact — ${match.relationship || "contact"}. Last contacted: ${match.lastContactDate || "unknown"}`);
        continue;
      }
    } catch {
      // Non-critical
    }

    // Search agent memory for prior mentions
    try {
      const { hybridSearch } = await import("../vector-search");
      const results = await hybridSearch(name, { limit: 3 });
      if (results.length > 0) {
        const context = results.map((r: any) => r.content?.slice(0, 100) || "").join("; ");
        attendeeContext.push(`${name} (${email}): Memory hits — ${context}`);
        continue;
      }
    } catch {
      // Non-critical
    }

    attendeeContext.push(`${name} (${email}): No prior context found`);
  }

  // Generate brief via LLM
  const OpenAI = (await import("openai")).default;
  const openai = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
  });

  const completion = await openai.chat.completions.create({
    model: "meta-llama/llama-4-scout:free",
    messages: [
      {
        role: "system",
        content: `Generate a concise meeting prep brief (3-5 bullet points) for a solo founder. Be direct and actionable. Include:
1. Meeting purpose/context
2. Key attendee context
3. Suggested talking points or preparation items
Keep it under 200 words.`,
      },
      {
        role: "user",
        content: `Meeting: ${event.summary || "Untitled"}
Time: ${event.start?.dateTime || "TBD"}
Description: ${(event.description || "No description").slice(0, 500)}

Attendees:
${attendeeContext.join("\n")}

Generate a brief meeting prep.`,
      },
    ],
    temperature: 0.3,
  });

  return completion.choices[0]?.message?.content || "Meeting prep unavailable.";
}

async function sendPrepNotification(brief: string, title: string, minutesUntil: number): Promise<void> {
  try {
    const { sendProactiveMessage } = await import("../channels/channel-manager");
    const { getAuthorizedChatIds } = await import("../channels/adapters/telegram-adapter");

    const message = formatMessage({
      header: msgHeader("📋", `Meeting in ${Math.round(minutesUntil)}min`),
      body: `<b>${escapeHtml(title)}</b>\n\n${msgTruncate(escapeHtml(brief))}`,
    });

    for (const chatId of getAuthorizedChatIds()) {
      await sendProactiveMessage("telegram", chatId, message);
    }
  } catch {
    // Telegram not configured — skip
  }
}
