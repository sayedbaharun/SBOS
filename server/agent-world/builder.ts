/**
 * Agent World State Builder
 *
 * Assembles a dense JSON snapshot of the current operating state
 * for AI agents to consume. Cached for 60 seconds.
 */
import { eq, sql } from "drizzle-orm";
import { storage } from "../storage";
import { agentTasks, tasks } from "@shared/schema";
import { getUserDate } from "../utils/dates";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorldStateKeyResult {
  id: string;
  title: string;
  currentValue: number;
  targetValue: number;
  unit: string | null;
  status: string;
}

export interface WorldStateGoal {
  id: string;
  ventureId: string;
  ventureName: string;
  targetStatement: string;
  period: string;
  status: string;
  keyResults: WorldStateKeyResult[];
}

export interface WorldStateTask {
  id: string;
  title: string;
  priority: string | null;
  status: string;
  ventureId: string | null;
  focusDate: string | null;
}

export interface WorldStateHealth {
  energyLevel: number | null;
  sleepHours: number | null;
  workoutDone: boolean | null;
  mood: string | null;
}

export interface WorldStateVenture {
  id: string;
  name: string;
  status: string;
  domain: string | null;
}

export interface WorldState {
  generatedAt: string;
  date: string;
  activeGoals: WorldStateGoal[];
  topTasks: WorldStateTask[];
  health: WorldStateHealth | null;
  openReviews: number;
  agentReadyTasks: number;
  ventures: WorldStateVenture[];
}

// ---------------------------------------------------------------------------
// In-memory cache (60-second TTL)
// ---------------------------------------------------------------------------

interface CacheEntry {
  data: WorldState;
  expiresAt: number;
}

let cache: CacheEntry | null = null;
const CACHE_TTL_MS = 60 * 1000;

// ---------------------------------------------------------------------------
// Lazy DB accessor
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any = null;

async function getDb() {
  if (!db) {
    db = (storage as any).db;
  }
  return db;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export async function buildWorldState(): Promise<WorldState> {
  // Return cached result if still fresh
  if (cache && Date.now() < cache.expiresAt) {
    return cache.data;
  }

  const date = getUserDate();

  // ISO timestamp in Dubai timezone
  const generatedAt = new Date().toLocaleString("en-US", {
    timeZone: "Asia/Dubai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  // Build a proper ISO string for Dubai time
  const dubaiNow = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Dubai" })
  );
  const generatedAtISO = dubaiNow.toISOString();

  // Fetch all data in parallel
  const [goalsRaw, tasksRaw, healthEntry, venturesRaw, database] =
    await Promise.all([
      storage.getAllActiveGoalsWithProgress(),
      storage.getTasks({ status: "next,in_progress", limit: 10 }),
      storage.getHealthEntryByDate(date),
      storage.getVentures(),
      getDb(),
    ]);

  // Map goals
  const activeGoals: WorldStateGoal[] = goalsRaw.map((goal) => ({
    id: goal.id,
    ventureId: goal.ventureId,
    ventureName: goal.venture?.name ?? "",
    targetStatement: goal.targetStatement,
    period: goal.period,
    status: goal.status,
    keyResults: (goal.keyResults ?? []).map((kr) => ({
      id: kr.id,
      title: kr.title,
      currentValue: kr.currentValue,
      targetValue: kr.targetValue,
      unit: kr.unit ?? null,
      status: kr.status,
    })),
  }));

  // Map top tasks
  const topTasks: WorldStateTask[] = tasksRaw.map((t) => ({
    id: t.id,
    title: t.title,
    priority: t.priority ?? null,
    status: t.status,
    ventureId: t.ventureId ?? null,
    focusDate: t.focusDate ?? null,
  }));

  // Map health
  const health: WorldStateHealth | null = healthEntry
    ? {
        energyLevel: healthEntry.energyLevel ?? null,
        sleepHours: healthEntry.sleepHours ?? null,
        workoutDone: healthEntry.workoutDone ?? null,
        mood: healthEntry.mood ?? null,
      }
    : null;

  // Map ventures
  const ventures: WorldStateVenture[] = venturesRaw.map((v) => ({
    id: v.id,
    name: v.name,
    status: v.status,
    domain: v.domain ?? null,
  }));

  // Count open reviews (agentTasks with status = 'needs_review')
  const openReviewsResult = await database
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(agentTasks)
    .where(eq(agentTasks.status, "needs_review"));
  const openReviews = openReviewsResult[0]?.count ?? 0;

  // Count agent-ready tasks (tasks where tags @> '["agent-ready"]')
  const agentReadyResult = await database
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(tasks)
    .where(sql`${tasks.tags} @> '["agent-ready"]'::jsonb`);
  const agentReadyTasks = agentReadyResult[0]?.count ?? 0;

  const worldState: WorldState = {
    generatedAt: generatedAtISO,
    date,
    activeGoals,
    topTasks,
    health,
    openReviews,
    agentReadyTasks,
    ventures,
  };

  // Update cache
  cache = { data: worldState, expiresAt: Date.now() + CACHE_TTL_MS };

  return worldState;
}

/**
 * Invalidate the in-memory cache (useful for testing).
 */
export function invalidateWorldStateCache(): void {
  cache = null;
}

/**
 * Reset the cached DB reference (useful for testing).
 */
export function resetDbCache(): void {
  db = null;
}
