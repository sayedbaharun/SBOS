# Technical Stack

> SB-OS stack — overrides global Agent OS defaults.

## Application Framework
- **Runtime:** Node.js 20+ (LTS)
- **Language:** TypeScript (ESM modules, `"type": "module"`)
- **Backend:** Express v5
- **Frontend:** React 19 + Wouter + TanStack Query v5

## Database
- **Primary DB:** PostgreSQL (Railway-managed)
- **ORM:** Drizzle ORM + drizzle-zod
- **Vector Store:** Qdrant (3 collections) + Pinecone (nightly backup)
- **Graph Store:** FalkorDB v6.6

## JavaScript / Build
- **Build Tool (client):** Vite
- **Build Tool (server):** esbuild
- **Import Strategy:** Node.js ESM modules
- **Package Manager:** npm

## UI & Styling
- **CSS Framework:** Tailwind CSS v3.4.19 (NOT v4)
- **UI Components:** shadcn/ui + Radix UI
- **Icons:** Lucide React
- **Fonts:** Google Fonts (self-hosted)

## Authentication
- **Preferred:** Clerk (use for all new Vercel-hosted ventures and any app with user-facing auth)
- **SB-OS (existing):** Express session + connect-pg-simple + bcryptjs (already built — do not replace)
- **Rule:** New ventures built on Vercel → Clerk. SB-OS and Railway services → existing session auth unless greenfield.

## Database — Matched to Hosting

| Hosting | Database | Why |
|---------|----------|-----|
| **Vercel** | **Neon** (serverless PostgreSQL) | Neon's HTTP driver works in serverless/edge environments; Railway PG requires persistent connections |
| **Railway** | **Railway-managed PostgreSQL** | Already provisioned, persistent connections, no cold starts |
| **Rule** | Never mix — don't connect a Vercel app to Railway PG or a Railway app to Neon unless explicitly justified |

## AI & LLM
- **Priority 1:** OpenRouter API — multi-model cascade (primary for all agents and ventures)
- **Priority 1 (alt):** Kilocode — use alongside or instead of OpenRouter where applicable
- **Priority 2:** OpenAI API — fallback if OpenRouter/Kilocode unavailable
- **Priority 3:** Google AI (Gemini) — last resort fallback
- **Fast inference:** Cerebras (used for compaction summarization in SB-OS)
- **Agent skills:** Claude API (Anthropic SDK) via Claude Code skills layer
- **Rule:** Always implement model cascade in this order. Never hard-code a single model.

## New Module Integrations (Venture Onboarding System)
- **Google Drive API:** `googleapis` npm package — folder creation, file upload
- **Task API:** Internal SB-OS `POST /api/tasks` (bulk task creation)
- **Telegram:** Existing `server/channels/telegram-topic-service.ts` — routes to venture topic
- **Memory files:** Direct file writes to `~/Desktop/memory-system/*.md`

## Hosting & Deployment

### Decision Matrix — Pick the right platform per venture

| Platform | Use When | Examples |
|----------|----------|---------|
| **Railway** | Always-on Node.js server, WebSockets, cron jobs, stateful processes, long-running agents | SB-OS, SyntheLIQ engine, mydclaw, tomaholic, Sintelligence |
| **Vercel** | Next.js apps, static sites, serverless API routes, Vercel Cron Jobs, frontend-only ventures | syntheliq.com (marketing), X Dashboard, SENTINEL, AI Wealth Archetype Generator, any venture landing page |
| **Evaluate per venture** | Mobile apps (App Store/Play Store), Python scripts/bots (Railway or local cron), local-only tools | Polymarket bot (local), iOS shortcuts |

### Rules
- **Default for new web ventures:** Vercel (serverless, zero infra overhead, free tier generous)
- **Default for SB-OS modules / agent backends:** Railway (persistent, always-on)
- **Never use Railway for a landing page** — Vercel is faster, cheaper, and has better CDN
- **Never use Vercel for a stateful backend** — no persistent connections, cold starts will break cron/socket logic

### Deployment Methods
- **Railway:** `git push origin main` — auto-deploys. Never use `railway up` unless explicitly required.
- **Vercel:** Connected to GitHub, auto-deploys on push to `main`. Use `vercel --prod` only for manual overrides.

## Scheduling
- **Cron:** node-cron v4 + cron-parser v5
- **Timezone:** Always explicit IANA — default `Asia/Dubai`
- **Serverless cron:** Vercel Cron Jobs (for Vercel-hosted ventures needing scheduled tasks)

## Testing
- **Framework:** Vitest

## Code Repository
- **Primary:** github.com/sayedbaharun/SBOS
