# SB-OS Deployment Log

> Chronological record of deployments, issues, and resolutions.

---

## 2026-02-20 — Agent OS Initial Deployment (v1.1.0)

**Commit**: `61f7826` (pushed to `sayedbaharun/aura`)
**Railway Status**: SUCCESS
**Live URL**: `https://sbaura.up.railway.app`

### What Was Deployed

- **Hierarchical Multi-Agent System** (Phases 1-6 complete)
  - 10 agent templates (CMO, CTO, Chief of Staff, Head of Products, + 6 specialists)
  - Agent runtime with multi-turn tool calling (17 tools)
  - Delegation engine with privilege attenuation
  - Message bus for inter-agent communication
  - Agent scheduler with cron-based proactive execution (5 scheduled jobs)
  - Telegram channel adapter (@SBNexusBot)
  - Agent UI: `/agents`, `/agents/:slug`, `/agents/delegation-log`
  - 22 new API endpoints under `/api/agents`

- **Infrastructure Changes**
  - Added `Dockerfile` for Docker-based builds (replacing Railpack)
  - Version bumped to 1.1.0
  - Added `highlight.js@11` and `lowlight@3` as explicit dependencies

### Issues Encountered & Resolved

| # | Issue | Root Cause | Fix |
|---|-------|-----------|-----|
| 1 | Agent seeding returned `{"error":"Failed to seed agents"}` | YAML parser couldn't handle nested `schedule:` blocks; `__dirname` undefined in ESM | Rewrote YAML parser for nested objects; added `fileURLToPath` for `__dirname` |
| 2 | `/agents` page CSS error | Tailwind v4.2.0 installed but project uses v3 syntax | Downgraded to `tailwindcss@3.4.19` |
| 3 | Page requires hard refresh to show content | Stale Vite cache | Cleared `node_modules/.vite` |
| 4 | `429 Too Many Requests` on page load | Vite HMR module requests exhausting rate limit | Added skip for `/@`, `/node_modules`, `/src` paths in globalLimiter |
| 5 | Agent chat 500 error | `OPENROUTER_API_KEY` not set | Added key to `.env` |
| 6 | `railway up` hangs on "Indexing..." | Large project causes indefinite hang | Used `git push` for auto-deploy instead |
| 7 | Railway deploying old commit (591d868) | Origin pointed to `Revolv-Group/aura` but Railway watches `sayedbaharun/aura` | Updated git remote, pushed to correct repo |
| 8 | Railway build cache reusing same image | Railpack aggressive caching ignores code changes | Added `Dockerfile` to force Docker builder |
| 9 | `npm ci` failed (missing highlight.js, lowlight) | `prosemirror-highlight` (from `@blocknote/core`) needs these as peer deps | Added `highlight.js@11` and `lowlight@3` as explicit deps |
| 10 | `ERR_ERL_KEY_GEN_IPV6` console warning | express-rate-limit v8 validates IPv6 for custom keyGenerator | Added `validate: { keyGeneratorIpFallback: false }` |

### Files Modified

| File | Change |
|------|--------|
| `server/agents/agent-registry.ts` | Fixed YAML parser, improved error logging |
| `server/routes/agents.ts` | Added ESM `__dirname`, improved error messages |
| `server/routes/ai-chat.ts` | Added `keyGeneratorIpFallback: false` |
| `server/routes/venture-lab.ts` | Added `keyGeneratorIpFallback: false` |
| `server/index.ts` | Added Vite dev path skip to rate limiter, build timestamp |
| `postcss.config.js` | Confirmed Tailwind v3 config |
| `package.json` | Version 1.1.0, added highlight.js + lowlight |
| `Dockerfile` | Created for Railway Docker builds |

### Post-Deploy Verification

Server logs confirmed:
- Agent scheduler initialized (5 jobs for 10 agents)
- Channel adapters started (Telegram)
- All automations running (day creation, reminders, RAG embeddings)
- Categories seeding check complete

---

## Previous Deployments

### 2026-01-18 — Last Pre-Agent Deploy

**Commit**: `591d868`
**Status**: SUCCESS
**Notes**: Last deployment before agent system. Standard SB-OS with ventures, tasks, health, trading modules.
