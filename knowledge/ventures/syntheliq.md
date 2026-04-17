# SyntheLIQ AI — Venture Knowledge

**Domain:** B2B AI Automation (SaaS)
**Status:** Built, pre-launch
**Venture type:** Agency platform — deploys autonomous AI agent teams for SMEs

---

## What We Do

We sell AI agent teams, not chatbots. Clients get a full operational AI workforce that handles lead qualification, content creation, outreach, finance, and support — without hiring.

**Target market:** SMEs in UAE/GCC with 5–50 employees who need operational leverage. English-first, Arabic-capable.

**Revenue model:**
- One-time setup fee (Stripe Checkout)
- Monthly subscription (recurring)
- Custom enterprise engagements

---

## Current State

- Full website live with 25+ pages, quiz funnel, proposal system, Stripe checkout (test keys)
- 21 AI agents deployed in orchestrator (15 original + 6 Arabic-first)
- Client portal at `/portal` on orchestrator
- Agent swarms: sales-pipeline, content-engine, client-onboarding templates

**P0 launch blockers:**
1. Switch Stripe to live keys
2. E2E payment test (quiz → proposal → checkout → onboarding)
3. Distribution — no paid ads, no social presence, no outbound

---

## Repos & Infrastructure

| Component | Repo | Railway Project | Deploy |
|-----------|------|----------------|--------|
| Web (frontend + lightweight API) | `sayedbaharun/syntheliq` | `002bdba4` | Auto-deploy on push |
| Engine (orchestrator backend) | `syntheliq-engine/syntheliq-engine/` | `b196d416` | `railway up` from inner dir |

- **Orchestrator URL:** `https://syntheliq-engine.up.railway.app`
- **Database:** Neon PostgreSQL `ep-restless-base-aizo9wye` (us-east-1), paid plan

---

## Agent System (21 Agents)

**Roles:** Director, Scout, Content, Prospector, Outreach, Qualifier, Closer, Delivery, Finance, Support, Analyst, Strategist, Copywriter, SEO Expert
**Arabic-first agents:** arabic-support, arabic-outreach, arabic-content, arabic-closer, arabic-qualifier, arabic-researcher

**Model routing:** Sonnet for Director/Analyst/Closer/Scout. Haiku for all others.

---

## Strategic Context for Agents

- **Distribution is the #1 gap** — product is built, no one knows about it. Any agent on growth/content/marketing should prioritize distribution channels.
- **Middle East positioning** — content and outreach should address UAE/GCC business culture, Arabic capability is a differentiator
- **Competitive framing** — "autonomous AI teams" not "AI chatbots." Messaging: autonomy, reliability, business outcomes.
- **SB-OS integration** — SB-OS is the operational backend. Content Studio at SB-OS `/admin/content-dashboard` proxies SyntheLIQ content.

---

## Tags
syntheliq, ai-automation, saas, b2b, agency, uae, gcc, arabic, agents, stripe, railway, neon
