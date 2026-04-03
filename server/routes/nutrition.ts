/**
 * Nutrition Routes
 * CRUD operations for nutrition entries + AI macro estimation
 */
import { Router, Request, Response } from "express";
import { storage } from "../storage";
import { logger } from "../logger";
import { insertNutritionEntrySchema } from "@shared/schema";
import { z } from "zod";

const router = Router();

// Get nutrition entries (with date filter)
router.get("/", async (req: Request, res: Response) => {
  try {
    const filters = {
      dayId: req.query.dayId as string,
      date: req.query.date as string,
    };

    const cleanFilters = Object.fromEntries(
      Object.entries(filters).filter(([_, value]) => value !== undefined)
    );

    const entries = await storage.getNutritionEntries(cleanFilters);
    res.json(entries);
  } catch (error) {
    logger.error({ error }, "Error fetching nutrition entries");
    res.status(500).json({ error: "Failed to fetch nutrition entries" });
  }
});

// Get single nutrition entry
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const entry = await storage.getNutritionEntry(req.params.id);
    if (!entry) {
      return res.status(404).json({ error: "Nutrition entry not found" });
    }
    res.json(entry);
  } catch (error) {
    logger.error({ error }, "Error fetching nutrition entry");
    res.status(500).json({ error: "Failed to fetch nutrition entry" });
  }
});

// Create nutrition entry (auto-link to Day)
router.post("/", async (req: Request, res: Response) => {
  try {
    const validatedData = insertNutritionEntrySchema.parse(req.body);

    // Extract date from datetime to find/create Day
    const date = new Date(validatedData.datetime).toISOString().split('T')[0];
    const day = await storage.getDayOrCreate(date);

    // Create nutrition entry with linked dayId
    const entry = await storage.createNutritionEntry({
      ...validatedData,
      dayId: day.id,
    } as any);

    res.status(201).json(entry);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid nutrition entry data", details: error.errors });
    } else {
      logger.error({ error }, "Error creating nutrition entry");
      res.status(500).json({ error: "Failed to create nutrition entry" });
    }
  }
});

// Update nutrition entry
router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const updates = insertNutritionEntrySchema.partial().parse(req.body);
    const entry = await storage.updateNutritionEntry(req.params.id, updates);
    if (!entry) {
      return res.status(404).json({ error: "Nutrition entry not found" });
    }
    res.json(entry);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid nutrition entry data", details: error.errors });
    } else {
      logger.error({ error }, "Error updating nutrition entry");
      res.status(500).json({ error: "Failed to update nutrition entry" });
    }
  }
});

// Delete nutrition entry
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    await storage.deleteNutritionEntry(req.params.id);
    res.json({ success: true });
  } catch (error) {
    logger.error({ error }, "Error deleting nutrition entry");
    res.status(500).json({ error: "Failed to delete nutrition entry" });
  }
});

// Estimate macros using AI
router.post("/estimate-macros", async (req: Request, res: Response) => {
  try {
    const { description } = req.body;

    if (!description || typeof description !== 'string') {
      return res.status(400).json({ error: "Description is required" });
    }

    // Check if OpenRouter API key is configured
    if (!process.env.OPENROUTER_API_KEY) {
      return res.status(503).json({
        error: "AI service not configured",
        message: "OpenRouter API key is not set. Please configure OPENROUTER_API_KEY environment variable."
      });
    }

    const OpenAI = (await import("openai")).default;
    const openai = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
    });

    const completion = await openai.chat.completions.create({
      model: "meta-llama/llama-4-scout:free",
      messages: [
        {
          role: "system",
          content: `You are a nutrition expert. Given a meal description, estimate the nutritional macros.
Return ONLY a JSON object with these exact fields:
- calories: number (total kcal)
- proteinG: number (grams of protein)
- carbsG: number (grams of carbohydrates)
- fatsG: number (grams of fat)
- confidence: "low" | "medium" | "high" (how confident you are in the estimate)
- notes: string (brief explanation or assumptions made)

Base your estimates on typical portion sizes unless specified. Be conservative and realistic.
Return ONLY valid JSON, no markdown or explanation outside the JSON.`
        },
        {
          role: "user",
          content: `Estimate the nutritional macros for: ${description}`
        }
      ],
      temperature: 0.3,
      max_tokens: 300,
    });

    const responseText = completion.choices[0]?.message?.content || "";

    // Parse JSON response
    try {
      // Clean the response - remove any markdown code blocks if present
      const cleanedResponse = responseText
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      const macros = JSON.parse(cleanedResponse);

      // Validate the response has required fields
      if (typeof macros.calories !== 'number' ||
        typeof macros.proteinG !== 'number' ||
        typeof macros.carbsG !== 'number' ||
        typeof macros.fatsG !== 'number') {
        throw new Error("Invalid macro values");
      }

      res.json(macros);
    } catch (parseError) {
      logger.error({ parseError, responseText }, "Failed to parse AI macro response");
      res.status(500).json({
        error: "Failed to parse AI response",
        message: "The AI returned an invalid response format"
      });
    }
  } catch (error: any) {
    logger.error({ error }, "Error estimating macros");

    if (error?.status === 401) {
      res.status(503).json({
        error: "AI service authentication failed",
        message: "Invalid OpenAI API key"
      });
    } else if (error?.status === 429) {
      res.status(429).json({
        error: "Rate limited",
        message: "Too many requests. Please try again in a moment."
      });
    } else {
      res.status(500).json({ error: "Failed to estimate macros" });
    }
  }
});

export default router;
