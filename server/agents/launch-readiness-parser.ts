/**
 * Launch Readiness Parser
 * Parses raw text from external tool evaluation (Genspark/Manus) into
 * structured 10-category readiness data.
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

export interface ReadinessItem {
  item: string;
  tier: 'mvp' | 'soft' | 'full';
  status: 'done' | 'partial' | 'missing' | 'na';
  agentReady: boolean;
}

export interface ReadinessCategory {
  id: number;
  name: string;
  items: ReadinessItem[];
}

export interface ParsedReadiness {
  readinessScore: number;
  ventureType: string;
  currentTier: 'pre-mvp' | 'mvp' | 'soft' | 'full';
  standardsCompliance: {
    clerk: boolean | null;
    neon: boolean | null;
    typescript: boolean | null;
    tailwind: boolean | null;
    noHardcodedSecrets: boolean | null;
  };
  categories: ReadinessCategory[];
}

const SYSTEM_PROMPT = `You are a venture readiness analyst. You parse evaluation reports about business ventures/prototypes and extract structured readiness data.

The 10 standard launch checklist categories are:
1. Brand & Identity
2. Legal & Compliance
3. Online Presence
4. Content Readiness
5. Offer & Revenue
6. Operations & Fulfillment
7. Tech & Infrastructure
8. Distribution & Marketing
9. Team & Accountability
10. AI-Native Readiness

For each category, extract individual checklist items and classify them:
- status: "done" (confirmed built/exists), "partial" (started but incomplete), "missing" (not built/not confirmed), "na" (not applicable for this venture type)
- tier: "mvp" (must exist before first user), "soft" (needed for warm audience launch), "full" (needed for full public launch)
- agentReady: true if an AI agent can complete this task autonomously without the founder providing new information, false if it requires human input/decision

Return ONLY a JSON object matching this schema exactly.`;

export async function parseReadinessEvaluation(rawText: string): Promise<ParsedReadiness> {
  const openai = await getOpenAIClient();

  const userPrompt = `Parse this venture evaluation report and extract structured readiness data.

EVALUATION REPORT:
${rawText}

Return a JSON object with this exact structure:
{
  "readinessScore": <number 1-100>,
  "ventureType": <string describing the venture type>,
  "currentTier": <"pre-mvp" | "mvp" | "soft" | "full">,
  "standardsCompliance": {
    "clerk": <true if Clerk auth is used, false if different auth, null if not a tech product>,
    "neon": <true if Neon DB is used, false if different DB, null if not applicable>,
    "typescript": <true if TypeScript only, false if JS used, null if not applicable>,
    "tailwind": <true if Tailwind CSS used, false if not, null if not applicable>,
    "noHardcodedSecrets": <true if no hardcoded keys found, false if they exist, null if not checkable>
  },
  "categories": [
    {
      "id": <1-10>,
      "name": <category name>,
      "items": [
        {
          "item": <specific checklist item text>,
          "tier": <"mvp" | "soft" | "full">,
          "status": <"done" | "partial" | "missing" | "na">,
          "agentReady": <boolean>
        }
      ]
    }
  ]
}

Rules:
- Include ALL 10 categories even if not mentioned (use "missing" for items not covered)
- Each category must have at least 3 items
- readinessScore = weighted average: MVP items (weight 3) + Soft items (weight 2) + Full items (weight 1). Done=full credit, Partial=half, Missing=0, NA=skip
- currentTier: "pre-mvp" if any MVP item is missing, "mvp" if all MVP done but Soft missing, "soft" if all Soft done but Full missing, "full" if everything done
- agentReady=true only for tasks a Claude agent can complete by reading context and calling APIs (e.g., draft a privacy policy, create social handles) NOT tasks that need the founder (e.g., register a company, get a bank account)`;

  const completion = await openai.chat.completions.create({
    model: "openai/gpt-4o",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.3,
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("No content from LLM");

  const parsed = JSON.parse(content) as ParsedReadiness;

  if (!parsed.readinessScore || !parsed.categories || parsed.categories.length === 0) {
    throw new Error("LLM returned incomplete readiness data");
  }

  return parsed;
}

// Generate readiness items from existing venture data (for "Run AI Audit")
export async function auditVentureReadiness(ventureContext: {
  name: string;
  oneLiner?: string | null;
  domain?: string | null;
  notes?: string | null;
  projectCount: number;
  taskCount: number;
  docCount: number;
}): Promise<ParsedReadiness> {
  const openai = await getOpenAIClient();

  const userPrompt = `Audit this venture for launch readiness based on the limited context available.

VENTURE:
- Name: ${ventureContext.name}
- Description: ${ventureContext.oneLiner || 'Not provided'}
- Domain: ${ventureContext.domain || 'Not specified'}
- Notes: ${ventureContext.notes || 'None'}
- Projects: ${ventureContext.projectCount} projects in SB-OS
- Tasks: ${ventureContext.taskCount} tasks tracked
- Documents: ${ventureContext.docCount} knowledge docs

Since we have limited info, mark items as "missing" unless the context explicitly confirms they exist. This is a baseline audit — the founder will update statuses as things get built.

Return the same JSON structure as described. Be conservative — assume missing unless confirmed.`;

  const completion = await openai.chat.completions.create({
    model: "openai/gpt-4o",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.3,
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("No content from LLM");

  return JSON.parse(content) as ParsedReadiness;
}
