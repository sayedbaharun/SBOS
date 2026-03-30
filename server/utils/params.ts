/**
 * Safe query/param integer parsing.
 * Avoids the `parseInt(String(undefined) || "n")` anti-pattern where
 * String(undefined) = "undefined" (truthy), defeating the || fallback.
 */
export function parseIntParam(value: unknown, fallback: number): number {
  if (value == null) return fallback;
  const n = parseInt(String(value), 10);
  return Number.isNaN(n) ? fallback : n;
}
