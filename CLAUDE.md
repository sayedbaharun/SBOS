# SB-OS: The Sayed Baharun Personal Operating System

> **Complete Technical & Product Specification**
> Last updated: 2026-04-17

This file is the single source of truth for the SB-OS codebase. It provides guidance for development (including Claude Code), architecture details, API reference, and product specifications.

---

## Table of Contents

1. [Identity & Philosophy](#1-identity--philosophy)
2. [Technology Stack](#2-technology-stack)
3. [Project Structure](#3-project-structure)
4. [Development Commands](#4-development-commands)
5. [Architecture](#5-architecture)
6. [Database Schema](#6-database-schema)
7. [API Reference](#7-api-reference)
8. [Key Files](#8-key-files)
9. [UX Modules & Screens](#9-ux-modules--screens)
10. [Focus Slots (Time Blocking)](#10-focus-slots-time-blocking)
11. [Automation & Logic Layer](#11-automation--logic-layer)
12. [Integration Points](#12-integration-points)
13. [Environment Configuration](#13-environment-configuration)
14. [Code Patterns](#14-code-patterns)
15. [Common Development Tasks](#15-common-development-tasks)
16. [Roadmap](#16-roadmap)
17. [Agent Operating System](#17-agent-operating-system)
18. [Memory System](#18-memory-system)
19. [Compaction Pipeline](#19-compaction-pipeline)
20. [Agent OS Standards](#20-agent-os-standards)

> Claude Code development instructions (hooks, memory protocol, MCP tools): see `.claude/CLAUDE.md`

---

## 1. Identity & Philosophy

### What is SB-OS?

**SB-OS** (formerly Aura) is a full-stack personal operating system and productivity engine for managing multiple business ventures, projects, tasks, health, and knowledge. Built as a custom "second brain" to replace Notion, Todoist, and other fragmented productivity tools.

SB-OS is **the operating system for one founder: Sayed Baharun**.

It is:
- A **thinking partner + execution engine**, not a task manager
- **Single-brain, multi-venture**: everything rolls up to one person across multiple businesses
- **Today-centric**: every day is a unified view of tasks, health, nutrition, and focus
- **Context-preserving**: relations ensure no information is orphaned
- **Trading-aware**: built-in trading journal and session management

### Core Capabilities

- **Multiple Ventures** - Business initiatives across different domains (SaaS, media, realty, trading, personal)
- **Project Management** - Time-bound initiatives with phases, budgets, and outcomes
- **Task Execution** - Atomic work items with time blocking and effort tracking
- **Health & Wellness** - Daily health metrics and nutrition logging
- **Knowledge Base** - SOPs, playbooks, specs, and templates with hierarchical organization
- **Daily Operations** - Morning rituals, evening reviews, and reflection workflows
- **Trading Module** - Strategy templates, daily checklists, session tracking, and P&L journal
- **AI Integration** - Venture-specific AI agents with context awareness
- **Shopping & Books** - Personal life management tools

### Design Principles

1. **Capture → Clarify → Commit → Complete**
   - Every input flows through a canonical pipeline
   - Nothing falls through cracks; everything is processed

2. **Leverage → Precision → Defensibility**
   - Focus on high-leverage work first
   - Precision in execution (deep work slots, clear outcomes)
   - Build defensible moats (SOPs, systems, documented knowledge)

3. **Few Canonical Entities**
   - Core entities: Ventures, Projects, Tasks, Days, Health, Nutrition, Docs
   - Heavy use of relations (never duplicate data)
   - Every entity connects to Ventures or Days for context

4. **Health & Clarity First, Then Output**
   - Health metrics are first-class citizens
   - Energy and mood inform task planning
   - Deep work > shallow busywork

5. **One Source of Truth**
   - Every piece of data lives in exactly one place
   - Relations create views, not copies
   - Built for iteration and evolution

6. **Simple First**
   - Build what's needed, add complexity later

---

## 2. Technology Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | React 18, Wouter routing, TanStack Query, shadcn/ui, Tailwind CSS |
| **Backend** | Express.js, Node.js, TypeScript |
| **ORM** | Drizzle ORM with drizzle-zod |
| **Database** | PostgreSQL (Railway-managed) |
| **Vector Store** | Qdrant (3 collections: raw_memories, compacted_memories, entity_index) |
| **Graph Store** | FalkorDB (entity relationship graph, co-occurrence tracking) |
| **Semantic Backup** | Pinecone (secondary vector store, nightly sync from Qdrant) |
| **Fast LLM** | Cerebras API (used for compaction summarization — fast inference) |
| **Build** | Vite (client), esbuild (server) |
| **Validation** | Zod schemas (shared between client/server) |
| **Auth** | Session-based (SB-OS existing) — Clerk for all new Vercel-hosted ventures |
| **Session Storage** | PostgreSQL via connect-pg-simple |
| **Rich Text Editor** | BlockNote for document editing |
| **AI (primary)** | OpenRouter API / Kilocode — multi-model cascade |
| **AI (fallback 1)** | OpenAI API |
| **AI (fallback 2)** | Google AI (Gemini) — last resort |
| **AI (fast)** | Cerebras API — compaction summarization |

---

## 3. Project Structure

```
/.agent-os      Agent OS standards and product documentation
  /product      Product specs, roadmap, decisions, code standards
    mission.md          Product mission and vision
    mission-lite.md     Condensed mission for AI context
    tech-stack.md       Technical architecture and hosting matrix
    roadmap.md          Development phases and feature list
    decisions.md        Architectural decision log
    code-style.md       Code style rules and engineering philosophy
    dev-best-practices.md  Development practices, AI-native principles
  /specs        Feature specs (created per-feature via /create-spec)
/client         React frontend (Vite + TypeScript)
  /src
    /components   UI components (shadcn/ui + custom)
      /ui         45+ shadcn/ui components
    /pages        26 page components
    /lib          Utilities and helpers
    /hooks        Custom React hooks
/server         Express backend (Node.js + TypeScript)
  index.ts        Main entry point
  routes.ts       API route definitions (entry, delegates to /routes/*)
  storage.ts      Database abstraction layer (100+ methods)
  integrations.ts Integration configuration
  logger.ts       Structured logging utility
  /agents         Multi-agent OS (see Section 17)
    agent-chat.ts           Multi-turn chat loop with loop detection
    agent-task.ts           Delegated task execution loop
    agent-runtime.ts        Core execution orchestration
    agent-registry.ts       Agent CRUD and slug lookup
    agent-scheduler.ts      Cron-based agent job runner
    delegation-engine.ts    Hierarchical delegation + privilege attenuation
    message-bus.ts          Inter-agent messaging
    scheduled-jobs.ts       All registered job handlers (30+)
    /templates              Agent soul markdown files (seed data)
    /tools                  Tool implementations (web_search, deploy, etc.)
  /memory         Hybrid retrieval memory system (see Section 18)
    hybrid-retriever.ts     Triple-arm RRF search (Qdrant + PG + FalkorDB)
    qdrant-store.ts         Qdrant vector operations
    pinecone-store.ts       Pinecone backup store
    graph-store.ts          FalkorDB graph CRUD + fulltext index
    entity-extractor.ts     NLP entity extraction from messages
    entity-linker.ts        Link entities to memory payloads
    query-expander.ts       Synonym/context query expansion
    reranker.ts             Cross-encoder reranking
    retrieval-metrics.ts    In-memory ring buffer for arm latency/hit rates
    memory-lifecycle.ts     Decay + archival + backfill jobs
    schemas.ts              Zod schemas for all memory payload types
  /compaction     Session compaction pipeline (see Section 19)
    compactor.ts            Full 7-step compaction pipeline
    context-monitor.ts      In-memory message tracking per session
    cerebras-client.ts      Cerebras API client for fast summarization
    prompts.ts              Compaction + entity extraction prompt templates
    compaction-tuner.ts     Adaptive compaction threshold tuning
    memory-rescue.ts        Fallback recovery for failed compactions
  /channels       Channel adapters
    /adapters
      telegram-adapter.ts   Telegram bot (12 commands + @agent routing)
      whatsapp-adapter.ts   WhatsApp Cloud API adapter
  /infra          Infrastructure utilities
    tool-loop-detector.ts   Repetition detection + circuit breaker
    credential-proxy.ts     12-service credential registry
    context-budget.ts       Token budget management per agent
  /routes         Modular route files (agents, memory, automations, etc.)
  /integrations   External service clients (WHOOP, Google, etc.)
  /sync           Data sync jobs
  /voice          Voice integration
  /ws             WebSocket handlers
/shared         Shared Zod schemas and database types
  schema.ts       All entity schemas (40+ tables)
/migrations     Database migrations (auto-generated)
```

---

## 4. Development Commands

```bash
npm run dev      # Start development server with hot reload (port 5000)
npm run build    # Build client (Vite) and server (esbuild) for production
npm run start    # Run production build
npm run check    # TypeScript type checking
npm run db:push  # Push database schema changes to PostgreSQL
```

### Development Workflow

- Local development uses Vite dev middleware integrated into Express server
- Production build creates `/dist/public` (client) and `/dist/index.js` (server)
- Server serves static files from `/dist/public` in production

---

## 5. Architecture

### Monorepo Structure

```
/client   - React frontend (Vite + TypeScript)
/server   - Express backend (Node.js + TypeScript)
/shared   - Shared Zod schemas and database types
```

### Data Hierarchy & Relations

```
ventures (saas/media/realty/trading/personal)
  └── projects (product/marketing/ops/etc)
       └── phases (Phase 1, Phase 2, etc)
            └── tasks (atomic work items)
  └── aiAgentPrompts (venture-specific AI config)
  └── ventureConversations (AI chat history)

days (daily logs)
  └── tasks (scheduled for this day)
  └── healthEntries
  └── nutritionEntries
  └── morningRituals (JSON: pressUps, squats, supplements, water)
  └── eveningRituals (JSON: review, journal, gratitude, priorities)
  └── tradingJournal (JSON: sessions with P&L)

captureItems (inbox)
  └── can convert to tasks

docs (knowledge base)
  └── hierarchical (parentId, isFolder)
  └── attachments

tradingStrategies (templates)
  └── dailyTradingChecklists (daily instances)
```

---

## 6. Database Schema

All schemas defined with Zod in `/shared/schema.ts` for runtime validation. Use Drizzle ORM for queries.

### Core Tables (24+)

#### 6.1. users

User profile with authentication.

| Field | Type | Description |
|-------|------|-------------|
| `id` | serial | Primary key |
| `email` | string | Email address (unique) |
| `password` | string | Hashed password |
| `firstName` | string | First name |
| `lastName` | string | Last name |
| `timezone` | string | Default timezone |
| `lastLoginAt` | timestamp | Last login timestamp |
| `createdAt` | timestamp | Creation timestamp |

#### 6.2. userPreferences

User settings and configuration.

| Field | Type | Description |
|-------|------|-------------|
| `id` | serial | Primary key |
| `userId` | fk → users | Parent user |
| `theme` | string | UI theme preference |
| `morningRitualConfig` | json | Morning ritual settings |
| `notificationSettings` | json | Notification preferences |
| `aiContextInstructions` | text | Custom AI instructions |
| `updatedAt` | timestamp | Last update |

#### 6.3. customCategories

User-defined enum values.

| Field | Type | Description |
|-------|------|-------------|
| `id` | serial | Primary key |
| `userId` | fk → users | Parent user |
| `categoryType` | enum | `domain`, `task_type`, `focus_slot` |
| `value` | string | Category value |
| `label` | string | Display label |
| `color` | string | Display color |
| `order` | number | Sort order |

#### 6.4. auditLogs

Security audit trail.

| Field | Type | Description |
|-------|------|-------------|
| `id` | serial | Primary key |
| `userId` | fk → users | Acting user |
| `action` | string | Action performed |
| `entityType` | string | Entity type affected |
| `entityId` | string | Entity ID affected |
| `metadata` | json | Additional context |
| `ipAddress` | string | Client IP |
| `userAgent` | string | Client user agent |
| `createdAt` | timestamp | Timestamp |

#### 6.5. ventures

Business/personal initiatives (top level).

| Field | Type | Description |
|-------|------|-------------|
| `id` | serial | Primary key |
| `name` | string | Venture name |
| `status` | enum | `planning`, `building`, `on_hold`, `ongoing`, `archived` |
| `domain` | enum | `saas`, `media`, `realty`, `trading`, `personal`, `other` |
| `oneLiner` | string | One-sentence description |
| `primaryFocus` | text | Main strategic focus |
| `color` | string | Display color |
| `icon` | string | Display icon |
| `notes` | text | Additional notes |
| `createdAt` | timestamp | Creation timestamp |
| `updatedAt` | timestamp | Last update |

#### 6.6. projects

Concrete initiatives within ventures.

| Field | Type | Description |
|-------|------|-------------|
| `id` | serial | Primary key |
| `name` | string | Project title |
| `ventureId` | fk → ventures | Parent venture |
| `status` | enum | `not_started`, `planning`, `in_progress`, `blocked`, `done`, `archived` |
| `category` | enum | `marketing`, `sales_biz_dev`, `customer_success`, `product`, `tech_engineering`, `operations`, `research_dev`, `finance`, `people_hr`, `legal_compliance`, `admin_general`, `strategy_leadership` |
| `priority` | enum | `P0`, `P1`, `P2`, `P3` |
| `startDate` | date | Planned start |
| `targetEndDate` | date | Target completion |
| `actualEndDate` | date | Actual completion (nullable) |
| `outcome` | text | What success looks like |
| `notes` | text | Strategy, plan, links |
| `budget` | number | Budget amount |
| `budgetSpent` | number | Spent amount |
| `revenueGenerated` | number | Revenue generated |

#### 6.7. phases

Project phases and key deliverables.

| Field | Type | Description |
|-------|------|-------------|
| `id` | serial | Primary key |
| `name` | string | Phase name |
| `projectId` | fk → projects | Parent project |
| `status` | enum | Phase status |
| `order` | number | Display order |
| `targetDate` | date | Target date |
| `notes` | text | Phase notes |

#### 6.8. tasks

Atomic units of execution.

| Field | Type | Description |
|-------|------|-------------|
| `id` | serial | Primary key |
| `title` | string | Task title |
| `status` | enum | `idea`, `next`, `in_progress`, `waiting`, `done`, `cancelled`, `backlog` |
| `priority` | enum | `P0`, `P1`, `P2`, `P3` |
| `type` | enum | `business`, `deep_work`, `admin`, `health`, `learning`, `personal` |
| `domain` | enum | `home`, `work`, `health`, `finance`, `travel`, `learning`, `play`, `calls`, `personal` |
| `ventureId` | fk → ventures | Parent venture (nullable) |
| `projectId` | fk → projects | Parent project (nullable) |
| `phaseId` | fk → phases | Parent phase (nullable) |
| `dayId` | fk → days | Day explicitly scheduled (nullable) |
| `dueDate` | date | Hard deadline (nullable) |
| `focusDate` | date | Day planned to work on it |
| `focusSlot` | enum | Time slot (see Focus Slots) |
| `estEffort` | float | Estimated hours |
| `actualEffort` | float | Actual hours (nullable) |
| `notes` | text | Details, context, links |
| `tags` | text | Comma-separated tags |
| `completedAt` | timestamp | Completion timestamp |

#### 6.9. captureItems

GTD-style inbox for raw thoughts.

| Field | Type | Description |
|-------|------|-------------|
| `id` | serial | Primary key |
| `title` | text | Capture text |
| `type` | enum | `idea`, `task`, `note`, `link`, `reminder` |
| `source` | enum | `brain`, `whatsapp`, `email`, `meeting`, `web` |
| `domain` | enum | `work`, `health`, `finance`, `learning`, `personal` |
| `ventureId` | fk → ventures | Link to venture (nullable) |
| `projectId` | fk → projects | Link to project (nullable) |
| `linkedTaskId` | fk → tasks | If converted to task (nullable) |
| `clarified` | boolean | Has this been processed? |
| `notes` | text | Additional context |
| `clarifiedAt` | timestamp | When processed (nullable) |

#### 6.10. days

Daily logs (central hub for each day).

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Primary key (format: `day_YYYY-MM-DD`) |
| `date` | date | YYYY-MM-DD (unique) |
| `title` | string | Day theme/title |
| `mood` | enum | `low`, `medium`, `high`, `peak` |
| `top3Outcomes` | json | Three outcomes with completion status |
| `oneThingToShip` | text | Single most leveraged deliverable |
| `reflectionAm` | text | Morning intention |
| `reflectionPm` | text | Evening review |
| `primaryVentureFocus` | fk → ventures | Main venture for the day |
| `morningRituals` | json | `{ pressUps, squats, supplements, water }` |
| `eveningRituals` | json | `{ reviewCompleted, journalEntry, gratitude, tomorrowPriorities, windDown }` |
| `tradingJournal` | json | `{ sessions: [{ timestamp, sessionName, pnl, notes, lessons, emotionalState }] }` |

#### 6.11. healthEntries

Daily health metrics (one per day).

| Field | Type | Description |
|-------|------|-------------|
| `id` | serial | Primary key |
| `dayId` | fk → days | Parent day |
| `date` | date | Entry date |
| `sleepHours` | float | Hours slept |
| `sleepQuality` | enum | `poor`, `fair`, `good`, `excellent` |
| `energyLevel` | int | 1–5 scale |
| `mood` | enum | `low`, `medium`, `high`, `peak` |
| `steps` | int | Steps walked |
| `weightKg` | float | Weight in kg |
| `stressLevel` | enum | `low`, `medium`, `high` |
| `workoutDone` | boolean | Did workout happen? |
| `workoutType` | enum | `strength`, `cardio`, `yoga`, `sports`, `none` |
| `workoutDurationMin` | int | Workout duration in minutes |
| `tags` | text | Context tags |
| `notes` | text | Subjective context |

#### 6.12. nutritionEntries

Meal logs (multiple per day).

| Field | Type | Description |
|-------|------|-------------|
| `id` | serial | Primary key |
| `dayId` | fk → days | Parent day |
| `datetime` | timestamp | Date + time of meal |
| `mealType` | enum | `breakfast`, `lunch`, `dinner`, `snack` |
| `description` | string | Meal description |
| `calories` | float | Approximate calories |
| `proteinG` | float | Protein in grams |
| `carbsG` | float | Carbs in grams |
| `fatsG` | float | Fats in grams |
| `context` | enum | `home`, `restaurant`, `office`, `travel` |
| `tags` | text | Meal tags |
| `notes` | text | Additional context |

#### 6.13. docs

SOPs, prompts, playbooks, specs, templates with hierarchical organization.

| Field | Type | Description |
|-------|------|-------------|
| `id` | serial | Primary key |
| `title` | string | Doc title |
| `type` | enum | `page`, `sop`, `prompt`, `spec`, `template`, `playbook`, `strategy`, `tech_doc`, `process`, `reference`, `meeting_notes`, `research` |
| `domain` | enum | `venture_ops`, `marketing`, `product`, `sales`, `tech`, `trading`, `finance`, `legal`, `hr`, `personal` |
| `status` | enum | `draft`, `active`, `archived` |
| `ventureId` | fk → ventures | Parent venture (nullable) |
| `projectId` | fk → projects | Parent project (nullable) |
| `parentId` | fk → docs | Parent doc for hierarchy (nullable) |
| `isFolder` | boolean | Is this a folder? |
| `order` | number | Sort order within parent |
| `body` | text | Legacy markdown content |
| `content` | json | BlockNote JSON content |
| `metadata` | json | Additional metadata |
| `tags` | text | Tags for search |
| `coverImage` | string | Cover image URL |
| `icon` | string | Display icon |

#### 6.14. attachments

Files and images for docs.

| Field | Type | Description |
|-------|------|-------------|
| `id` | serial | Primary key |
| `docId` | fk → docs | Parent document |
| `filename` | string | Original filename |
| `mimeType` | string | File MIME type |
| `size` | number | File size in bytes |
| `storageType` | enum | `url`, `base64`, `local` |
| `storageUrl` | string | Storage location |
| `createdAt` | timestamp | Upload timestamp |

#### 6.15. shoppingItems

Shopping list with priorities.

| Field | Type | Description |
|-------|------|-------------|
| `id` | serial | Primary key |
| `title` | string | Item name |
| `quantity` | number | Quantity needed |
| `unit` | string | Unit of measure |
| `category` | enum | `groceries`, `personal`, `household`, `business` |
| `priority` | enum | `P1`, `P2`, `P3` |
| `status` | enum | `to_buy`, `purchased` |
| `store` | string | Preferred store |
| `notes` | text | Additional notes |
| `createdAt` | timestamp | Created timestamp |

#### 6.16. books

Reading list management.

| Field | Type | Description |
|-------|------|-------------|
| `id` | serial | Primary key |
| `title` | string | Book title |
| `author` | string | Author name |
| `status` | enum | `to_read`, `reading`, `finished` |
| `platform` | string | Reading platform |
| `rating` | number | Rating (1-5) |
| `notes` | text | Notes and highlights |
| `startedAt` | timestamp | Start date |
| `finishedAt` | timestamp | Finish date |

#### 6.17. tradingStrategies

Trading strategy templates with dynamic checklists.

| Field | Type | Description |
|-------|------|-------------|
| `id` | serial | Primary key |
| `name` | string | Strategy name |
| `description` | text | Strategy description |
| `isActive` | boolean | Currently active? |
| `isDefault` | boolean | Default strategy? |
| `sections` | json | Array of sections with checklist items |
| `createdAt` | timestamp | Created timestamp |
| `updatedAt` | timestamp | Last update |

**Section item types**: `checkbox`, `text`, `number`, `select`, `time`, `table`

#### 6.18. dailyTradingChecklists

Daily instances of trading strategy checklists.

| Field | Type | Description |
|-------|------|-------------|
| `id` | serial | Primary key |
| `date` | date | Trading date |
| `strategyId` | fk → tradingStrategies | Strategy template |
| `instrument` | string | Trading instrument |
| `session` | enum | `london`, `new_york`, `asian`, `other` |
| `mentalState` | number | Mental state (1-10) |
| `highImpactNews` | json | High impact news events |
| `primarySetup` | text | Primary setup description |
| `completedSections` | json | Completed checklist data |
| `trades` | json | Array of trades with entry/exit/pnl |
| `endOfSessionReview` | json | `{ followedPlan, noTradeIsSuccess, lessons }` |
| `createdAt` | timestamp | Created timestamp |

### AI & Automation Tables

#### 6.19. aiAgentPrompts

Venture-specific AI agent configuration.

| Field | Type | Description |
|-------|------|-------------|
| `id` | serial | Primary key |
| `ventureId` | fk → ventures | Parent venture (nullable for global) |
| `name` | string | Agent name |
| `systemPrompt` | text | System prompt |
| `capabilities` | json | Agent capabilities |
| `quickActions` | json | Quick action buttons |
| `knowledgeSources` | json | Knowledge source config |
| `isActive` | boolean | Currently active? |

#### 6.20. chatMessages

Web-based AI chat conversations.

| Field | Type | Description |
|-------|------|-------------|
| `id` | serial | Primary key |
| `role` | enum | `user`, `assistant`, `system` |
| `content` | text | Message content |
| `metadata` | json | Additional metadata |
| `createdAt` | timestamp | Timestamp |

#### 6.21. ventureConversations

Venture-scoped chat history.

| Field | Type | Description |
|-------|------|-------------|
| `id` | serial | Primary key |
| `ventureId` | fk → ventures | Parent venture |
| `role` | enum | `user`, `assistant` |
| `content` | text | Message content |
| `metadata` | json | Additional metadata |
| `createdAt` | timestamp | Timestamp |

#### 6.22. ventureContextCache

Cached context summaries for AI agents.

| Field | Type | Description |
|-------|------|-------------|
| `id` | serial | Primary key |
| `ventureId` | fk → ventures | Parent venture |
| `contextType` | string | Type of context |
| `content` | text | Cached content |
| `lastUpdated` | timestamp | Last rebuild |
| `expiresAt` | timestamp | Cache expiry |

#### 6.23. ventureAgentActions

Audit log for AI agent actions.

| Field | Type | Description |
|-------|------|-------------|
| `id` | serial | Primary key |
| `ventureId` | fk → ventures | Parent venture |
| `actionType` | string | Action type |
| `input` | text | Action input |
| `output` | text | Action output |
| `status` | enum | `pending`, `completed`, `failed` |
| `createdAt` | timestamp | Timestamp |

#### 6.24. sessions

Express session storage (managed by connect-pg-simple).

---

## 7. API Reference

All routes prefixed with `/api`. **157+ total endpoints**.

### Authentication & Settings
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | Login with email/password |
| POST | `/api/auth/logout` | Logout and destroy session |
| POST | `/api/auth/setup` | Initial user setup |
| POST | `/api/auth/change-password` | Change password |
| GET | `/api/auth/user` | Get current user |
| GET | `/api/auth/status` | Check auth status |
| GET | `/api/auth/csrf-token` | Get CSRF token |
| GET | `/api/settings/preferences` | Get user preferences |
| PATCH | `/api/settings/preferences` | Update preferences |
| GET | `/api/settings/morning-ritual` | Get morning ritual config |
| PATCH | `/api/settings/morning-ritual` | Update morning ritual config |
| GET | `/api/settings/ai` | Get AI settings |
| PATCH | `/api/settings/ai` | Update AI settings |

### Dashboard (Command Center V2)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/dashboard/readiness` | Health battery status |
| GET | `/api/dashboard/ventures` | Venture overview |
| GET | `/api/dashboard/inbox` | Capture items |
| GET | `/api/dashboard/tasks` | Today's tasks |
| GET | `/api/dashboard/urgent` | Urgent tasks + "On Fire" indicator |
| GET | `/api/dashboard/top3` | Top 3 priority tasks |
| GET | `/api/dashboard/day` | Current day data |
| GET | `/api/dashboard/next-meeting` | Next scheduled meeting |

### Ventures
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/ventures` | List all ventures |
| GET | `/api/ventures/:id` | Get single venture |
| POST | `/api/ventures` | Create venture |
| PATCH | `/api/ventures/:id` | Update venture |
| DELETE | `/api/ventures/:id` | Delete venture |

### Projects
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/projects` | List projects (`?ventureId=` filter) |
| GET | `/api/projects/:id` | Get single project |
| POST | `/api/projects` | Create project |
| PATCH | `/api/projects/:id` | Update project |
| DELETE | `/api/projects/:id` | Delete project |

### Phases
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/phases` | List phases (`?projectId=` filter) |
| GET | `/api/phases/:id` | Get single phase |
| POST | `/api/phases` | Create phase |
| PATCH | `/api/phases/:id` | Update phase |
| DELETE | `/api/phases/:id` | Delete phase |

### Tasks
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/tasks` | List tasks (filters: `ventureId`, `projectId`, `status`) |
| GET | `/api/tasks/today` | Get today's tasks |
| POST | `/api/tasks` | Create task |
| PATCH | `/api/tasks/:id` | Update task |
| DELETE | `/api/tasks/:id` | Delete task |

### Captures
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/captures` | List capture items |
| POST | `/api/captures` | Create capture |
| PATCH | `/api/captures/:id` | Update capture |
| DELETE | `/api/captures/:id` | Delete capture |
| POST | `/api/captures/:id/convert` | Convert capture to task |

### Days
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/days/today` | Get or create today's day record |
| GET | `/api/days/:date` | Get day by date (YYYY-MM-DD) |
| POST | `/api/days` | Create day record |
| PATCH | `/api/days/:id` | Update day |
| DELETE | `/api/days/:id` | Delete day |

### Health
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | List health entries |
| POST | `/api/health` | Create health entry |
| PATCH | `/api/health/:id` | Update health entry |
| DELETE | `/api/health/:id` | Delete health entry |

### Nutrition
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/nutrition` | List nutrition entries |
| POST | `/api/nutrition` | Create nutrition entry |
| PATCH | `/api/nutrition/:id` | Update nutrition entry |
| DELETE | `/api/nutrition/:id` | Delete nutrition entry |
| POST | `/api/nutrition/estimate-macros` | AI-powered macro estimation |

### Docs
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/docs` | List docs (filters: `venture_id`, `project_id`, `type`, `domain`, `status`, `parent_id`, `limit`, `offset`) |
| GET | `/api/docs/tree/:ventureId` | Get hierarchical doc tree for a venture |
| GET | `/api/docs/search?q=` | Search docs by query |
| GET | `/api/docs/children/:parentId` | Get direct children of a doc (use `null` for root level) |
| GET | `/api/docs/quality/review-queue` | Get docs needing quality review |
| GET | `/api/docs/quality/metrics` | Get overall doc quality metrics |
| GET | `/api/docs/:id` | Get single doc |
| GET | `/api/docs/:id/quality` | Get quality breakdown for a doc |
| POST | `/api/docs` | Create doc |
| PATCH | `/api/docs/:id` | Update doc |
| DELETE | `/api/docs/:id` | Delete doc |
| DELETE | `/api/docs/:id/recursive` | Delete doc and all children |
| POST | `/api/docs/reorder` | Reorder docs (for drag and drop) |
| POST | `/api/docs/:id/recalculate-quality` | Recalculate quality score |
| POST | `/api/docs/:id/mark-reviewed` | Mark doc as reviewed |
| GET | `/api/docs/:docId/attachments` | List attachments for a doc |
| POST | `/api/docs/:docId/attachments` | Upload attachment to a doc |
| DELETE | `/api/attachments/:id` | Delete attachment |

### Shopping
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/shopping` | List shopping items |
| POST | `/api/shopping` | Create shopping item |
| PATCH | `/api/shopping/:id` | Update shopping item |
| DELETE | `/api/shopping/:id` | Delete shopping item |

### Books
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/books` | List books |
| POST | `/api/books` | Create book |
| PATCH | `/api/books/:id` | Update book |
| DELETE | `/api/books/:id` | Delete book |

### Custom Categories
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/categories` | List custom categories |
| POST | `/api/categories` | Create category |
| PATCH | `/api/categories/:id` | Update category |
| DELETE | `/api/categories/:id` | Delete category |

### Intelligence (Jarvis)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/intelligence/daily` | Today's intelligence synthesis |
| GET | `/api/intelligence/history` | Past syntheses |
| POST | `/api/intelligence/run` | Manually trigger synthesis |
| GET | `/api/intelligence/email/triage` | Today's email triage |
| GET | `/api/intelligence/email/triage/:id` | Single triaged email |
| POST | `/api/intelligence/email/triage/run` | Trigger email triage |
| POST | `/api/intelligence/email/reply` | Send email reply |
| GET | `/api/intelligence/meeting-preps` | Meeting preps |
| POST | `/api/intelligence/meeting-preps/run` | Trigger meeting prep |
| GET | `/api/intelligence/nudges/stats` | Nudge response analytics |

### AI Chat
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/ai-models` | List available AI models |
| POST | `/api/chat` | Send chat message (rate limited) |
| GET | `/api/chat/history` | Get chat history |
| DELETE | `/api/chat/history` | Clear chat history |

### AI Agent Prompts
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/ai-agent-prompts` | List all prompts |
| GET | `/api/ai-agent-prompts/venture/:ventureId` | Get venture-specific prompt |
| POST | `/api/ai-agent-prompts` | Create prompt |
| PATCH | `/api/ai-agent-prompts/:id` | Update prompt |
| DELETE | `/api/ai-agent-prompts/:id` | Delete prompt |

### Venture AI
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/ventures/:ventureId/chat` | Venture-scoped chat |
| GET | `/api/ventures/:ventureId/chat/history` | Get venture chat history |
| GET | `/api/ventures/:ventureId/ai/context-status` | Get context cache status |
| POST | `/api/ventures/:ventureId/ai/rebuild-context` | Rebuild context cache |
| GET | `/api/ventures/:ventureId/ai/actions` | Get agent action history |

### Project Scaffolding
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/project-scaffolding/options` | Get scaffolding options |
| POST | `/api/project-scaffolding/generate` | Generate project scaffold |
| POST | `/api/project-scaffolding/commit` | Commit generated scaffold |

### Trading
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/trading-strategies` | List strategies |
| GET | `/api/trading-strategies/:id` | Get single strategy |
| GET | `/api/trading-strategies/default/active` | Get active default strategy |
| POST | `/api/trading-strategies` | Create strategy |
| POST | `/api/trading-strategies/seed` | Seed default strategies |
| PATCH | `/api/trading-strategies/:id` | Update strategy |
| DELETE | `/api/trading-strategies/:id` | Delete strategy |
| GET | `/api/trading-checklists` | List daily checklists |
| GET | `/api/trading-checklists/today` | Get today's checklist |
| POST | `/api/trading-checklists` | Create checklist |
| PATCH | `/api/trading-checklists/:id` | Update checklist |
| DELETE | `/api/trading-checklists/:id` | Delete checklist |

### Google Drive Integration
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/drive/status` | Get connection status |
| GET | `/api/drive/folders` | List folders |
| GET | `/api/drive/files` | List files |
| GET | `/api/drive/search` | Search files |
| POST | `/api/drive/sync` | Sync files |
| ... | ... | 15+ additional drive endpoints |

---

## 8. Key Files

### Server

#### `server/index.ts`
Main entry point that:
- Sets up Express app with Vite dev middleware (dev) or static serving (prod)
- Configures session management with PostgreSQL storage
- Registers API routes and error handlers
- Sets up CSRF protection

#### `server/storage.ts`
Database abstraction layer (`DBStorage` class):
- Implements `IStorage` interface for all database operations
- Uses Drizzle ORM with Neon serverless PostgreSQL
- 100+ methods for all entities
- Handles ventures, projects, tasks, phases, captures, days, health, nutrition, docs, trading, shopping, books, AI

#### `server/routes.ts`
All API route definitions and handlers (147+ routes).

#### `server/integrations.ts`
Integration configuration for external services.

### Client

#### `client/src/App.tsx`
Main router with authentication guards using Wouter and TanStack Query for user state.

#### `client/src/pages/` (26 Pages)

| File | Route | Description |
|------|-------|-------------|
| `landing.tsx` | `/` | Unauthenticated landing page |
| `command-center-v2.tsx` | `/dashboard` | **Main HUD** - Readiness, health battery, top 3, urgent tasks |
| `command-center.tsx` | `/command-center` | Legacy daily overview |
| `venture-hq.tsx` | `/ventures` | Ventures grid and overview |
| `venture-detail.tsx` | `/ventures/:id` | Single venture with projects, tasks, docs |
| `health-hub.tsx` | `/health-hub` | Health metrics tracking and calendar |
| `nutrition-dashboard.tsx` | `/nutrition` | Meal logging and macro tracking |
| `knowledge-hub.tsx` | `/knowledge` | Docs library with search and filters |
| `doc-detail.tsx` | `/knowledge/:id` | Single document view/edit with BlockNote |
| `deep-work.tsx` | `/deep-work` | Weekly calendar and focus session planning |
| `notifications.tsx` | `/notifications` | Notification history |
| `settings.tsx` | `/settings` | Main settings page |
| `settings-ai.tsx` | `/settings/ai` | AI assistant configuration |
| `settings-integrations.tsx` | `/settings/integrations` | Integration status and config |
| `settings-categories.tsx` | `/settings/categories` | Custom domain/task type/slot config |
| `calendar.tsx` | `/calendar` | Monthly calendar with task/event overlay |
| `morning-ritual.tsx` | `/morning`, `/morning/:date` | Morning habits tracking |
| `evening-review.tsx` | `/evening`, `/evening/:date` | Daily reflection + tomorrow planning |
| `shopping.tsx` | `/shopping` | Shopping list with priorities |
| `books.tsx` | `/books` | Reading list management |
| `capture.tsx` | `/capture` | Raw idea capture interface |
| `trading.tsx` | `/trading` | Trading dashboard with strategies |
| `ai-chat.tsx` | `/ai-chat` | General AI assistant chat |
| `all-tasks.tsx` | `/tasks` | Comprehensive task list view |

#### `client/src/components/ui/*`
45+ shadcn/ui components - prefer these over creating custom components.

#### `client/src/components/`
Feature-specific components:
- `cockpit-components.tsx` - HealthBattery, ContextCard, MissionStatement
- `trading-strategies-manager.tsx` - Strategy CRUD
- `trading-strategy-dashboard.tsx` - Strategy execution view
- `trading-session-indicator.tsx` - Live trading session clocks
- `capture-modal.tsx` - Quick capture interface
- `task-detail-modal.tsx` - Task detail and editing
- `create-task-modal.tsx` - Task creation interface
- `layout.tsx` - Main layout wrapper with sidebar/topbar

#### `client/src/hooks/`
Custom React hooks:
- `useAuth` - Authentication state
- `useToast` - Toast notifications
- `use-attachments` - Document attachments
- `use-backlinks` - Document backlinks
- `use-doc-search` - Document search
- `use-templates` - Document templates
- `use-mobile` - Mobile detection
- `use-sidebar-collapsed` - Sidebar state

#### `client/src/lib/`
Utilities:
- `queryClient.ts` - TanStack Query configuration
- `daily-reminders.ts` - Daily reminder system
- `notification-store.ts` - Notification management
- `doc-templates.ts` - Document templates
- `saved-meals.ts` - Meal templates
- `task-celebrations.ts` - Task completion celebrations
- `export-utils.ts` - Export functionality
- `browser-notifications.ts` - Browser notification API

---

## 9. UX Modules & Screens

### 9.1. Command Center V2 (Main Dashboard)

The primary HUD interface at `/dashboard`.

**Components:**
- **Health Battery**: Visual readiness indicator based on sleep, energy, mood
- **Today Overview**: Day title, date, primary venture focus
- **Top 3 Outcomes**: Priority tasks with completion status
- **One Thing to Ship**: Single most leveraged deliverable
- **Urgent Tasks**: "On Fire" indicator for overdue/critical items
- **Tasks: Today**: Filtered by `focusDate = today` OR `dueDate = today`
- **Inbox Snapshot**: Unclarified capture items
- **Next Meeting**: Upcoming calendar event

### 9.2. Morning Ritual Page

Daily morning habits tracking at `/morning`.

**Components:**
- **Press-Ups Counter**: Daily press-up goal and tracking
- **Squats Counter**: Daily squat goal and tracking
- **Supplements Checklist**: Daily supplement tracking
- **Water Intake**: Hydration tracking (500ml target)
- **Day Planning**: Set top 3 outcomes and one thing to ship

### 9.3. Evening Review Page

Daily reflection workflow at `/evening`.

**Components:**
- **Day Review**: Completed status of outcomes
- **Journal Entry**: Free-form reflection
- **Gratitude**: What went well
- **Tomorrow Priorities**: Next day planning
- **Wind-Down Checklist**: Evening routine items

### 9.4. Venture HQ

High-level view of all ventures with drill-down.

**Components:**
- **Venture Dashboard**: List of ventures with status, project count, task count
- **Venture Detail View**:
  - Projects Board (Kanban or list by status)
  - Tasks List (grouped by project)
  - Docs & SOPs
  - AI Agent (venture-scoped chat)
  - Metrics

### 9.5. Trading Dashboard

Comprehensive trading system at `/trading`.

**Components:**
- **Trading Session Indicator**: Live clocks showing London, New York, Asian sessions with killzone highlighting
- **Strategy Manager**: Create and manage trading strategies with dynamic checklists
- **Daily Checklist**: Execute strategy checklist for the day
- **Session Selector**: Choose trading session (London, NY, Asian)
- **Trade Logger**: Log individual trades with entry/exit/pnl
- **End of Session Review**: Lessons learned, followed plan, no-trade-is-success
- **Trading Journal**: Historical session entries with P&L

### 9.6. Deep Work & Planning

Dedicated view for planning and executing deep work sessions.

**Components:**
- **Deep Work Queue**: Tasks filtered by `type = deep_work`
- **Weekly Calendar**: 7 days × focus slots grid with drag-and-drop
- **Focus Session Timer**: Track actual effort

### 9.7. Health & Performance Hub

Track health metrics and correlate with performance.

**Components:**
- **Health Calendar**: 30-day view with color-coded energy/mood
- **Health Table**: Last 30 entries with all metrics
- **Weekly/Monthly Summary**: Averages and trends

### 9.8. Nutrition Dashboard

Track meals, macros, and nutrition trends.

**Components:**
- **Today's Meals**: List with macro totals
- **Weekly Summary**: Daily calories/protein chart
- **Add/Edit Meal**: Form with AI-powered macro estimation
- **Saved Meals**: Quick-add frequent meals

### 9.9. Knowledge Hub

Central repository for SOPs, prompts, playbooks.

**Components:**
- **Hierarchical Tree**: Folder-based document organization
- **Knowledge Library**: Tabs for All, SOPs, Prompts, Playbooks, Specs
- **Search**: By title, tags, domain, venture
- **Doc Detail View**: BlockNote rich text editor with attachments

### 9.10. Calendar View

Monthly calendar at `/calendar`.

**Components:**
- **Month View**: Days with task/event indicators
- **Day Detail**: Tasks scheduled for selected day
- **Quick Add**: Create tasks for specific dates

### 9.11. All Tasks View

Comprehensive task list at `/tasks`.

**Components:**
- **Task List**: All tasks with filters
- **Status Filter**: Filter by status
- **Venture Filter**: Filter by venture
- **Priority Sort**: Sort by priority

### 9.12. Shopping List

Shopping management at `/shopping`.

**Components:**
- **Item List**: Shopping items by category
- **Priority Badges**: P1/P2/P3 indicators
- **Quick Add**: Fast item creation
- **Purchase Toggle**: Mark items as purchased

### 9.13. Books

Reading list at `/books`.

**Components:**
- **Book List**: Books by status (to-read, reading, finished)
- **Notes**: Reading notes and highlights
- **Progress Tracking**: Start/finish dates

### 9.14. AI Chat

General AI assistant at `/ai-chat`.

**Components:**
- **Chat Interface**: Message history with streaming responses
- **Model Selector**: Choose AI model
- **Clear History**: Reset conversation

---

## 10. Focus Slots (Time Blocking)

Tasks can be assigned to specific time blocks for scheduling:

| Slot | Time | Purpose |
|------|------|---------|
| `deep_work_1` | 9-11am | Deep strategic/creative work |
| `deep_work_2` | 2-4pm | Deep execution work |
| `admin_block_1` | 11am-12pm | Email, admin, quick tasks |
| `admin_block_2` | 4-5pm | Wrap up, admin |
| `morning_routine` | 6-9am | Health, planning, breakfast |
| `evening_review` | 5-6pm | Review, reflection, planning |
| `meetings` | Anytime | Meetings, calls |
| `buffer` | Anytime | Flex time, unexpected |

---

## 11. Automation & Logic Layer

### 11.1. Daily Day Record Auto-Creation

**Trigger**: First load of Command Center each day

**Logic**: If no Day record exists for today, create one with default values.

### 11.2. Task Surfacing: Today's Tasks

**Trigger**: Load Command Center

**Logic**:
```sql
SELECT * FROM tasks
WHERE status NOT IN ('done', 'cancelled')
  AND (focus_date = today OR due_date = today OR day_id = today_id)
ORDER BY priority ASC, focus_slot ASC
```

### 11.3. Capture → Task Conversion

**Trigger**: User clicks "Convert to Task"

**Logic**:
1. Create Task with capture's title, notes, venture/project
2. Update Capture: set `linkedTaskId`, `clarified = true`, `clarifiedAt = now()`

### 11.4. Health/Nutrition → Day Linking

**Trigger**: User logs entry

**Logic**: Ensure Day record exists for the date, link entry to Day.

### 11.5. Project Status Auto-Suggest

**Trigger**: Task marked done

**Logic**: If all project tasks are done, suggest marking project as done.

### 11.6. Task → Day Auto-Linking

**Trigger**: Task scheduled to focus slot

**Logic**: Create/get Day for selected date, link task via `dayId` and `focusDate`.

### 11.7. Trading Session Detection

**Trigger**: Trading page load

**Logic**: Show active trading sessions based on current time:
- London: 8am-4pm GMT
- New York: 1pm-9pm GMT (8am-4pm EST)
- Asian: 11pm-7am GMT

### 11.8. AI Context Caching

**Trigger**: Venture chat or context rebuild

**Logic**: Cache venture context (projects, tasks, docs) for faster AI responses.

---

## 12. Integration Points

### 12.1. Google Drive Integration ✅

- File sync and search
- Folder management
- Document import/export

### 12.2. Gmail ✅

- Email triage via `email-triage.ts` agent job
- `/api/intelligence/email/*` endpoints
- Telegram `/emails` and `/reply` commands

### 12.3. Telegram Bot ✅ (`@SBNexusBot`)

- 12 commands — see Mobile Access section
- `@agent-slug <msg>` routing to any agent
- `/btw <msg>` for no-history side questions
- Webhook at `/api/webhooks/telegram`

### 12.4. WhatsApp ✅

- Cloud API integration via `whatsapp-adapter.ts`
- Webhook at `/api/webhooks/whatsapp`
- Inbound routing by phone number
- Arabic auto-detect

### 12.5. WHOOP Band ✅

- OAuth2 flow (`integration_tokens` table)
- Syncs: recovery, HRV, RHR, strain, sleep, workouts
- Env vars: `WHOOP_CLIENT_ID`, `WHOOP_CLIENT_SECRET`, `WHOOP_REDIRECT_URI`
- Sync button on Health Hub header
- Endpoints: `GET /api/whoop/status`, `POST /api/whoop/sync`

### 12.6. AI Integration ✅

- Multi-model support via OpenRouter
- Venture-specific AI agents
- Context-aware responses
- Macro estimation for nutrition
- Model failover health monitor: `GET /api/providers/health`

### 12.7. Google Calendar (Planned)

- Map tasks with `focusDate + focusSlot` → GCal events

### 12.8. TickTick Integration ✅

Mobile capture via TickTick app synced to SB-OS inbox.

**Features:**
- One-way sync: TickTick inbox → SB-OS capture items
- Designate a "SB-OS Inbox" list in TickTick for mobile captures
- Sync pulls incomplete tasks and creates capture items
- Optional: Auto-complete TickTick tasks after sync
- Deduplication via `externalId` field

**API Endpoints:**
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/ticktick/status` | Check connection status |
| GET | `/api/ticktick/projects` | List all TickTick projects |
| GET | `/api/ticktick/projects/:id/tasks` | Get tasks from a project |
| POST | `/api/ticktick/inbox/setup` | Create/find SB-OS Inbox project |
| POST | `/api/ticktick/sync` | Sync inbox tasks to captures |
| POST | `/api/ticktick/tasks/:id/complete` | Complete a task in TickTick |
| POST | `/api/ticktick/tasks` | Create a task in TickTick |

**Workflow:**
1. Set `TICKTICK_ACCESS_TOKEN` in environment
2. Call `POST /api/ticktick/inbox/setup` to create inbox list
3. Add tasks to "SB-OS Inbox" list in TickTick mobile app
4. Call `POST /api/ticktick/sync` to pull tasks into SB-OS captures
5. Process captures in SB-OS (convert to tasks, clarify, etc.)

---

## 13. Environment Configuration

Required environment variables (`.env`):

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host/db` |
| `SESSION_SECRET` | Express session encryption key | Random string |
| `PORT` | Server port | `5000` |
| `NODE_ENV` | Environment | `development` or `production` |

Optional:
| Variable | Description |
|----------|-------------|
| `OPENROUTER_API_KEY` | OpenRouter API key for AI features + agent system |
| `CEREBRAS_API_KEY` | Cerebras API for fast compaction summarization |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token (@SBNexusBot) |
| `AUTHORIZED_TELEGRAM_CHAT_IDS` | Comma-separated authorized Telegram chat IDs |
| `TELEGRAM_WEBHOOK_URL` | Webhook URL for production Telegram mode |
| `TELEGRAM_WEBHOOK_SECRET` | Webhook secret for validation |
| `BRAVE_SEARCH_API_KEY` | For agent web_search tool (falls back to LLM knowledge) |
| `VERCEL_TOKEN` | For agent deploy tool — Vercel deployments |
| `VERCEL_TEAM_ID` | For agent deploy tool — Vercel team scope |
| `RAILWAY_TOKEN` | For agent deploy tool — Railway deployments |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `QDRANT_URL` | Qdrant vector store URL |
| `QDRANT_API_KEY` | Qdrant API key |
| `PINECONE_API_KEY` | Pinecone secondary vector store |
| `PINECONE_INDEX` | Pinecone index name |
| `FALKORDB_URL` | FalkorDB graph store URL |
| `FALKORDB_PASSWORD` | FalkorDB password |
| `WHOOP_CLIENT_ID` | WHOOP OAuth2 client ID |
| `WHOOP_CLIENT_SECRET` | WHOOP OAuth2 client secret |
| `WHOOP_REDIRECT_URI` | WHOOP OAuth2 redirect URI |
| `WHATSAPP_ACCESS_TOKEN` | WhatsApp Cloud API token |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp phone number ID |
| `WHATSAPP_VERIFY_TOKEN` | Webhook verification token |
| `MEMORY_API_KEY` | Bearer token for `/api/memory/ingest-markdown` (Claude Code hook) |
| `TICKTICK_ACCESS_TOKEN` | TickTick OAuth access token for mobile capture |
| `TICKTICK_INBOX_PROJECT_ID` | (Optional) Specific TickTick project ID for inbox |
| `TICKTICK_INBOX_NAME` | (Optional) Name of inbox project (default: "SB-OS Inbox") |

---

## 14. Code Patterns

### Type Safety
- Use path aliases: `@/` for client code, `@shared/` for shared schemas
- Strict TypeScript enabled - all code must type-check with `npm run check`
- Zod schemas in `/shared/schema.ts` are source of truth for validation
- Use `drizzle-zod` for database schema type inference

### API Communication
- Frontend uses TanStack Query with `apiRequest` helper from `client/src/lib/utils.ts`
- All API calls include credentials for session cookies
- Query keys follow pattern: `["resource", id]` (e.g., `["ventures"]`, `["tasks"]`)

### Error Handling
- Express global error handler catches all route errors
- Zod validation errors return 400 with validation messages
- Database errors logged and return 500

### Session Management
- Sessions stored in PostgreSQL via `connect-pg-simple`
- Session cookie name: `connect.sid`
- Password-protected authentication

### Database Migrations
- Schema changes go in `/shared/schema.ts`
- Run `npm run db:push` to apply changes (Drizzle Kit auto-generates migrations)
- Migrations stored in `/migrations` directory
- DO NOT manually edit migration files

### Component Patterns
- Use shadcn/ui components from `/components/ui/`
- Feature components in `/components/`
- Pages in `/pages/`
- Custom hooks in `/hooks/`

---

## 15. Common Development Tasks

### Adding a New API Route
1. Define Zod schema in `/shared/schema.ts` if needed
2. Add route handler in `server/routes.ts`
3. Update frontend API call in appropriate page component
4. Use TanStack Query for data fetching/mutations

### Modifying Database Schema
1. Update schema in `/shared/schema.ts`
2. Run `npm run db:push` to apply changes
3. Check `/migrations` for generated migration file
4. Update relevant `storage.ts` methods if needed

### Adding shadcn/ui Components
Components are already installed. To add new ones:
```bash
npx shadcn-ui@latest add [component-name]
```
Components appear in `client/src/components/ui/`.

### Adding a New Page
1. Create page component in `client/src/pages/`
2. Add route in `client/src/App.tsx`
3. Add navigation link if needed
4. Use TanStack Query for data fetching

---

## 16. Roadmap

### Phase 1: Foundation ✅ COMPLETE
- ✅ Core entities (ventures, projects, tasks, captures, docs)
- ✅ Health & nutrition tracking
- ✅ Daily planning hub (days table)
- ✅ Phases for project organization
- ✅ Budget tracking for projects
- ✅ Focus slot scheduling system

### Phase 2: Daily Operations ✅ COMPLETE
- ✅ Command Center V2 (HUD dashboard)
- ✅ Morning ritual page
- ✅ Evening review workflow
- ✅ Task-to-slot assignment UI
- ✅ Calendar view
- ✅ All tasks view

### Phase 3: AI Integration ✅ COMPLETE
- ✅ Multi-model AI chat (OpenRouter)
- ✅ Venture-specific AI agents
- ✅ Context caching for faster responses
- ✅ AI-powered macro estimation
- 🚧 Telegram bot for quick capture (planned)

### Phase 4: Trading Module ✅ COMPLETE
- ✅ Trading strategy templates
- ✅ Daily trading checklists
- ✅ Session tracking (London, NY, Asian)
- ✅ Trade logging with P&L
- ✅ Trading session indicator with killzones
- ✅ End-of-session review

### Phase 5: Life Management ✅ COMPLETE
- ✅ Shopping list with priorities
- ✅ Books/reading list
- ✅ Custom categories (user-defined enums)
- ✅ User preferences and settings

### Phase 6: Integrations ✅ COMPLETE
- ✅ Google Drive sync
- ✅ Gmail triage + reply via agents
- ✅ Telegram bot (12 commands, @agent routing)
- ✅ WhatsApp Cloud API (bidirectional, Arabic auto-detect)
- ✅ WHOOP band (OAuth2, health data auto-sync)
- 🚧 Google Calendar sync (planned)

### Phase 7: Agent OS ✅ COMPLETE
- ✅ Hierarchical multi-agent system (21 agents)
- ✅ Delegation engine with privilege attenuation
- ✅ Tool loop detection + circuit breaker
- ✅ Scheduled jobs (30+ handlers)
- ✅ Agent metrics dashboard (`/api/agents/metrics`)
- ✅ Session isolation (sessionId per platform:sender)
- ✅ Credential proxy (12-service registry)
- ✅ Browser automation (Playwright, 6 actions)

### Phase 8: Memory & Intelligence ✅ COMPLETE
- ✅ Qdrant vector store (3 collections)
- ✅ FalkorDB graph store + fulltext index
- ✅ Pinecone secondary store + nightly sync
- ✅ Hybrid triple-arm retriever (RRF fusion)
- ✅ Session compaction pipeline (Cerebras)
- ✅ Entity extraction + co-occurrence tracking
- ✅ Retrieval metrics (`GET /api/memory/metrics`)
- ✅ Memory decay + archival jobs
- ✅ Claude Code hooks → Qdrant bridge

### Phase 9: Optimization ✅ COMPLETE
- ✅ React.lazy + Suspense on 29 pages (3.8MB → 549KB main bundle)
- ✅ Vite manualChunks for BlockNote/Recharts
- ✅ FalkorDB fulltext index (O(n) → O(log n) entity search)
- ✅ Pinecone backfill auto-trigger on startup if 0 records
- ✅ 32 critical path Vitest tests (delegation, memory, retrieval, scheduler)

### Phase 10: Registries & Lifestyle ✅ COMPLETE
- ✅ Domains registry (`domains` table, `/api/domains`)
- ✅ AI Models registry (`ai_models_registry`, `/api/ai-models-registry`, 16 providers)
- ✅ Mantras/rules (`mantras` table, `/api/mantras/today` filters by day)
- ✅ MantraBanner on /today page (gym schedule + rules + mantras)
- ✅ /today page rebalance (Left: habits/health/evening; Right: day plan/admin/meals)

### Phase 11: Testing & Real Use ✅ COMPLETE
- DB wiped clean (tasks, projects, phases cleared)
- Testing all systems with real data from scratch

### Phase 12: AI-Native Swarm + Telegram Topics ✅ COMPLETE (2026-04-11 to 2026-04-14)
- ✅ Command Center V4 + OKR system (`0477abb`, `d6dc93e`)
- ✅ Model cascade bulletproofed — 8-shot fallback across 5 providers (`294f34b`)
- ✅ Wave 4 AI-Native Swarm — proactive morning loop (7:30am Dubai), NL write tools, event bus (`f2f7bfd`)
- ✅ Catch-Up Scheduler — `agent_job_runs` table, missed cron recovery, Telegram alert (`888bd3c`)
- ✅ Real BM25 + Benchmark Harness — `plainto_tsquery`, GIN index, R@5=1.000 baseline (`86e8070`)
- ✅ Wave 5 Telegram Topics Phase 1 — `telegram_topic_map`, 13 topics, full routing pipeline (`c48bbd9`)
- ✅ Wave 5.1 Auto-Topic + Orphan Cleanup — auto-create topic on venture creation, pin script (`6e9b5e6`)
- ✅ Wave 5.2 Delegation Execution Gap Fixed — all delegation surfaces now auto-execute tasks (`4760128`)
- ✅ Telegram Topics Phase 2/3/4 — inbound context injection, NL inbox routing, pinned KR cards (`4686969`)
- ✅ Trading Command Center — `/trading` with session indicator, ForexFactory calendar, Dubai TZ (`72bebf4`)

### Phase 13: Agent OS Standards ✅ COMPLETE (2026-04-17)
- ✅ `.agent-os/product/` — mission, tech-stack (hosting matrix, Clerk, LLM cascade), roadmap, decisions (`6dc8d6b`)
- ✅ `code-style.md` — engineering philosophy, legibility rules, TS/React/API/DB patterns
- ✅ `dev-best-practices.md` — AI-native principles as top constraint, TDD, deployment, security
- ✅ Tech stack locked: Clerk (Vercel ventures), Neon (Vercel DB), Railway PG (Railway DB), OpenRouter/Kilocode→OpenAI→Google

### Phase 14: Venture Onboarding System 🔲 PLANNED
- 🔲 `server/agents/venture-onboarding.ts` — venture type classifier, checklist filter, bulk task creator
- 🔲 Google Drive scaffolder — `Ventures/{Name}/Brand/Legal/Content/Ops/` auto-created on venture creation
- 🔲 Launch Readiness writer — updates `memory-system/{venture}.md` with per-category status
- 🔲 Trigger on `POST /api/ventures` + manual button on venture detail page
- 🔲 Skills: `brand-identity-builder`, `legal-scaffolder`, `content-strategy-builder`, `offer-architect`
- See `.agent-os/product/roadmap.md` for full 3-phase breakdown

---

## 17. Agent Operating System

The hierarchical multi-agent system lives entirely in `server/agents/`. Agents are defined as markdown "soul" files with YAML frontmatter, seeded into the `agents` DB table.

### 17.1. Agent Hierarchy

```
user
 └── chief-of-staff (executive)
      ├── cmo (manager)
      │    ├── smm-syntheliq (specialist)
      │    └── script-writer-syntheliq (specialist)
      ├── cto (manager)
      │    └── task-automation-scout (worker)
      └── ... (21 total agents)
```

Roles: `executive` → `manager` → `specialist` → `worker`. Delegation only goes **down** the org chart.

### 17.2. Agent Soul Frontmatter

```yaml
---
name: Chief of Staff
slug: chief-of-staff
role: executive
parent: user
venture: null
expertise: [strategic_planning, delegation, oversight]
tools: [create_task, update_task, send_telegram, web_search]
permissions: [read_all, write_tasks, send_messages]
delegates_to: [cmo, cto, cfo]
max_delegation_depth: 2
model_tier: top          # auto | top | mid | fast | local
temperature: 0.7
schedule:
  daily_briefing: "0 7 * * *"   # 7am daily (Asia/Dubai)
memory_scope: shared    # isolated | shared | inherit_parent
---
```

### 17.3. Delegation Engine (`delegation-engine.ts`)

Implements DeepMind Feb 2026 privilege attenuation rules:
- **canDelegateTo check**: agent can only delegate to slugs in its `canDelegateTo` list
- **Depth enforcement**: `currentDepth < maxDelegationDepth` (known bug: `|| 2` fallback means `0` is treated as `2`)
- **Circular detection**: delegation chain array prevents A→B→A loops
- **Privilege attenuation**: delegated task gets `INTERSECTION(delegator.permissions, requested.permissions)` — never more than delegator has
- **Full audit trail**: every delegation logged to `agent_tasks` table with chain

### 17.4. Tool Loop Detection (`infra/tool-loop-detector.ts`)

`ToolLoopDetector` class used in every `agent-chat.ts` execution:
- Tracks tool call history per session turn
- Detects repetitive patterns (same tool, same args repeatedly)
- Severities: `warning` (inject guidance message) → `circuit_breaker` (force final response, no more tool calls)
- Prevents infinite agent loops that waste tokens

### 17.5. Agent API Endpoints

```
GET    /api/agents                          List all agents
GET    /api/agents/:slug                    Get agent by slug
POST   /api/agents/:slug/chat               Chat with agent
GET    /api/agents/:slug/conversations      Chat history
DELETE /api/agents/:slug/conversations      Clear history
POST   /api/agents/admin/seed               Seed agent templates
GET    /api/agents/metrics?days=7           Per-agent metrics (chats, cost, tokens)
POST   /api/agents/:slug/trigger-schedule   Manually trigger a scheduled job
DELETE /api/agents/:slug/conversations      Clear agent conversation history
GET    /api/agents/delegation-log           Full delegation audit log
POST   /api/agents/task-queue/process       Process pending delegated tasks
GET    /api/providers/health                Model failover health status (60s cache)
```

### 17.6. Scheduled Jobs (30+ registered)

All jobs registered via `registerJobHandler()` in `scheduled-jobs.ts`. Key jobs:

| Job | Schedule | Description |
|-----|----------|-------------|
| `daily_briefing` | 7am daily | Morning intelligence synthesis |
| `evening_review` | 6pm daily | Evening task review |
| `scan_backlog` | 8am, 1pm, 6pm | Task Automation Scout tags `agent-ready` tasks |
| `embedding_backfill` | startup | Backfills Pinecone if 0 records |
| `memory_cleanup` | weekly | Archives stale memories |
| `qdrant_archive_stale` | weekly | Archive raw >90d + <0.4 importance |
| `github_actions_sha_audit` | Mon 6am | Checks unpinned GitHub Actions, Telegrams if found |
| `pipeline_health_check` | periodic | Checks all integration pipelines |
| `knowledge_extraction` | daily | Extracts knowledge from conversation logs |

### 17.7. New DB Tables (Agents)

| Table | Purpose |
|-------|---------|
| `agents` | Agent definitions (slug, role, permissions, model, schedule, etc.) |
| `agent_tasks` | Delegated task queue with delegation chain + status |
| `agent_conversations` | Per-agent chat history with `sessionId` for isolation |
| `automations` | Cron + webhook automation rules with `timezone` column |
| `content_queue` | Agent-generated content pending review (social_post, video_script, carousel) |
| `integration_tokens` | OAuth2 tokens (WHOOP, Google, etc.) |
| `domains` | Owned domains registry (offplandub.ai, etc.) |
| `ai_models_registry` | AI models catalog (16 providers seeded) |
| `mantras` | Daily mantras/rules filtered by day of week |

---

## 18. Memory System

The memory pipeline turns every agent conversation into searchable, structured long-term memory.

### 18.1. Architecture Overview

```
Agent conversation
    │
    ▼
Context Monitor (in-memory ring buffer)
    │
    ▼
Compactor (7-step pipeline) ──► Cerebras (fast summarization)
    │                                │
    ├── raw_memories (Qdrant)        │
    ├── compacted_memories (Qdrant) ◄┘
    ├── entity_index (Qdrant)
    └── Entity graph (FalkorDB)
         │
         ▼
    Pinecone (nightly sync / backup)
```

### 18.2. Qdrant Collections

| Collection | Content | Decay Policy |
|------------|---------|--------------|
| `raw_memories` | Individual messages | Archive >90d + importance <0.4 |
| `compacted_memories` | Session summaries | Archive >180d + importance <0.5 |
| `entity_index` | Named entities (people, ventures, tools) | No decay |

All collections use `archived: true` field + `must_not: archived:true` filter on all searches.

### 18.3. Hybrid Retriever — Triple-Arm RRF

Three retrieval arms fused via Reciprocal Rank Fusion:

| Arm | Source | RRF Weight |
|-----|--------|------------|
| Vector | Qdrant semantic search | 0.55 |
| Keyword | PostgreSQL BM25-lite | 0.25 |
| Graph | FalkorDB traversal | 0.20 |

**Per-result scoring formula:**
```
final_score = 0.70 × cosine_similarity
            + 0.15 × recency_decay(half_life=30d)
            + 0.15 × importance_score
```

**Query pipeline**: raw query → `query-expander.ts` (synonyms + context) → triple-arm search → RRF merge → `reranker.ts` (cross-encoder) → top-k results

### 18.4. FalkorDB Graph

- Entities: `person`, `venture`, `project`, `tool`, `concept`, `location`
- Full-text index on `Entity.name` + `Entity.description` (replaces O(n) CONTAINS scan)
- Co-occurrence strength increments `+0.1` per re-encounter (capped 1.0)
- `graphContextSearch()` uses fulltext first, CONTAINS fallback if empty

### 18.5. Retrieval Metrics

`GET /api/memory/metrics` — answers "is each arm adding value?"
- In-memory ring buffer in `hybrid-retriever.ts` tracks per-arm: latency, hit rate
- Populated automatically on every retrieval

### 18.6. Memory Ingest from Claude Code

`POST /api/memory/ingest-markdown` — Bearer token auth (`MEMORY_API_KEY`)
- Accepts markdown content from Claude Code's file-based memory
- Embeds and stores in Qdrant `raw_memories`

---

## 19. Compaction Pipeline

Session compaction converts raw conversation messages into dense, structured memory.

### 19.1. 7-Step Pipeline (`compactor.ts`)

1. **Extract** — `getCompactableMessages(sessionId)` from context monitor (splits into toCompact / toKeep)
2. **Store raw** — `upsertRawMemories()` to Qdrant `raw_memories`
3. **Summarize** — Cerebras API (fallback: Ollama) generates structured JSON summary
4. **Parse** — validate against `compactionOutputSchema` (Zod)
5. **Store compacted** — `upsertCompactedMemory()` to Qdrant `compacted_memories`
6. **Update entities** — extract entities, upsert to `entity_index` + FalkorDB graph
7. **Replace context** — `replaceAfterCompaction()` updates in-memory session context

### 19.2. Compaction Output Schema

```ts
{
  summary: string,           // Dense paragraph summary
  key_decisions: string[],   // Decisions made
  action_items: string[],    // Todos/next steps
  entities: Entity[],        // Named entities with type + description
  topics: string[],          // Main topics covered
  importance: number,        // 0.0–1.0
}
```

### 19.3. Adaptive Tuning (`compaction-tuner.ts`)

Monitors compaction quality metrics and adjusts thresholds (message count before compaction, min importance) based on retrieval performance feedback.

---

## Deployment

### Railway (Production)

SB-OS is deployed on **Railway** with auto-deploy from `sayedbaharun/SBOS` on push to `main`.

- **Live URL**: `https://sbaura.up.railway.app`
- **Builder**: Railpack (switched from Dockerfile 2026-03-25)
- **Port**: 8080
- **Database**: Railway-managed PostgreSQL (NOT Neon — `.env` shows `nozomi.proxy.rlwy.net`)

```bash
# Deploy (push triggers auto-deploy)
git push origin main

# Check status / logs
railway status
railway logs
```

**Important**: Do NOT use `railway up` for this project — it hangs on large codebases. Always deploy via `git push`.

### Agent Operating System

See **Section 17** for full documentation. Quick reference:
- 21 agents seeded from `server/agents/templates/`
- Agent API at `/api/agents` (see Section 17.5)
- Agent UI pages: `/agents`, `/agents/:slug`, `/agents/delegation-log`
- Requires `OPENROUTER_API_KEY` for LLM calls
- Seed agents via `POST /api/agents/admin/seed`

### Hosting Decision Matrix

| Platform | Use When | Examples |
|----------|----------|---------|
| **Railway** | Always-on Node.js, WebSockets, cron jobs, stateful processes | SB-OS, SyntheLIQ engine, mydclaw, tomaholic |
| **Vercel** | Next.js apps, static sites, serverless API routes, Vercel Cron Jobs | syntheliq.com, X Dashboard, SENTINEL, venture landing pages |
| **Evaluate** | Mobile apps, Python bots, local-only tools | Polymarket bot, iOS shortcuts |

- **New ventures default**: Vercel (zero infra overhead, free tier)
- **SB-OS modules / agent backends**: Railway (persistent, always-on)
- Never Railway for a landing page. Never Vercel for a stateful backend.

## Mobile Access

### What works now
- **PWA**: Safari → Share → "Add to Home Screen" at `https://sbaura.up.railway.app`
- **Telegram bot** (`@SBNexusBot`): Agent chat via `@cmo`, `@cto`, plain text → Chief of Staff

### Telegram commands (12 total)
| Command | What it does |
|---------|-------------|
| `/start` | Welcome message and usage guide |
| `/agents` | List all available AI agents |
| `/briefing` | Generate daily briefing via Chief of Staff agent |
| `/capture <text>` | Creates a capture item directly → inbox |
| `/today` | Top 3 outcomes + urgent tasks + inbox count |
| `/tasks` | Lists in_progress and next tasks (numbered, max 10) |
| `/done <number>` | Marks a task as done by number from `/tasks` |
| `/shop <item> [#category]` | Add to shopping list (categories: #groceries, #household, #personal, #business) |
| `/clip <url>` | Clip web article to Knowledge Hub (auto-embeds for RAG) |
| `/emails` | Today's email triage summary (urgent, action needed, info) |
| `/email <id>` | Full triaged email details with suggested reply |
| `/reply <id> <msg>` | Send email reply via Gmail |

### Agent chat via Telegram
- `@cmo <message>` → routes to CMO agent
- `@cto <message>` → routes to CTO agent
- `@<agent-slug> <message>` → routes to specific agent
- Plain text → routes to Chief of Staff (default)
- Bare URL → prompts to clip to Knowledge Hub

---

## License

Private project - not open source.

---

---

## 20. Agent OS Standards

All product documentation, code standards, and feature specs live in `.agent-os/` in the project root. This is the source of truth for how this codebase is built — read before writing any new feature.

### 20.1. Directory Structure

```
.agent-os/
├── product/
│   ├── mission.md           ← Product vision, users, problems, features
│   ├── mission-lite.md      ← 2-sentence condensed version for AI context
│   ├── tech-stack.md        ← Full stack + hosting matrix + auth + DB + LLM cascade
│   ├── roadmap.md           ← 3-phase build plan with effort estimates
│   ├── decisions.md         ← Architectural decision log (read before making arch choices)
│   ├── code-style.md        ← Engineering philosophy + all style rules
│   └── dev-best-practices.md ← AI-native principles + process + deployment + security
└── specs/
    └── YYYY-MM-DD-spec-name/ ← Per-feature specs (created via /create-spec)
        ├── spec.md
        ├── spec-lite.md
        └── sub-specs/
```

### 20.2. AI-Native Principle (Non-Negotiable)

Every feature is built AI-first. Before writing any code, ask:
- Can an agent trigger this?
- Can an agent execute this without human input?
- Is the output structured JSON that an agent can parse?

A feature that requires daily human operation is not finished. See `dev-best-practices.md` for the full AI-native principles.

### 20.3. Key Rules (Summary)

- **Auth**: Clerk for new Vercel ventures. Session auth stays in SB-OS.
- **DB**: Neon for Vercel-hosted apps. Railway PostgreSQL for Railway-hosted apps.
- **LLM cascade**: OpenRouter/Kilocode → OpenAI → Google. Never hard-code one model.
- **Code style**: Engineering philosophy first — write for junior engineers, no code for code's sake, files under 300 lines, single responsibility per module.
- **Deploy**: `git push origin main` only. Never `railway up`. Confirm build before calling done.
- **New features**: Read the spec, find existing patterns, build smallest version that satisfies it, one task at a time.

### 20.4. Workflow

1. `/plan-product` — sets up `.agent-os/product/` for a new product
2. `/create-spec` — creates a spec folder with requirements, technical spec, DB schema, API spec, tasks
3. `/execute-tasks` — implements the spec task by task

---

**SB-OS: Built with focus and intention.**
