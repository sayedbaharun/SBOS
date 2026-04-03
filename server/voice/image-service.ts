/**
 * Image Analysis Service
 *
 * Uses vision-capable LLMs to analyze images from Telegram.
 * Detects intent: meal photo, receipt, whiteboard, screenshot, etc.
 * Returns structured data for downstream processing.
 */

import { logger } from "../logger";

export interface ImageAnalysis {
  description: string;
  intent: "meal" | "receipt" | "document" | "whiteboard" | "screenshot" | "general";
  structured?: Record<string, unknown>;
  labels?: string[];
}

/**
 * Analyze an image using a vision-capable model via OpenRouter.
 */
export async function analyzeImage(
  imageUrl: string,
  caption?: string
): Promise<ImageAnalysis> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY required for image analysis");
  }

  const systemPrompt = `You are an image analysis assistant for a personal OS.
Analyze the image and return a JSON object with:
- "description": Brief description of what's in the image (1-2 sentences)
- "intent": One of: "meal" (food/drink), "receipt" (purchase receipt), "document" (text document), "whiteboard" (notes/diagram), "screenshot" (app/web screenshot), "general" (anything else)
- "labels": Array of relevant tags (3-5 tags)
- "structured": Object with extracted data based on intent:
  - For "meal": { description, calories (estimate), protein (estimate in g), carbs (estimate in g), fats (estimate in g), mealType }
  - For "receipt": { store, total, currency, items (array of strings), date }
  - For "document": { title, summary, keyPoints (array) }
  - For "whiteboard": { topics (array), actionItems (array) }
  - For "screenshot": { app, summary }
  - For "general": { summary }

Return ONLY valid JSON, no markdown.`;

  const userContent: any[] = [
    {
      type: "image_url",
      image_url: { url: imageUrl },
    },
  ];

  if (caption) {
    userContent.push({
      type: "text",
      text: `User caption: "${caption}"`,
    });
  }

  userContent.push({
    type: "text",
    text: "Analyze this image and return structured JSON.",
  });

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "HTTP-Referer": process.env.SITE_URL || "http://localhost:5000",
        "X-Title": "SB-OS Vision",
      },
      body: JSON.stringify({
        model: "meta-llama/llama-4-scout:free",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        max_tokens: 1000,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Vision API error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    // Parse JSON from response (handle markdown code blocks)
    const jsonStr = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(jsonStr);

    logger.debug(
      { intent: parsed.intent, labels: parsed.labels },
      "Image analyzed"
    );

    return {
      description: parsed.description || "Image analyzed",
      intent: parsed.intent || "general",
      structured: parsed.structured,
      labels: parsed.labels,
    };
  } catch (error) {
    logger.error({ error }, "Image analysis failed");

    // Fallback: return generic result
    return {
      description: caption || "Image received",
      intent: "general",
      labels: [],
    };
  }
}
