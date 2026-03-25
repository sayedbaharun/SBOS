/**
 * Domains Registry Routes
 * CRUD for tracking domain names across ventures
 */
import { Router, Request, Response } from "express";
import { storage } from "../storage";
import { logger } from "../logger";
import { insertDomainSchema } from "@shared/schema";
import { z } from "zod";

const router = Router();

router.get("/", async (req: Request, res: Response) => {
  try {
    const ventureId = req.query.ventureId as string | undefined;
    const status = req.query.status as string | undefined;
    const items = await storage.getDomains({ ventureId, status });
    res.json(items);
  } catch (error) {
    logger.error({ error }, "Error fetching domains");
    res.status(500).json({ error: "Failed to fetch domains" });
  }
});

router.get("/:id", async (req: Request, res: Response) => {
  try {
    const item = await storage.getDomain(String(req.params.id));
    if (!item) return res.status(404).json({ error: "Domain not found" });
    res.json(item);
  } catch (error) {
    logger.error({ error }, "Error fetching domain");
    res.status(500).json({ error: "Failed to fetch domain" });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const data = insertDomainSchema.parse(req.body);
    const item = await storage.createDomain(data);
    res.status(201).json(item);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid domain data", details: error.issues });
    } else {
      logger.error({ error }, "Error creating domain");
      res.status(500).json({ error: "Failed to create domain" });
    }
  }
});

router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const updates = insertDomainSchema.partial().parse(req.body);
    const item = await storage.updateDomain(String(req.params.id), updates);
    if (!item) return res.status(404).json({ error: "Domain not found" });
    res.json(item);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid domain data", details: error.issues });
    } else {
      logger.error({ error }, "Error updating domain");
      res.status(500).json({ error: "Failed to update domain" });
    }
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    await storage.deleteDomain(String(req.params.id));
    res.json({ success: true });
  } catch (error) {
    logger.error({ error }, "Error deleting domain");
    res.status(500).json({ error: "Failed to delete domain" });
  }
});

export default router;
