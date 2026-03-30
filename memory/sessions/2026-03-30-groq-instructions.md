# Claude Code Task: Add Groq API as a Provider

> Written by Cowork on 2026-03-30. SB wants to reduce agent costs by adding Groq as a fast/cheap LLM provider.

---

## Context

SB-OS currently has 3 LLM providers:
- **OpenRouter** (primary) — multi-model gateway
- **Kilo Code** (fallback) — kicks in when OpenRouter credits run out
- **Cerebras** (compaction only) — fast Llama 3.3 70B for summarization

SB wants to add **Groq** as a 4th provider. Groq runs Llama models on dedicated LPU hardware — extremely fast and cheap ($0.06–$0.18 per 1M tokens).

**Goal:** Use Groq for the "fast" tier agents (specialists, workers) and as a compaction alternative to Cerebras, cutting costs on the 30+ scheduled jobs and worker agents.

---

## What Needs to Change (4 Files)

### 1. New file: `server/groq-client.ts`

Create a Groq client modeled on the existing `server/compaction/cerebras-client.ts` (read that file for the exact pattern).

Key details:
- Groq API URL: `https://api.groq.com/openai/v1/chat/completions`
- Groq is **OpenAI-compatible** — same request/response format
- Env var: `GROQ_API_KEY`
- Default model: `llama-3.3-70b-versatile` (same quality as Cerebras Llama 3.3 70B)
- Cheaper alternative: `llama-3.1-8b-instant` for simple tasks
- Support JSON mode (`response_format: { type: "json_object" }`)
- 30-second timeout (same as Cerebras)
- Export a `generateGroqCompletion()` function with same signature as Cerebras

### 2. Update: `server/model-manager.ts`

Add Groq as a provider alongside OpenRouter, Kilo, and Local. Follow the exact same pattern as the Kilo Code client (lines 29-44):

**a) Add Groq client initialization (after the Kilo section, ~line 44):**
```
let groqClient: OpenAI | null = null;

function getGroqClient(): OpenAI | null {
  if (!process.env.GROQ_API_KEY) return null;
  if (!groqClient) {
    groqClient = new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: "https://api.groq.com/openai/v1",
    });
  }
  return groqClient;
}
```

**b) Add Groq to `providerHealth` (line 104-108):**
```
groq: createHealthEntry(),
```

**c) Add Groq to `getProviderHealth()` (line 148-163):**
```
groq: {
  ...providerHealth.groq,
  configured: !!process.env.GROQ_API_KEY,
},
```

**d) Add Groq models to `MODEL_COST_PER_MILLION` (line 351-363):**
```
"groq/llama-3.3-70b-versatile": { input: 6, output: 6 },
"groq/llama-3.1-8b-instant": { input: 5, output: 5 },
"groq/llama-4-scout-17b-16e-instruct": { input: 15, output: 15 },
```

**e) Add Groq to the fallback cascade:**
In the `chatCompletion` function, after the Kilo fallback attempt, add a Groq fallback attempt before giving up. The chain should be: OpenRouter → Kilo → Groq → error.

Use the same try/catch pattern as the Kilo fallback. When calling Groq, map the requested model to a Groq equivalent:
- Any "fast" tier model → `llama-3.3-70b-versatile`
- Any "mid" tier model → `llama-3.3-70b-versatile`
- Any "top" tier model → skip Groq (keep Claude for executive reasoning)

### 3. Update: `server/agents/types.ts`

No changes required to defaults yet. But add a comment near the MODEL_TIER_DEFAULTS (line 173) noting that Groq is available as an alternative fast-tier provider:

```
/**
 * Default model selection based on agent role.
 * Groq alternative for fast tier: "groq/llama-3.3-70b-versatile"
 * Set GROQ_API_KEY to enable Groq as fallback provider.
 */
```

### 4. Update: `server/compaction/cerebras-client.ts`

Add Groq as a fallback between Cerebras and Ollama. The cascade should be: Cerebras → Groq → Ollama.

In the `generateCompletion()` function (line 25-57), after the Cerebras try/catch fails, add:

```
// Try Groq before falling back to local Ollama
const groqKey = process.env.GROQ_API_KEY;
if (groqKey) {
  try {
    return await groqCompletion(groqKey, systemPrompt, userPrompt, { temperature, maxTokens, jsonMode });
  } catch (error) {
    logger.warn({ error }, "Groq failed, falling back to Ollama");
  }
}
```

Add a `groqCompletion()` function (same structure as `cerebrasCompletion` on line 59-106) but pointing to:
- URL: `https://api.groq.com/openai/v1/chat/completions`
- Model: `llama-3.3-70b-versatile`
- Source: `"groq"` (add to the CompletionResult source union type on line 19)

---

## Environment Variable

Add to Railway (and local .env):
```
GROQ_API_KEY=gsk_xxxxxxxxxxxxx
```

Get the key from: https://console.groq.com/keys

**Free tier:** 14,400 requests/day on Llama 8B, 1,000 requests/day on Llama 70B. Paid tier is pay-as-you-go, no minimum.

---

## After Implementation

1. Add `GROQ_API_KEY` to the env vars table in root `CLAUDE.md` (Section 13, Optional variables)
2. Add Groq to `memory/context/tools-and-stack.md` under Databases & Storage section
3. Update `memory/MEMORY.md` tools table to include Groq
4. Run `GET /api/providers/health` to verify Groq shows as configured + healthy
5. Test by triggering a fast-tier agent chat and checking `token_usage_log` for groq model entries

---

## What NOT to Change

- Do NOT change executive/top tier to Groq — Chief of Staff should stay on Claude Opus
- Do NOT change mid tier defaults — managers should stay on Claude Sonnet for now
- Do NOT remove Cerebras — keep it as primary compaction, Groq is the fallback
- Do NOT change any agent soul files — the tier system handles routing automatically
