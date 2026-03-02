# Agent System

> 13 agents (11 active + 2 sentinels) in a hierarchical team with delegation, memory, and learning.

## Agent Hierarchy

```
SAYED (CEO / Founder)
│
├── Chief of Staff (Opus) ─── daily briefing, coordination, triage
│   ├── delegates to → CMO, Head of Products, CTO
│   └── schedule: 8:45am intelligence, 9am briefing, 10am check-in, email triage 3x/day, meeting prep */15min, 6pm review, Fri 4pm weekly
│
├── CMO (Sonnet) ─── marketing strategy across all ventures
│   ├── Growth Specialist (Haiku)
│   ├── SEO Specialist (Haiku)
│   ├── Social Media Manager (Haiku)
│   └── Content Strategist (Haiku)
│
├── Head of Products (Haiku) ─── product strategy, idea evaluation
│   ├── Venture Architect (Sonnet) ─── structured venture planning
│   ├── Research Analyst (Haiku)
│   └── MVP Builder (Haiku)
│
└── CTO (Sonnet) ─── technical architecture, stack decisions

Sentinels (non-interactive):
├── _claude-code ─── Claude Code memory integration
└── _shared-memory ─── cross-agent shared memory pool
```

## Model Tier Assignments

| Tier | Model | Agents |
|------|-------|--------|
| `top` (Opus) | Claude Opus 4 | Chief of Staff |
| `mid` (Sonnet) | Claude Sonnet 4 | CMO, CTO, Venture Architect |
| `fast` (Haiku) | Claude Haiku 3.5 | Head of Products, Growth Specialist, SEO Specialist, Social Media Manager, Content Strategist, Research Analyst, MVP Builder |

To rebalance tiers: update templates in `server/agents/templates/`, then `POST /api/agents/admin/seed`.

## Agent Registry

| Slug | Name | Role | Parent | Tools | Schedule |
|------|------|------|--------|-------|----------|
| `chief-of-staff` | Chief of Staff | executive | user | delegate, create_task, search_knowledge_base, list_tasks, list_projects, get_venture_summary, generate_report, remember, search_memory, submit_deliverable | daily_intelligence (8:45am), daily_briefing (9am), morning_checkin (10am), email_triage (8am/1pm/6pm), meeting_prep (*/15min), evening_review (6pm), weekly_report_cos (Fri 4pm), session_log_extraction, pipeline_health_check, memory_consolidation |
| `cmo` | CMO | executive | user | web_search, deep_research, create_task, create_doc, search_knowledge_base, delegate, generate_report, market_analyze, remember, search_memory, submit_deliverable | weekly_report (Fri 5pm), campaign_review (Mon 9am) |
| `cto` | CTO | executive | user | create_task, create_doc, search_knowledge_base, delegate, web_search, deep_research, remember, search_memory, submit_deliverable | tech_review (Wed 10am) |
| `head-of-products` | Head of Products | manager | user | web_search, create_task, create_doc, create_project, search_knowledge_base, delegate, market_analyze, submit_deliverable | product_review (Wed 10am) |
| `venture-architect` | Venture Architect | specialist | head-of-products | create_task, create_project, create_phase, create_doc, search_knowledge_base, list_tasks, list_projects, get_venture_summary | — |
| `research-analyst` | Research Analyst | specialist | head-of-products | web_search, create_doc, search_knowledge_base, market_analyze, submit_deliverable | — |
| `mvp-builder` | MVP Builder | specialist | head-of-products | create_task, create_doc, create_project, create_phase, search_knowledge_base, code_generate, deploy | — |
| `growth-specialist` | Growth Specialist | specialist | cmo | web_search, create_task, create_doc, search_knowledge_base, market_analyze | — |
| `seo-specialist` | SEO Specialist | specialist | cmo | web_search, create_task, create_doc, search_knowledge_base | — |
| `content-strategist` | Content Strategist | specialist | cmo | web_search, create_task, create_doc, search_knowledge_base | — |
| `social-media-manager` | Social Media Manager | specialist | cmo | web_search, create_task, create_doc, search_knowledge_base | — |

## Agent Runtime

The core execution engine is `server/agents/agent-runtime.ts`. Two entry points:

- **`executeAgentChat(agentSlug, userMessage, userId)`** — direct user-to-agent conversation
- **`executeAgentTask(taskId)`** — executes delegated tasks autonomously

### Execution Flow

1. Load agent definition from DB (cached via registry)
2. Load conversation history (last 10 messages)
3. Build memory context via `buildMemoryContext()` — 60% agent-specific, 30% shared, 10% venture
4. Assemble system prompt: soul template + delegation context + memory
5. Build tool schemas filtered by agent's `available_tools`
6. **Multi-turn tool loop** (max 10 turns):
   - Check context budget → trigger compaction if needed (see [Resonance Pentad](resonance-pentad.md))
   - Call LLM via OpenRouter
   - Process tool calls, execute tools, gather results
   - Check for tool loops (see [Infrastructure](infrastructure.md))
   - If `delegate` tool called → delegation engine handles handoff
7. Save conversation to DB
8. Fire-and-forget: extract learnings, generate embeddings
9. Return `AgentChatResult`

### Quality Gate

- Tool calls validated against agent's `available_tools` and `action_permissions`
- Delegation validated: target must be in `can_delegate_to`, depth < `max_delegation_depth`
- No circular delegation allowed
- Privilege attenuation: delegated tasks get intersection of delegator's and requested permissions

## Delegation Engine

`server/agents/delegation-engine.ts` handles hierarchical task delegation.

- `delegateTask(request)` — validate permissions, create task, send via message bus
- `completeDelegation(taskId, result)` — mark complete, return result to parent
- `failDelegation(taskId, error)` — mark failed with error
- `delegateFromUser(slug, title, desc, priority)` — user-initiated delegation

Task statuses: `pending` → `in_progress` → `delegated` | `completed` | `failed` | `needs_review`

## Built-in Tools

| Tool | Type | Description |
|------|------|-------------|
| `delegate` | Action | Delegate task to child agent |
| `create_task` | Action | Create a task in SB-OS |
| `create_doc` | Action | Create a knowledge base document |
| `create_project` | Action | Create a new project |
| `create_capture` | Action | Add item to inbox |
| `search_knowledge_base` | Read | Search docs/SOPs/knowledge base |
| `list_tasks` | Read | List tasks with filters |
| `list_projects` | Read | List projects with filters |
| `get_venture_summary` | Read | Get venture overview |
| `web_search` | Research | Quick web search (Brave API) |
| `deep_research` | Research | Search + fetch + LLM analysis |
| `generate_report` | Research | Generate briefings/reports |
| `market_analyze` | Research | TAM/SAM/SOM, SWOT, competitive analysis |
| `code_generate` | Build | Project scaffolding (Next.js, Express, landing) |
| `deploy` | Build | Deploy to Vercel or Railway |
| `remember` | Memory | Store persistent memory |
| `search_memory` | Memory | Hybrid semantic + keyword search |
| `submit_deliverable` | Workflow | Submit work for user review |

## Learning Pipeline

`server/agents/learning-extractor.ts` — automatic knowledge extraction.

1. **After every chat**: `extractConversationLearnings()` runs fire-and-forget
   - GPT-4o-mini extracts structured learnings (type, importance, scope, tags)
   - Stores to `agent_memory` table with embeddings
2. **After delegation**: `storeTaskOutcomeLearning()` records success/failure
3. **Nightly consolidation** (3am Dubai):
   - `consolidateAgentMemories()` per agent
   - Merge duplicates (Jaccard similarity > 0.8)
   - Decay stale memories (>90 days + low importance → delete, >30 days → reduce by 0.05)
   - Consolidate shared memory pool

## Deliverables & Review Queue

5 agents can `submit_deliverable`: Chief of Staff, CMO, CTO, Head of Products, Research Analyst.

Deliverables enter `needs_review` status and appear in the `/review` UI for user approval or rejection.

## API Endpoints

All prefixed with `/api/agents`.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | List all agents |
| `GET` | `/:slug` | Get agent by slug |
| `GET` | `/:slug/hierarchy` | Get hierarchy chain |
| `GET` | `/:slug/children` | Get direct reports |
| `POST` | `/:slug/chat` | Chat with agent |
| `GET` | `/:slug/conversations` | Get conversation history |
| `DELETE` | `/:slug/conversations` | Clear conversations |
| `POST` | `/:slug/delegate` | Delegate task to agent |
| `GET` | `/:slug/tasks` | Get agent's tasks |
| `GET` | `/:slug/memory` | Get agent's memories |
| `POST` | `/:slug/memory` | Add memory |
| `POST` | `/:slug/trigger-schedule` | Trigger scheduled job |
| `POST` | `/:slug/reload-schedule` | Reload schedule |
| `GET` | `/delegation/log` | Delegation audit log |
| `GET` | `/compaction-stats` | Aggregate compaction stats |
| `GET` | `/:slug/compaction-stats` | Per-agent compaction stats |
| `POST` | `/admin/seed` | Seed from templates |
| `GET` | `/admin/org-chart` | Hierarchical org chart |
| `GET` | `/admin/channels` | Channel adapter statuses |
| `POST` | `/admin/channels/send` | Send proactive message |
| `GET` | `/admin/schedules` | All scheduled jobs |

## MCP Integration

SB-OS exposes 16 MCP tools for Claude Code integration via `server/mcp-server.ts`. Tools include `get_dashboard`, `list_ventures`, `create_task`, `chat_with_agent`, `delegate_to_agent`, and more.
