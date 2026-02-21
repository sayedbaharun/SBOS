# SB-OS Agent Operating System — Architecture & Operations Guide

> Complete technical reference for the hierarchical multi-agent system.
> Generated: 2026-02-20

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture](#2-architecture)
3. [Database Schema (4 New Tables)](#3-database-schema)
4. [Agent Organization (10 Agents)](#4-agent-organization)
5. [Core Components](#5-core-components)
6. [Specialized Tools (17 Tools)](#6-specialized-tools)
7. [Channel Adapters](#7-channel-adapters)
8. [Scheduler & Proactive Execution](#8-scheduler--proactive-execution)
9. [API Reference (22 Endpoints)](#9-api-reference)
10. [File Inventory](#10-file-inventory)
11. [Phase Completion Status](#11-phase-completion-status)
12. [Setup & Deployment Checklist](#12-setup--deployment-checklist)
13. [Security Model](#13-security-model)
14. [Remaining Work](#14-remaining-work)

---

## 1. System Overview

SB-OS has been extended from a personal productivity tool into an **AI-powered executive operating system** with a hierarchical agent team. Agents have personalities, tools, permissions, memory, and reporting chains. They delegate tasks down the hierarchy with privilege attenuation and report results back up.

### Key Principles

- **No external frameworks** — no CrewAI, LangGraph, or n8n. SB-OS owns its own workflow/delegation engine.
- **Hierarchical > Flat** — isolated memory per specialist, shared messaging for coordination.
- **Privilege attenuation** — delegated tasks get the intersection of permissions, never more.
- **Agents cannot self-modify** — their soul/definition is injected as system prompt, not editable by the agent.
- **Audit everything** — every delegation, tool call, and message is logged.

### System Statistics

| Metric | Value |
|--------|-------|
| Total agent system files | 35 |
| Total lines of code | ~10,500 |
| Agent templates | 10 |
| Core tools | 17 |
| MCP tools | 16 |
| API endpoints | 22 |
| UI pages | 3 |
| Database tables | 4 new |
| Channel adapters | 1 (Telegram) |
| Scheduled job types | 8 |

---

## 2. Architecture

### Data Flow

```
USER (Sayed)
  │
  ├── Web Dashboard (/api/agents/:slug/chat)
  │     └── agent-runtime.ts → executeAgentChat()
  │
  ├── Telegram (@SBNexusBot)
  │     └── telegram-adapter.ts → channel-manager.ts → agent-runtime.ts
  │
  └── Scheduled Jobs (cron)
        └── agent-scheduler.ts → scheduled-jobs.ts → agent-runtime.ts

AGENT RUNTIME (agent-runtime.ts)
  │
  ├── Resolves agent from registry (agent-registry.ts)
  ├── Loads soul template (system prompt)
  ├── Loads conversation history (agentConversations table)
  ├── Loads memory context (agent-memory-manager.ts)
  ├── Assembles tools (filtered by agent's available_tools)
  ├── Calls LLM via model-manager.ts (OpenRouter)
  ├── Multi-turn tool execution loop (max 10 turns)
  │     ├── delegate → delegation-engine.ts → recursive agent execution
  │     ├── web_search / deep_research → tools/web-research.ts
  │     ├── generate_report → tools/report-generator.ts
  │     ├── market_analyze → tools/market-analyzer.ts
  │     ├── code_generate → tools/code-generator.ts
  │     ├── deploy → tools/deployer.ts
  │     ├── remember / search_memory → agent-memory-manager.ts
  │     └── create_task / create_doc / etc. → storage.ts
  ├── Saves conversation to DB
  └── Returns AgentChatResult

INTER-AGENT COMMUNICATION (message-bus.ts)
  │
  ├── agent:message — direct messages
  ├── agent:delegation — task delegation requests
  ├── agent:result — delegation results
  ├── agent:broadcast — manager to all subordinates
  └── agent:escalation — specialist to manager
```

### Agent Organization Chart

```
YOU (CEO / Founder)
│
├── Chief of Staff (executive, top-tier model)
│   ├── Delegates to: CMO, Head of Products, CTO
│   └── Schedule: daily_briefing @ 7am daily
│
├── CMO (executive, top-tier model)
│   ├── Growth Specialist (specialist, mid-tier)
│   ├── SEO Specialist (specialist, mid-tier)
│   ├── Social Media Manager (specialist, mid-tier)
│   └── Content Strategist (specialist, mid-tier)
│   └── Schedule: weekly_report @ Fri 5pm, campaign_review @ Mon 9am
│
├── Head of Products (manager, top-tier model)
│   ├── Research Analyst (specialist, mid-tier)
│   └── MVP Builder (specialist, mid-tier)
│
└── CTO (executive, top-tier model)
    └── Schedule: tech_review @ Wed 10am
```

### Model Tier Defaults

| Tier | Model | Used By |
|------|-------|---------|
| `top` | Claude Opus 4 | Executives (Chief of Staff, CMO, CTO) |
| `mid` | Claude Sonnet 4 | Managers + Specialists |
| `fast` | Claude 3.5 Haiku | Workers (future) |

---

## 3. Database Schema

### 3.1. `agents` Table

Agent definitions — loaded from soul templates or created via API/UI.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | Auto-generated UUID |
| `name` | text | "Chief Marketing Officer" |
| `slug` | text (unique) | "cmo" |
| `role` | enum | `executive`, `manager`, `specialist`, `worker` |
| `parent_id` | uuid (FK → agents) | Hierarchy (CMO reports to user, SEO to CMO) |
| `venture_id` | uuid (FK → ventures) | Optional venture scope |
| `soul` | text | Full markdown definition (personality, responsibilities) |
| `expertise` | jsonb string[] | `["brand-strategy", "demand-generation"]` |
| `available_tools` | jsonb string[] | `["web_search", "delegate", "create_task"]` |
| `action_permissions` | jsonb string[] | `["read", "create_task", "write"]` |
| `can_delegate_to` | jsonb string[] | `["growth-specialist", "seo-specialist"]` |
| `max_delegation_depth` | integer | Default 2 |
| `preferred_model` | text | Override model (null = use tier default) |
| `model_tier` | text | `auto`, `top`, `mid`, `fast` |
| `temperature` | real | Default 0.7 |
| `max_tokens` | integer | Default 4096 |
| `memory_scope` | text | `isolated`, `shared`, `inherit_parent` |
| `max_context_tokens` | integer | Default 8000 |
| `schedule` | jsonb | `{"daily_briefing": "0 7 * * *"}` |
| `is_active` | boolean | Soft delete flag |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

**Indexes:** `agents_slug_idx` on `slug`, `agents_role_idx` on `role`, `agents_parent_idx` on `parent_id`

### 3.2. `agent_conversations` Table

Per-agent chat history with threading support.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | |
| `agent_id` | uuid (FK → agents, CASCADE) | |
| `role` | text | `user`, `assistant`, `system`, `delegation` |
| `content` | text | Message content |
| `metadata` | jsonb | `{model, tokensUsed, tool_calls}` |
| `parent_message_id` | uuid | Threading for delegation conversations |
| `delegation_from` | uuid (FK → agents) | Which agent delegated this |
| `delegation_task_id` | uuid | Links to agent_tasks |
| `created_at` | timestamp | |

**Indexes:** `agent_conv_agent_idx` on `agent_id`, `agent_conv_task_idx` on `delegation_task_id`

### 3.3. `agent_tasks` Table

Inter-agent task delegation with audit trail.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | |
| `title` | text | |
| `description` | text | |
| `assigned_by` | text | Agent UUID or `"user"` |
| `assigned_to` | uuid (FK → agents, CASCADE) | |
| `delegation_chain` | jsonb string[] | `["user", "cmo", "seo-specialist"]` |
| `depth` | integer | Delegation depth (0 = from user) |
| `status` | enum | `pending`, `in_progress`, `delegated`, `completed`, `failed`, `needs_review` |
| `priority` | integer | 1–10 (1 = highest) |
| `result` | jsonb | Structured output from agent |
| `error` | text | Error message if failed |
| `granted_permissions` | jsonb string[] | Attenuated permissions for this task |
| `granted_tools` | jsonb string[] | Attenuated tools for this task |
| `deadline` | timestamp | |
| `started_at` | timestamp | |
| `completed_at` | timestamp | |
| `created_at` | timestamp | |

**Indexes:** `agent_tasks_assignee_idx` on `assigned_to`, `agent_tasks_status_idx` on `status`

### 3.4. `agent_memory` Table

Per-agent persistent memory with importance scoring, TTL, and learning pipeline support. Supports shared cross-agent memories via `SHARED_MEMORY_AGENT_ID` sentinel and semantic search via embeddings.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | |
| `agent_id` | uuid (FK → agents, CASCADE) | Owner agent (or `SHARED_MEMORY_AGENT_ID` for shared) |
| `memory_type` | enum | `learning`, `preference`, `context`, `relationship`, `decision` |
| `content` | text | Memory content |
| `importance` | real | 0.0–1.0 (higher = more important) |
| `created_at` | timestamp | |
| `expires_at` | timestamp | Optional TTL |
| `scope` | text | `agent` (private), `shared` (cross-agent), `venture` (venture-scoped) |
| `venture_id` | uuid (FK → ventures, SET NULL) | Venture scope for `venture`-scoped memories |
| `tags` | jsonb string[] | Semantic tags for categorization |
| `embedding` | text | JSON-serialized float[] for semantic search |
| `embedding_model` | text | Model used to generate embedding |
| `source_conversation_id` | uuid | Conversation that generated this memory |
| `last_accessed_at` | timestamp | Last time this memory was retrieved |
| `access_count` | integer | Number of times this memory was accessed |

**Indexes:**
- `idx_agent_memory_agent_id` on `agent_id`
- `idx_agent_memory_type` on `memory_type`
- `idx_agent_memory_importance` on `importance`
- `idx_agent_memory_scope` on `scope`
- `idx_agent_memory_venture_id` on `venture_id`

### Enums Added

```sql
agent_role: executive | manager | specialist | worker
agent_task_status: pending | in_progress | delegated | completed | failed | needs_review
agent_memory_type: learning | preference | context | relationship | decision
```

---

## 4. Agent Organization (10 Agents)

### Executives (report to user, top-tier models)

| Slug | Name | Delegates To | Schedule |
|------|------|-------------|----------|
| `chief-of-staff` | Chief of Staff | cmo, head-of-products, cto | daily_briefing: 7am daily |
| `cmo` | CMO | growth-specialist, seo-specialist, social-media-manager, content-strategist | weekly_report: Fri 5pm, campaign_review: Mon 9am |
| `cto` | CTO | (none yet) | tech_review: Wed 10am |

### Managers (report to user, top-tier models)

| Slug | Name | Delegates To | Schedule |
|------|------|-------------|----------|
| `head-of-products` | Head of Products | research-analyst, mvp-builder | (none) |

### Specialists (report to executives/managers, mid-tier models)

| Slug | Name | Parent | Key Tools |
|------|------|--------|-----------|
| `growth-specialist` | Growth Specialist | cmo | web_search, market_analyze |
| `seo-specialist` | SEO Specialist | cmo | web_search |
| `social-media-manager` | Social Media Manager | cmo | web_search |
| `content-strategist` | Content Strategist | cmo | web_search |
| `research-analyst` | Research Analyst | head-of-products | web_search, market_analyze |
| `mvp-builder` | MVP Builder | head-of-products | code_generate, deploy, create_task, create_doc, create_project |

---

## 5. Core Components

### 5.1. Agent Runtime (`server/agents/agent-runtime.ts`, ~1,200 lines)

The execution loop for every agent. Two entry points:

- **`executeAgentChat(agentSlug, userMessage, userId)`** — direct user→agent conversation
- **`executeAgentTask(taskId)`** — executes delegated tasks

Flow:
1. Load agent definition from DB
2. Load conversation history (last 10 messages)
3. Build memory context via `buildMemoryContext()`
4. Assemble system prompt from soul + delegation context + memory
5. Build tool schemas filtered by agent's `available_tools`
6. Multi-turn tool calling loop (max 10 turns) via OpenRouter
7. If `delegate` tool called → `delegation-engine.ts` handles handoff
8. Save conversation and actions to DB
9. Return `AgentChatResult`

### 5.2. Agent Registry (`server/agents/agent-registry.ts`, 479 lines)

Loads, caches, and resolves agent definitions.

- **`loadAgent(slug)`** — load single agent by slug (cached)
- **`loadAllAgents()`** — load all active agents (cached)
- **`getAgentHierarchy(agentId)`** — get full chain to root
- **`getAgentChildren(agentId)`** — get direct reports
- **`seedFromTemplates(dir)`** — seed DB from `.md` template files
- **`invalidateCache(slug?)`** — clear cache after updates
- **`resolveAgentForMessage(text)`** — detect @agent mentions

### 5.3. Delegation Engine (`server/agents/delegation-engine.ts`, 355 lines)

Hierarchical task delegation with privilege attenuation (DeepMind Feb 2026 rules).

- **`delegateTask(request)`** — validate + create task + send via bus
- **`completeDelegation(taskId, result)`** — mark complete, return result
- **`failDelegation(taskId, error)`** — mark failed
- **`getPendingDelegations(agentId)`** — get pending tasks for agent
- **`getDelegationChain(taskId)`** — get full delegation chain
- **`delegateFromUser(slug, title, desc, priority)`** — user→agent delegation

Validation rules:
1. `toAgent` must be in `fromAgent.canDelegateTo`
2. Current depth < `fromAgent.maxDelegationDepth`
3. No circular delegation
4. Permissions = intersection(delegator's, requested)

### 5.4. Message Bus (`server/agents/message-bus.ts`, 241 lines)

EventEmitter-based inter-agent communication (singleton).

Events: `agent:message`, `agent:delegation`, `agent:result`, `agent:broadcast`, `agent:escalation`, `agent:schedule`

Methods: `send()`, `sendDelegation()`, `sendResult()`, `broadcast()`, `escalate()`, `onMessage()`, `offMessage()`, `getRecentMessages()`

Buffer: last 100 messages per agent in-memory.

### 5.5. Conversation Manager (`server/agents/conversation-manager.ts`, 351 lines)

Threading, delegation context, conversation analytics.

- `getConversationHistory(agentId, options)` — with token windowing
- `getDelegationThread(taskId)` — follow delegation chains
- `saveMessage(params)` — persist with metadata
- `clearConversation(agentId, options)` — preserve delegation audit trail
- `buildDelegationContext(taskId)` — assemble full context for delegated task
- `getConversationStats(agentId)` — message counts by role
- `getAllAgentActivity(sinceHours)` — system-wide activity summary

### 5.6. Agent Memory Manager (`server/agents/agent-memory-manager.ts`, 435 lines)

Per-agent persistent memory with shared memories, semantic search, and relevant context recall.

- `storeMemory(params)` — create memory entry with optional scope, tags, venture; auto-generates embedding
- `getMemories(agentId, options)` — query by type, importance, limit
- `searchMemories(agentId, query)` — **hybrid semantic + keyword search** (cosine similarity on embeddings with keyword fallback); includes shared memories; updates access tracking
- `buildMemoryContext(agentId, maxTokens)` — structured context for system prompt with 3 sections: agent-specific (60% budget), shared organization-wide (30%), and venture-specific (10%)
- `buildRelevantMemoryContext(agentId, currentMessage, maxTokens)` — semantic search against current message to surface contextually relevant past memories
- `updateImportance(memoryId, importance)` — boost/decay
- `deleteMemory(memoryId)` — remove single memory
- `clearMemories(agentId, memoryType?)` — bulk remove memories
- `cleanupExpiredMemories()` — remove TTL-expired entries
- `getMemoryStats(agentId)` — total, byType, avgImportance

### 5.7. Learning Pipeline (`server/agents/learning-extractor.ts`, 415 lines)

Automatic knowledge extraction and memory lifecycle management. Runs async (fire-and-forget) after every agent conversation.

- `extractConversationLearnings(params)` — auto-extracts structured learnings after every chat using a cheap LLM (GPT-4o-mini). Classifies each extraction by type, importance, scope, and tags. Stores shared/venture memories under `SHARED_MEMORY_AGENT_ID`.
- `consolidateAgentMemories(agentId)` — nightly duplicate merging using Jaccard text similarity (threshold 0.8). Keeps higher-importance memory, boosts by +0.1, deletes duplicate. Also triggers decay.
- `decayOldMemories(agentId)` — importance decay for stale memories. Deletes memories >90 days old with importance <0.3. Reduces importance by 0.05 for memories >30 days old with importance <0.5.
- `storeTaskOutcomeLearning(params)` — records task success/failure as learnings (failures weighted slightly higher at 0.7 vs 0.6 importance).
- `SHARED_MEMORY_AGENT_ID` — sentinel UUID (`00000000-...`) for cross-agent memories. Auto-creates inactive sentinel agent row on first use.

**Learning Loop Architecture:**
```
Agent Chat (agent-runtime.ts)
  │
  ├── extractConversationLearnings()  ← fire-and-forget after every chat
  │     ├── LLM extracts structured learnings
  │     ├── Stores to agent_memory (agent-scoped or shared)
  │     └── generateEmbeddingsForRecentMemories()  ← async background
  │
  ├── storeTaskOutcomeLearning()      ← after delegation completes/fails
  │
  └── Nightly cron (memory_consolidation)
        ├── consolidateAgentMemories() per agent
        │     ├── Merge duplicate memories (Jaccard > 0.8)
        │     └── decayOldMemories() — prune stale entries
        └── Consolidate shared memory pool
```

---

## 6. Specialized Tools (17 Tools)

### Data Access Tools

| Tool | Permission Required | Description |
|------|-------------------|-------------|
| `search_knowledge_base` | read | Search docs/SOPs/knowledge base |
| `list_tasks` | read | List tasks with status/priority/venture filters |
| `list_projects` | read | List projects with status filter |
| `get_venture_summary` | read | Get venture overview with metrics |

### Action Tools

| Tool | Permission Required | Description |
|------|-------------------|-------------|
| `create_task` | create_task or write | Create a new task |
| `create_doc` | create_doc or write | Create a knowledge base document |
| `create_project` | create_project or write | Create a new project |
| `create_capture` | create_capture or write | Add item to inbox |
| `delegate` | delegate + canDelegateTo | Delegate task to child agent |

### Research & Analysis Tools (`server/agents/tools/`)

| Tool | File | Description |
|------|------|-------------|
| `web_search` | `web-research.ts` | Quick web search (Brave API or model fallback) |
| `deep_research` | `web-research.ts` | Search + fetch + LLM analysis (5 modes: summary, competitive, market, technical, general) |
| `generate_report` | `report-generator.ts` | Generate reports (daily_briefing, weekly_summary, venture_status, custom) |
| `market_analyze` | `market-analyzer.ts` | Market analysis (market_sizing, competitor_analysis, swot, market_validation) |

### Code & Deploy Tools (`server/agents/tools/`)

| Tool | File | Description |
|------|------|-------------|
| `code_generate` | `code-generator.ts` | Generate project scaffolds (Next.js, Express, landing page, custom) or code snippets. Actions: `generate_project`, `generate_code`, `list_projects`. Writes to `$TMPDIR/sbos-generated-projects/`. |
| `deploy` | `deployer.ts` | Deploy generated projects to Vercel (REST API v13) or Railway (GraphQL API). Actions: `deploy`, `history`, `status`. Auto-deploys to preview/staging; production returns `pending_approval`. |

### Memory Tools

| Tool | File | Description |
|------|------|-------------|
| `remember` | `agent-memory-manager.ts` | Store persistent memory (learning, preference, context, relationship, decision) with optional scope and tags |
| `search_memory` | `agent-memory-manager.ts` | Hybrid semantic + keyword search across agent's private and shared memories |

> **Note:** In addition to manual `remember` calls, the Learning Pipeline (`learning-extractor.ts`) automatically extracts and stores learnings after every conversation. Manual `remember` is for explicit user/agent-initiated memories; the pipeline captures implicit knowledge.

---

## 7. Channel Adapters

### Architecture (`server/channels/`)

```
channel-manager.ts          ← Adapter lifecycle, message routing
types.ts                    ← IncomingMessage, OutgoingMessage, ChannelAdapter interface
adapters/
  telegram-adapter.ts       ← Telegraf-based Telegram bot
```

### Telegram Adapter

**Bot:** `@SBNexusBot` (Nexus)
**Library:** Telegraf v4.16.3 (already in dependencies)
**Mode:** Polling (dev) / Webhook (prod via `TELEGRAM_WEBHOOK_URL`)

**Commands:**
| Command | Description |
|---------|-------------|
| `/start` | Show welcome message and usage |
| `/agents` | List all available agents |
| `/briefing` | Generate instant daily briefing |

**Message Routing:**
- `@cmo <message>` → routes to CMO agent
- `@cto <message>` → routes to CTO agent
- `@<any-slug> <message>` → routes to that agent
- Plain text → routes to Chief of Staff (default)

**Features:**
- Access control via `AUTHORIZED_TELEGRAM_CHAT_IDS`
- Rate limiting: 10 messages/minute per chat
- Long message splitting (4096 char Telegram limit)
- Photo message handling
- Message history persistence to `messages` table
- Proactive message sending (briefings, reports)

**Environment Variables:**
| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | Bot token from @BotFather |
| `AUTHORIZED_TELEGRAM_CHAT_IDS` | Yes (prod) | Comma-separated authorized chat IDs |
| `TELEGRAM_WEBHOOK_URL` | No | Webhook URL for production (polling if not set) |
| `TELEGRAM_WEBHOOK_SECRET` | No | Webhook secret for validation |

---

## 8. Scheduler & Proactive Execution

### Architecture (`server/agents/`)

```
agent-scheduler.ts          ← Cron job registration, lifecycle management
scheduled-jobs.ts           ← Job handler registry with built-in handlers
```

### Registered Job Handlers

| Job Name | Agent | Cron | Description |
|----------|-------|------|-------------|
| `daily_briefing` | chief-of-staff | `0 7 * * *` (7am daily) | Morning briefing → saves + sends to Telegram |
| `weekly_report` | cmo | `0 17 * * 5` (Fri 5pm) | Weekly marketing report → saves + sends to Telegram |
| `campaign_review` | cmo | `0 9 * * 1` (Mon 9am) | Campaign review via agent chat |
| `tech_review` | cto | `0 10 * * 3` (Wed 10am) | Technical project review |
| `venture_status_report` | any | (manual) | Venture-scoped status report |
| `memory_cleanup` | any | (manual) | Clean up expired agent memories |
| `memory_consolidation` | any | (nightly) | Merge duplicate memories, decay stale ones, consolidate shared pool |
| `inbox_triage` | any | (manual) | Process unclarified capture items |

**Fallback:** Unknown job names execute as agent chat prompts.

### Scheduler API

- `initializeScheduler()` — called at server startup, reads all agent schedules from DB
- `triggerJob(agentSlug, jobName)` — manually trigger any job
- `reloadAgentSchedule(agentSlug)` — reload after schedule update
- `getScheduleStatus()` — get all active jobs with run counts
- `stopAllJobs()` — graceful shutdown

---

## 9. API Reference (22 Endpoints)

All prefixed with `/api/agents`.

### Agent CRUD

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | List all agents (optional `?role=` filter) |
| `GET` | `/:slug` | Get single agent by slug |
| `GET` | `/:slug/hierarchy` | Get agent's hierarchy chain to root |
| `GET` | `/:slug/children` | Get agent's direct reports |
| `POST` | `/` | Create new agent |
| `PATCH` | `/:slug` | Update agent fields |
| `DELETE` | `/:slug` | Deactivate agent (soft delete) |

### Agent Chat

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/:slug/chat` | Send message to agent, get response |
| `GET` | `/:slug/conversations` | Get conversation history (`?limit=50`) |
| `DELETE` | `/:slug/conversations` | Clear conversation history |

### Delegation

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/:slug/delegate` | Delegate task to agent (from user) |
| `GET` | `/delegation/log` | Get full delegation audit log (`?status=&limit=`) |
| `GET` | `/:slug/tasks` | Get tasks assigned to agent |

### Agent Memory

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/:slug/memory` | Get agent's memories |
| `POST` | `/:slug/memory` | Add memory entry |

### Channels

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/admin/channels` | Get all channel adapter statuses |
| `POST` | `/admin/channels/send` | Send proactive message via channel |

### Scheduler

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/admin/schedules` | Get all scheduled jobs and run stats |
| `POST` | `/:slug/trigger-schedule` | Manually trigger a scheduled job |
| `POST` | `/:slug/reload-schedule` | Reload schedule config from DB |

### Admin

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/admin/seed` | Seed agents from soul templates |
| `GET` | `/admin/org-chart` | Get hierarchical org chart |

---

## 10. File Inventory

### Core Framework (`server/agents/`)

| File | Lines | Purpose |
|------|-------|---------|
| `types.ts` | 207 | All TypeScript interfaces, model tier defaults |
| `agent-runtime.ts` | ~1,200 | Core execution loop, 17 tools, multi-turn LLM |
| `agent-registry.ts` | 479 | Load, cache, resolve agent definitions |
| `delegation-engine.ts` | 355 | Task delegation with privilege attenuation |
| `message-bus.ts` | 241 | Inter-agent EventEmitter communication |
| `conversation-manager.ts` | 351 | Threading, windowing, analytics |
| `agent-memory-manager.ts` | 435 | Per-agent memory CRUD, hybrid semantic search, shared memory context builder |
| `learning-extractor.ts` | 415 | Auto-extraction of conversation learnings, nightly consolidation, memory decay, task outcome learning |
| `agent-scheduler.ts` | 270 | Cron-based proactive execution |
| `scheduled-jobs.ts` | 267 | Built-in job handlers (briefing, reports, memory consolidation) |

### Specialized Tools (`server/agents/tools/`)

| File | Lines | Purpose |
|------|-------|---------|
| `web-research.ts` | 298 | Web search (Brave/fallback) + deep research + extraction |
| `report-generator.ts` | 267 | Daily briefing, weekly summary, venture status |
| `market-analyzer.ts` | 262 | TAM/SAM/SOM, competitor analysis, SWOT, validation |
| `code-generator.ts` | ~448 | LLM-powered project scaffolding (Next.js, Express, landing, custom) |
| `deployer.ts` | ~430 | Vercel REST API v13 + Railway GraphQL deployment |

### Channel Adapters (`server/channels/`)

| File | Lines | Purpose |
|------|-------|---------|
| `types.ts` | 95 | IncomingMessage, OutgoingMessage, ChannelAdapter |
| `channel-manager.ts` | 213 | Adapter lifecycle, message routing, @mentions |
| `adapters/telegram-adapter.ts` | 424 | Telegraf bot with access control, rate limiting |

### Soul Templates (`server/agents/templates/`)

10 markdown files: `chief-of-staff.md`, `cmo.md`, `cto.md`, `head-of-products.md`, `growth-specialist.md`, `seo-specialist.md`, `social-media-manager.md`, `content-strategist.md`, `research-analyst.md`, `mvp-builder.md`

### UI Pages (`client/src/pages/`)

| File | Lines | Purpose |
|------|-------|---------|
| `agents.tsx` | ~608 | Agent HQ — grid/tree views, search, role filters, stats cards |
| `agent-detail.tsx` | ~949 | Agent detail — overview/tasks/memory/activity tabs + live chat panel |
| `delegation-log.tsx` | ~537 | Delegation audit trail — expandable rows, chain visualization, filters |

### Modified Existing Files

| File | Changes |
|------|---------|
| `shared/schema.ts` | Added 4 tables, 3 enums, relations, insert schemas, type exports |
| `server/routes/index.ts` | Registered `/api/agents` route module |
| `server/routes/agents.ts` | 22 REST endpoints (new file) |
| `server/index.ts` | Added scheduler + channel adapter initialization |
| `client/src/App.tsx` | Added imports + routes for agents, agent-detail, delegation-log |
| `client/src/components/sidebar/sidebar.tsx` | Added "Agent HQ" nav item with Users icon in Work section |
| `.env` | Updated `TELEGRAM_BOT_TOKEN` |

---

## 11. Phase Completion Status

| Phase | Description | Status |
|-------|-------------|--------|
| **Phase 1** | Agent Framework Core | COMPLETE |
| | DB tables (agents, agent_conversations, agent_tasks, agent_memory) | Done |
| | types.ts — interfaces and model tier defaults | Done |
| | agent-registry.ts — load, cache, resolve, seed | Done |
| | agent-runtime.ts — core execution loop | Done |
| | message-bus.ts — inter-agent communication | Done |
| | delegation-engine.ts — privilege attenuation | Done |
| | routes/agents.ts — 22 REST endpoints | Done |
| | 10 soul templates seeded | Done |
| **Phase 2** | Specialized Tools | COMPLETE |
| | tools/web-research.ts — search + analysis | Done |
| | tools/report-generator.ts — briefings + reports | Done |
| | tools/market-analyzer.ts — TAM/SWOT/competitive | Done |
| | conversation-manager.ts — threading + analytics | Done |
| | agent-memory-manager.ts — CRUD + context builder | Done |
| | Wired 7 new tools into agent-runtime.ts | Done |
| **Phase 3** | Proactive Agents | COMPLETE |
| | agent-scheduler.ts — cron-based execution | Done |
| | scheduled-jobs.ts — 7 built-in handlers | Done |
| | Scheduler initialization at server startup | Done |
| | Scheduler API routes (3 endpoints) | Done |
| | Updated templates with schedules | Done |
| **Phase 4** | Channel Integration (Telegram) | COMPLETE |
| | channels/types.ts — shared channel types | Done |
| | channels/channel-manager.ts — routing + lifecycle | Done |
| | channels/adapters/telegram-adapter.ts — full bot | Done |
| | Channel initialization at server startup | Done |
| | Channel API routes (2 endpoints) | Done |
| | Scheduled jobs send to Telegram | Done |
| **Phase 5** | Code & Deploy | COMPLETE |
| | tools/code-generator.ts — project scaffolding (Next.js, Express, landing, custom) | Done |
| | tools/deployer.ts — Vercel/Railway deployment (preview auto-deploy, prod approval) | Done |
| | Wired `code_generate` + `deploy` tools into agent-runtime.ts | Done |
| | MVP Builder template already configured with code_generate + deploy tools | Done |
| **Phase 6** | UI | COMPLETE |
| | `/agents` page — Agent HQ with grid view, org tree, search, role filters, stats | Done |
| | `/agents/:slug` page — Agent detail (overview, tasks, memory, activity tabs) + live chat panel | Done |
| | `/agents/delegation-log` page — Delegation audit trail with expandable rows, chain visualization, filters | Done |
| | Routes wired in App.tsx, "Agent HQ" nav item added to sidebar | Done |

---

## 12. Setup & Deployment Checklist

### Step 1: Push Database Schema

The 4 new tables and 3 enums need to be pushed to PostgreSQL.

```bash
cd /Users/sayedbaharun/Documents/GitHub/aura
npm run db:push
```

This will create:
- `agent_role` enum
- `agent_task_status` enum
- `agent_memory_type` enum
- `agents` table with indexes
- `agent_conversations` table with indexes
- `agent_tasks` table with indexes
- `agent_memory` table with indexes

### Step 2: Seed Agent Templates

After the schema is pushed, seed the 10 agent templates into the database.

**Option A: Via API (after server is running)**
```bash
curl -X POST http://localhost:5000/api/agents/admin/seed \
  -H "Content-Type: application/json" \
  -H "Cookie: <your-session-cookie>"
```

**Option B: The server will need to be running first**
Start the dev server, then hit the seed endpoint from the browser or via the dashboard.

### Step 3: Environment Variables

Verify these are set in `.env`:

```bash
# Required for agent system
OPENROUTER_API_KEY=<your-key>        # Already set as OPENAI_API_KEY (OpenRouter-compatible)
DATABASE_URL=<your-neon-url>          # Already set

# Required for Telegram
TELEGRAM_BOT_TOKEN=8392857797:AAEY3TwO9ZKC-99ErhyRkaWXeH2slYALalc
AUTHORIZED_TELEGRAM_CHAT_IDS=-7964798688

# Optional
BRAVE_SEARCH_API_KEY=<key>           # For web_search tool (falls back to LLM knowledge)
VERCEL_TOKEN=<token>                 # For deploy tool — Vercel deployments
VERCEL_TEAM_ID=<team-id>            # For deploy tool — Vercel team scope
RAILWAY_TOKEN=<token>               # For deploy tool — Railway deployments
TELEGRAM_WEBHOOK_URL=<url>           # For production webhook mode
TELEGRAM_WEBHOOK_SECRET=<secret>     # For webhook validation
```

### Step 4: Start the Server

```bash
npm run dev
```

The server will automatically:
1. Initialize the agent scheduler (reads schedules from DB)
2. Register and start the Telegram adapter
3. Begin listening for cron-scheduled jobs

### Step 5: Verify Everything Works

```bash
# 1. Check agents are seeded
curl http://localhost:5000/api/agents

# 2. Chat with an agent
curl -X POST http://localhost:5000/api/agents/chief-of-staff/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Give me a quick status update"}'

# 3. Check schedules
curl http://localhost:5000/api/agents/admin/schedules

# 4. Check Telegram status
curl http://localhost:5000/api/agents/admin/channels

# 5. Check org chart
curl http://localhost:5000/api/agents/admin/org-chart

# 6. Trigger a briefing manually
curl -X POST http://localhost:5000/api/agents/chief-of-staff/trigger-schedule \
  -H "Content-Type: application/json" \
  -d '{"jobName": "daily_briefing"}'

# 7. Delegate a task
curl -X POST http://localhost:5000/api/agents/cmo/delegate \
  -H "Content-Type: application/json" \
  -d '{"title": "Research competitor pricing", "description": "Analyze top 5 competitors", "priority": 3}'
```

### Step 6: Get Your Telegram Chat ID

If you need to update `AUTHORIZED_TELEGRAM_CHAT_IDS`:

1. Send any message to `@SBNexusBot` on Telegram
2. Visit: `https://api.telegram.org/bot<TOKEN>/getUpdates`
3. Find your `chat.id` in the response
4. Add it to `.env` as `AUTHORIZED_TELEGRAM_CHAT_IDS`

---

## 13. Security Model

| Principle | Implementation |
|-----------|---------------|
| **No shell access** | Agents use typed tools only, never raw commands |
| **Privilege attenuation** | Delegated tasks get intersection of permissions |
| **Max delegation depth** | Default 2, configurable per agent |
| **No self-modification** | Agents cannot read/modify their own definitions |
| **Audit trail** | Every delegation, tool call, message logged to DB |
| **Tool sandboxing** | Code generator writes to `$TMPDIR/sbos-generated-projects/` only; deployer only deploys from that directory |
| **Deploy approval** | Preview/staging auto-deploy; production returns `pending_approval` requiring explicit user action |
| **Memory isolation** | Each agent has its own memory namespace; shared memories use a sentinel agent ID with explicit `scope` control |
| **Channel access control** | Telegram whitelist via `AUTHORIZED_TELEGRAM_CHAT_IDS` |
| **Rate limiting** | 10 messages/minute per Telegram chat |
| **Input sanitization** | Channel messages normalized before agent processing |

---

## 14. Remaining Work

All 6 planned phases are **COMPLETE**. The following are optional enhancements:

### Future Enhancements

| Enhancement | Description |
|-------------|-------------|
| WhatsApp adapter | Baileys-based WhatsApp integration |
| Browser automation tool | Playwright-based browser tool for agents |
| Agent performance metrics | Track response quality, task success rate |
| Multi-venture agent scoping | Agents that work across specific ventures only |
| External vector DB | Replace in-memory embedding search with Qdrant/Pinecone for scale |

---

## 15. Deployment

### Railway Configuration

SB-OS is deployed on **Railway** with automatic deployments from GitHub.

| Setting | Value |
|---------|-------|
| **Service** | aura |
| **GitHub Repo** | `sayedbaharun/aura` (auto-deploy on push to main) |
| **Builder** | Docker (via `Dockerfile`) |
| **Runtime Port** | 8080 (`ENV PORT=8080`) |
| **Database** | PostgreSQL (Railway-managed) |
| **Live URL** | `https://sbaura.up.railway.app` |

### Dockerfile

The project uses a custom `Dockerfile` (bypasses Railway's Railpack builder to avoid aggressive caching issues):

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
EXPOSE 8080
ENV PORT=8080
CMD ["npm", "run", "start"]
```

### Required Environment Variables (Railway)

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string (auto-set by Railway) |
| `SESSION_SECRET` | Express session encryption key |
| `OPENROUTER_API_KEY` | OpenRouter API key for agent LLM calls |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token for @SBNexusBot |
| `AUTHORIZED_TELEGRAM_CHAT_IDS` | Comma-separated authorized Telegram chat IDs |
| `PORT` | Server port (Railway sets to 8080) |
| `NODE_ENV` | Set to `production` |

### Deployment Commands

```bash
# Deploy via git push (recommended — triggers auto-deploy)
git push origin main

# Check deployment status
railway status

# View logs
railway logs

# Redeploy current commit
railway redeploy -y
```

### Known Deployment Issues & Solutions

| Issue | Solution |
|-------|----------|
| Railpack build cache reusing old images | Use Dockerfile instead of Railpack (add `Dockerfile` to project root) |
| `npm ci` lockfile sync errors | Ensure `package-lock.json` is regenerated with same Node/npm version as Dockerfile (`node:20-slim`) |
| `ERR_ERL_KEY_GEN_IPV6` from express-rate-limit | Add `validate: { keyGeneratorIpFallback: false }` to rate limiter config |
| `railway up` hanging on "Indexing..." | Use `git push` to trigger auto-deploy instead of `railway up` for large projects |

### Post-Deployment Verification

After deployment, the server automatically:
1. Runs `ensureSchema()` for DB migration
2. Seeds default categories
3. Configures Telegram webhook (if `RAILWAY_PUBLIC_DOMAIN` is set)
4. Initializes agent scheduler (loads all agent schedules from DB)
5. Starts channel adapters (Telegram)
6. Starts automations (daily day creation, reminders, RAG embeddings)

Check logs for: `✓ SB-OS automations initialized` and `Agent scheduler initialized: X jobs for Y agents`.

---

## 16. Session Fixes Log (2026-02-20)

Issues resolved during initial deployment:

1. **YAML Parser** — `agent-registry.ts` parser couldn't handle nested `schedule:` blocks with indented sub-keys. Rewrote to support nested objects and strip quotes from values.

2. **ESM `__dirname`** — `routes/agents.ts` used `__dirname` which isn't available in ESM. Fixed with `fileURLToPath(import.meta.url)`.

3. **Tailwind CSS v3/v4 mismatch** — Project had Tailwind v4.2.0 installed but used v3 syntax (`@tailwind base/components/utilities`, `tailwind.config.ts`). Downgraded to v3.4.19.

4. **Vite dev asset rate limiting** — Vite HMR serves hundreds of module requests (`/@vite/`, `/node_modules/`, `/src/`) that exhausted the 1000 req/min global rate limit. Added skip conditions for these paths.

5. **express-rate-limit IPv6 validation** — Custom `keyGenerator` using `req.ip` triggered `ERR_ERL_KEY_GEN_IPV6` validation. Fixed with `validate: { xForwardedForHeader: false, keyGeneratorIpFallback: false }`.

6. **npm ci lockfile sync** — `prosemirror-highlight` (from `@blocknote/core`) requires `highlight.js@^11` and `lowlight@^3`. Added as explicit dependencies to fix lockfile resolution.

---

---

## 17. MCP Server Integration

SB-OS exposes its data and agent capabilities to Claude Code, Claude Desktop, and any MCP-compatible AI tool via the **Model Context Protocol**.

### Setup

The MCP server is configured in `.mcp.json` at the project root:

```json
{
  "mcpServers": {
    "sbos": {
      "command": "npx",
      "args": ["tsx", "server/mcp-server.ts"],
      "cwd": "/Users/sayedbaharun/Documents/GitHub/aura"
    }
  }
}
```

When Claude Code opens the project, the `sbos` MCP server starts automatically, connecting to the same database via `DATABASE_URL` from `.env`.

### Available MCP Tools (16 tools)

**Read Tools:**
| Tool | Description |
|------|-------------|
| `get_dashboard` | Today's overview: day record, tasks, urgent items, inbox count, ventures |
| `list_ventures` | All business ventures with status and domain |
| `list_tasks` | Tasks with optional filters (venture, project, status) |
| `list_projects` | Projects, optionally filtered by venture |
| `search_docs` | Search knowledge base by keyword |
| `get_doc` | Get full document content by ID |
| `list_captures` | Inbox items (unclarified by default) |
| `get_health_summary` | Last 7 days of health entries |
| `list_agents` | All active AI agents with roles and capabilities |
| `get_agent_memories` | Get an agent's memories (supports type filter, includes shared memories) |

**Write Tools:**
| Tool | Description |
|------|-------------|
| `create_task` | Create a task (optionally linked to venture/project) |
| `update_task` | Update task status, priority, notes, dates |
| `create_capture` | Add item to inbox |
| `create_doc` | Create knowledge base document |

**Agent Tools:**
| Tool | Description |
|------|-------------|
| `chat_with_agent` | Send message to any agent, get their response |
| `delegate_to_agent` | Delegate a task to an agent for autonomous execution |

### Usage

When working in Claude Code within the SB-OS project, you can:
- Ask "What's on my plate today?" → triggers `get_dashboard`
- Say "Create a P1 task for the SaaS venture" → triggers `create_task`
- Say "Ask the CMO to analyze our competitor pricing" → triggers `chat_with_agent`
- Say "Delegate market research to the Research Analyst" → triggers `delegate_to_agent`

---

**Total system: ~10,500 lines of TypeScript across 35 files, 10 agent templates, 17 agent tools, 16 MCP tools, 22 API endpoints, 3 UI pages, 1 channel adapter, 8 scheduled job types. All 6 phases complete + MCP integration + Learning Pipeline. Deployed to Railway.**
