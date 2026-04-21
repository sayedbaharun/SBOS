/**
 * Debrief Handler
 *
 * Parses end-of-day debrief text into structured task items and creates
 * completed tasks in SB-OS under the right ventures.
 *
 * Used by both:
 * - Telegram /debrief command (with confirm/cancel step)
 * - POST /api/debrief REST endpoint (with autoConfirm option)
 */

import { storage } from "../storage";
import { getUserDate } from "../utils/dates";
import { logger } from "../logger";

export interface DebriefItem {
  title: string;
  ventureSlug: string | null;
  ventureId: string | null;
  ventureName: string;
  type: string;
  domain: string;
  priority: string;
  notes: string | null;
  actualEffort: number | null;
}

export interface ParsedDebrief {
  items: DebriefItem[];
  sessionSummary: string;
}

export async function parseDebrief(
  text: string,
  sessionLogContent?: string
): Promise<ParsedDebrief> {
  const allVentures = await storage.getVentures();

  const ventureLines = allVentures
    .map((v) => `- "${v.name}" → slug: "${v.slug || v.id}"`)
    .join("\n");

  const sessionSection = sessionLogContent
    ? `\n\nThe user also worked on the following during Claude Code sessions today (include these as additional items):\n${sessionLogContent.slice(0, 2000)}`
    : "";

  const systemPrompt = `You are a personal productivity assistant. Parse the user's end-of-day debrief into structured task items.

The user manages these ventures — use the exact slug shown to identify each:
${ventureLines}

Rules:
- Each distinct activity or task becomes one item
- Map each item to the most relevant venture slug from the list above
- If an item doesn't clearly belong to one of the ventures above (gym, personal errands, general life admin), set ventureSlug to null — do not force a match
- Calls and meetings → type: "admin", domain: "calls"
- Gym / exercise / health activities → type: "health", domain: "health"
- Default priority: P2. Only use P0/P1 if the user mentions urgency or importance
- Only set actualEffort (in decimal hours) if the user explicitly mentions time spent
- Generate a "sessionSummary" (2-3 sentences) capturing the overall day

Valid task types: business, deep_work, admin, health, learning, personal
Valid domains: work, home, health, finance, travel, learning, play, calls, personal

Return ONLY valid JSON (no markdown, no explanation):
{
  "items": [
    {
      "title": "Brief descriptive task title",
      "ventureSlug": "exact-slug-or-null",
      "type": "business|deep_work|admin|health|learning|personal",
      "domain": "work|home|health|finance|travel|learning|play|calls|personal",
      "priority": "P2",
      "notes": "optional context or null",
      "actualEffort": null
    }
  ],
  "sessionSummary": "Overall summary of the day"
}${sessionSection}`;

  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY not configured");
  }

  const OpenAI = (await import("openai")).default;
  const openai = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
  });

  const completion = await openai.chat.completions.create({
    model: "google/gemini-2.0-flash-exp:free",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: text },
    ],
    temperature: 0.2,
    max_tokens: 900,
  });

  const raw = completion.choices[0]?.message?.content || "";
  const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const parsed = JSON.parse(cleaned);

  // Build slug → venture map
  const slugMap: Record<string, (typeof allVentures)[0]> = {};
  for (const v of allVentures) {
    if (v.slug) slugMap[v.slug] = v;
  }

  const items: DebriefItem[] = (parsed.items || []).map((item: any) => {
    const venture = item.ventureSlug ? slugMap[item.ventureSlug] || null : null;

    return {
      title: String(item.title || "Untitled task"),
      ventureSlug: venture?.slug || item.ventureSlug || null,
      ventureId: venture?.id || null,
      ventureName: venture?.name || "No venture",
      type: item.type || "business",
      domain: item.domain || "work",
      priority: item.priority || "P2",
      notes: item.notes || null,
      actualEffort:
        typeof item.actualEffort === "number" ? item.actualEffort : null,
    };
  });

  return {
    items,
    sessionSummary: String(
      parsed.sessionSummary || "End-of-day debrief logged."
    ),
  };
}

export async function executeDebrief(
  parsed: ParsedDebrief,
  source: "telegram" | "web" = "telegram"
): Promise<{ created: number; ventureBreakdown: Record<string, number> }> {
  const today = getUserDate();
  const completedAt = new Date();
  const ventureBreakdown: Record<string, number> = {};

  for (const item of parsed.items) {
    await storage.createTask({
      title: item.title,
      status: "completed",
      completedAt,
      focusDate: today,
      ventureId: item.ventureId || null,
      type: item.type as any,
      domain: item.domain as any,
      priority: item.priority as any,
      notes: item.notes || null,
      actualEffort: item.actualEffort || null,
      tags: ["debrief"],
    } as any);

    const name = item.ventureName || "Personal";
    ventureBreakdown[name] = (ventureBreakdown[name] || 0) + 1;
  }

  // Write session log (non-critical, fire-and-forget)
  try {
    const db = (storage as any).db;
    const { sessionLogs } = await import("@shared/schema");
    await db.insert(sessionLogs).values({
      source,
      summary: parsed.sessionSummary,
      keyTopics: Object.keys(ventureBreakdown),
      decisions: [],
      openThreads: [],
      filesModified: [],
      tags: ["debrief"],
    });
  } catch (err: any) {
    logger.warn(
      { error: err.message },
      "Debrief session log write failed (non-critical)"
    );
  }

  return { created: parsed.items.length, ventureBreakdown };
}
