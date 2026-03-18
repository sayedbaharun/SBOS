# SB-OS: Architecture Overview

> **Status**: Work in Progress | **Last Updated**: 2026-03-18 | **Version**: 1.0

---

## What is SB-OS?

SB-OS is a full-stack personal operating system for **one founder (Sayed Baharun)** managing multiple business ventures. It replaces Notion, Todoist, and fragmented productivity tools with a single unified system.

It is three things in one:

1. **A thinking partner** — AI agents that understand your ventures, context, and preferences
2. **An execution engine** — task management, scheduling, health tracking, trading journal
3. **A second brain** — knowledge base, memory system, and context-preserving relationships

---

## System Architecture (Bird's Eye)

```
                              CHANNELS
                    ┌──────────────────────────┐
                    │  Telegram   WhatsApp  Web │
                    └──────────┬───────────────┘
                               │
                    ┌──────────▼───────────────┐
                    │     CHANNEL MANAGER       │
                    │  routing, rate limiting,  │
                    │  access control           │
                    └──────────┬───────────────┘
                               │
            ┌──────────────────▼──────────────────┐
            │          AGENT OPERATING SYSTEM       │
            │                                       │
            │  ┌─────────┐  ┌──────────┐  ┌──────┐│
            │  │  Chief   │  │   CTO    │  │ CMO  ││
            │  │of Staff  │  │          │  │      ││
            │  └────┬─────┘  └────┬─────┘  └──┬───┘│
            │       │             │            │    │
            │  ┌────▼─────────────▼────────────▼──┐│
            │  │        DELEGATION ENGINE          ││
            │  │  permissions, depth limits, DLQ   ││
            │  └────────────────┬──────────────────┘│
            │                   │                    │
            │  ┌────────────────▼──────────────────┐│
            │  │         TOOL EXECUTION            ││
            │  │  search, create, deploy, browse   ││
            │  └───────────────────────────────────┘│
            └──────────────────┬──────────────────┘
                               │
         ┌─────────────────────▼─────────────────────┐
         │              INTELLIGENCE LAYER             │
         │                                             │
         │  ┌────────────┐ ┌──────────┐ ┌───────────┐│
         │  │  MEMORY     │ │  PROXY   │ │ COUNCIL   ││
         │  │  SYSTEM     │ │  LAYER   │ │ (debate)  ││
         │  └──────┬──────┘ └────┬─────┘ └─────┬─────┘│
         │         │             │              │      │
         │  ┌──────▼──────┐ ┌───▼────┐  ┌─────▼────┐ │
         │  │Qdrant       │ │OpenRtr │  │3 models  │ │
         │  │FalkorDB     │ │Kilo    │  │parallel  │ │
         │  │Pinecone     │ │Local   │  │synthesis │ │
         │  │PostgreSQL   │ │Qwen    │  │          │ │
         │  └─────────────┘ └────────┘  └──────────┘ │
         └─────────────────────────────────────────────┘
                               │
         ┌─────────────────────▼─────────────────────┐
         │              DATA LAYER                     │
         │                                             │
         │  PostgreSQL (Neon)  — 30+ tables            │
         │  Ventures → Projects → Tasks → Days         │
         │  Health, Nutrition, Trading, Docs, Agents   │
         └─────────────────────────────────────────────┘
```

---

## Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | React 18, Wouter, TanStack Query, shadcn/ui, Tailwind v3 | Single-page app |
| **Backend** | Express.js, Node.js, TypeScript | API server |
| **Database** | PostgreSQL (Neon Serverless) | Primary data store |
| **ORM** | Drizzle ORM + drizzle-zod | Type-safe queries |
| **Vector Store** | Qdrant Cloud (1536-dim, text-embedding-3-small) | Semantic memory search |
| **Graph Store** | FalkorDB Cloud | Knowledge graph (entities + relationships) |
| **Backup Store** | Pinecone | Cloud fallback for compacted memories |
| **LLM Routing** | OpenRouter → Kilo → Local Qwen | Multi-provider failover |
| **Channels** | Telegram (Telegraf) + WhatsApp (Cloud API) | Messaging interfaces |
| **Deployment** | Railway (Docker, auto-deploy from GitHub) | Production hosting |
| **Build** | Vite (client) + esbuild (server) | Fast builds |

---

## Core Data Model

Everything in SB-OS connects to either a **Venture** or a **Day**.

```
VENTURES (top level — business initiatives)
  └── Projects (time-bound initiatives)
       └── Phases (milestones)
            └── Tasks (atomic work items)
  └── Docs (SOPs, specs, playbooks)
  └── AI Agents (venture-scoped intelligence)

DAYS (daily operations hub)
  └── Tasks (scheduled for this day)
  └── Health Entries (sleep, energy, workout)
  └── Nutrition Entries (meals, macros)
  └── Morning/Evening Rituals
  └── Trading Journal

CAPTURE ITEMS (GTD inbox)
  └── Convert to Tasks or Docs
```

### Key Tables (30+)

| Category | Tables |
|----------|--------|
| **Core** | `ventures`, `projects`, `phases`, `tasks`, `days` |
| **Health** | `health_entries`, `nutrition_entries`, `bloodwork` |
| **Knowledge** | `docs`, `attachments`, `knowledge_files` |
| **Trading** | `trading_strategies`, `daily_trading_checklists` |
| **Agents** | `agents`, `agent_conversations`, `agent_tasks`, `agent_memory` |
| **Memory** | `entity_relations`, `agent_compaction_events`, `session_logs` |
| **Infra** | `token_usage_log`, `dead_letter_jobs`, `automations` |
| **Personal** | `shopping_items`, `books`, `capture_items` |

---

## API Surface

**157+ REST endpoints** across 46 route files, organized by domain:

| Domain | Key Endpoints | Count |
|--------|---------------|-------|
| **Auth** | `/api/auth/login`, `/api/auth/user` | 8 |
| **Dashboard** | `/api/dashboard/readiness`, `/api/dashboard/tasks` | 8 |
| **Ventures** | CRUD + AI chat + context cache | 10 |
| **Projects/Phases** | CRUD + scaffolding | 12 |
| **Tasks** | CRUD + today's tasks + bulk ops | 8 |
| **Health/Nutrition** | CRUD + macro estimation | 10 |
| **Docs** | CRUD + tree + search + quality + attachments | 18 |
| **Agents** | 22 endpoints + council | 23 |
| **Memory/RAG** | Search, embeddings, lifecycle triggers | 12 |
| **Trading** | Strategies + checklists + sessions | 12 |
| **Intelligence** | Daily synthesis, email triage, meeting prep | 10 |
| **Integrations** | Google Drive, TickTick, automations | 20+ |

---

## Deployment

| Environment | Platform | How |
|-------------|----------|-----|
| **Production** | Railway (Docker) | Auto-deploy on `git push origin main` |
| **Database** | Railway PostgreSQL + Neon (migration target) | `DATABASE_URL` env var |
| **Dev** | Local | `npm run dev` (port 5000, Vite HMR) |

Railway project ID: `6c419b1e` | Hobby plan ($5/mo)

### Deploy checklist:
1. `git push origin main` → Railway auto-builds
2. Docker builder (not Railpack — avoids caching issues)
3. Port 8080 (set in Dockerfile)
4. Never use `railway up` — hangs on large codebases

---

## Frontend Pages (26)

| Page | Route | Description |
|------|-------|-------------|
| Command Center | `/dashboard` | Main HUD — health battery, top 3, urgent tasks |
| Today | `/today` | Daily view with life admin checklist |
| Venture HQ | `/ventures` | All ventures grid |
| Venture Detail | `/ventures/:id` | Projects, tasks, docs, AI chat per venture |
| Agent HQ | `/agents` | Agent org chart with live status |
| Agent Detail | `/agents/:slug` | Per-agent chat + task history |
| Health Hub | `/health-hub` | Health metrics, calendar, bloodwork |
| Nutrition | `/nutrition` | Meal logging with AI macro estimation |
| Knowledge Hub | `/knowledge` | Doc library with search and hierarchy |
| Deep Work | `/deep-work` | Weekly calendar with focus slots |
| Trading | `/trading` | Strategy execution + session tracking |
| All Tasks | `/tasks` | Comprehensive task list with filters |
| Calendar | `/calendar` | Monthly view with task overlay |
| Morning Ritual | `/morning` | Daily habit tracking |
| Evening Review | `/evening` | Reflection + tomorrow planning |
| AI Chat | `/ai-chat` | General AI assistant |
| Capture | `/capture` | Quick idea capture (GTD inbox) |
| Shopping | `/shopping` | Shopping list |
| Books | `/books` | Reading list |
| Settings | `/settings` | User preferences, AI config, integrations |

---

## Design Principles

1. **Capture → Clarify → Commit → Complete** — every input flows through a canonical pipeline
2. **Leverage → Precision → Defensibility** — high-leverage work first, build moats
3. **Few Canonical Entities** — ventures, projects, tasks, days, docs. Heavy relations, never duplicate data
4. **Health & Clarity First** — health metrics are first-class citizens; energy informs task planning
5. **One Source of Truth** — every piece of data lives in exactly one place
6. **Simple First** — build what's needed, add complexity later

---

## What's Next (Open Areas)

- [ ] Google Calendar sync (bidirectional)
- [ ] Gmail integration for email capture
- [ ] Mobile app (React Native PWA)
- [ ] Analytics & insights dashboard
- [ ] Smart scheduling based on energy levels

---

*This document is a living reference. Update it as the system evolves.*
