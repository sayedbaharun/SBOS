/**
 * Build Brief Generator
 * Takes venture details and generates 3 briefs:
 * 1. Manus/Genspark brief (research, brand, content)
 * 2. Lovable/Replit brief (technical spec with Clerk + Neon enforced)
 * 3. Pre-filled evaluation prompt
 */

async function getOpenAIClient() {
  const apiKey = process.env.KILOCODE_API_KEY || process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("No LLM API key configured");
  const OpenAI = (await import("openai")).default;
  return new OpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
  });
}

export interface BuildBriefInput {
  name: string;
  description: string;
  ventureType: 'service' | 'content-brand' | 'platform-app' | 'hnwi-network' | 'real-estate' | 'personal-brand';
  targetHosting: 'vercel' | 'railway';
  primaryGoal: 'validate-idea' | 'build-mvp' | 'build-marketing-site' | 'build-tool';
}

export interface BuildBriefOutput {
  manusBrief: string;
  lovableBrief: string;
  evaluationPrompt: string;
  generatedAt: string;
  ventureType: string;
  targetHosting: string;
}

const VENTURE_TYPE_LABELS: Record<string, string> = {
  'service': 'Service Business (consulting, agency, done-for-you)',
  'content-brand': 'Content Brand (faceless or personal, media, social-first)',
  'platform-app': 'Platform / App (SaaS, tool, marketplace)',
  'hnwi-network': 'HNWI / Private Network (membership, syndicate, deal flow)',
  'real-estate': 'Real Estate (listings, transactions)',
  'personal-brand': 'Personal Brand (individual-led, offer ladder)',
};

const GOAL_LABELS: Record<string, string> = {
  'validate-idea': 'validate the idea with a minimal version',
  'build-mvp': 'build an MVP ready for first users',
  'build-marketing-site': 'build a marketing/landing site',
  'build-tool': 'build a standalone tool or utility',
};

const AUTH_DB_FOR_HOSTING: Record<string, string> = {
  vercel: 'Clerk (import @clerk/nextjs), Neon Postgres (Drizzle ORM, DATABASE_URL env var), Next.js 14+ App Router',
  railway: 'Session-based auth (express-session + bcrypt), Railway PostgreSQL (Drizzle ORM, DATABASE_URL env var), Express + React',
};

export async function generateBuildBrief(input: BuildBriefInput): Promise<BuildBriefOutput> {
  const openai = await getOpenAIClient();

  const systemPrompt = `You are an expert venture architect. You generate precise, copy-paste-ready briefs for building ventures. Your output must be directly usable — no fluff, no placeholders that the user needs to fill in themselves.`;

  const userPrompt = `Generate 3 briefs for this venture:

**Venture**: ${input.name}
**What it does**: ${input.description}
**Type**: ${VENTURE_TYPE_LABELS[input.ventureType]}
**Hosting target**: ${input.targetHosting === 'vercel' ? 'Vercel (Next.js, serverless)' : 'Railway (Node.js, always-on)'}
**Primary goal**: ${GOAL_LABELS[input.primaryGoal]}

Generate exactly these 3 outputs in JSON format:

1. "manusBrief" — A detailed prompt to paste into Manus or Genspark for research and brand asset generation. Must include:
   - Business brief (problem, solution, target customer, revenue model)
   - Competitor analysis request (3-5 similar products)
   - Brand direction (tone, visual style, 3 adjectives that describe the brand)
   - Content strategy (3 content pillars, first 10 content ideas)
   - Prompts to generate: logo concept description, color palette, hero image concept
   - Keep this around 500-700 words

2. "lovableBrief" — A technical specification prompt for Lovable, Replit, or v0. Must:
   - Start with the exact tech stack block (do not modify this):
     "MANDATORY TECH STACK — do not deviate:
     - Auth: ${AUTH_DB_FOR_HOSTING[input.targetHosting]}
     - Styling: Tailwind CSS v3 + shadcn/ui components
     - Language: TypeScript only — no JS files
     - No hardcoded API keys — use environment variables only
     - No SQLite, localStorage, or mock data — real DB from day one"
   - Then describe exactly what to build: pages, features, user flows
   - Be specific about the DB schema (tables, key fields)
   - Include the full list of pages/routes
   - Keep this around 400-600 words

3. "evaluationPrompt" — The standard evaluation prompt, pre-filled with this venture's name and type. Use this exact format but fill in the venture-specific parts:
   "You are auditing [${input.name}] — a [${VENTURE_TYPE_LABELS[input.ventureType]}] — to determine how close it is to being production-ready.

   Evaluate everything that exists in this prototype against the 10-category launch checklist framework below. Score each item: ✅ Done | 🟡 Partial | ❌ Missing | ➖ N/A

   [Include the full 10-category checklist with all items, pre-configured for ${VENTURE_TYPE_LABELS[input.ventureType]}. Skip N/A items where appropriate.]

   At the end, provide:
   - Overall readiness score (1-100)
   - Current tier (pre-mvp / mvp / soft-launch / full-launch)
   - Top 5 gaps to fix first
   - Standards compliance: Does this use Clerk? Neon? TypeScript? No hardcoded secrets?"

Return ONLY a JSON object with keys: manusBrief, lovableBrief, evaluationPrompt`;

  const completion = await openai.chat.completions.create({
    model: "openai/gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.7,
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("No content returned from LLM");

  const parsed = JSON.parse(content);
  if (!parsed.manusBrief || !parsed.lovableBrief || !parsed.evaluationPrompt) {
    throw new Error("LLM returned incomplete brief data");
  }

  return {
    manusBrief: parsed.manusBrief,
    lovableBrief: parsed.lovableBrief,
    evaluationPrompt: parsed.evaluationPrompt,
    generatedAt: new Date().toISOString(),
    ventureType: input.ventureType,
    targetHosting: input.targetHosting,
  };
}
