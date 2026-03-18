# SB-OS: Agent Operating System

> **Status**: Work in Progress | **Last Updated**: 2026-03-18 | **Version**: 1.0

---

## Overview

The Agent OS is a hierarchical multi-agent system where 16+ AI agents operate autonomously, communicate through a message bus, and execute tasks on behalf of one founder. Agents have souls (identity definitions), tools, permissions, schedules, and persistent memory.

---

## Agent Hierarchy

```
                          ┌──────────────┐
                          │  SAYED       │
                          │  (founder)   │
                          └──────┬───────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                    │
      ┌───────▼──────┐  ┌──────▼───────┐  ┌────────▼────────┐
      │ CHIEF OF     │  │     CTO      │  │      CMO        │
      │ STAFF        │  │              │  │                 │
      │ (executive)  │  │ (executive)  │  │  (executive)    │
      └───────┬──────┘  └──────┬───────┘  └────────┬────────┘
              │                │                     │
  ┌───────────┼──────┐    ┌───▼─────┐     ┌────────┼────────────┐
  │           │      │    │         │     │        │            │
┌─▼──┐  ┌────▼──┐ ┌─▼─┐ ┌▼──────┐ │  ┌──▼───┐ ┌──▼─────┐ ┌───▼────┐
│Exec│  │Venture│ │Lib│ │MVP    │ │  │Growth│ │Content │ │SEO     │
│Asst│  │Archt. │ │   │ │Builder│ │  │Spec. │ │Strat.  │ │Spec.   │
└────┘  └───────┘ └───┘ └───────┘ │  └──────┘ └────────┘ └────────┘
                                   │
                            ┌──────▼──────┐
                            │Agent        │
                            │Engineer     │
                            └─────────────┘

  STANDALONE / SPECIALIST:
  ┌────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────────┐
  │Research    │ │Opportunity   │ │Task Auto.    │ │SMM (per-venture) │
  │Analyst    │ │Hunter        │ │Scout         │ │syntheliq, content│
  └────────────┘ └──────────────┘ └──────────────┘ └──────────────────┘
```

---

## Agent Roster

| Slug | Name | Role | Venture | Key Responsibilities |
|------|------|------|---------|---------------------|
| `chief-of-staff` | Chief of Staff | executive | Global | Daily briefing, evening review, memory management, email triage, pipeline health |
| `cto` | CTO | executive | Global | Tech review, architecture decisions, code review |
| `cmo` | CMO | executive | Global | Campaign review, marketing strategy, distribution |
| `executive-assistant` | Executive Assistant | worker | Global | Weekly planning, schedule optimization |
| `venture-architect` | Venture Architect | manager | Global | Venture health assessments, strategy |
| `librarian` | Librarian | worker | Global | Knowledge extraction, doc quality audits |
| `mvp-builder` | MVP Builder | worker | Global | Project health, rapid prototyping |
| `agent-engineer` | Agent Engineer | worker | Global | Agent performance, model cost review |
| `growth-specialist` | Growth Specialist | worker | Global | Growth opportunities, experiments |
| `content-strategist` | Content Strategist | worker | Global | Content calendar, editorial planning |
| `seo-specialist` | SEO Specialist | worker | Global | SEO audits, ranking analysis |
| `research-analyst` | Research Analyst | worker | Global | Market pulse, upstream feature scanning |
| `opportunity-hunter` | Opportunity Hunter | worker | Global | Micro-SaaS opportunities, quick wins |
| `task-automation-scout` | Task Automation Scout | worker | Global | Scans backlogs, tags agent-ready tasks |
| `smm-syntheliq` | SMM — SyntheLIQ AI | worker | SyntheLIQ | Social media content for SyntheLIQ |
| `smm-content-intelligence` | SMM — Content Intelligence | worker | Content Intelligence | Social media content for CI |

---

## Agent Anatomy

Each agent is defined by a **soul template** (markdown file in `server/agents/templates/`) and a database row.

### Soul Template Structure

```markdown
# Agent Name

## Identity
Who the agent is, personality, tone

## Responsibilities
What the agent does day-to-day

## Tools
Which tools the agent can use

## Constraints
What the agent must NOT do

## Schedule
Cron-based scheduled jobs

## Communication Style
How the agent writes and responds
```

### Database Schema (`agents` table)

| Field | Type | Purpose |
|-------|------|---------|
| `id` | uuid | Primary key |
| `name` | text | Display name |
| `slug` | text | URL-safe identifier (unique) |
| `role` | enum | executive, manager, worker |
| `parent_id` | uuid | Reports to (hierarchy) |
| `venture_id` | uuid | Venture scope (null = global) |
| `soul` | text | Full soul definition (markdown) |
| `model` | text | Preferred LLM model |
| `temperature` | float | LLM temperature |
| `max_turns` | int | Max tool-use turns per conversation |
| `schedule` | jsonb | Cron expressions for scheduled jobs |
| `can_delegate_to` | text[] | Agent slugs this agent can delegate to |
| `max_delegation_depth` | int | How deep delegation chains can go |
| `granted_tools` | text[] | Tools this agent is allowed to use |
| `is_active` | boolean | Whether agent is operational |

---

## Agent Runtime

**File:** `server/agents/agent-runtime.ts` (barrel export)

### Execution Flow

```
Message arrives (Telegram / Web / Scheduler)
        │
        ▼
┌──────────────────────┐
│  BUILD SYSTEM PROMPT  │ ← soul + venture context + memory context
│  (agent-prompt.ts)    │   + current date/time + tool schemas
└───────────┬──────────┘
            │
            ▼
┌──────────────────────┐
│  MULTI-TURN LOOP      │ ← max 10 turns
│  (agent-chat.ts)      │
│                        │
│  1. Send to LLM        │
│  2. If tool_calls:     │
│     → executeTool()    │
│     → append result    │
│     → loop back to 1   │
│  3. If text response:  │
│     → return to user   │
└───────────┬──────────┘
            │
            ▼
┌──────────────────────┐
│  POST-PROCESSING      │
│                        │
│  • Save conversation   │
│  • Entity extraction   │ ← fire-and-forget
│  • Learning extraction │ ← fire-and-forget
│  • Log token usage     │
└──────────────────────┘
```

### Tool Loop Detection

**File:** `server/infra/tool-loop-detector.ts`

Prevents runaway agents with severity escalation:
- **Warning**: Same tool called 3+ times with similar args
- **Critical**: 5+ repetitions
- **Circuit Breaker**: 7+ repetitions → force-terminate the turn

---

## Agent Tools

### Built-in Tools (available to all agents based on `granted_tools`)

| Tool | Purpose | Category |
|------|---------|----------|
| `search_knowledge_base` | Search docs, SOPs, specs | Read |
| `search_tasks` | Search tasks by filters | Read |
| `list_tasks` | List tasks for venture/project | Read |
| `list_projects` | List projects for venture | Read |
| `get_venture_summary` | Venture overview with metrics | Read |
| `create_task` | Create a new task | Write |
| `update_task` | Update task status/fields | Write |
| `create_doc` | Create a document | Write |
| `create_project` | Create a project | Write |
| `remember` | Store persistent agent memory | Memory |
| `search_memory` | Search agent memories | Memory |
| `delegate` | Delegate task to another agent | Delegation |
| `submit_deliverable` | Submit work for human review | Output |
| `send_message` | Send proactive message to channel | Communication |

### Specialist Tool Modules

| File | Tools | Used By |
|------|-------|---------|
| `web-research.ts` | `web_search`, `deep_research`, `extract_url` | Research Analyst, CTO |
| `report-generator.ts` | `daily_briefing`, `weekly_summary`, `venture_status` | Chief of Staff |
| `market-analyzer.ts` | `tam_analysis`, `competitor_analysis`, `swot`, `validation` | Growth Specialist |
| `code-generator.ts` | `scaffold_project` (Next.js, Express, landing, custom) | MVP Builder |
| `deployer.ts` | `deploy_vercel`, `deploy_railway` | MVP Builder, CTO |
| `browser-action.ts` | `browse` (navigate, click, type, screenshot, extract, scroll) | Research Analyst |
| `life-context.ts` | `get_health_context`, `get_schedule_context` | Executive Assistant |

---

## Delegation Engine

**File:** `server/agents/delegation-engine.ts`

Agents can delegate tasks to other agents they have permission to delegate to.

### Delegation Rules

1. Target agent must be in delegator's `can_delegate_to` list
2. Current depth < delegator's `max_delegation_depth`
3. No circular delegation (no self-delegation)
4. Granted permissions = intersection of delegator's permissions and task requirements

### Delegation Flow

```
Agent A decides to delegate
        │
        ▼
┌──────────────────┐
│ VALIDATE          │ → permissions, depth, circularity
└───────┬──────────┘
        │ pass
        ▼
┌──────────────────┐
│ CREATE TASK       │ → agent_tasks table
│ Status: pending   │
└───────┬──────────┘
        │
        ▼
┌──────────────────┐
│ MESSAGE BUS       │ → notify target agent
└───────┬──────────┘
        │
        ▼
┌──────────────────┐
│ TARGET EXECUTES   │ → executeAgentTask()
│ Reports result    │
└───────┬──────────┘
        │
        ▼
┌──────────────────┐
│ COMPLETE/FAIL     │ → update task status
│ Notify delegator  │
└──────────────────┘
```

### Dead Letter Queue

Failed delegations and scheduled jobs that error after 3 retries go to `dead_letter_jobs` table. Telegram alert sent to authorized chat IDs.

---

## Channel Adapters

**File:** `server/channels/channel-manager.ts`

### Telegram (`@SBNexusBot`)

**File:** `server/channels/adapters/telegram-adapter.ts`

| Feature | Implementation |
|---------|---------------|
| **Access control** | Whitelist via `AUTHORIZED_TELEGRAM_CHAT_IDS` |
| **Rate limiting** | 10 messages/minute per chat |
| **Agent routing** | `@slug message` → specific agent; plain text → Chief of Staff |
| **Commands (12)** | `/start`, `/agents`, `/briefing`, `/capture`, `/today`, `/tasks`, `/done`, `/shop`, `/clip`, `/emails`, `/email`, `/reply` |
| **Resilience** | Polling resilience, webhook health monitoring, circuit breaker |
| **Side questions** | `/btw` for no-history one-off questions |
| **Web clipping** | Bare URL → prompt to clip to Knowledge Hub |

### WhatsApp (Cloud API)

**File:** `server/channels/adapters/whatsapp-adapter.ts`

| Feature | Implementation |
|---------|---------------|
| **Webhook** | `/api/webhooks/whatsapp` |
| **Voice** | Voice messages transcribed via Whisper |
| **Routing** | Inbound messages routed to Chief of Staff |

### Routing Rules

```
@cmo <message>        → CMO agent
@cto <message>        → CTO agent
@<agent-slug> <msg>   → Specific agent
/command              → Command handler
Plain text            → Chief of Staff (default)
Bare URL              → Web clip prompt
```

---

## Scheduled Jobs System

**Files:** `server/agents/agent-scheduler.ts` + `server/agents/scheduled-jobs.ts`

### How It Works

1. On server startup, `initializeScheduler()` reads all active agents' `schedule` JSONB
2. For each `{jobName: cronExpression}`, registers a `node-cron` task
3. When cron fires: execute handler → retry (3 attempts, fast backoff) → dead letter on failure

### All Scheduled Jobs (27+)

| Job | Agent | Schedule | Purpose |
|-----|-------|----------|---------|
| `daily_briefing` | Chief of Staff | 6:00 AM daily | Morning intelligence synthesis |
| `morning_checkin` | Chief of Staff | 6:30 AM daily | Today's priorities + health check |
| `evening_review` | Chief of Staff | 7:00 PM daily | Day review + tomorrow planning |
| `email_triage` | Chief of Staff | 4 AM, 9 AM, 2 PM | Email categorization |
| `memory_consolidation` | Chief of Staff | 11:00 PM daily | Session compaction |
| `session_log_extraction` | Chief of Staff | 10:00 PM daily | Extract session logs |
| `embedding_backfill` | Chief of Staff | Every 30 min | Batch embed unprocessed docs |
| `pipeline_health_check` | Chief of Staff | Every 6 hours | Memory pipeline health |
| `hot_commit` | Chief of Staff | Every 30 min | Pattern-based fact extraction |
| `importance_enrichment` | Chief of Staff | 1:00 AM daily | Re-score memory importance |
| `graph_deepening` | Chief of Staff | 3:00 AM Sunday | Discover new entity relationships |
| `memory_prune` | Chief of Staff | 4:00 AM Sunday | Remove stale low-importance memories |
| `syntheliq_reconcile` | Chief of Staff | Every 6 hours | SyntheLIQ data sync |
| `check_credit_balance` | Chief of Staff | Every 6 hours | OpenRouter credit monitoring |
| `weekly_report_cos` | Chief of Staff | 4:00 PM Friday | Weekly wrap-up report |
| `weekly_report` | CMO | 5:00 PM Friday | Marketing weekly report |
| `campaign_review` | CMO | 9:00 AM Monday | Campaign performance review |
| `distribution_check` | CMO | 8:00 AM Mon/Wed/Fri | Content distribution check |
| `tech_review` | CTO | 10:00 AM Wednesday | Tech stack review |
| `architecture_health` | CTO | 10:00 AM Monday | Architecture health check |
| `agent_performance` | Agent Engineer | 11:00 AM Friday | Agent performance metrics |
| `model_cost_review` | Agent Engineer | 8:00 AM Monday | LLM cost analysis |
| `project_health` | MVP Builder | 8:00 AM Mon/Wed/Fri | Project status check |
| `venture_health` | Venture Architect | 10:00 AM Thursday | Venture health assessment |
| `knowledge_extraction` | Librarian | 10:00 PM daily | Extract knowledge from conversations |
| `knowledge_audit` | Librarian | 10:00 AM Wednesday | Doc quality audit |
| `content_queue` | SMM agents | 7:00 AM (varies) | Generate social media drafts |
| `growth_opportunities` | Growth Specialist | 7:00 AM Mon/Thu | Growth opportunity scan |
| `market_pulse` | Research Analyst | 9:00 AM Tue/Fri | Market intelligence |
| `upstream_feature_scan` | Research Analyst | 5:00 AM daily | Scan arXiv/GitHub/Reddit |

---

## Automations (Webhook-Triggered)

**Table:** `automations`

Beyond cron, agents can be triggered by webhooks:

| Field | Purpose |
|-------|---------|
| `trigger_type` | `cron` or `webhook` |
| `webhook_path` | URL path for webhook trigger |
| `webhook_auth` | `bearer` or `secret` authentication |
| `agent_slug` | Agent to execute |
| `prompt` | What to tell the agent |

**API:** Full CRUD at `/api/automations`

External systems (n8n, Zapier, custom) can trigger agents via authenticated webhooks.

---

## Safety & Resilience

| Mechanism | Implementation |
|-----------|---------------|
| **Tool loop detection** | Warning → Critical → Circuit breaker (3/5/7 repetitions) |
| **Delegation depth limits** | Per-agent `max_delegation_depth` prevents infinite chains |
| **Permission filtering** | Agents only get tools in their `granted_tools` list |
| **Dead letter queue** | Failed jobs → `dead_letter_jobs` table + Telegram alert |
| **Rate limiting** | Per-chat rate limits on Telegram (10/min) |
| **Retry with backoff** | 3 attempts with fast exponential backoff on scheduled jobs |
| **Circuit breaker** | Chat action circuit breaker for Telegram API calls |
| **Credential isolation** | Keys never in agent context; injected at execution boundary only |
| **Output scrubbing** | `scrubCredentials()` strips key patterns from all agent output |

---

## Review Queue (Human-in-the-Loop)

Agents can submit deliverables via `submit_deliverable` tool. These go to a review queue:

| Status | Meaning |
|--------|---------|
| `pending` | Awaiting human review |
| `approved` | Accepted as-is |
| `amended` | Accepted with modifications |
| `rejected` | Sent back to agent |

**UI:** Review Queue page with tabs for Pending/Approved/Rejected.

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `server/agents/agent-runtime.ts` | Barrel export for runtime modules |
| `server/agents/agent-chat.ts` | Multi-turn LLM execution loop |
| `server/agents/agent-prompt.ts` | System prompt builder |
| `server/agents/agent-tools.ts` | Tool schema definitions |
| `server/agents/agent-tool-handlers.ts` | Tool execution router |
| `server/agents/delegation-engine.ts` | Inter-agent delegation |
| `server/agents/agent-scheduler.ts` | Cron-based job scheduling |
| `server/agents/scheduled-jobs.ts` | Job handler registry (27+ handlers) |
| `server/agents/multi-model-council.ts` | Multi-model deliberation |
| `server/agents/learning-extractor.ts` | Post-conversation learning extraction |
| `server/agents/agent-memory-manager.ts` | Per-agent memory CRUD |
| `server/agents/message-bus.ts` | Inter-agent message bus |
| `server/agents/templates/*.md` | Soul templates (16 files) |
| `server/channels/channel-manager.ts` | Channel routing and management |
| `server/channels/adapters/telegram-adapter.ts` | Telegram bot adapter |
| `server/channels/adapters/whatsapp-adapter.ts` | WhatsApp Cloud API adapter |
| `server/routes/agents.ts` | 23 REST endpoints for agent management |

---

*This document is a living reference. Update it as the agent system evolves.*
