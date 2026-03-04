/**
 * Telegram Message Formatting — Unified Message Builder
 *
 * Shared formatting layer for all Telegram messages sent by SB-OS.
 * All output is HTML parse mode. Jarvis-like tone: confident, brief, decisive.
 *
 * Used by: scheduled-jobs, intelligence-synthesizer, email-triage,
 * meeting-prep, nudge-engine, proactive-triggers, sub-agent, agent-scheduler.
 */

const SEPARATOR = "━━━━━━━━━━━━━━━━━";

/**
 * Escape HTML entities for safe Telegram HTML rendering.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Header line with emoji + bold title + separator.
 *
 * Example:
 *   ☀️ <b>Daily Briefing</b>
 *   ━━━━━━━━━━━━━━━━━
 */
export function msgHeader(emoji: string, title: string): string {
  return `${emoji} <b>${escapeHtml(title)}</b>\n${SEPARATOR}`;
}

/**
 * Section with bold title and bullet items.
 *
 * Example:
 *   🎯 <b>Priorities</b>
 *     • Item 1
 *     • Item 2
 */
export function msgSection(emoji: string, title: string, items: string[]): string {
  if (items.length === 0) return "";
  const header = `${emoji} <b>${escapeHtml(title)}</b>`;
  const body = items.map((item) => `  • ${item}`).join("\n");
  return `${header}\n${body}`;
}

/**
 * Stats bar — dot-separated counters on one line.
 *
 * Example:
 *   📅 3 events  ·  📋 5 tasks  ·  🔥 1 overdue
 */
export function msgStats(
  stats: Array<{ emoji: string; count: number; label: string }>
): string {
  return stats
    .filter((s) => s.count > 0)
    .map((s) => `${s.emoji} ${s.count} ${s.label}`)
    .join("  ·  ");
}

/**
 * Truncate text with ellipsis for agent-generated content.
 * Default max: 2000 chars.
 */
export function msgTruncate(text: string, maxChars: number = 2000): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 3) + "...";
}

/**
 * Assemble a complete Telegram message from parts.
 * All parts are optional except header.
 */
export function formatMessage(opts: {
  header: string;
  stats?: string;
  sections?: string[];
  body?: string;
  cta?: string;
}): string {
  const parts: string[] = [opts.header];

  if (opts.stats) {
    parts.push("");
    parts.push(opts.stats);
  }

  if (opts.sections) {
    for (const section of opts.sections) {
      if (section) {
        parts.push("");
        parts.push(section);
      }
    }
  }

  if (opts.body) {
    parts.push("");
    parts.push(opts.body);
  }

  if (opts.cta) {
    parts.push("");
    parts.push(opts.cta);
  }

  return parts.join("\n");
}
