/**
 * Web Clip Route
 *
 * POST /api/docs/clip-url - Clip a web URL into the Knowledge Hub
 */

import { Router, type Request, type Response } from "express";
import { clipUrl } from "../web-clipper";
import { storage } from "../storage";
import { processDocumentNow } from "../embedding-jobs";
import { logger } from "../logger";

const router = Router();

router.post("/clip-url", async (req: Request, res: Response) => {
  try {
    const { url, ventureId, tags, type } = req.body;

    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "URL is required" });
    }

    // Extract content from URL
    const clipped = await clipUrl(url);

    // Create doc record (dedup by title)
    const { doc, created } = await storage.createDocIfNotExists({
      title: clipped.title,
      body: clipped.body,
      type: type || "reference",
      domain: "personal",
      ventureId: ventureId || undefined,
      status: "active",
      tags: Array.isArray(tags) ? tags : [],
      metadata: clipped.metadata,
    });

    // Trigger embedding in background (only for new docs)
    if (created) {
      processDocumentNow(doc.id).catch((err) =>
        logger.debug({ err: err.message, docId: doc.id }, "Background embedding after clip failed (non-critical)")
      );
    }

    logger.info({ docId: doc.id, url, title: clipped.title }, "Web clip created");

    res.json({
      id: doc.id,
      title: doc.title,
      type: doc.type,
      wordCount: clipped.metadata.wordCount,
      sourceUrl: url,
    });
  } catch (error: any) {
    logger.error({ error: error.message, url: req.body?.url }, "Web clip failed");
    res.status(500).json({ error: error.message || "Failed to clip URL" });
  }
});

export default router;
