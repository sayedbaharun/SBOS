/**
 * Intelligence Synthesizer — Cross-Domain Daily Intelligence
 *
 * Runs at 8:45am Dubai (before morning briefing at 9am).
 * Pulls data from 5 sources (calendar, tasks, email, life context, yesterday's outcomes)
 * and synthesizes cross-domain insights using GPT-4o-mini.
 *
 * Output → daily_intelligence table + Telegram message + injected into morning briefing.
 */

import { logger } from "../logger";
import { storage } from "../storage";
import { getUserDate } from "../utils/dates";
import { msgHeader, msgSection, msgStats, msgTruncate, formatMessage, escapeHtml } from "../infra/telegram-format";

// ============================================================================
// DATA GATHERING
// ============================================================================

interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  attendees?: Array<{ email: string; displayName?: string }>;
  description?: string;
}

async function gatherCalendarEvents(): Promise<{ events: CalendarEvent[]; errors: string[] }> {
  try {
    const { listEvents } = await import("../google-calendar");
    const now = new Date();
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);

    const rawEvents = await listEvents(now, endOfDay, 20);
    const events: CalendarEvent[] = rawEvents.map((e: any) => ({
      id: e.id || "",
      summary: e.summary || "Untitled",
      start: e.start?.dateTime || e.start?.date || "",
      end: e.end?.dateTime || e.end?.date || "",
      attendees: e.attendees?.map((a: any) => ({
        email: a.email,
        displayName: a.displayName,
      })),
      description: e.description?.slice(0, 200),
    }));

    return { events, errors: [] };
  } catch (err: any) {
    return { events: [], errors: [`Calendar: ${err.message}`] };
  }
}

async function gatherTasks(): Promise<{
  dueToday: any[];
  overdue: any[];
  inProgress: any[];
  errors: string[];
}> {
  try {
    const today = getUserDate();
    const allTasks = await storage.getTasks({});
    const activeTasks = allTasks.filter(
      (t: any) => t.status !== "completed" && t.status !== "cancelled" && t.status !== "done"
    );

    const dueToday = activeTasks.filter(
      (t: any) => t.dueDate === today || t.focusDate === today
    );
    const overdue = activeTasks.filter(
      (t: any) => t.dueDate && t.dueDate < today
    );
    const inProgress = activeTasks.filter(
      (t: any) => t.status === "in_progress"
    );

    return { dueToday, overdue, inProgress, errors: [] };
  } catch (err: any) {
    return { dueToday: [], overdue: [], inProgress: [], errors: [`Tasks: ${err.message}`] };
  }
}

async function gatherEmails(): Promise<{
  unread: Array<{ id: string; from: string; subject: string; snippet: string; date: string }>;
  unreadCount: number;
  errors: string[];
}> {
  try {
    const { listMessages, getUnreadCount } = await import("../gmail");
    const [messages, count] = await Promise.all([
      listMessages({ query: "is:unread", maxResults: 10 }),
      getUnreadCount(),
    ]);

    const unread = messages.map((m) => ({
      id: m.id,
      from: m.from,
      subject: m.subject,
      snippet: m.snippet,
      date: m.date.toISOString(),
    }));

    return { unread, unreadCount: count, errors: [] };
  } catch (err: any) {
    return { unread: [], unreadCount: 0, errors: [`Email: ${err.message}`] };
  }
}

async function gatherLifeContext(): Promise<{ context: string; errors: string[] }> {
  try {
    const { buildLifeContext } = await import("./tools/life-context");
    const context = await buildLifeContext();
    return { context, errors: [] };
  } catch (err: any) {
    return { context: "", errors: [`Life context: ${err.message}`] };
  }
}

async function gatherYesterdayOutcomes(): Promise<{ outcomes: any[]; reflection: string | null; errors: string[] }> {
  try {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const day = await storage.getDay(yesterday);
    if (!day) return { outcomes: [], reflection: null, errors: [] };

    const outcomes = (day.top3Outcomes as any[]) || [];
    return { outcomes, reflection: day.reflectionPm || null, errors: [] };
  } catch (err: any) {
    return { outcomes: [], reflection: null, errors: [`Yesterday: ${err.message}`] };
  }
}

// ============================================================================
// CONFLICT DETECTION
// ============================================================================

interface Conflict {
  type: string;
  description: string;
  severity: "high" | "medium" | "low";
}

function detectConflicts(
  events: CalendarEvent[],
  tasks: { dueToday: any[]; overdue: any[] }
): Conflict[] {
  const conflicts: Conflict[] = [];

  // Check for overlapping calendar events
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const a = events[i];
      const b = events[j];
      if (a.start && b.start && a.end && b.end) {
        const aStart = new Date(a.start).getTime();
        const aEnd = new Date(a.end).getTime();
        const bStart = new Date(b.start).getTime();
        const bEnd = new Date(b.end).getTime();

        if (aStart < bEnd && bStart < aEnd) {
          conflicts.push({
            type: "calendar_overlap",
            description: `"${a.summary}" and "${b.summary}" overlap`,
            severity: "high",
          });
        }
      }
    }
  }

  // Check for high-priority tasks with no calendar time
  const p0Tasks = tasks.dueToday.filter((t: any) => t.priority === "P0");
  if (p0Tasks.length > 0 && events.length > 4) {
    conflicts.push({
      type: "no_time_for_p0",
      description: `${p0Tasks.length} P0 task(s) due today but calendar has ${events.length} events`,
      severity: "high",
    });
  }

  // Overdue tasks
  if (tasks.overdue.length > 0) {
    conflicts.push({
      type: "overdue_tasks",
      description: `${tasks.overdue.length} overdue task(s): ${tasks.overdue.slice(0, 3).map((t: any) => t.title).join(", ")}`,
      severity: tasks.overdue.length > 3 ? "high" : "medium",
    });
  }

  // Calculate free hours
  if (events.length > 0) {
    const totalMeetingMinutes = events.reduce((sum, e) => {
      if (!e.start || !e.end) return sum;
      return sum + (new Date(e.end).getTime() - new Date(e.start).getTime()) / 60000;
    }, 0);
    const meetingHours = totalMeetingMinutes / 60;
    if (meetingHours > 6) {
      conflicts.push({
        type: "meeting_heavy_day",
        description: `${meetingHours.toFixed(1)}h in meetings today — limited deep work time`,
        severity: "medium",
      });
    }
  }

  return conflicts;
}

// ============================================================================
// SYNTHESIS
// ============================================================================

async function synthesize(inputs: {
  calendar: { events: CalendarEvent[] };
  tasks: { dueToday: any[]; overdue: any[]; inProgress: any[] };
  emails: { unread: any[]; unreadCount: number };
  lifeContext: string;
  yesterday: { outcomes: any[]; reflection: string | null };
  conflicts: Conflict[];
}): Promise<{
  synthesis: string;
  priorities: Array<{ item: string; reason: string; urgency: string }>;
  blindSpots: Array<{ area: string; suggestion: string }>;
}> {
  const OpenAI = (await import("openai")).default;
  const openai = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
  });

  const prompt = buildSynthesisPrompt(inputs);

  const completion = await openai.chat.completions.create({
    model: "meta-llama/llama-4-scout:free",
    messages: [
      {
        role: "system",
        content: `You are an executive intelligence assistant for a solo founder (Sayed) running multiple ventures.
Analyze the cross-domain data and produce:
1. A brief, actionable morning intelligence brief (3-5 paragraphs)
2. Top 3 priorities with reasoning
3. Blind spots — things that might be falling through the cracks

Be direct, specific, and actionable. No filler. Focus on what matters TODAY.
Format your response as JSON: { "synthesis": "...", "priorities": [...], "blindSpots": [...] }`,
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.3,
    response_format: { type: "json_object" },
  });

  const content = completion.choices[0]?.message?.content || "{}";
  try {
    const parsed = JSON.parse(content);
    return {
      synthesis: parsed.synthesis || "Intelligence synthesis unavailable.",
      priorities: parsed.priorities || [],
      blindSpots: parsed.blindSpots || parsed.blind_spots || [],
    };
  } catch {
    return {
      synthesis: content,
      priorities: [],
      blindSpots: [],
    };
  }
}

function buildSynthesisPrompt(inputs: {
  calendar: { events: CalendarEvent[] };
  tasks: { dueToday: any[]; overdue: any[]; inProgress: any[] };
  emails: { unread: any[]; unreadCount: number };
  lifeContext: string;
  yesterday: { outcomes: any[]; reflection: string | null };
  conflicts: Conflict[];
}): string {
  const sections: string[] = [];
  const today = getUserDate();

  sections.push(`# Daily Intelligence Input — ${today}`);

  // Calendar
  if (inputs.calendar.events.length > 0) {
    sections.push("\n## Today's Calendar");
    for (const e of inputs.calendar.events) {
      const time = e.start ? new Date(e.start).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" }) : "all-day";
      const attendeeCount = e.attendees?.length || 0;
      sections.push(`- ${time}: ${e.summary}${attendeeCount > 0 ? ` (${attendeeCount} attendees)` : ""}`);
    }
  } else {
    sections.push("\n## Today's Calendar\nNo events scheduled.");
  }

  // Tasks
  sections.push("\n## Tasks");
  sections.push(`Due today: ${inputs.tasks.dueToday.length}`);
  if (inputs.tasks.dueToday.length > 0) {
    for (const t of inputs.tasks.dueToday.slice(0, 5)) {
      sections.push(`- [${t.priority || "P2"}] ${t.title} (${t.status})`);
    }
  }
  if (inputs.tasks.overdue.length > 0) {
    sections.push(`Overdue: ${inputs.tasks.overdue.length}`);
    for (const t of inputs.tasks.overdue.slice(0, 3)) {
      sections.push(`- [OVERDUE] ${t.title} — due ${t.dueDate}`);
    }
  }
  sections.push(`In progress: ${inputs.tasks.inProgress.length}`);

  // Emails
  sections.push("\n## Email");
  sections.push(`Unread: ${inputs.emails.unreadCount}`);
  if (inputs.emails.unread.length > 0) {
    for (const e of inputs.emails.unread.slice(0, 5)) {
      sections.push(`- From: ${e.from.slice(0, 50)} | ${e.subject}`);
    }
  }

  // Life context
  if (inputs.lifeContext) {
    sections.push(`\n${inputs.lifeContext}`);
  }

  // Yesterday
  if (inputs.yesterday.outcomes.length > 0) {
    sections.push("\n## Yesterday's Outcomes");
    for (const o of inputs.yesterday.outcomes) {
      const text = o.outcome || o.text || o;
      const done = o.completed ? "DONE" : "NOT DONE";
      sections.push(`- [${done}] ${text}`);
    }
  }
  if (inputs.yesterday.reflection) {
    sections.push(`Yesterday's reflection: ${inputs.yesterday.reflection.slice(0, 300)}`);
  }

  // Conflicts
  if (inputs.conflicts.length > 0) {
    sections.push("\n## Detected Conflicts");
    for (const c of inputs.conflicts) {
      sections.push(`- [${c.severity.toUpperCase()}] ${c.type}: ${c.description}`);
    }
  }

  return sections.join("\n");
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

/**
 * Run the daily intelligence synthesis.
 * Called by the scheduled job at 8:45am Dubai.
 */
export async function runDailyIntelligence(): Promise<{
  synthesis: string;
  conflicts: Conflict[];
  priorities: any[];
  blindSpots: any[];
  errors: string[];
}> {
  const today = getUserDate();
  logger.info({ date: today }, "Running daily intelligence synthesis");

  // Check if already run today
  const existing = await storage.getDailyIntelligence(today);
  if (existing) {
    logger.info({ date: today }, "Daily intelligence already exists for today, skipping");
    return {
      synthesis: existing.synthesis,
      conflicts: (existing.conflicts as Conflict[]) || [],
      priorities: (existing.priorities as any[]) || [],
      blindSpots: (existing.blindSpots as any[]) || [],
      errors: [],
    };
  }

  // Gather all data in parallel
  const [calendarResult, tasksResult, emailsResult, lifeResult, yesterdayResult] = await Promise.all([
    gatherCalendarEvents(),
    gatherTasks(),
    gatherEmails(),
    gatherLifeContext(),
    gatherYesterdayOutcomes(),
  ]);

  const allErrors = [
    ...calendarResult.errors,
    ...tasksResult.errors,
    ...emailsResult.errors,
    ...lifeResult.errors,
    ...yesterdayResult.errors,
  ];

  // Detect conflicts
  const conflicts = detectConflicts(calendarResult.events, tasksResult);

  // Synthesize with LLM
  let result;
  try {
    result = await synthesize({
      calendar: { events: calendarResult.events },
      tasks: tasksResult,
      emails: { unread: emailsResult.unread, unreadCount: emailsResult.unreadCount },
      lifeContext: lifeResult.context,
      yesterday: yesterdayResult,
      conflicts,
    });
  } catch (err: any) {
    logger.error({ error: err.message }, "Intelligence synthesis LLM call failed");
    result = {
      synthesis: `Intelligence synthesis failed: ${err.message}. Raw data collected successfully.`,
      priorities: [],
      blindSpots: [],
    };
    allErrors.push(`Synthesis: ${err.message}`);
  }

  // Store to DB
  try {
    await storage.createDailyIntelligence({
      date: today,
      synthesis: result.synthesis,
      conflicts: conflicts as any,
      priorities: result.priorities as any,
      blindSpots: result.blindSpots as any,
      calendarSummary: {
        eventCount: calendarResult.events.length,
        nextEvent: calendarResult.events[0]?.summary,
        freeHours: calculateFreeHours(calendarResult.events),
      } as any,
      emailSummary: {
        unreadCount: emailsResult.unreadCount,
        urgentCount: 0,
        actionNeeded: 0,
      } as any,
      taskSummary: {
        dueToday: tasksResult.dueToday.length,
        overdue: tasksResult.overdue.length,
        inProgress: tasksResult.inProgress.length,
      } as any,
      rawInputs: {
        gatherErrors: allErrors,
        calendarEventCount: calendarResult.events.length,
        emailCount: emailsResult.unread.length,
      } as any,
    });
  } catch (err: any) {
    logger.error({ error: err.message }, "Failed to store daily intelligence");
    allErrors.push(`Storage: ${err.message}`);
  }

  // Note: Telegram notification removed — intelligence is now sent as part of
  // the unified daily_briefing handler in scheduled-jobs.ts.
  // The data is still stored in daily_intelligence table for API access.

  logger.info(
    {
      date: today,
      calendarEvents: calendarResult.events.length,
      dueToday: tasksResult.dueToday.length,
      unreadEmails: emailsResult.unreadCount,
      conflicts: conflicts.length,
      errors: allErrors.length,
    },
    "Daily intelligence synthesis complete"
  );

  return {
    synthesis: result.synthesis,
    conflicts,
    priorities: result.priorities,
    blindSpots: result.blindSpots,
    errors: allErrors,
  };
}

function calculateFreeHours(events: CalendarEvent[]): number {
  if (events.length === 0) return 10; // Assume 10 working hours
  const totalMeetingMs = events.reduce((sum, e) => {
    if (!e.start || !e.end) return sum;
    return sum + (new Date(e.end).getTime() - new Date(e.start).getTime());
  }, 0);
  return Math.max(0, 10 - totalMeetingMs / 3600000);
}

function formatTelegramSynthesis(
  result: { synthesis: string; priorities: any[]; blindSpots: any[] },
  conflicts: Conflict[],
  events: CalendarEvent[],
  tasks: { dueToday: any[]; overdue: any[] },
  emails: { unreadCount: number }
): string {
  const statsBar = msgStats([
    { emoji: "📅", count: events.length, label: "events" },
    { emoji: "📋", count: tasks.dueToday.length, label: "tasks" },
    { emoji: "🔥", count: tasks.overdue.length, label: "overdue" },
    { emoji: "📧", count: emails.unreadCount, label: "unread" },
  ]);

  const sections: string[] = [];

  // Conflicts
  if (conflicts.length > 0) {
    const items = conflicts.map((c) =>
      `${c.severity === "high" ? "🔴" : "🟡"} ${escapeHtml(c.description)}`
    );
    sections.push(msgSection("⚠️", "Conflicts", items));
  }

  // Priorities
  if (result.priorities.length > 0) {
    const items = result.priorities.slice(0, 3).map((p: any) => {
      const icon = p.urgency === "high" ? "🔴" : p.urgency === "medium" ? "🟡" : "🟢";
      return `${icon} ${escapeHtml(p.item)}`;
    });
    sections.push(msgSection("🎯", "Priorities", items));
  }

  // Blind spots
  if (result.blindSpots.length > 0) {
    const items = result.blindSpots.slice(0, 2).map((b: any) =>
      `${escapeHtml(b.area)} — ${escapeHtml(b.suggestion)}`
    );
    sections.push(msgSection("👁️", "Watch For", items));
  }

  return formatMessage({
    header: msgHeader("🧠", "Morning Intelligence"),
    stats: statsBar,
    sections,
    body: result.synthesis ? msgTruncate(escapeHtml(result.synthesis), 800) : undefined,
    cta: "/today for outcomes · /tasks for full list",
  });
}

/**
 * Get the latest daily intelligence (for injection into morning briefing)
 */
export async function getLatestIntelligence(): Promise<{
  synthesis: string;
  conflicts: any[];
  priorities: any[];
} | null> {
  const today = getUserDate();
  const existing = await storage.getDailyIntelligence(today);
  if (!existing) return null;

  return {
    synthesis: existing.synthesis,
    conflicts: (existing.conflicts as any[]) || [],
    priorities: (existing.priorities as any[]) || [],
  };
}
