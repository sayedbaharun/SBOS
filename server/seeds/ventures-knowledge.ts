/**
 * Ventures Knowledge Seed
 *
 * Inserts per-venture knowledge files into the docs table so agents
 * can find them via search_knowledge_base.
 * Also patches the chief-of-staff agent's contextMemory with a ventures reference note.
 *
 * Run standalone:  npx tsx server/seeds/ventures-knowledge.ts
 * Or call:         seedVenturesKnowledge(storage) from an API route / obsidian-watch
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { eq } from "drizzle-orm";
import type { IStorage } from "../storage";
import { agents } from "@shared/schema";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE_DIR = path.resolve(__dirname, "../../knowledge/ventures");

const VENTURE_DOCS = [
  {
    title: "SyntheLIQ AI — Venture Knowledge",
    file: "syntheliq.md",
    tags: "syntheliq,ai-automation,saas,b2b,agency,uae,gcc,arabic,agents,stripe,railway,neon,ventures",
  },
  {
    title: "Aivant Realty — Venture Knowledge",
    file: "aivant-realty.md",
    tags: "aivant,realty,dubai,real-estate,off-plan,rera,investment,property,uae,arabic,luxury,ventures",
  },
  {
    title: "Trading — Venture Knowledge",
    file: "trading.md",
    tags: "trading,forex,indices,journal,checklist,london-session,new-york-session,killzone,pnl,discipline,ventures",
  },
  {
    title: "My Sigma Mindset — Venture Knowledge",
    file: "sigma-mindset.md",
    tags: "sigma,mindset,faceless,content,tiktok,youtube-shorts,instagram-reels,self-improvement,discipline,media,ventures",
  },
  {
    title: "Personal Brand — Venture Knowledge",
    file: "personal-brand.md",
    tags: "personal-brand,thought-leadership,linkedin,twitter,instagram,dubai,founder,ai-automation,content,offer-ladder,mena,ventures",
  },
];

const CHIEF_OF_STAFF_VENTURES_NOTE = `
## Venture Knowledge Files
When answering questions about any of Sayed's ventures, search the knowledge base for the relevant venture file:
- "SyntheLIQ AI — Venture Knowledge" (B2B AI automation agency, agents, Stripe, distribution blockers)
- "Aivant Realty — Venture Knowledge" (Dubai real estate, off-plan, RERA, luxury)
- "Trading — Venture Knowledge" (forex/indices, session trading, SB-OS trading module)
- "My Sigma Mindset — Venture Knowledge" (faceless content brand, TikTok/YouTube/Instagram, sigma content)
- "Personal Brand — Venture Knowledge" (founder brand, May 2026 launch, offer ladder)
Use \`search_knowledge_base\` with the venture name or relevant keywords.
`;

export async function seedVenturesKnowledge(storageInstance: IStorage) {
  const results: { title: string; created: boolean; id: string }[] = [];

  for (const docDef of VENTURE_DOCS) {
    const filePath = path.join(KNOWLEDGE_DIR, docDef.file);
    if (!fs.existsSync(filePath)) {
      console.log(`⚠️  File not found, skipping: ${docDef.file}`);
      continue;
    }
    const body = fs.readFileSync(filePath, "utf-8");

    const { doc, created } = await storageInstance.createDocIfNotExists({
      title: docDef.title,
      type: "reference",
      domain: "venture_ops",
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

  // Patch chief-of-staff contextMemory — append ventures note if not already present
  const db = (storageInstance as any).db;
  const [cos] = await db
    .select({ id: agents.id, contextMemory: agents.contextMemory })
    .from(agents)
    .where(eq(agents.slug, "chief-of-staff"))
    .limit(1);

  if (cos) {
    const alreadyPatched = cos.contextMemory?.includes("Venture Knowledge Files");
    if (!alreadyPatched) {
      const updatedMemory = (cos.contextMemory || "") + CHIEF_OF_STAFF_VENTURES_NOTE;
      await db
        .update(agents)
        .set({ contextMemory: updatedMemory })
        .where(eq(agents.id, cos.id));
      console.log("✅ Patched chief-of-staff contextMemory with ventures reference");
    } else {
      console.log("✓ chief-of-staff contextMemory already has ventures note, skipping");
    }
  } else {
    console.log("⚠️  chief-of-staff agent not found in DB — run POST /api/agents/admin/seed first");
  }

  return results;
}

// Standalone entrypoint
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  (async () => {
    const { storage } = await import("../storage");
    await seedVenturesKnowledge(storage);
    console.log("\nDone. Embedding cron will pick up new docs within ~1 minute.");
    process.exit(0);
  })();
}
