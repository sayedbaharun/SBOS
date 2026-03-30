/**
 * WHOOP Integration Service
 * OAuth2 flow + daily health data sync (recovery, sleep, strain, workouts)
 */
import { storage } from "../storage";
import { logger } from "../logger";

const WHOOP_AUTH_URL = "https://api.prod.whoop.com/oauth/oauth2/auth";
const WHOOP_TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";
const WHOOP_API_BASE = "https://api.prod.whoop.com/developer";

const WHOOP_SCOPES = "read:recovery read:cycles read:sleep read:workout offline";

function getClientId(): string {
  return process.env.WHOOP_CLIENT_ID || "";
}

function getClientSecret(): string {
  return process.env.WHOOP_CLIENT_SECRET || "";
}

function getRedirectUri(): string {
  // Use the Railway URL in production, localhost in dev
  const base = process.env.WHOOP_REDIRECT_URI || process.env.BASE_URL || "http://localhost:5000";
  return `${base}/api/whoop/callback`;
}

/**
 * Generate the WHOOP OAuth authorization URL
 */
export function getAuthorizationUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: getClientId(),
    redirect_uri: getRedirectUri(),
    scope: WHOOP_SCOPES,
    state,
  });
  return `${WHOOP_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange authorization code for access + refresh tokens
 */
export async function exchangeCodeForTokens(code: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}> {
  const response = await fetch(WHOOP_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: getClientId(),
      client_secret: getClientSecret(),
      redirect_uri: getRedirectUri(),
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`WHOOP token exchange failed: ${response.status} ${err}`);
  }

  const data = await response.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  };
}

/**
 * Refresh an expired access token
 */
async function refreshAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}> {
  const response = await fetch(WHOOP_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: getClientId(),
      client_secret: getClientSecret(),
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`WHOOP token refresh failed: ${response.status} ${err}`);
  }

  const data = await response.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  };
}

/**
 * Get a valid access token, refreshing if needed
 */
async function getValidAccessToken(): Promise<string> {
  const token = await storage.getIntegrationToken("whoop");
  if (!token) {
    throw new Error("WHOOP not connected. Complete OAuth flow first.");
  }

  // If token hasn't expired, use it
  if (token.expiresAt && new Date() < token.expiresAt) {
    return token.accessToken;
  }

  // Refresh the token
  if (!token.refreshToken) {
    throw new Error("WHOOP refresh token missing. Re-authorize.");
  }

  logger.info("Refreshing WHOOP access token");
  const refreshed = await refreshAccessToken(token.refreshToken);

  await storage.upsertIntegrationToken("whoop", {
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    expiresAt: new Date(Date.now() + refreshed.expiresIn * 1000),
    scopes: WHOOP_SCOPES,
  });

  return refreshed.accessToken;
}

/**
 * Make an authenticated WHOOP API call
 */
async function whoopFetch(path: string, params?: Record<string, string>): Promise<any> {
  const accessToken = await getValidAccessToken();
  const url = new URL(`${WHOOP_API_BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`WHOOP API error ${path}: ${response.status} ${err}`);
  }

  return response.json();
}

// =============================================================================
// WHOOP sport name → SB-OS workout type mapping
// =============================================================================
const SPORT_TO_WORKOUT_TYPE: Record<string, string> = {
  running: "cardio",
  cycling: "cardio",
  swimming: "cardio",
  rowing: "cardio",
  elliptical: "cardio",
  "stairmaster / stepmill": "cardio",
  "jump rope": "cardio",
  hiit: "cardio",
  "spin / cycling": "cardio",
  weightlifting: "strength",
  "functional fitness": "strength",
  powerlifting: "strength",
  "olympic lifting": "strength",
  crossfit: "strength",
  calisthenics: "strength",
  yoga: "yoga",
  pilates: "yoga",
  stretching: "yoga",
  basketball: "sport",
  soccer: "sport",
  tennis: "sport",
  "martial arts": "sport",
  boxing: "sport",
  cricket: "sport",
  padel: "sport",
  golf: "sport",
  walking: "walk",
  hiking: "walk",
};

function mapSportToWorkoutType(sportName: string): "strength" | "cardio" | "yoga" | "sport" | "walk" | "at_home" | "none" {
  const normalized = sportName.toLowerCase().trim();
  return (SPORT_TO_WORKOUT_TYPE[normalized] as any) || "cardio"; // default to cardio for unknown
}

/**
 * Map WHOOP sleep performance percentage to SB-OS sleep quality enum
 */
function mapSleepPerformance(pct: number): "poor" | "fair" | "good" | "excellent" {
  if (pct >= 85) return "excellent";
  if (pct >= 70) return "good";
  if (pct >= 50) return "fair";
  return "poor";
}

// =============================================================================
// SYNC: Pull WHOOP data and create/update health entries
// =============================================================================

interface WhoopDaySummary {
  date: string; // YYYY-MM-DD
  sleepHours: number | null;
  sleepQuality: "poor" | "fair" | "good" | "excellent" | null;
  recoveryScore: number | null;
  hrv: number | null;
  restingHeartRate: number | null;
  strainScore: number | null;
  workoutDone: boolean;
  workoutType: string | null;
  workoutDurationMin: number | null;
}

/**
 * Sync WHOOP data for a specific date range (defaults to today)
 */
export async function syncWhoopData(startDate?: string, endDate?: string): Promise<{
  synced: number;
  errors: string[];
}> {
  const errors: string[] = [];

  // Default: sync last 2 days (covers overnight sleep)
  const now = new Date();
  const twoDaysAgo = new Date(now);
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

  const start = startDate || twoDaysAgo.toISOString();
  const end = endDate || now.toISOString();

  logger.info({ start, end }, "Starting WHOOP sync");

  // Fetch all data in parallel
  const [cyclesData, recoveryData, sleepData, workoutData] = await Promise.all([
    whoopFetch("/v2/cycle", { start, end, limit: "25" }).catch(e => { errors.push(`Cycles: ${e.message}`); return { records: [] }; }),
    whoopFetch("/v2/recovery", { start, end, limit: "25" }).catch(e => { errors.push(`Recovery: ${e.message}`); return { records: [] }; }),
    whoopFetch("/v2/activity/sleep", { start, end, limit: "25" }).catch(e => { errors.push(`Sleep: ${e.message}`); return { records: [] }; }),
    whoopFetch("/v2/activity/workout", { start, end, limit: "25" }).catch(e => { errors.push(`Workouts: ${e.message}`); return { records: [] }; }),
  ]);

  // Build a map of date → summary
  const dayMap = new Map<string, WhoopDaySummary>();

  function getOrCreate(dateStr: string): WhoopDaySummary {
    if (!dayMap.has(dateStr)) {
      dayMap.set(dateStr, {
        date: dateStr,
        sleepHours: null,
        sleepQuality: null,
        recoveryScore: null,
        hrv: null,
        restingHeartRate: null,
        strainScore: null,
        workoutDone: false,
        workoutType: null,
        workoutDurationMin: null,
      });
    }
    return dayMap.get(dateStr)!;
  }

  // Process cycles (strain)
  for (const cycle of cyclesData.records || []) {
    if (cycle.score_state !== "SCORED" || !cycle.score) continue;
    const dateStr = cycle.end?.slice(0, 10) || cycle.start?.slice(0, 10);
    if (!dateStr) continue;
    const summary = getOrCreate(dateStr);
    summary.strainScore = cycle.score.strain;
  }

  // Process recovery
  for (const rec of recoveryData.records || []) {
    if (rec.score_state !== "SCORED" || !rec.score) continue;
    // Recovery is tied to a cycle — use the cycle's date
    // The created_at gives us the date
    const dateStr = rec.created_at?.slice(0, 10);
    if (!dateStr) continue;
    const summary = getOrCreate(dateStr);
    summary.recoveryScore = rec.score.recovery_score;
    summary.hrv = rec.score.hrv_rmssd_milli;
    summary.restingHeartRate = rec.score.resting_heart_rate;
  }

  // Process sleep (use the main sleep, not naps)
  for (const sleep of sleepData.records || []) {
    if (sleep.nap || sleep.score_state !== "SCORED" || !sleep.score) continue;
    // Sleep end time = the date you woke up
    const dateStr = sleep.end?.slice(0, 10);
    if (!dateStr) continue;
    const summary = getOrCreate(dateStr);

    const stages = sleep.score.stage_summary;
    if (stages) {
      const totalSleepMs =
        (stages.total_light_sleep_time_milli || 0) +
        (stages.total_slow_wave_sleep_time_milli || 0) +
        (stages.total_rem_sleep_time_milli || 0);
      summary.sleepHours = Math.round((totalSleepMs / 3600000) * 10) / 10; // 1 decimal
    }

    if (sleep.score.sleep_performance_percentage != null) {
      summary.sleepQuality = mapSleepPerformance(sleep.score.sleep_performance_percentage);
    }
  }

  // Process workouts (aggregate per day — pick longest)
  const workoutsByDate = new Map<string, Array<{ type: string; durationMin: number }>>();
  for (const workout of workoutData.records || []) {
    if (workout.score_state !== "SCORED") continue;
    const dateStr = workout.start?.slice(0, 10);
    if (!dateStr) continue;

    const startMs = new Date(workout.start).getTime();
    const endMs = new Date(workout.end).getTime();
    const durationMin = Math.round((endMs - startMs) / 60000);

    if (!workoutsByDate.has(dateStr)) workoutsByDate.set(dateStr, []);
    workoutsByDate.get(dateStr)!.push({
      type: workout.sport_name || "other",
      durationMin,
    });
  }

  Array.from(workoutsByDate.entries()).forEach(([dateStr, workouts]) => {
    const summary = getOrCreate(dateStr);
    summary.workoutDone = true;
    // Pick the longest workout as the primary
    const primary = workouts.sort((a: { type: string; durationMin: number }, b: { type: string; durationMin: number }) => b.durationMin - a.durationMin)[0];
    summary.workoutType = mapSportToWorkoutType(primary.type);
    // Total duration across all workouts
    summary.workoutDurationMin = workouts.reduce((sum: number, w: { durationMin: number }) => sum + w.durationMin, 0);
  });

  // Now upsert health entries
  let synced = 0;
  for (const summary of Array.from(dayMap.values())) {
    try {
      const existing = await storage.getHealthEntryByDate(summary.date);

      const whoopFields: Record<string, any> = {
        whoopSyncedAt: new Date(),
      };

      // Only set WHOOP-sourced fields (don't overwrite manually entered data)
      if (summary.sleepHours != null) whoopFields.sleepHours = summary.sleepHours;
      if (summary.sleepQuality != null) whoopFields.sleepQuality = summary.sleepQuality;
      if (summary.recoveryScore != null) whoopFields.recoveryScore = summary.recoveryScore;
      if (summary.hrv != null) whoopFields.hrv = summary.hrv;
      if (summary.restingHeartRate != null) whoopFields.restingHeartRate = summary.restingHeartRate;
      if (summary.strainScore != null) whoopFields.strainScore = summary.strainScore;
      if (summary.workoutDone) {
        whoopFields.workoutDone = true;
        if (summary.workoutType) whoopFields.workoutType = summary.workoutType;
        if (summary.workoutDurationMin != null) whoopFields.workoutDurationMin = summary.workoutDurationMin;
      }

      if (existing) {
        // Update existing entry — only WHOOP fields, preserve manual entries (mood, stress, energy, notes)
        await storage.updateHealthEntry(existing.id, whoopFields);
      } else {
        // Create new entry
        const day = await storage.getDayOrCreate(summary.date);
        await storage.createHealthEntry({
          dayId: day.id,
          date: summary.date,
          ...whoopFields,
        } as any);
      }

      synced++;
    } catch (err: any) {
      errors.push(`${summary.date}: ${err.message}`);
    }
  }

  logger.info({ synced, errors: errors.length }, "WHOOP sync complete");
  return { synced, errors };
}

/**
 * Check if WHOOP is connected and tokens are valid
 */
export async function isWhoopConnected(): Promise<boolean> {
  if (!getClientId() || !getClientSecret()) return false;
  const token = await storage.getIntegrationToken("whoop");
  return !!token;
}
