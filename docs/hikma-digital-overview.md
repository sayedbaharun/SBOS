# Hikma Digital — Comprehensive Overview

> **Last updated**: 2026-03-06
> **Venture ID in SB-OS**: `de2a8490`
> **Website**: [hikmadigital.com](https://hikmadigital.com)

---

## Business Model

Hikma Digital is a **B2B AI automation agency** under Revolv Group, starting with the Middle East market and expanding internationally.

### Value Proposition
We deploy AI agent teams for SMEs — not chatbots, but autonomous agents that handle real business operations: lead qualification, content creation, outreach, finance, support, and more. Clients get a full AI workforce without hiring, training, or managing it.

### Revenue Model
- **Setup fee** — one-time payment via Stripe Checkout to cover onboarding, agent configuration, and initial training
- **Monthly subscription** — recurring fee for ongoing agent operation, monitoring, and optimization
- **Custom engagements** — enterprise clients with bespoke agent architectures

### Target Market
- **Primary**: SMEs in the Middle East (UAE, Saudi, Qatar) — businesses with 5-50 employees who need operational leverage but can't afford large teams
- **Secondary**: International SMEs discovering us via content marketing, SEO, and referrals
- **Initial focus**: AI automation consulting, productized around OpenClaw/NanoClaw-style agent deployments

### Go-to-Market
- **Quiz funnel**: hikmadigital.com/quiz — 10-question assessment that scores the lead and routes to appropriate agent tier (Starter / Growth / Full Agency / Custom)
- **Content marketing**: Blog with SEO-optimized articles on AI automation for business
- **12 industry pages**: Vertical-specific landing pages (real estate, healthcare, legal, etc.)
- **Proposal system**: AI-generated proposals with agent recommendations tailored to quiz results
- **Distribution gap**: Currently missing paid ads, social media presence, and outbound channels — this is the primary launch blocker after payment flow

---

## Product Architecture

### Two Codebases

1. **hikmadigital** (web frontend + lightweight API)
   - React + Vite + Tailwind CSS v3
   - Public website, quiz funnel, blog, industry pages, proposal viewer, payment flow, onboarding form, admin dashboard
   - Deployed on Railway (project `002bdba4`)
   - GitHub: `sayedbaharun/hikmadigital`

2. **hikma-engine** (orchestrator backend, package name: hikma-engine, dir: `hikmadigital/hikmaclaw/`)
   - Express + TypeScript
   - 14 AI agents, event-driven orchestration, lead pipeline, content queue, Telegram bot
   - Deployed on Railway (project `b196d416`) — **separate Railway project**, not a service under hikmadigital
   - GitHub: `sayedbaharun/hikma-engine` (renamed from `hikmaclaw` on 2026-03-01)

### Database
- **Neon Serverless PostgreSQL**
- Web tables: `sme_leads`, `assessment_leads`, `time_leak_assessments`, `assessment_events`
- Orchestrator tables: `leads`, `clients`, `proposals`, `payments`, `client_onboarding`, `content_queue`, `agent_runs`, `events`, `director_reports`, `escalations`, `agent_health`

### Payment Flow
```
Quiz → Lead Score → Proposal Generated → Client Reviews Proposal
→ "Pay Setup Fee" CTA → Stripe Checkout → payment-success page
→ Auto-create client record → Onboarding form (6 sections) → Agent deployment
```
- Currently on **Stripe test keys** — must switch to live keys before accepting real payments

---

## Agent System (14 Agents)

| # | Agent | Role | Schedule/Trigger | MCP Tools |
|---|-------|------|-----------------|-----------|
| 1 | **Director** | Oversees all agents, health monitoring | Every 2h + `agent_failed` event | gmail |
| 2 | **Scout** | Market research, trend spotting | Daily 8am | — |
| 3 | **Content** | Blog posts, social media content | Daily 10am, listens to `scout_complete` | — |
| 4 | **Prospector** | Lead sourcing and outbound research | Weekdays 9am | — |
| 5 | **Outreach** | Email outreach to warm leads | Event: `prospector_complete`, `lead_qualified_warm` | gmail |
| 6 | **Qualifier** | Scores and qualifies inbound leads | Event: `new_lead` | — |
| 7 | **Closer** | Handles hot leads, sends proposals | Event: `lead_qualified_hot` | gmail |
| 8 | **Delivery** | Client onboarding after deal close | Event: `deal_closed` | gmail |
| 9 | **Finance** | Invoicing, payment tracking | Mondays 9am + `invoice_due` | stripe |
| 10 | **Support** | Client support tickets | Event: `support_ticket` | gmail |
| 11 | **Analyst** | Data analysis on pipeline | On-demand | — |
| 12 | **Strategist** | Business strategy recommendations | On-demand | — |
| 13 | **Copywriter** | Marketing copy, ad text | On-demand | — |
| 14 | **SEO Expert** | SEO audits, keyword research | On-demand | — |

### Agent Chains (event-driven flow)
```
Scout (8am) → scout_complete → Content
Prospector (9am) → prospector_complete → Outreach
Web form / Prospector → new_lead → Qualifier
Qualifier → lead_qualified_hot → Closer
Qualifier → lead_qualified_warm → Outreach
Closer → deal_closed → Delivery (+ auto-create client)
Director (every 2h) + agent_failed → monitors everything
```

### Model Routing
- **Sonnet**: Director, Analyst, Closer, Scout (high-stakes decisions)
- **Haiku**: All others (cost-efficient for routine tasks)

### Agent-Oriented API
All orchestrator responses use envelope format: `{ data, _meta, _guidance }`. Errors include educational context: `{ _error: { code, message, explanation, suggestion } }`. Lead and Proposal state machines attached as `_guidance.current_state`.

---

## Tech Stack Summary

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite, Tailwind CSS v3.4 |
| Backend (web) | Express, TypeScript |
| Backend (orchestrator) | Express, TypeScript, event-driven architecture |
| Database | Neon Serverless PostgreSQL |
| Payments | Stripe (Checkout Sessions, Webhooks) |
| Email | Resend (transactional), Gmail MCP (agent outreach) |
| Telegram | Webhook bot with 16 commands |
| Hosting | Railway (2 separate projects) |
| AI Models | OpenRouter (Sonnet + Haiku) |

---

## Current State (as of 2026-03-06)

### What's Live
- Full website with 25+ pages (homepage, agents, quiz, results, blog, industry pages, case studies, legal)
- Quiz funnel → lead capture → proposal generation → proposal page with PDF download
- Stripe checkout integration (test keys)
- Client onboarding form (6 sections)
- Admin dashboard (6 tabs, password-protected)
- 14 AI agents configured in orchestrator
- Gmail MCP integration (5 email aliases: outreach@, sales@, welcome@, support@, finance@)
- Telegram bot with 16 commands + auto-notifications
- Agent-Oriented API demo page at /demo

### Launch Blockers (P0)
1. **Stripe live keys** — still on test keys, need to switch to live for real payments
2. **E2E payment test** — full flow (quiz → proposal → checkout → onboarding) not tested end-to-end with real Stripe
3. **Distribution channels** — no paid ads, no social media presence, no outbound. Website exists but nobody knows about it

### Post-Launch (P1)
- WhatsApp Business API integration
- Social media auto-posting (currently manual via `/publish`)
- Image optimization (WebP/AVIF)
- Error tracking (Sentry)
- Full analytics / conversion funnel tracking

---

## Key URLs & Resources

| Resource | URL |
|----------|-----|
| Website | https://hikmadigital.com |
| Quiz Funnel | https://hikmadigital.com/quiz |
| Admin Dashboard | https://hikmadigital.com/admin |
| API Demo | https://hikmadigital.com/demo |
| GitHub (web) | github.com/sayedbaharun/hikmadigital |
| GitHub (orchestrator) | github.com/sayedbaharun/hikma-engine |
| Railway (web) | Project `002bdba4` |
| Railway (orchestrator) | Project `b196d416` |

---

## SB-OS Integration

- **Venture record**: ID `de2a8490`, type `saas`, status `ongoing`
- **Project**: "Agency Platform (hikmadigital.com)" — P0, in_progress
- **3 phases**: Foundation (done), Agent System (done), Launch & Distribution (in_progress)
- **14 tasks tracked**: 8 completed, 6 upcoming
- **Agents with Hikma context**: CMO (distribution_check), Growth Specialist (growth_opportunities), SEO Specialist (seo_audit), Social Media Manager (content_queue), Content Strategist (content_calendar), Research Analyst (upstream_feature_scan), Venture Architect (venture_health)

---

## Strategic Notes for Agents

- **Distribution is the #1 gap** — the product is built but needs marketing. Any agent working on growth, content, or marketing should prioritize distribution channels for Hikma Digital.
- **Middle East focus** — content and outreach should be relevant to UAE/GCC business culture and pain points. English is primary language.
- **Agent count is flexible** — currently 14 agents but designed to grow as new business needs emerge. New agents are created by the Director or manually.
- **OpenClaw/NanoClaw upstream** — Research Analyst monitors these repos for features that could enhance Hikma's agent capabilities.
- **Competitive positioning** — we're not selling "AI chatbots." We sell autonomous AI teams that replace operational headcount. The messaging should always emphasize autonomy, reliability, and business outcomes over technology.
