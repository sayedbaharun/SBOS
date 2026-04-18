/**
 * Content posting schedule — Dubai time (Asia/Dubai, UTC+4).
 * Maps content pillars to default post slots and target platforms.
 */

export type Platform = "x" | "linkedin" | "youtube" | "tiktok";

export interface PillarSchedule {
  /** Cron expression in Asia/Dubai timezone */
  cron: string;
  /** Human-readable slot */
  slot: string;
  platforms: Platform[];
}

export const PILLAR_SCHEDULE: Record<string, PillarSchedule> = {
  "mindset-monday": {
    cron: "0 7 * * 1",
    slot: "Mon 07:00 Dubai",
    platforms: ["x", "linkedin", "youtube", "tiktok"],
  },
  "wealth-wednesday": {
    cron: "0 7 * * 3",
    slot: "Wed 07:00 Dubai",
    platforms: ["x", "linkedin", "youtube", "tiktok"],
  },
  "story-friday": {
    cron: "0 17 * * 5",
    slot: "Fri 17:00 Dubai",
    platforms: ["x", "linkedin", "tiktok"],
  },
  "quick-tips": {
    cron: "0 12 * * 2,4",
    slot: "Tue+Thu 12:00 Dubai",
    platforms: ["x", "tiktok", "youtube"],
  },
  "controversial-takes": {
    cron: "0 19 * * 6",
    slot: "Sat 19:00 Dubai",
    platforms: ["x", "linkedin"],
  },
};

/** Returns the next scheduled post time for a given pillar (UTC Date) */
export function nextPostTime(pillar: string): Date {
  const schedule = PILLAR_SCHEDULE[pillar];
  if (!schedule) {
    // Default: 2 hours from now
    return new Date(Date.now() + 2 * 60 * 60 * 1000);
  }

  // Simple next-occurrence calculation based on slot
  const now = new Date();
  const [, hour, , , dayStr] = schedule.cron.split(" ");
  const postHourUTC = parseInt(hour, 10) - 4; // Dubai is UTC+4
  const days = dayStr.split(",").map(Number);

  const candidate = new Date(now);
  candidate.setUTCSeconds(0, 0);
  candidate.setUTCMinutes(0);
  candidate.setUTCHours(postHourUTC < 0 ? postHourUTC + 24 : postHourUTC);

  for (let i = 0; i < 8; i++) {
    const dayOfWeek = candidate.getUTCDay(); // 0=Sun
    if (days.includes(dayOfWeek) && candidate > now) return candidate;
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }

  return new Date(Date.now() + 24 * 60 * 60 * 1000);
}

/** Copy limits per platform */
export const COPY_LIMITS: Record<Platform, number> = {
  x: 280,
  linkedin: 3000,
  youtube: 5000,
  tiktok: 2200,
};

/** Truncate copy for a platform, appending hashtags where they fit */
export function formatCopyForPlatform(
  copy: string,
  hashtags: string[],
  platform: Platform
): string {
  const limit = COPY_LIMITS[platform];
  const hashtagStr = hashtags.length > 0 ? `\n\n${hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ")}` : "";
  const combined = `${copy}${hashtagStr}`;
  if (combined.length <= limit) return combined;
  const truncated = `${copy.substring(0, limit - hashtagStr.length - 4)}…`;
  return `${truncated}${hashtagStr}`;
}
