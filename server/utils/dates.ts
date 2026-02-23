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
