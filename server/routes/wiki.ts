/**
 * Wiki Routes
 *
 * Auto-generated wiki articles from memory synthesis.
 * Articles stored as docs with type: 'reference' + metadata.isWiki: true
 */

import { Router, type Request, type Response } from "express";
import { logger } from "../logger";
import { storage } from "../storage";

const router = Router();

/**
 * GET /api/wiki
 * List all wiki articles.
 */
router.get("/", async (_req: Request, res: Response) => {
  try {
    const docs = await storage.getDocs({ type: "reference", limit: 200, offset: 0 });
    const wikis = docs.filter((d: any) => d.metadata?.isWiki === true);

    const summaries = wikis.map((d: any) => ({
      id: d.id,
      entityName: d.metadata?.wikiEntity ?? d.title.replace("Wiki: ", ""),
      title: d.title,
      generatedAt: d.metadata?.generatedAt,
      sourceCount: d.metadata?.sourceCount ?? 0,
      updatedAt: d.updatedAt,
      bodyPreview: (d.body ?? "").slice(0, 300),
    }));

    // Sort by generatedAt descending
    summaries.sort((a: any, b: any) =>
      new Date(b.generatedAt ?? 0).getTime() - new Date(a.generatedAt ?? 0).getTime()
    );

    res.json(summaries);
  } catch (error) {
    logger.error({ error }, "Failed to list wiki articles");
    res.status(500).json({ error: "Failed to list wiki articles" });
  }
});

/**
 * GET /api/wiki/:entityName
 * Get a specific wiki article by entity name.
 */
router.get("/:entityName", async (req: Request, res: Response) => {
  try {
    const entityName = decodeURIComponent(String(req.params.entityName));
    const docs = await storage.getDocs({ type: "reference", limit: 200, offset: 0 });
    const wiki = docs.find((d: any) => d.metadata?.isWiki && d.metadata?.wikiEntity === entityName);

    if (!wiki) {
      return res.status(404).json({ error: "No wiki found for this entity. Trigger generation first." });
    }

    res.json(wiki);
  } catch (error) {
    logger.error({ error }, "Failed to get wiki article");
    res.status(500).json({ error: "Failed to get wiki article" });
  }
});

/**
 * POST /api/wiki/generate
 * Generate (or regenerate) a wiki article for an entity.
 * Body: { entityName: string }
 */
router.post("/generate", async (req: Request, res: Response) => {
  try {
    const { entityName } = req.body as { entityName?: string };
    if (!entityName || typeof entityName !== "string") {
      return res.status(400).json({ error: "entityName is required" });
    }

    const { generateWiki } = await import("../memory/wiki-synthesizer");
    const result = await generateWiki(entityName.trim());

    res.json({
      entityName: result.entityName,
      docId: result.docId,
      created: result.created,
      sourceCount: result.sources.length,
      articlePreview: result.article.slice(0, 500),
    });
  } catch (error) {
    logger.error({ error }, "Wiki generation failed");
    res.status(500).json({ error: "Wiki generation failed" });
  }
});

/**
 * POST /api/wiki/batch
 * Generate wiki articles for top N entities.
 * Body: { limit?: number }
 */
router.post("/batch", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(String(req.body?.limit ?? "10")), 25);
    const { generateWikiBatch } = await import("../memory/wiki-synthesizer");
    const result = await generateWikiBatch(limit);
    res.json(result);
  } catch (error) {
    logger.error({ error }, "Wiki batch generation failed");
    res.status(500).json({ error: "Wiki batch generation failed" });
  }
});

/**
 * GET /api/wiki/suggestions
 * Returns entities that have memories but no wiki page yet.
 */
router.get("/suggestions", async (_req: Request, res: Response) => {
  try {
    const { db } = await import("../../db");
    const { entityRelations } = await import("@shared/schema");
    const { desc, sql } = await import("drizzle-orm");

    // Top entities by mention count
    const topEntities = await db
      .select({
        name: entityRelations.sourceName,
        mentionCount: sql<number>`sum(${entityRelations.mentionCount})`,
      })
      .from(entityRelations)
      .groupBy(entityRelations.sourceName)
      .orderBy(desc(sql<number>`sum(${entityRelations.mentionCount})`))
      .limit(50);

    // Get existing wikis
    const docs = await storage.getDocs({ type: "reference", limit: 200, offset: 0 });
    const existingWikiEntities = new Set(
      docs.filter((d: any) => d.metadata?.isWiki).map((d: any) => d.metadata?.wikiEntity)
    );

    const suggestions = topEntities
      .filter((e) => !existingWikiEntities.has(e.name))
      .slice(0, 20)
      .map((e) => ({ name: e.name, mentionCount: Number(e.mentionCount) }));

    res.json(suggestions);
  } catch (error) {
    logger.error({ error }, "Failed to get wiki suggestions");
    res.status(500).json({ error: "Failed to get wiki suggestions" });
  }
});

export default router;
