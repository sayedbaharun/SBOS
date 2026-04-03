# SyntheLIQ AI — B2B AI Automation Agency

**Domain:** SaaS / AI Automation
**Status:** Active
**Full technical details:** `~/.claude/projects/-Users-sayedbaharun/memory/syntheliq-technical.md`

## What It Is

B2B AI automation agency deploying autonomous agent teams for SMEs. Not chatbots — full operational agents (lead qualification, outreach, content, finance, support). Middle East first (UAE/GCC), expanding internationally.

## Repos & Deploy
- `syntheliq` (web) → Railway `002bdba4`, auto-deploy from push
- `syntheliq-engine` (orchestrator) → Railway `b196d416`, deploy from inner dir via `railway up`
- **Orchestrator URL**: `https://syntheliq-engine.up.railway.app`

## Key URLs
- Quiz funnel → proposal → Stripe checkout → 6-section onboarding → agent deployment
- Client portal at `/portal` on orchestrator URL
- 21 agents total (15 original + 6 Arabic-first)

## SB-OS Integration
- SB-OS is the operational backend and knowledge base for SyntheLIQ agents
- Content Studio at `/admin/content-dashboard` proxies to SB-OS content API
- Agent swarms: `swarm_templates` + `swarm_runs` tables in syntheliq-engine
