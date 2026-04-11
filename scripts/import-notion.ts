/**
 * One-time Notion export import script
 * Run with: npx tsx scripts/import-notion.ts
 *
 * Requires local dev server running on port 5000.
 * Reads from ~/Downloads/notionexport/
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const BASE_URL = "http://localhost:5000";
const NOTION_DIR = path.join(os.homedir(), "Downloads", "notionexport");
const MEMORY_API_KEY = process.env.MEMORY_API_KEY || "";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function post(endpoint: string, body: unknown, extraHeaders: Record<string, string> = {}) {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${endpoint} failed ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function get(endpoint: string) {
  const res = await fetch(`${BASE_URL}${endpoint}`);
  if (!res.ok) throw new Error(`GET ${endpoint} failed ${res.status}`);
  return res.json();
}

function readFile(relativePath: string): string {
  return fs.readFileSync(path.join(NOTION_DIR, relativePath), "utf8");
}

// Normalize title for dedup: lowercase, strip leading "the/a/an ", trim
function normalizeTitle(t: string): string {
  return t
    .toLowerCase()
    .replace(/\*\*/g, "")
    .replace(/^(the|a|an)\s+/i, "")
    .trim();
}

// Strip markdown bold **text** and markdown links [text](url)
function stripMarkdown(s: string): string {
  return s
    .replace(/\*\*/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();
}

// Parse a markdown table into array of objects keyed by header names
function parseMarkdownTable(content: string): Record<string, string>[] {
  const lines = content.split("\n");
  const rows: Record<string, string>[] = [];
  let headers: string[] = [];
  let foundHeader = false;

  for (const line of lines) {
    if (!line.includes("|")) continue;
    const cells = line
      .split("|")
      .map((c) => c.trim())
      .filter((_, i, arr) => i > 0 && i < arr.length - 1); // remove empty first/last from leading/trailing |

    if (!foundHeader) {
      headers = cells;
      foundHeader = true;
      continue;
    }

    // Skip separator row (contains --- or ---)
    if (cells.every((c) => /^[-: ]+$/.test(c))) continue;

    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = stripMarkdown(cells[i] ?? "");
    });
    rows.push(row);
  }

  return rows;
}

// ─── Summary tracking ─────────────────────────────────────────────────────────

const summary = {
  booksImported: 0,
  booksSkipped: 0,
  docsCreated: 0,
  memoryIngested: 0,
  errors: [] as string[],
};

// ─── Step 1: Import Books ─────────────────────────────────────────────────────

interface NotionBook {
  title: string;
  author: string;
  platforms: string[];
  status: "to_read" | "reading" | "finished";
  notes: string;
}

function mapBooksPlatforms(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .map((p) => {
      if (p === "audible") return "audible";
      if (p === "kindle") return "kindle";
      if (p.includes("physical")) return "physical";
      return null;
    })
    .filter(Boolean) as string[];
}

function mapBooksDbStatus(raw: string): "to_read" | "reading" | "finished" {
  const s = raw.toLowerCase().trim();
  if (s === "reading") return "reading";
  if (s === "to read") return "to_read";
  if (s === "finished" || s === "completed") return "finished";
  return "to_read";
}

function mapTrackerStatus(raw: string): "to_read" | "reading" | "finished" {
  const s = raw.toLowerCase().trim();
  if (s === "reading") return "reading";
  if (s === "completed") return "finished";
  if (s === "abandoned") return "finished";
  return "to_read";
}

function collectAllBooks(): NotionBook[] {
  const all: NotionBook[] = [];

  // Source 1: DB - Books DB.md (deduplicate rows 12-20 which mirror rows 1-9)
  try {
    const content = readFile("Books/DB - Books DB.md");
    const rows = parseMarkdownTable(content);
    const seen = new Set<string>();
    for (const row of rows) {
      const title = row["Name"] || row["Title"] || "";
      if (!title) continue;
      const key = normalizeTitle(title);
      if (seen.has(key)) continue;
      seen.add(key);
      all.push({
        title: stripMarkdown(title),
        author: row["Author"] || "",
        platforms: mapBooksPlatforms(row["Platform"] || row["Platforms"] || ""),
        status: mapBooksDbStatus(row["Status"] || ""),
        notes: row["Notes"] || "",
      });
    }
    console.log(`  DB - Books DB: ${seen.size} unique books parsed`);
  } catch (e) {
    summary.errors.push(`Books DB parse error: ${e}`);
  }

  // Source 2: DB - Reading Book Tracker.md (richer: has reviews)
  try {
    const content = readFile("Books/DB - Reading Book Tracker.md");
    const rows = parseMarkdownTable(content);
    for (const row of rows) {
      const title = row["Title"] || "";
      if (!title) continue;
      const existing = all.find((b) => normalizeTitle(b.title) === normalizeTitle(title));
      if (existing) {
        // Enrich existing entry with review/status from tracker
        if (row["Review"]) existing.notes = row["Review"];
        if (row["Status"]) existing.status = mapTrackerStatus(row["Status"]);
      } else {
        all.push({
          title: stripMarkdown(title),
          author: row["Author"] || "",
          platforms: [],
          status: mapTrackerStatus(row["Status"] || ""),
          notes: row["Review"] || "",
        });
      }
    }
    console.log(`  DB - Reading Book Tracker: processed ${rows.length} rows`);
  } catch (e) {
    summary.errors.push(`Reading Tracker parse error: ${e}`);
  }

  // Source 3: DB - Books.md (has descriptions)
  try {
    const content = readFile("Books/DB - Books.md");
    const rows = parseMarkdownTable(content);
    for (const row of rows) {
      const title = row["Name"] || row["Title"] || "";
      if (!title) continue;
      const existing = all.find((b) => normalizeTitle(b.title) === normalizeTitle(title));
      if (existing) {
        if (row["Description"] && !existing.notes) existing.notes = row["Description"];
      } else {
        all.push({
          title: stripMarkdown(title),
          author: row["Author"] || "",
          platforms: [],
          status: "to_read",
          notes: row["Description"] || "",
        });
      }
    }
    console.log(`  DB - Books: processed ${rows.length} rows`);
  } catch (e) {
    summary.errors.push(`Books parse error: ${e}`);
  }

  // Source 4: Mind Dump.md (24 "to read" books, free-form)
  try {
    const content = readFile("Books/Mind Dump.md");
    // Match: **N. Title** by Author\n\nDescription paragraph
    const regex = /\*\*\d+\.\s+(.+?)\*\*\s+by\s+(.+?)\n\n([\s\S]+?)(?=\n\n\*\*\d+\.|\n\n---|\n---|\s*$)/g;
    let match;
    let count = 0;
    while ((match = regex.exec(content)) !== null) {
      const title = match[1].trim();
      const author = match[2].trim();
      const description = match[3].replace(/\n/g, " ").trim();
      const existing = all.find((b) => normalizeTitle(b.title) === normalizeTitle(title));
      if (!existing) {
        all.push({
          title,
          author,
          platforms: [],
          status: "to_read",
          notes: description,
        });
        count++;
      }
    }
    console.log(`  Mind Dump: ${count} new books parsed`);
  } catch (e) {
    summary.errors.push(`Mind Dump parse error: ${e}`);
  }

  return all;
}

async function importBooks() {
  console.log("\n📚 Step 1: Importing Books...");

  const notionBooks = collectAllBooks();
  console.log(`  Total unique books from Notion: ${notionBooks.length}`);

  // Fetch existing books from SB-OS
  const existing: { title: string }[] = await get("/api/books");
  const existingNorm = new Set(existing.map((b) => normalizeTitle(b.title)));
  console.log(`  Existing books in SB-OS: ${existing.length}`);

  // Filter to new only
  const toImport = notionBooks.filter((b) => !existingNorm.has(normalizeTitle(b.title)));
  console.log(`  New books to import: ${toImport.length}`);
  console.log(`  Skipping (already exist): ${notionBooks.length - toImport.length}`);

  summary.booksSkipped = notionBooks.length - toImport.length;

  for (const book of toImport) {
    try {
      await post("/api/books", {
        title: book.title,
        author: book.author || null,
        platforms: book.platforms.length > 0 ? book.platforms : null,
        status: book.status,
        notes: book.notes || null,
      });
      console.log(`  ✓ ${book.title}`);
      summary.booksImported++;
    } catch (e) {
      const msg = `Failed to import book "${book.title}": ${e}`;
      console.error(`  ✗ ${msg}`);
      summary.errors.push(msg);
    }
  }
}

// ─── Step 2 & 3: Import Docs ──────────────────────────────────────────────────

interface DocImport {
  title: string;
  filePath: string;
  type: string;
  domain: string;
  tags: string;
  status?: string;
}

async function importDoc(config: DocImport) {
  let content: string;
  try {
    content = readFile(config.filePath);
  } catch (e) {
    const msg = `Could not read ${config.filePath}: ${e}`;
    console.error(`  ✗ ${msg}`);
    summary.errors.push(msg);
    return;
  }

  try {
    await post("/api/docs", {
      title: config.title,
      type: config.type,
      domain: config.domain,
      status: config.status || "active",
      body: content,
      tags: config.tags,
      isFolder: false,
    });
    console.log(`  ✓ "${config.title}" (${config.type}/${config.domain})`);
    summary.docsCreated++;
  } catch (e) {
    const msg = `Failed to create doc "${config.title}": ${e}`;
    console.error(`  ✗ ${msg}`);
    summary.errors.push(msg);
  }
}

async function importDocs() {
  console.log("\n📄 Steps 2 & 3: Importing Docs...");

  const docs: DocImport[] = [
    {
      title: "Trading Strategy Library",
      filePath: "Trading/Strategy Library_ba076e96.md",
      type: "strategy",
      domain: "trading",
      tags: "trading,strategies,notion-import",
    },
    {
      title: "47 → 48 Yearly Command Board",
      filePath: "Home/47 → 48 Yearly Command Board_2703e3de.md",
      type: "reference",
      domain: "personal",
      tags: "goals,yearly,roadmap,notion-import",
    },
    {
      title: "Personal Brand Story & Belief Extractor Prompt",
      filePath: "Home/prompt_29a3e3de.md",
      type: "prompt",
      domain: "personal",
      tags: "brand,prompt,ai,notion-import",
    },
    {
      title: "Quotes Library",
      filePath: "Knowledge HQ/DB - Quotes.md",
      type: "reference",
      domain: "personal",
      tags: "quotes,content,social-media,notion-import",
    },
    {
      title: "Investor Contacts (VC + Web3 Angels)",
      filePath: "Knowledge HQ/Investor Databases_29b3e3de.md",
      type: "reference",
      domain: "finance",
      tags: "investors,contacts,fundraising,notion-import",
    },
  ];

  for (const doc of docs) {
    await importDoc(doc);
  }
}

// ─── Step 4: Ingest Knowledge HQ to Memory ───────────────────────────────────

interface MemoryIngest {
  filePath: string;
  description: string;
  tags: string[];
}

async function ingestToMemory(config: MemoryIngest, content: string) {
  if (!MEMORY_API_KEY) {
    console.warn("  ⚠ MEMORY_API_KEY not set — skipping memory ingest");
    return false;
  }

  await post(
    "/api/memory/ingest-markdown",
    {
      content,
      source: "notion-export",
      tags: config.tags,
    },
    { "x-memory-api-key": MEMORY_API_KEY }
  );
  return true;
}

async function importMemory() {
  console.log("\n🧠 Step 4: Ingesting Knowledge HQ to Memory (Qdrant)...");

  if (!MEMORY_API_KEY) {
    console.warn("  ⚠ MEMORY_API_KEY not set in environment — skipping all memory ingestion");
    console.warn("  Set MEMORY_API_KEY env var and re-run to ingest these files");
    return;
  }

  const files: MemoryIngest[] = [
    {
      filePath: "Knowledge HQ/🤖 AI & Automation_2563e3de.md",
      description: "AI & Automation: dev tools, IDE table, To Research tracker",
      tags: ["notion-import", "ai-tools", "dev-tools", "research"],
    },
    {
      filePath: "Knowledge HQ/DB - To Research.md",
      description: "Research pipeline: 17 AI/dev tools being evaluated",
      tags: ["notion-import", "research-pipeline", "tools"],
    },
    {
      filePath: "Knowledge HQ/Daily Quotes_28a3e3de.md",
      description: "Daily Quotes SOP: quote request workflow",
      tags: ["notion-import", "quotes", "sop", "workflow"],
    },
    {
      filePath: "Knowledge HQ/DB - None_14.md",
      description: "AI Expert Persona Roles: 18 defined coaching/AI personas",
      tags: ["notion-import", "ai-personas", "prompts", "roles"],
    },
  ];

  for (const file of files) {
    try {
      const content = readFile(file.filePath);
      const ok = await ingestToMemory(file, content);
      if (ok) {
        console.log(`  ✓ ${file.description}`);
        summary.memoryIngested++;
      }
    } catch (e) {
      const msg = `Memory ingest failed for ${file.filePath}: ${e}`;
      console.error(`  ✗ ${msg}`);
      summary.errors.push(msg);
    }
  }
}

// ─── Step 5: Summary ──────────────────────────────────────────────────────────

function printSummary() {
  console.log("\n" + "═".repeat(50));
  console.log("📊 IMPORT SUMMARY");
  console.log("═".repeat(50));
  console.log(`  Books imported:     ${summary.booksImported}`);
  console.log(`  Books skipped:      ${summary.booksSkipped} (already existed)`);
  console.log(`  Docs created:       ${summary.docsCreated}`);
  console.log(`  Memory ingested:    ${summary.memoryIngested}`);
  console.log(`  Errors:             ${summary.errors.length}`);
  if (summary.errors.length > 0) {
    console.log("\n  ⚠ Errors:");
    summary.errors.forEach((e) => console.log(`    - ${e}`));
  }
  console.log("═".repeat(50));
  console.log("\n✅ Done. Verify in SB-OS:");
  console.log("  → /learning  (check Books tab)");
  console.log("  → /knowledge (check new docs: Trading Strategy Library, Command Board, etc.)");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🚀 SB-OS Notion Import");
  console.log(`   Source: ${NOTION_DIR}`);
  console.log(`   Target: ${BASE_URL}`);
  console.log(`   Memory: ${MEMORY_API_KEY ? "✓ key found" : "✗ no key"}`);

  // Quick health check
  try {
    await get("/api/auth/status");
  } catch {
    console.error("\n❌ Cannot reach dev server at localhost:5000");
    console.error("   Start it with: npm run dev");
    process.exit(1);
  }

  await importBooks();
  await importDocs();
  await importMemory();
  printSummary();
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
