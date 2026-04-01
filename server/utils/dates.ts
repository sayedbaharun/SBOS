/**
 * Date Utilities
 *
 * Timezone-aware date helpers for SB-OS.
 * Default timezone is Asia/Dubai (UTC+4) since Sayed is based in Dubai.
 */

/**
 * Get today's date string in YYYY-MM-DD format, adjusted for the user's timezone.
 *
 * Without this, `new Date().toISOString().split("T")[0]` returns UTC date,
 * which is wrong at e.g. 2 AM Dubai time (still yesterday in UTC).
 */
export function getUserDate(timezone = "Asia/Dubai"): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: timezone });
}

/**
 * Convert a UTC ISO timestamp to a local date string (YYYY-MM-DD).
 * Used to correctly bucket WHOOP data by the user's local calendar day.
 */
export function utcToLocalDate(isoTimestamp: string, timezone = "Asia/Dubai"): string {
  return new Date(isoTimestamp).toLocaleDateString("en-CA", { timeZone: timezone });
}
