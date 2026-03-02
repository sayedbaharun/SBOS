# User Guide

> Daily workflows: morning ritual → deep work → evening review.

## Daily Execution Loop

SB-OS structures the day around a consistent rhythm:

```
9:00am  — Morning Briefing (auto, Telegram)
10:00am — Morning Check-in (smart, skips if done)
         — Deep work throughout the day
6:00pm  — Evening Review (smart, skips if reflected)
         — Nudge engine runs every 30 minutes
4:00pm  — Weekly Report (Fridays only)
```

All times are Dubai (UTC+4).

## Morning Ritual

Start your day via Telegram:

```
morning done
```

This instantly logs all morning habits (50 press-ups, 50 squats, water, supplements). Or log individually:

```
Did 60 press ups 50 squats water supplements
```

The morning check-in at 10am only nudges about MISSING habits — if you've already done everything, it skips entirely.

## Setting Daily Outcomes

Tell the bot your top 3 priorities:

```
Top 3: Ship landing page, review proposals, gym session
```

Or:
```
Focus today: finish the API refactor, client call at 2pm, evening workout
```

## Health Tracking

### Via Telegram NLP

```
Slept 7h good, energy 4, weight 82kg
```

```
Push day 45 mins, felt strong
```

```
Had grilled chicken salad for lunch
```

The bot uses GPT-4o-mini to estimate macros from meal descriptions. You can also send meal photos — the vision model analyzes them.

### Via Web Dashboard

Navigate to the Health section for detailed entries, charts, and trends.

## Command Center V2

The web dashboard home screen shows:

- **Health Battery** — sleep quality, mood, energy level aggregated into a readiness score
- **Top 3 Outcomes** — today's priorities with completion status
- **Urgent Tasks** — overdue or high-priority items with "On Fire" indicator
- **Daily Scorecard** — task completion metrics

## Telegram Quick Actions

| Action | Command |
|--------|---------|
| Capture an idea | `/capture Build competitor analysis dashboard` |
| Check today's status | `/today` |
| See active tasks | `/tasks` |
| Complete a task | `/done 3` (by number from `/tasks`) |
| Add shopping item | `/shop Chicken breast #groceries` |
| Clip a web article | `/clip https://example.com/article` |
| Get a briefing | `/briefing` |
| List agents | `/agents` |

## Agent Chat

Talk to any agent by mentioning them:

```
@cmo Review our Instagram strategy for Hikma Digital
```

```
@cto What's the best approach for migrating to serverless?
```

Plain text without `@` goes to the Chief of Staff, who will either answer or delegate.

### Via Web UI

Navigate to Agent HQ → click any agent → use the chat panel.

## Knowledge Hub

The Knowledge Hub stores all documents: SOPs, prompts, specs, strategies, notes.

### Creating Docs

- Web UI: Knowledge Hub → New Document
- Telegram: `/clip <url>` clips a web article with auto-summary
- Agents: agents can create docs via `create_doc` tool

### Organization

- Docs are hierarchical (folders + children)
- Filtered by venture, type, domain
- Full-text search + RAG vector search
- Quality scoring with review queue

## Trading Module

### Strategies & Checklists

1. Configure trading strategies (instruments, timeframes, risk rules)
2. Each trading day, create a daily checklist from your strategy
3. Pre-trade checklist, session review, post-trade analysis

### Trading AI Coach

Chat with the trading AI in the Trading section. It knows your:
- Account balance and risk rules
- Setup library (FVG, Order Block, etc.)
- Trading beliefs and psychology
- No-trade rules and emotional triggers

### Session Tracking

Log trades with entry/exit, R:R, setup type, emotions, and review notes.

## Focus Slots

Time blocking system for structuring the day:

- **AM Focus** (morning deep work)
- **PM Focus** (afternoon sessions)
- **Evening** (light work, review)

Assign tasks to focus slots to plan your day.

## Evening Review

The bot at 6pm shows:
- Outcome completion status (only INCOMPLETE items)
- Completed task count
- Asks for a quick reflection

Respond naturally:

```
Day was productive, shipped the feature, energy dipped after lunch
```

Or type `done` to close the day.

If you've already logged a reflection, the evening review skips entirely.

## Capture & Triage

### Quick Capture

From anywhere:
- Telegram: `/capture <thought>`
- Web: Click the capture button
- TickTick: Sync from mobile (if configured)

### Triage

Unclarified captures appear in the inbox. For each:
- Convert to task (with venture/project assignment)
- File as knowledge
- Dismiss

The Chief of Staff can also suggest triage actions via the `inbox_triage` scheduled job.

## Strategic Foresight

For venture planning:
- **Scenarios** — model future states with probability and impact
- **PESTLE Analysis** — political, economic, social, technological, legal, environmental factors
- **Trend Signals** — track emerging trends by strength and relevance
- **What-If Questions** — strategic question bank
- **Fear Setting** — Tim Ferriss-style decision analysis

## System Health

Health issues are automatically reported in morning check-in and evening review messages. Monitor:
- Pipeline health (session log ingestion)
- Embedding pipeline status
- Scheduler job errors
- Nudge engine recency
- Telegram connection status
