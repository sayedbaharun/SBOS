/**
 * Lightweight CSV parser for simple 2D files (no quoted multi-line values).
 * Handles comma-delimited files with a header row.
 * Strips UTF-8 BOM if present.
 */
export function parseSimpleCSV(content: string): Record<string, string>[] {
  // Strip UTF-8 BOM if present
  const clean = content.replace(/^\uFEFF/, "");

  const lines = clean.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map(h => h.trim().toLowerCase());

  return lines.slice(1).map(line => {
    const values = line.split(",").map(v => v.trim());
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = values[i] ?? "";
    });
    return row;
  });
}
