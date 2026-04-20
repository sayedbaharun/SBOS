/**
 * Travel Knowledge Seed
 *
 * Inserts SB's travel loyalty memberships and Oneworld strategy documents
 * into the docs table so agents can find them via search_knowledge_base.
 * Also patches the chief-of-staff agent's contextMemory with a travel reference note.
 *
 * Run standalone:  SEED_STANDALONE=true npx tsx server/seeds/travel-knowledge.ts
 * Or call:         seedTravelKnowledge(storage) from an API route
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { eq } from "drizzle-orm";
import type { IStorage } from "../storage";
import { agents } from "@shared/schema";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE_DIR = path.resolve(__dirname, "../../knowledge/travel");

const TRAVEL_DOCS = [
  {
    title: "SB Travel Memberships",
    file: "travel-memberships.md",
    tags: "travel,memberships,loyalty,airlines,hotels,avios,oneworld,qatar,emirates,ihg,hilton,marriott,accor,radisson,gha,sixt,amex",
  },
  {
    title: "Oneworld Alliance Strategy",
    file: "oneworld-strategy.md",
    tags: "travel,avios,oneworld,sapphire,qatar,privilege-club,lounge,baggage,qpoints,status,award-booking,qsuites",
  },
];

const CHIEF_OF_STAFF_TRAVEL_NOTE = `
## Travel Knowledge Files
When handling travel bookings, hotel searches, flight bookings, Avios strategy, lounge access, membership numbers, or status queries — search the knowledge base for:
- "SB Travel Memberships" (loyalty numbers, tiers, expiry for all programs)
- "Oneworld Alliance Strategy" (Qatar Privilege Club / Sapphire benefits across all 15 airlines, award booking tips, status retention)
Use \`search_knowledge_base\` with queries like "membership number", "avios", "lounge access", "privilege club", "IHG", "Hilton", "Marriott".
`;

export async function seedTravelKnowledge(storageInstance: IStorage) {
  const results: { title: string; created: boolean; id: string }[] = [];

  for (const docDef of TRAVEL_DOCS) {
    const filePath = path.join(KNOWLEDGE_DIR, docDef.file);
    let body: string;
    try {
      body = fs.readFileSync(filePath, "utf-8");
    } catch {
      // File not present in this environment (e.g. Railway) — skip silently
      continue;
    }

    const { doc, created } = await storageInstance.createDocIfNotExists({
      title: docDef.title,
      type: "reference",
      domain: "personal",
      status: "active",
      body,
      tags: docDef.tags,
      isFolder: false,
      parentId: null,
      ventureId: null,
      projectId: null,
    });

    results.push({ title: doc.title, created, id: doc.id });
    console.log(created ? `✅ Created: ${doc.title} (${doc.id})` : `✓ Already exists: ${doc.title}, skipping`);
  }

  // Patch chief-of-staff contextMemory — append travel note if not already present
  const db = (storageInstance as any).db;
  const [cos] = await db
    .select({ id: agents.id, contextMemory: agents.contextMemory })
    .from(agents)
    .where(eq(agents.slug, "chief-of-staff"))
    .limit(1);

  if (cos) {
    const alreadyPatched = cos.contextMemory?.includes("Travel Knowledge Files");
    if (!alreadyPatched) {
      const updatedMemory = (cos.contextMemory || "") + CHIEF_OF_STAFF_TRAVEL_NOTE;
      await db
        .update(agents)
        .set({ contextMemory: updatedMemory })
        .where(eq(agents.id, cos.id));
      console.log("✅ Patched chief-of-staff contextMemory with travel reference");
    } else {
      console.log("✓ chief-of-staff contextMemory already has travel note, skipping");
    }
  } else {
    console.log("⚠️  chief-of-staff agent not found in DB — run POST /api/agents/admin/seed first");
  }

  return results;
}

// Standalone entrypoint — only runs when invoked directly with tsx (not when bundled by esbuild).
// esbuild sets import.meta.url to the bundle file path, making it equal to process.argv[1],
// which caused process.exit(0) to fire inside the production server and kill it silently.
// Use SEED_STANDALONE=true instead of the import.meta.url check.
if (process.env.SEED_STANDALONE === 'true') {
  (async () => {
    const { storage } = await import("../storage");
    await seedTravelKnowledge(storage);
    console.log("\nDone. Embedding cron will pick up new docs within ~1 minute.");
    process.exit(0);
  })();
}
