/**
 * Telegram NLP Handler
 *
 * Detects natural language logging messages and routes them directly to storage,
 * bypassing the agent system for speed.
 *
 * Supports COMBINED messages — a single text can log multiple things at once:
 *   "morning done, slept 7h good, energy 4, weight 82kg, push day 45 mins"
 *   → rituals + health entry + workout, all in one shot
 *
 * Uses GPT-4o-mini for structured extraction.
 */

import { logger } from "../logger";
import { storage } from "../storage";
import { getUserDate } from "../utils/dates";

// ============================================================================
// KEYWORD GATES (zero-cost rejection for non-logging messages)
// ============================================================================

const RITUAL_KEYWORDS = [
  "press ups", "pressups", "push ups", "pushups", "squats",
  "supplements", "water", "drank", "hydration", "500ml", "morning ritual",
];
const WORKOUT_KEYWORDS = [
  "workout", "trained", "gym", "ran", "cardio", "strength",
  "yoga", "walked", "exercise", "hiit", "run",
  "push day", "pull day", "leg day", "upper body", "lower body",
  "chest day", "back day", "shoulder day", "arm day",
];
const NUTRITION_KEYWORDS = [
  "ate", "had for", "breakfast", "lunch", "dinner", "snack",
  "meal", "calories", "protein",
];
const HEALTH_KEYWORDS = [
  "slept", "sleep", "hours sleep", "energy", "mood", "stress",
  "weight", "weigh", "kg", "lbs",
  "fasting", "fasted", "broke fast", "break fast", "intermittent",
  "fast started", "fast ended", "eating window",
];

// "morning done" shortcut patterns — exact match, no LLM call needed
const MORNING_DONE_PATTERNS = [
  "morning done", "morning complete", "rituals done", "habits done",
];

function isMorningDoneShortcut(text: string): boolean {
  const lower = text.toLowerCase().trim();
  // Exact match only if the message is short (no extra data appended)
  return MORNING_DONE_PATTERNS.includes(lower);
}

// Check if message is a "morning done + extra data" combo
function isMorningDoneCombo(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return MORNING_DONE_PATTERNS.some((p) => lower.startsWith(p)) && lower.length > 20;
}

async function handleMorningDoneShortcut(): Promise<string> {
  const today = getUserDate();
  const day = await storage.getDayOrCreate(today);
  const existing = (day.morningRituals as Record<string, any>) ?? {};

  const merged = {
    ...existing,
    pressUps: { ...existing.pressUps, done: true, reps: existing.pressUps?.reps ?? 50 },
    squats: { ...existing.squats, done: true, reps: existing.squats?.reps ?? 50 },
    supplements: { done: true },
    water: { done: true },
    completedAt: new Date().toISOString(),
  };

  await storage.updateDay(today, { morningRituals: merged } as any);

  return `All morning rituals marked done! ✅\n  ✅ Press-ups: ${merged.pressUps.reps}\n  ✅ Squats: ${merged.squats.reps}\n  ✅ Supplements: done\n  ✅ Water: done\n\n🎉 All morning rituals complete!`;
}

function matchesAnyKeyword(text: string): boolean {
  const lower = text.toLowerCase();
  const allKeywords = [...RITUAL_KEYWORDS, ...WORKOUT_KEYWORDS, ...NUTRITION_KEYWORDS, ...HEALTH_KEYWORDS];
  return allKeywords.some((kw) => lower.includes(kw));
}

// ============================================================================
// LLM EXTRACTION (supports combined/multi-intent messages)
// ============================================================================

const SYSTEM_PROMPT = `You are a personal logging assistant. Parse the user's natural language message into structured data.

IMPORTANT: A single message can contain MULTIPLE intents. Extract ALL of them.

Return ONLY valid JSON (no markdown, no explanation) as an object with an "intents" array:

{"intents": [ ... one or more intent objects ... ]}

Possible intent shapes:

1. Morning ritual update:
{"intent":"morning_ritual","rituals":{"pressUps":{"done":true,"reps":15},"squats":{"done":true,"reps":10},"water":{"done":true},"supplements":{"done":true}}}
Only include rituals the user actually mentioned. Possible keys: pressUps, squats, water, supplements.
If user says "morning done" or similar, mark all four as done with default reps of 50.
IMPORTANT: "water" means hydration/drinking water. "supplements" means vitamins/pills/capsules.

2. Health/sleep log:
{"intent":"health_log","sleepHours":7.5,"sleepQuality":"good","energyLevel":4,"mood":"high","stressLevel":"low","weightKg":82,"fasting":{"status":"started","hours":16,"window":"16:8"}}
Only include fields the user actually mentioned.
- sleepQuality: "poor", "fair", "good", "excellent"
- energyLevel: 1-5
- mood: "low", "medium", "high", "peak"
- stressLevel: "low", "medium", "high"
- weightKg: number in kg (convert from lbs if needed: lbs / 2.205)
- fasting.status: "started" (beginning fast), "ended" (broke fast), "active" (currently fasting)
- fasting.hours: target or completed fasting hours
- fasting.window: fasting pattern like "16:8", "18:6", "20:4"

3. Workout log:
{"intent":"workout","workoutType":"strength","durationMin":45,"notes":"Push day - chest, shoulders, triceps"}
workoutType must be one of: strength, cardio, yoga, sports, none.
Interpret gym-specific language: "push day" = strength, "pull day" = strength, "leg day" = strength, "cardio day" = cardio.
Include the specific focus in notes (e.g., "push day" → notes: "Push day").

4. Nutrition log:
{"intent":"nutrition","mealType":"lunch","description":"Chicken shawarma wrap with hummus","calories":650,"proteinG":42,"carbsG":55,"fatsG":18}
mealType must be one of: breakfast, lunch, dinner, snack. Estimate macros based on typical portions.

Examples of combined messages:
- "morning done, slept 7h good quality, energy 4" → morning_ritual + health_log
- "weight 82kg, push day 45 mins" → health_log + workout
- "slept 6 hours, mood low, had eggs for breakfast 350cal" → health_log + nutrition
- "morning done slept 8h energy 5 mood peak weight 81kg" → morning_ritual + health_log

If nothing matches, return: {"intents":[]}`;

async function extractStructured(text: string): Promise<{ intents: any[] }> {
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
    max_tokens: 600,
  });

  const raw = completion.choices[0]?.message?.content || "";
  const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  return JSON.parse(cleaned);
}

// ============================================================================
// STORAGE HANDLERS
// ============================================================================

async function handleMorningRitual(rituals: Record<string, any>): Promise<string> {
  const today = getUserDate();
  const day = await storage.getDayOrCreate(today);

  // Merge with existing rituals (don't overwrite)
  const existing = (day.morningRituals as Record<string, any>) ?? {};
  const merged = { ...existing, ...rituals };

  // Check if all four are done
  const allDone =
    merged.pressUps?.done &&
    merged.squats?.done &&
    merged.water?.done &&
    merged.supplements?.done;
  if (allDone && !merged.completedAt) {
    merged.completedAt = new Date().toISOString();
  }

  await storage.updateDay(today, { morningRituals: merged } as any);

  // Build confirmation
  const parts: string[] = [];
  if (rituals.pressUps?.done) parts.push(`Press-ups: ${rituals.pressUps.reps ?? "done"}`);
  if (rituals.squats?.done) parts.push(`Squats: ${rituals.squats.reps ?? "done"}`);
  if (rituals.water?.done) parts.push("Water: done");
  if (rituals.supplements?.done) parts.push("Supplements: done");

  let response = `Morning ritual logged:\n${parts.map((p) => `  ✅ ${p}`).join("\n")}`;
  if (allDone) response += "\n\n🎉 All morning rituals complete!";
  return response;
}

async function handleHealthLog(data: {
  sleepHours?: number;
  sleepQuality?: string;
  energyLevel?: number;
  mood?: string;
  stressLevel?: string;
  weightKg?: number;
  fasting?: { status?: string; hours?: number; window?: string };
}): Promise<string> {
  const today = getUserDate();
  const day = await storage.getDayOrCreate(today);

  // Check if health entry already exists for today — update it instead of creating duplicate
  const existingEntries = await storage.getHealthEntries({ dateGte: today, dateLte: today });
  const existing = existingEntries[0];

  const healthData: Record<string, any> = {
    dayId: day.id,
    date: today,
  };
  if (data.sleepHours !== undefined) healthData.sleepHours = data.sleepHours;
  if (data.sleepQuality) healthData.sleepQuality = data.sleepQuality;
  if (data.energyLevel !== undefined) healthData.energyLevel = data.energyLevel;
  if (data.mood) healthData.mood = data.mood;
  if (data.stressLevel) healthData.stressLevel = data.stressLevel;
  if (data.weightKg !== undefined) healthData.weightKg = data.weightKg;

  // Store fasting data in notes (structured)
  if (data.fasting) {
    const fastingNote = [
      data.fasting.status ? `Fasting: ${data.fasting.status}` : null,
      data.fasting.hours ? `${data.fasting.hours}h` : null,
      data.fasting.window ? `(${data.fasting.window})` : null,
    ].filter(Boolean).join(" ");
    healthData.notes = existing?.notes
      ? `${existing.notes}\n${fastingNote}`
      : fastingNote;
  }

  if (existing) {
    await storage.updateHealthEntry(existing.id, healthData);
  } else {
    await storage.createHealthEntry(healthData as any);
  }

  // Also update day mood if provided
  if (data.mood) {
    await storage.updateDay(today, { mood: data.mood } as any);
  }

  // Build confirmation
  const parts: string[] = [];
  if (data.sleepHours !== undefined) parts.push(`Sleep: ${data.sleepHours}h${data.sleepQuality ? ` (${data.sleepQuality})` : ""}`);
  if (data.energyLevel !== undefined) parts.push(`Energy: ${data.energyLevel}/5`);
  if (data.mood) parts.push(`Mood: ${data.mood}`);
  if (data.stressLevel) parts.push(`Stress: ${data.stressLevel}`);
  if (data.weightKg !== undefined) parts.push(`Weight: ${data.weightKg}kg`);
  if (data.fasting) {
    const fParts = [data.fasting.status, data.fasting.hours ? `${data.fasting.hours}h` : null, data.fasting.window].filter(Boolean);
    parts.push(`Fasting: ${fParts.join(" ")}`);
  }

  return `Health logged:\n${parts.map((p) => `  📊 ${p}`).join("\n")}`;
}

async function handleWorkout(data: {
  workoutType: string;
  durationMin?: number;
  notes?: string;
}): Promise<string> {
  const today = getUserDate();
  const day = await storage.getDayOrCreate(today);

  // Check if health entry exists — update workout fields, or create new
  const existingEntries = await storage.getHealthEntries({ dateGte: today, dateLte: today });
  const existing = existingEntries[0];

  const workoutData: Record<string, any> = {
    workoutDone: true,
    workoutType: data.workoutType,
    workoutDurationMin: data.durationMin ?? null,
  };

  if (existing) {
    // Merge workout into existing health entry
    const updateData: Record<string, any> = { ...workoutData };
    if (data.notes) {
      updateData.notes = existing.notes
        ? `${existing.notes}\nWorkout: ${data.notes}`
        : `Workout: ${data.notes}`;
    }
    await storage.updateHealthEntry(existing.id, updateData);
  } else {
    await storage.createHealthEntry({
      dayId: day.id,
      date: today,
      ...workoutData,
      notes: data.notes ?? null,
    } as any);
  }

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
  const today = getUserDate();
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
// CONVERSATION PERSISTENCE (store NLP interactions for memory/learning)
// ============================================================================

/**
 * Log NLP interactions as agent conversations so they appear in conversation
 * history and trigger learning extraction. Uses chief-of-staff as the agent.
 */
async function logNlpConversation(userMessage: string, assistantResponse: string): Promise<void> {
  try {
    const { loadAgent } = await import("../agents/agent-registry");
    const agent = await loadAgent("chief-of-staff");
    if (!agent) return;

    // Lazy DB access
    const { storage: st } = await import("../storage");
    const db = (st as any).db;
    const { agentConversations } = await import("@shared/schema");

    // Insert user message
    await db.insert(agentConversations).values({
      agentId: agent.id,
      role: "user" as const,
      content: userMessage,
      metadata: { source: "telegram-nlp", channel: "telegram" },
    });

    // Insert assistant response
    await db.insert(agentConversations).values({
      agentId: agent.id,
      role: "assistant" as const,
      content: assistantResponse,
      metadata: { source: "telegram-nlp", channel: "telegram" },
    });

    // Fire learning extraction (fire-and-forget)
    const { extractConversationLearnings } = await import("../agents/learning-extractor");
    extractConversationLearnings({
      agentId: agent.id,
      agentSlug: "chief-of-staff",
      userMessage,
      assistantResponse,
    }).catch((err: any) =>
      logger.warn({ error: err.message }, "NLP learning extraction failed (non-critical)")
    );

    // Fire entity relation extraction (fire-and-forget)
    import("../memory/entity-linker").then(({ extractEntityRelations }) =>
      extractEntityRelations({ userMessage, assistantResponse })
        .catch(() => {})
    ).catch(() => {});
  } catch (error: any) {
    // Non-critical — don't break the NLP response
    logger.warn({ error: error.message }, "Failed to log NLP conversation (non-critical)");
  }
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

export async function detectAndHandleLog(
  text: string
): Promise<{ handled: boolean; response?: string }> {
  // Step 0: "morning done" shortcut — exact match only, instant, no LLM call
  if (isMorningDoneShortcut(text)) {
    try {
      const response = await handleMorningDoneShortcut();
      logger.info("Morning done shortcut handled via Telegram");
      logNlpConversation(text, response).catch(() => {});
      return { handled: true, response };
    } catch (error: any) {
      logger.error({ error: error.message }, "Morning done shortcut error");
      return { handled: false };
    }
  }

  // Step 1: Quick keyword gate — also check for "morning done + extra" combos
  const hasKeywords = matchesAnyKeyword(text);
  const isCombo = isMorningDoneCombo(text);
  if (!hasKeywords && !isCombo) return { handled: false };

  try {
    // Step 2: LLM structured extraction (multi-intent)
    const parsed = await extractStructured(text);

    if (!parsed?.intents || parsed.intents.length === 0) {
      return { handled: false };
    }

    // Step 3: Process ALL intents and collect responses
    const responses: string[] = [];

    for (const intent of parsed.intents) {
      switch (intent.intent) {
        case "morning_ritual":
          responses.push(await handleMorningRitual(intent.rituals));
          break;
        case "health_log":
          responses.push(await handleHealthLog({
            sleepHours: intent.sleepHours,
            sleepQuality: intent.sleepQuality,
            energyLevel: intent.energyLevel,
            mood: intent.mood,
            stressLevel: intent.stressLevel,
            weightKg: intent.weightKg,
            fasting: intent.fasting,
          }));
          break;
        case "workout":
          responses.push(await handleWorkout({
            workoutType: intent.workoutType || "strength",
            durationMin: intent.durationMin,
            notes: intent.notes,
          }));
          break;
        case "nutrition":
          responses.push(await handleNutrition({
            mealType: intent.mealType || "snack",
            description: intent.description || text,
            calories: intent.calories,
            proteinG: intent.proteinG,
            carbsG: intent.carbsG,
            fatsG: intent.fatsG,
          }));
          break;
        default:
          // Unknown intent, skip
          break;
      }
    }

    if (responses.length === 0) {
      return { handled: false };
    }

    const combined = responses.join("\n\n");
    logger.info(
      { intentCount: parsed.intents.length, intents: parsed.intents.map((i: any) => i.intent) },
      "NLP multi-intent log handled via Telegram"
    );
    logNlpConversation(text, combined).catch(() => {});
    return { handled: true, response: combined };
  } catch (error: any) {
    logger.error({ error: error.message, text }, "NLP handler error");
    // Fall through to agent system on error
    return { handled: false };
  }
}
