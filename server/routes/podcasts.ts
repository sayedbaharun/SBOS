/**
 * Podcasts Routes
 * CRUD operations for podcast listening list
 */
import { Router, Request, Response } from "express";
import { storage } from "../storage";
import { logger } from "../logger";
import { insertPodcastSchema } from "@shared/schema";
import { z } from "zod";

const router = Router();

// Get all podcasts
router.get("/", async (req: Request, res: Response) => {
  try {
    const status = req.query.status as string;
    const podcastList = await storage.getPodcasts(status ? { status } : undefined);
    res.json(podcastList);
  } catch (error) {
    logger.error({ error }, "Error fetching podcasts");
    res.status(500).json({ error: "Failed to fetch podcasts" });
  }
});

// Get single podcast
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const podcast = await storage.getPodcast(String(req.params.id));
    if (!podcast) {
      return res.status(404).json({ error: "Podcast not found" });
    }
    res.json(podcast);
  } catch (error) {
    logger.error({ error }, "Error fetching podcast");
    res.status(500).json({ error: "Failed to fetch podcast" });
  }
});

// Create podcast
router.post("/", async (req: Request, res: Response) => {
  try {
    const validatedData = insertPodcastSchema.parse(req.body);
    const podcast = await storage.createPodcast(validatedData);
    res.status(201).json(podcast);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid podcast data", details: error.issues });
    } else {
      logger.error({ error }, "Error creating podcast");
      res.status(500).json({ error: "Failed to create podcast" });
    }
  }
});

// Update podcast
router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const updates = insertPodcastSchema.partial().parse(req.body);
    const podcast = await storage.updatePodcast(String(req.params.id), updates);
    if (!podcast) {
      return res.status(404).json({ error: "Podcast not found" });
    }
    res.json(podcast);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid podcast data", details: error.issues });
    } else {
      logger.error({ error }, "Error updating podcast");
      res.status(500).json({ error: "Failed to update podcast" });
    }
  }
});

// Delete podcast
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    await storage.deletePodcast(String(req.params.id));
    res.json({ success: true });
  } catch (error) {
    logger.error({ error }, "Error deleting podcast");
    res.status(500).json({ error: "Failed to delete podcast" });
  }
});

export default router;
