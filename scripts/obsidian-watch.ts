/**
 * Obsidian → SB-OS Knowledge Sync Watcher
 *
 * Watches the knowledge/ directory for file saves (from Obsidian or any editor)
 * and re-seeds changed documents into the SB-OS PostgreSQL DB + Qdrant vector store.
 *
 * Run: npx tsx scripts/obsidian-watch.ts
 *
 * Keep this running in a terminal tab while you edit in Obsidian.
 * Changes are live in agents within ~60 seconds (embedding cron interval).
 */

import chokidar from "chokidar";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE_DIR = path.resolve(__dirname, "../knowledge");

// Debounce map: file → timer, so rapid saves don't spam the DB
const debounceMap = new Map<string, ReturnType<typeof setTimeout>>();

async function reseedFile(filePath: string) {
  const rel = path.relative(KNOWLEDGE_DIR, filePath);

  // Only handle .md files in known seed categories
  if (!filePath.endsWith(".md")) return;

  const category = rel.split(path.sep)[0]; // e.g. "travel"

  console.log(`[obsidian-watch] 📝 Change detected: ${rel}`);

  try {
    const { storage } = await import("../server/storage.js");

    if (category === "travel") {
      const { seedTravelKnowledge } = await import("../server/seeds/travel-knowledge.js");

      // Delete existing doc with same title so it gets re-created with fresh content
      const fs = await import("fs");
      const title = titleFromFile(filePath);
      const existing = await (storage as any).findDocByTitle(title);
      if (existing) {
        await storage.deleteDoc(existing.id);
        console.log(`[obsidian-watch] 🗑  Deleted stale version of "${title}"`);
      }

      await seedTravelKnowledge(storage);
      console.log(`[obsidian-watch] ✅ Re-seeded travel knowledge — agents will see changes within ~60s`);
    } else {
      console.log(`[obsidian-watch] ⚠️  No seed handler for category "${category}" — file saved to disk only`);
    }
  } catch (err) {
    console.error(`[obsidian-watch] ❌ Reseed failed:`, err);
  }
}

function titleFromFile(filePath: string): string {
  const name = path.basename(filePath, ".md");
  // Map filename → doc title (must match what the seed uses)
  const titleMap: Record<string, string> = {
    "travel-memberships": "SB Travel Memberships",
    "oneworld-strategy": "Oneworld Alliance Strategy",
  };
  return titleMap[name] ?? name;
}

function scheduleReseed(filePath: string) {
  const existing = debounceMap.get(filePath);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    debounceMap.delete(filePath);
    reseedFile(filePath);
  }, 1500); // wait 1.5s after last save before reseeding

  debounceMap.set(filePath, timer);
}

const watcher = chokidar.watch(KNOWLEDGE_DIR, {
  persistent: true,
  ignoreInitial: true,
  ignored: /(^|[/\\])\../, // ignore dotfiles
  awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
});

watcher
  .on("change", scheduleReseed)
  .on("add", scheduleReseed)
  .on("error", (err) => console.error("[obsidian-watch] watcher error:", err));

console.log(`[obsidian-watch] 👁  Watching ${KNOWLEDGE_DIR}`);
console.log(`[obsidian-watch] Edit any file in Obsidian → DB + Qdrant auto-update\n`);
