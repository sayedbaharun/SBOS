/**
 * AI Models Registry Routes
 * CRUD for tracking AI model providers, access, and usage
 */
import { Router, Request, Response } from "express";
import { storage } from "../storage";
import { logger } from "../logger";
import { insertAiModelSchema } from "@shared/schema";
import { z } from "zod";

const router = Router();

router.get("/", async (req: Request, res: Response) => {
  try {
    const provider = req.query.provider as string | undefined;
    const category = req.query.category as string | undefined;
    const isActive = req.query.isActive === "true" ? true : req.query.isActive === "false" ? false : undefined;
    const items = await storage.getAiModels({ provider, category, isActive });
    res.json(items);
  } catch (error) {
    logger.error({ error }, "Error fetching AI models");
    res.status(500).json({ error: "Failed to fetch AI models" });
  }
});

router.get("/:id", async (req: Request, res: Response) => {
  try {
    const item = await storage.getAiModel(String(req.params.id));
    if (!item) return res.status(404).json({ error: "AI model not found" });
    res.json(item);
  } catch (error) {
    logger.error({ error }, "Error fetching AI model");
    res.status(500).json({ error: "Failed to fetch AI model" });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const data = insertAiModelSchema.parse(req.body);
    const item = await storage.createAiModel(data);
    res.status(201).json(item);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid AI model data", details: error.issues });
    } else {
      logger.error({ error }, "Error creating AI model");
      res.status(500).json({ error: "Failed to create AI model" });
    }
  }
});

router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const updates = insertAiModelSchema.partial().parse(req.body);
    const item = await storage.updateAiModel(String(req.params.id), updates);
    if (!item) return res.status(404).json({ error: "AI model not found" });
    res.json(item);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid AI model data", details: error.issues });
    } else {
      logger.error({ error }, "Error updating AI model");
      res.status(500).json({ error: "Failed to update AI model" });
    }
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    await storage.deleteAiModel(String(req.params.id));
    res.json({ success: true });
  } catch (error) {
    logger.error({ error }, "Error deleting AI model");
    res.status(500).json({ error: "Failed to delete AI model" });
  }
});

// Seed initial models from the known providers list
router.post("/seed", async (req: Request, res: Response) => {
  try {
    const existing = await storage.getAiModels();
    if (existing.length > 0) {
      return res.json({ message: "Models already seeded", count: existing.length });
    }

    const seedModels = [
      { provider: "Anthropic", modelName: "Claude Opus 4.6", modelId: "claude-opus-4-6", category: "llm" as const, accessType: "api_key" as const, usedIn: ["Claude Code", "SB-OS agents"], isActive: true },
      { provider: "Anthropic", modelName: "Claude Sonnet 4.6", modelId: "claude-sonnet-4-6", category: "llm" as const, accessType: "api_key" as const, usedIn: ["SB-OS agents"], isActive: true },
      { provider: "Anthropic", modelName: "Claude Haiku 4.5", modelId: "claude-haiku-4-5-20251001", category: "llm" as const, accessType: "api_key" as const, usedIn: [], isActive: true },
      { provider: "OpenAI", modelName: "GPT-4o", category: "llm" as const, accessType: "api_key" as const, isActive: true },
      { provider: "Google", modelName: "Gemini Flash Lite", category: "llm" as const, accessType: "api_key" as const, usedIn: ["Task Automation Scout"], isActive: true },
      { provider: "Google", modelName: "Gemini Pro", category: "llm" as const, accessType: "api_key" as const, isActive: true },
      { provider: "xAI", modelName: "Grok", category: "llm" as const, accessType: "api_key" as const, isActive: false },
      { provider: "Moonshot", modelName: "Kimi K", category: "llm" as const, accessType: "api_key" as const, isActive: false },
      { provider: "Minimax", modelName: "Minimax", category: "llm" as const, accessType: "api_key" as const, isActive: false },
      { provider: "Xiaomi", modelName: "Mimo", category: "llm" as const, accessType: "api_key" as const, isActive: false },
      { provider: "NVIDIA", modelName: "Nemotron", category: "llm" as const, accessType: "api_key" as const, isActive: false },
      { provider: "DeepSeek", modelName: "DeepSeek", category: "llm" as const, accessType: "api_key" as const, isActive: false },
      { provider: "Alibaba", modelName: "Qwen", category: "llm" as const, accessType: "api_key" as const, isActive: false },
      { provider: "ZAI", modelName: "GLM", category: "llm" as const, accessType: "api_key" as const, isActive: false },
      { provider: "Lovart", modelName: "Lovart", category: "image" as const, accessType: "paid" as const, isActive: true },
      { provider: "OpenRouter", modelName: "Multi-model Gateway", category: "other" as const, accessType: "api_key" as const, usedIn: ["SB-OS agents", "embeddings"], isActive: true, notes: "Routes to multiple providers" },
    ];

    const created = [];
    for (const model of seedModels) {
      const item = await storage.createAiModel(model);
      created.push(item);
    }

    res.status(201).json({ message: `Seeded ${created.length} models`, count: created.length });
  } catch (error) {
    logger.error({ error }, "Error seeding AI models");
    res.status(500).json({ error: "Failed to seed AI models" });
  }
});

export default router;
