/**
 * Telegram NLP Handler
 *
 * Detects natural language logging messages (morning rituals, workouts, nutrition)
 * and routes them directly to storage, bypassing the agent system for speed.
 * Uses GPT-4o-mini for structured extraction (same pattern as macro estimation).
 */

import { logger } from "../logger";
import { storage } from "../storage";

// ============================================================================
// KEYWORD GATES (zero-cost rejection for non-logging messages)
// ============================================================================

const RITUAL_KEYWORDS = [
  "press ups", "pressups", "push ups", "pushups", "squats",
  "supplements", "reading", "read", "pages", "morning ritual",
];
const WORKOUT_KEYWORDS = [
  "workout", "trained", "gym", "ran", "cardio", "strength",
  "yoga", "walked", "exercise", "hiit", "run",
];
const NUTRITION_KEYWORDS = [
  "ate", "had for", "breakfast", "lunch", "dinner", "snack",
  "meal", "calories", "protein",
];

function matchesKeywords(text: string): "ritual" | "workout" | "nutrition" | null {
  const lower = text.toLowerCase();
  // Check ritual first (most specific)
  if (RITUAL_KEYWORDS.some((kw) => lower.includes(kw))) return "ritual";
  if (WORKOUT_KEYWORDS.some((kw) => lower.includes(kw))) return "workout";
  if (NUTRITION_KEYWORDS.some((kw) => lower.includes(kw))) return "nutrition";
  return null;
}

// ============================================================================
// LLM EXTRACTION
// ============================================================================

const SYSTEM_PROMPT = `You are a personal logging assistant. Parse the user's natural language message into structured data.

Determine the intent and return ONLY valid JSON (no markdown, no explanation) in one of these shapes:

1. Morning ritual update:
{"intent":"morning_ritual","rituals":{"pressUps":{"done":true,"reps":15},"squats":{"done":true,"reps":10},"reading":{"done":true,"pages":10},"supplements":{"done":true}}}
Only include rituals the user actually mentioned. Possible keys: pressUps, squats, reading, supplements.

2. Workout log:
{"intent":"workout","workoutType":"strength","durationMin":45,"notes":"Upper body focus"}
workoutType must be one of: strength, cardio, yoga, sports, none.

3. Nutrition log:
{"intent":"nutrition","mealType":"lunch","description":"Chicken shawarma wrap with hummus","calories":650,"proteinG":42,"carbsG":55,"fatsG":18}
mealType must be one of: breakfast, lunch, dinner, snack. Estimate macros based on typical portions.

If the message doesn't clearly describe a ritual, workout, or meal, return: {"intent":"none"}`;

async function extractStructured(text: string): Promise<any> {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY not configured");
  }

  const OpenAI = (await import("openai")).default;
  const openai = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
  });

  const completion = await openai.chat.completions.create({
    model: "openai/gpt-4o-mini",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: text },
    ],
    temperature: 0.2,
    max_tokens: 400,
  });

  const raw = completion.choices[0]?.message?.content || "";
  const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  return JSON.parse(cleaned);
}

// ============================================================================
// STORAGE HANDLERS
// ============================================================================

async function handleMorningRitual(rituals: Record<string, any>): Promise<string> {
  const today = new Date().toISOString().split("T")[0];
  const day = await storage.getDayOrCreate(today);

  // Merge with existing rituals (don't overwrite)
  const existing = (day.morningRituals as Record<string, any>) ?? {};
  const merged = { ...existing, ...rituals };

  // Check if all four are done
  const allDone =
    merged.pressUps?.done &&
    merged.squats?.done &&
    merged.reading?.done &&
    merged.supplements?.done;
  if (allDone && !merged.completedAt) {
    merged.completedAt = new Date().toISOString();
  }

  await storage.updateDay(today, { morningRituals: merged } as any);

  // Build confirmation
  const parts: string[] = [];
  if (rituals.pressUps?.done) parts.push(`Press-ups: ${rituals.pressUps.reps ?? "done"}`);
  if (rituals.squats?.done) parts.push(`Squats: ${rituals.squats.reps ?? "done"}`);
  if (rituals.reading?.done) parts.push(`Reading: ${rituals.reading.pages ? `${rituals.reading.pages} pages` : "done"}`);
  if (rituals.supplements?.done) parts.push("Supplements: done");

  let response = `Morning ritual logged:\n${parts.map((p) => `  ✅ ${p}`).join("\n")}`;
  if (allDone) response += "\n\n🎉 All morning rituals complete!";
  return response;
}

async function handleWorkout(data: {
  workoutType: string;
  durationMin?: number;
  notes?: string;
}): Promise<string> {
  const today = new Date().toISOString().split("T")[0];
  const day = await storage.getDayOrCreate(today);

  await storage.createHealthEntry({
    dayId: day.id,
    date: today,
    workoutDone: true,
    workoutType: data.workoutType as any,
    workoutDurationMin: data.durationMin ?? null,
    notes: data.notes ?? null,
  } as any);

  const parts = [`Type: ${data.workoutType}`];
  if (data.durationMin) parts.push(`Duration: ${data.durationMin} min`);
  if (data.notes) parts.push(`Notes: ${data.notes}`);

  return `Workout logged:\n${parts.map((p) => `  💪 ${p}`).join("\n")}`;
}

async function handleNutrition(data: {
  mealType: string;
  description: string;
  calories?: number;
  proteinG?: number;
  carbsG?: number;
  fatsG?: number;
}): Promise<string> {
  const today = new Date().toISOString().split("T")[0];
  const day = await storage.getDayOrCreate(today);

  await storage.createNutritionEntry({
    dayId: day.id,
    datetime: new Date(),
    mealType: data.mealType as any,
    description: data.description,
    calories: data.calories ?? null,
    proteinG: data.proteinG ?? null,
    carbsG: data.carbsG ?? null,
    fatsG: data.fatsG ?? null,
  } as any);

  const parts = [`${data.mealType}: ${data.description}`];
  if (data.calories) parts.push(`Calories: ${data.calories} kcal`);
  if (data.proteinG) parts.push(`Protein: ${data.proteinG}g`);
  if (data.carbsG) parts.push(`Carbs: ${data.carbsG}g`);
  if (data.fatsG) parts.push(`Fats: ${data.fatsG}g`);

  return `Nutrition logged:\n${parts.map((p) => `  🍽 ${p}`).join("\n")}`;
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

export async function detectAndHandleLog(
  text: string
): Promise<{ handled: boolean; response?: string }> {
  // Step 1: Quick keyword gate
  const category = matchesKeywords(text);
  if (!category) return { handled: false };

  try {
    // Step 2: LLM structured extraction
    const parsed = await extractStructured(text);

    if (!parsed?.intent || parsed.intent === "none") {
      return { handled: false };
    }

    // Step 3: Route to storage handler
    let response: string;

    switch (parsed.intent) {
      case "morning_ritual":
        response = await handleMorningRitual(parsed.rituals);
        break;
      case "workout":
        response = await handleWorkout({
          workoutType: parsed.workoutType || "strength",
          durationMin: parsed.durationMin,
          notes: parsed.notes,
        });
        break;
      case "nutrition":
        response = await handleNutrition({
          mealType: parsed.mealType || "snack",
          description: parsed.description || text,
          calories: parsed.calories,
          proteinG: parsed.proteinG,
          carbsG: parsed.carbsG,
          fatsG: parsed.fatsG,
        });
        break;
      default:
        return { handled: false };
    }

    logger.info({ intent: parsed.intent }, "NLP log handled via Telegram");
    return { handled: true, response };
  } catch (error: any) {
    logger.error({ error: error.message, text }, "NLP handler error");
    // Fall through to agent system on error
    return { handled: false };
  }
}
