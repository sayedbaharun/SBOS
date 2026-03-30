# Agent Operating Rhythm

> Daily, weekly, and scheduled work for every SB-OS agent.
> Maintained by the Librarian. Last updated: 2026-03-06.

---

## Full Daily Timeline (Dubai Time)

```
TIME        AGENT               JOB                    FREQ
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
8:00am      CoS                 email_triage (1/3)     Daily
9:00am      CoS                 daily_briefing         Daily
9:00am      Research Analyst    upstream_feature_scan  Daily
9:00am      Exec Asst           morning_schedule       Daily
9:00am      Opp Hunter          opportunity_scan       MWF
9:30am      CoS                 morning_checkin        Daily
10:00am     Content Strategist  content_calendar       Monday
10:00am     CTO                 tech_review            Wednesday
10:00am     Librarian           knowledge_audit        Wednesday
11:00am     Growth Specialist   growth_opportunities   Mon/Thu
11:00am     Social Media Mgr    content_queue          Sun/Wed
12:00pm     CMO                 distribution_check     MWF
12:00pm     MVP Builder         project_health         MWF
12:00pm     Agent Engineer      model_cost_review      Monday
12:00pm     SEO Specialist      seo_audit              Tuesday
1:00pm      CoS                 email_triage (2/3)     Daily
1:00pm      Research Analyst    market_pulse           Tue/Fri
2:00pm      CTO                 architecture_health    Monday
2:00pm      Venture Architect   venture_health         Thursday
3:00pm      Agent Engineer      agent_performance      Friday
5:00pm      CMO                 weekly_report          Friday
6:00pm      CoS                 email_triage (3/3)     Daily
7:00pm      CoS                 evening_review         Daily
8:00pm      Exec Asst           weekly_planning        Sunday
8:00pm      CMO                 campaign_review        Monday
10:00pm     Librarian           knowledge_extraction   Daily
10:00pm     CoS                 session_log_extraction Daily
11:00pm     CoS                 memory_consolidation   Daily
Every 6h    CoS                 pipeline_health_check  4x/day
Fri 4:00pm  CoS                 weekly_report_cos      Friday
```

---

## Agent-by-Agent Breakdown

### Chief of Staff (CoS) — @SBNexusBot
**Model**: Opus (top tier) | **Role**: Executive orchestrator

| Job | Schedule | What It Does |
|-----|----------|-------------|
| `daily_briefing` | Daily 9am | Cross-domain intelligence synthesis (calendar + tasks + email + health + memory) → one unified morning briefing via Telegram |
| `morning_checkin` | Daily 9:30am | Smart check-in — skips if rituals done, only nudges missing items + system health |
| `evening_review` | Daily 7pm | Day summary: outcomes progress, open tasks, completed work. Asks for reflection |
| `email_triage` | Daily 8am/1pm/6pm | Classifies unread emails as urgent/action/info/spam. Telegram digest |
| `session_log_extraction` | Daily 10pm | Processes Claude Code session logs → extracts learnings → agent_memory + Qdrant + Pinecone |
| `memory_consolidation` | Daily 11pm | Merges duplicate memories, decays stale ones, boosts confirmed patterns. Runs compaction tuner |
| `pipeline_health_check` | Every 6h | Monitors session log ingestion, Qdrant, Pinecone, unprocessed backlogs. Telegram alert on failure |
| `weekly_report_cos` | Fri 4pm | Friday wrap-up: tasks completed, ventures progressed, health trends, wins → Telegram + Knowledge Hub |

---

### Executive Assistant
**Model**: Haiku (fast) | **Role**: Calendar & scheduling

| Job | Schedule | What It Does |
|-----|----------|-------------|
| `morning_schedule` | Daily 9am | Reviews today's calendar, highlights conflicts, suggests time blocks |
| `weekly_planning` | Sun 8pm | Plans the week ahead — reviews upcoming events, suggests focus areas |

---

### CMO
**Model**: Sonnet (mid) | **Role**: Marketing strategy

| Job | Schedule | What It Does |
|-----|----------|-------------|
| `weekly_report` | Fri 5pm | Weekly marketing performance report — metrics, channel analysis, recommendations |
| `campaign_review` | Mon 8pm | Reviews ongoing campaigns/projects, assesses what's working |
| `distribution_check` | MWF 12pm | **NEW** — Per launched venture: which distribution channels are active? What's working? What to try next? Telegram brief |

---

### CTO
**Model**: Sonnet (mid) | **Role**: Technical strategy

| Job | Schedule | What It Does |
|-----|----------|-------------|
| `tech_review` | Wed 10am | Reviews all technical projects, identifies blocked/at-risk items, architectural concerns |
| `architecture_health` | Mon 2pm | **NEW** — Tech debt scan, security concerns, infrastructure issues across all codebases. Telegram summary |

---

### Growth Specialist
**Model**: Haiku (fast) | **Parent**: CMO

| Job | Schedule | What It Does |
|-----|----------|-------------|
| `growth_opportunities` | Mon/Thu 11am | **NEW** — Scans ventures for untried distribution channels, growth levers, quick-win experiments. Submits recommendations to review queue |

**Tools**: web_search, create_task, create_doc, search_knowledge_base, market_analyze, submit_deliverable, remember, list_projects, get_venture_summary

---

### SEO Specialist
**Model**: Haiku (fast) | **Parent**: CMO

| Job | Schedule | What It Does |
|-----|----------|-------------|
| `seo_audit` | Tue 12pm | **NEW** — Audits live web properties for SEO issues: meta tags, schema markup, Core Web Vitals, keyword gaps. Submits report to review queue |

**Tools**: web_search, create_task, create_doc, search_knowledge_base, submit_deliverable, remember

---

### Social Media Manager
**Model**: Haiku (fast) | **Parent**: CMO

| Job | Schedule | What It Does |
|-----|----------|-------------|
| `content_queue` | Sun/Wed 11am | **NEW** — Drafts 3-5 social posts per venture from Knowledge Hub content + recent wins. Submits batch to review queue for approval before publishing |

**Tools**: web_search, create_task, create_doc, search_knowledge_base, submit_deliverable, remember

---

### Content Strategist
**Model**: Haiku (fast) | **Parent**: CMO

| Job | Schedule | What It Does |
|-----|----------|-------------|
| `content_calendar` | Mon 10am | **NEW** — Weekly content plan: what's scheduled, gaps in coverage, trending topics to leverage. Produces calendar doc in Knowledge Hub |

**Tools**: web_search, create_task, create_doc, search_knowledge_base, submit_deliverable, remember

---

### MVP Builder
**Model**: Haiku (fast) | **Parent**: CTO

| Job | Schedule | What It Does |
|-----|----------|-------------|
| `project_health` | MWF 12pm | **NEW** — Checks for stalled tasks (>7 days no update), stalled projects, on-hold items. Creates unblock tasks or flags to CTO |

**Custom handler**: Queries `tasks` and `projects` tables directly for stale items, feeds structured data to the agent.

**Tools**: create_task, create_doc, create_project, create_phase, search_knowledge_base, code_generate, deploy, list_tasks, list_projects

---

### Research Analyst
**Model**: Haiku (fast) | **Parent**: CTO

| Job | Schedule | What It Does |
|-----|----------|-------------|
| `market_pulse` | Tue/Fri 1pm | **NEW** — Market landscape scan per active venture: competitor moves, funding rounds, product launches, regulatory changes. Submits brief to review queue |
| `upstream_feature_scan` | Daily 9am | **NEW** — Checks upstream repos for new commits/releases relevant to our projects. Assesses relevance, adoption effort, and impact |

**Upstream repos monitored**:
- **NanoClaw**: https://github.com/qwibitai/nanoclaw.git
- **OpenClaw**: https://github.com/openclaw/openclaw.git

**Tools**: web_search, create_doc, search_knowledge_base, market_analyze, submit_deliverable, remember, list_projects, get_venture_summary

---

### Venture Architect
**Model**: Sonnet (mid) | **Parent**: CTO

| Job | Schedule | What It Does |
|-----|----------|-------------|
| `venture_health` | Thu 2pm | **NEW** — Reviews all ventures: status vs plan, missing phases, stalled projects, untracked ventures mentioned in conversations. Submits structured report |

**Custom handler**: Queries ventures with project counts, task counts, completion rates. Feeds aggregate data to the agent.

**Tools**: create_task, create_project, create_phase, create_doc, search_knowledge_base, list_tasks, list_projects, get_venture_summary, submit_deliverable, remember

---

### Agent Engineer
**Model**: Sonnet (mid) | **Parent**: CTO

| Job | Schedule | What It Does |
|-----|----------|-------------|
| `agent_performance` | Fri 3pm | **NEW** — Analyzes dead letter queue, agent conversation volumes, compaction events, tool usage patterns. Submits improvement recommendations |
| `model_cost_review` | Mon 12pm | **NEW** — Fetches OpenRouter model list, compares price/speed/quality vs current tiers. Produces weekly cost optimization report with savings estimate |

**Custom handlers**: Both query operational tables (dead_letter_jobs, agent_conversations, agent_compaction_events) and external APIs (OpenRouter /models).

**Tools**: create_doc, create_task, search_knowledge_base, web_search, deep_research, remember, search_memory, submit_deliverable

---

### Opportunity Hunter
**Model**: Haiku (fast) | **Parent**: CTO

| Job | Schedule | What It Does |
|-----|----------|-------------|
| `opportunity_scan` | MWF 9am | Scans Reddit, Twitter/X, Hacker News for micro-SaaS ideas that can be built in <8 hours. Submits findings to review queue |

---

### Librarian
**Model**: Haiku (fast) | **Parent**: CTO

| Job | Schedule | What It Does |
|-----|----------|-------------|
| `knowledge_extraction` | Daily 10pm | Mines last 48h of agent conversations → extracts learnings (remember), decisions (create_doc), patterns (submit_deliverable) |
| `knowledge_audit` | Wed 10am | Flags stale docs (90+ days), orphaned docs (no venture/tags), duplicates. Submits audit report to review queue |

---

## Agent Hierarchy

```
Sayed (user)
└── Chief of Staff (SBNexusBot) — Opus
    ├── Executive Assistant — Haiku
    ├── CMO — Sonnet
    │   ├── Growth Specialist — Haiku
    │   ├── SEO Specialist — Haiku
    │   ├── Social Media Manager — Haiku
    │   └── Content Strategist — Haiku
    └── CTO — Sonnet
        ├── MVP Builder — Haiku
        ├── Research Analyst — Haiku
        ├── Opportunity Hunter — Haiku
        ├── Venture Architect — Sonnet
        ├── Agent Engineer — Sonnet
        └── Librarian — Haiku
```

---

## How Scheduled Jobs Work

1. **Cron strings** are defined in each agent's template YAML frontmatter (e.g., `"0 7 * * 1,4"`)
2. The **agent-scheduler** reads these on seed and registers cron jobs
3. When a cron fires, it calls `executeScheduledJob(agentId, agentSlug, jobName)`
4. If a **custom handler** exists (registered via `registerJobHandler`), it runs that handler with pre-fetched data
5. If no handler exists, it falls back to: `executeAgentChat(slug, "Execute your scheduled task: ${jobName}", "scheduler")`
6. The agent uses its **soul template** (personality, responsibilities, scheduled job instructions) + **tools** to complete the work
7. Most agents submit output via `submit_deliverable` → appears in the **Review Queue** for Sayed's approval

## Job Failure Handling

- Failed jobs retry 3x with exponential backoff (30s, 2min, 10min)
- After 3 failures → written to `dead_letter_jobs` table + Telegram alert
- Agent Engineer's `agent_performance` job reviews dead letters weekly

---

## Notes

- All times shown are **Dubai (UTC+4)**. Cron strings are in **UTC**.
- Agents with `submit_deliverable` tool send work to the **Review Queue** (`/review`) for approval.
- The Librarian is responsible for keeping this document current.
- **OpenRouter credits must be topped up** for agents to function — all LLM calls go through OpenRouter.
