# SB-OS: The Sayed Baharun Personal Operating System

> **Complete Technical & Product Specification**

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
| **Database** | PostgreSQL (Neon serverless) |
| **Build** | Vite (client), esbuild (server) |
| **Validation** | Zod schemas (shared between client/server) |
| **Auth** | Session-based authentication with password protection |
| **Session Storage** | PostgreSQL via connect-pg-simple |
| **Rich Text Editor** | BlockNote for document editing |
| **AI** | OpenRouter API (multi-model support) |

---

## 3. Project Structure

```
/client         React frontend (Vite + TypeScript)
  /src
    /components   UI components (shadcn/ui + custom)
      /ui         45+ shadcn/ui components
    /pages        26 page components
    /lib          Utilities and helpers
    /hooks        Custom React hooks
/server         Express backend (Node.js + TypeScript)
  index.ts        Main entry point
  routes.ts       API route definitions
  storage.ts      Database abstraction layer (100+ methods)
  integrations.ts Integration configuration
/shared         Shared Zod schemas and database types
  schema.ts       All entity schemas (24+ tables)
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
  └── morningRituals (JSON: pressUps, squats, supplements, reading)
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
| `morningRituals` | json | `{ pressUps, squats, supplements, reading }` |
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

All routes prefixed with `/api`. **147+ total endpoints**.

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
- **Reading Progress**: Pages/time read
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

### 12.2. Google Calendar (Planned)

- Map tasks with `focusDate + focusSlot` → GCal events
- Sync task scheduling changes

### 12.3. Gmail (Planned)

- Email capture to inbox

### 12.4. Notion Integration (Planned)

- Bidirectional sync for Ventures, Projects, Tasks, Days, Docs
- Store `externalId` (Notion page ID) on entities

### 12.5. WhatsApp/Telegram Quick Capture (Planned)

- Webhook endpoints for message capture
- Parse "Task:", "Idea:", "Note:" prefixes
- Create Capture Items with `source = whatsapp/telegram`

### 12.6. AI Integration ✅

- Multi-model support via OpenRouter
- Venture-specific AI agents
- Context-aware responses
- Macro estimation for nutrition

### 12.7. TickTick Integration ✅

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

### Phase 6: Integrations 🚧 IN PROGRESS
- ✅ Google Drive sync
- 🚧 Google Calendar sync
- 🚧 Gmail integration
- 🚧 Notion bidirectional sync
- 🚧 WhatsApp/Telegram quick capture

### Phase 7: Advanced Features (Future)
- Analytics and insights dashboard
- AI-powered task prioritization
- Smart scheduling based on energy levels
- Mobile app (React Native)
- API for third-party integrations

---

## Deployment

### Railway (Production)

SB-OS is deployed on **Railway** with auto-deploy from `sayedbaharun/aura` on push to `main`.

- **Live URL**: `https://sbaura.up.railway.app`
- **Builder**: Docker (`Dockerfile` in project root — bypasses Railpack caching issues)
- **Port**: 8080 (set via `ENV PORT=8080` in Dockerfile)
- **Database**: Railway-managed PostgreSQL

```bash
# Deploy (push triggers auto-deploy)
git push origin main

# Check status / logs
railway status
railway logs
```

**Important**: Do NOT use `railway up` for this project — it hangs on large codebases. Always deploy via `git push`.

### Agent Operating System

The hierarchical multi-agent system is documented in `AGENT-SYSTEM.md`. Key points:
- 10 agent templates seeded from `server/agents/templates/`
- Agent API at `/api/agents` (22 endpoints)
- Agent UI pages: `/agents`, `/agents/:slug`, `/agents/delegation-log`
- Requires `OPENROUTER_API_KEY` for LLM calls
- Seed agents via `POST /api/agents/admin/seed`

### Other Platforms
- **Vercel** (with external database)
- Any Node.js hosting platform

---

## Claude Code Persistent Memory (MCP Tools)

Claude Code has 3 MCP tools for persistent memory, reusing the existing `agent_memory` table:

| Tool | Purpose |
|------|---------|
| `store_claude_memory` | Store a learning, preference, decision, or context. Supports `scope: "shared"` to make it visible to all agents. |
| `search_claude_memory` | Hybrid semantic + keyword search across Claude Code and shared memories. |
| `get_claude_session_context` | Load accumulated memory context at the start of complex work. Optionally focus by topic. |

**Usage conventions:**
- Call `get_claude_session_context` at the start of complex or multi-session work
- Call `store_claude_memory` when discovering project constraints, patterns, deployment gotchas, or user preferences
- Use `scope: "shared"` for knowledge that agents should also benefit from (e.g., architectural decisions)
- Memories are automatically included in nightly consolidation (merge duplicates, decay stale entries)

**Sentinel:** `CLAUDE_CODE_AGENT_ID = "11111111-1111-1111-1111-111111111111"` (inactive agent row, slug: `_claude-code`)

## Mobile Access

### What works now
- **PWA**: Safari → Share → "Add to Home Screen" at `https://sbaura.up.railway.app`
- **Telegram bot** (`@SBNexusBot`): Agent chat via `@cmo`, `@cto`, plain text → Chief of Staff
- **Telegram commands**: `/briefing`, `/capture <text>`, `/today`, `/tasks`, `/done <number>`

### Telegram quick commands
| Command | What it does |
|---------|-------------|
| `/capture <text>` | Creates a capture item directly → inbox |
| `/today` | Top 3 outcomes + urgent tasks + inbox count |
| `/tasks` | Lists in_progress and next tasks (numbered, max 10) |
| `/done <number>` | Marks a task as done by number from `/tasks` |

---

## License

Private project - not open source.

---

**SB-OS: Built with focus and intention.**
