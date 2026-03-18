# SB-OS: Memory & Intelligence Layer

> **Status**: Work in Progress | **Last Updated**: 2026-03-18 | **Version**: 1.0

---

## Overview

The Memory & Intelligence Layer is what makes SB-OS a "second brain" rather than just a task manager. It stores, retrieves, and evolves knowledge across conversations, agents, and time.

**Four subsystems:**

1. **Hybrid Retriever** — Multi-angle query expansion + triple-arm search + cross-encoder reranking
2. **Memory Stores** — Qdrant (vector), FalkorDB (graph), PostgreSQL (keyword), Pinecone (backup)
3. **Memory Lifecycle** — Autonomous crons that extract, enrich, deepen, and prune memories
4. **Proxy Layer** — $0-first model routing, multi-provider failover, credential isolation

---

## 1. Hybrid Retriever Pipeline

Every memory retrieval flows through this pipeline:

```
User Query
    │
    ▼
┌─────────────────────────┐
│  QUERY EXPANSION         │
│  1 query → 3-5 angles    │
│  (LLM or rule-based)     │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────────────────────────┐
│  TRIPLE-ARM SEARCH (per query variant)       │
│                                              │
│  Arm 1: Qdrant Vector    (semantic, 0.55w)   │
│  Arm 2: PostgreSQL ILIKE  (keyword, 0.25w)   │
│  Arm 3: FalkorDB Graph   (structural, 0.20w) │
│                                              │
│  All 3 arms run in parallel per query        │
│  All query variants run in parallel          │
└───────────┬─────────────────────────────────┘
            │
            ▼
┌─────────────────────────┐
│  RECIPROCAL RANK FUSION  │
│  RRF with k=60           │
│  Adaptive weights:       │
│  graph down → 0.70/0.30  │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  CROSS-ENCODER RERANKING │
│  GPT-4o-mini judges      │
│  relevance 0.0-1.0       │
│  Blend: 70% reranker     │
│         30% RRF score    │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  DEDUPLICATE + FILTER    │
│  Content checksum dedup  │
│  min_score threshold     │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  CLOUD FALLBACK          │
│  If < 3 results:         │
│  → Pinecone backup query │
└───────────┬─────────────┘
            │
            ▼
        Top-K Results
```

### Query Expansion (NEW — Rasputin-inspired)

**File:** `server/memory/query-expander.ts`

Transforms 1 query into 3-5 reformulations to dramatically improve recall:

| Angle | Example (query: "SyntheLIQ pricing strategy") |
|-------|------|
| Original | "SyntheLIQ pricing strategy" |
| Entity-focused | "SyntheLIQ AI lead generation pricing tiers" |
| Topic/synonym | "SaaS pricing model recurring revenue packages" |
| Action-focused | "decisions about SyntheLIQ pricing changes revenue" |

- Uses GPT-4o-mini for LLM expansion (5s timeout, ~100 tokens)
- Falls back to rule-based heuristics (entity extraction, stop-word removal, action prefixing)
- All query variants searched in parallel — no added latency for the search itself

### Cross-Encoder Reranking (NEW — Rasputin-inspired)

**File:** `server/memory/reranker.ts`

After RRF fusion, the top 15 candidates get a precision pass:

1. Build numbered document list (text truncated to 200 chars)
2. GPT-4o-mini scores each document's relevance to the original query (0.0-1.0)
3. Final score = 70% reranker + 30% RRF score
4. Re-sort by final score

**Cost:** ~200 tokens per reranking call (~$0.001). Graceful fallback if it fails.

### Scoring Formula

Each result gets a weighted score:

```
final_score = 0.70 * cosine_similarity
            + 0.15 * recency_decay(half_life=30 days)
            + 0.15 * importance_score(0-1)
```

---

## 2. Memory Stores

### Qdrant Cloud (Primary Vector Store)

**3 collections**, 1536-dimension vectors (text-embedding-3-small):

| Collection | Contents | Payload Fields |
|------------|----------|----------------|
| `raw_memories` | Verbatim conversation messages | text, session_id, timestamp, source, domain, entities, importance |
| `compacted_memories` | Session summaries from compaction | summary, source_session_ids, key_entities, key_decisions, key_facts |
| `entity_index` | Named entities (people, orgs, projects) | name, entity_type, description, first_seen, last_seen, mention_count |

**Payload indexes** on: session_id, domain, timestamp, importance, entity_type

### FalkorDB Cloud (Knowledge Graph)

**Graph name:** `sbos_knowledge`

**Node types:**
| Label | Key Properties |
|-------|----------------|
| `Entity` | id, name, type, description, first_seen, last_seen, mention_count |
| `Memory` | id, summary, domain, importance, timestamp |
| `Decision` | id, content, importance, timestamp |
| `Agent` | id, name, slug |
| `Venture` | id, name |

**Edge types:**
| Relationship | Meaning |
|-------------|---------|
| `MENTIONS` | Memory → Entity (with context) |
| `RELATES_TO` | Entity ↔ Entity (with relationship type + strength) |
| `DECIDED` | Agent → Decision |
| `LEARNED` | Agent → Memory |
| `BELONGS_TO` | Decision → Venture |

**Graph search** extracts entities from query text, finds nodes by name/description match, traverses 1-2 hops for connected context. Score by mention frequency.

### PostgreSQL (Keyword Search + Agent Memory)

**`agent_memory` table** — per-agent persistent memory:

| Field | Type | Purpose |
|-------|------|---------|
| `agent_id` | uuid | Which agent owns this memory |
| `memory_type` | enum | learning, preference, context, relationship, decision |
| `content` | text | Memory content |
| `importance` | float | 0.0-1.0 importance score |
| `scope` | text | agent, shared, or venture |
| `tags` | jsonb | Searchable tags array |
| `embedding` | text | JSON-serialized vector for semantic search |

**Keyword search** uses ILIKE with BM25-lite scoring: term coverage (0.70) + recency decay (0.15) + importance (0.15).

### Pinecone (Cloud Backup)

**Namespace:** `compacted` — backs up compacted memories for disaster recovery. Queried only when local results < 3.

---

## 3. Memory Lifecycle (Autonomous Crons)

**File:** `server/memory/memory-lifecycle.ts`

Before the Rasputin upgrade, memories were mostly static after extraction. Now 4 autonomous processes keep them alive:

```
CONVERSATION HAPPENS
        │
        ▼
┌──────────────────┐     Every 30 min
│   HOT COMMIT      │◄─── Pattern match: decisions, deadlines,
│   (no LLM)        │     preferences, financials
└──────────────────┘     Sub-100ms per message
        │
        ▼
┌──────────────────┐     Fire-and-forget (after each conversation)
│  ENTITY EXTRACTOR │◄─── GPT-4o-mini extracts people, orgs, projects
│  (LLM)            │     Upserts to Qdrant + PostgreSQL + FalkorDB
└──────────────────┘
        │
        ▼
┌──────────────────┐     Every 30 min
│  EMBEDDING        │◄─── Batch process docs without embeddings
│  BACKFILL         │     10 docs/batch, 1-min intervals
└──────────────────┘
        │
        ▼
┌──────────────────┐     Nightly (11 PM)
│  SESSION          │◄─── Compaction: summarize old sessions
│  COMPACTION       │     Pre-compaction rescue (facts, decisions, actions)
└──────────────────┘     Store in Qdrant compacted_memories
        │
        ▼
┌──────────────────┐     Nightly (1 AM)
│  IMPORTANCE       │◄─── Re-score default (0.5) memories
│  ENRICHMENT       │     GPT-4o-mini batch scores (50/run)
└──────────────────┘     Trivial=0.1-0.3, Critical=0.9-1.0
        │
        ▼
┌──────────────────┐     Weekly (Sunday 3 AM)
│  GRAPH DEEPENING  │◄─── Find entity co-occurrences in memories
│                   │     Create new RELATES_TO edges in FalkorDB
└──────────────────┘     Strength = f(co-occurrence count)
        │
        ▼
┌──────────────────┐     Weekly (Sunday 4 AM)
│  MEMORY PRUNE     │◄─── Delete importance < 0.3, age > 90 days
│                   │     Keeps all memories with importance >= 0.7
└──────────────────┘
```

### Hot Commit Patterns

Captures facts immediately without waiting for nightly extraction:

| Pattern | Example | Importance |
|---------|---------|------------|
| Decisions | "decided to use Stripe for payments" | 0.8 |
| Preferences | "always use TypeScript strict mode" | 0.7 |
| Deadlines | "launches on 2026-04-15" | 0.9 |
| Financial | "budget is $5,000" | 0.8 |

### Cron Schedule (Chief of Staff agent)

| Job | Cron | Dubai Time |
|-----|------|------------|
| `hot_commit` | `*/30 * * * *` | Every 30 minutes |
| `embedding_backfill` | `*/30 * * * *` | Every 30 minutes |
| `session_log_extraction` | `0 22 * * *` | 2:00 AM |
| `memory_consolidation` | `0 23 * * *` | 3:00 AM |
| `importance_enrichment` | `0 1 * * *` | 5:00 AM |
| `graph_deepening` | `0 3 * * 0` | 7:00 AM Sunday |
| `memory_prune` | `0 4 * * 0` | 8:00 AM Sunday |
| `pipeline_health_check` | `0 */6 * * *` | Every 6 hours |

### Manual Triggers (API)

All lifecycle jobs can be triggered manually:

| Endpoint | What it does |
|----------|-------------|
| `POST /api/rag/lifecycle/hot-commit` | Run hot commit now |
| `POST /api/rag/lifecycle/enrich` | Run importance enrichment now |
| `POST /api/rag/lifecycle/deepen-graph` | Run graph deepening now |
| `POST /api/rag/lifecycle/cleanup` | Run memory prune now |

---

## 4. Proxy Layer (Model Routing & Failover)

**File:** `server/model-manager.ts`

### $0-First Routing

```
Request comes in with complexity tag
        │
        ▼
  ┌─── Is local Qwen running? ───┐
  │ YES                     NO    │
  ▼                         ▼     │
simple → local Qwen ($0)    simple → GPT-4o-mini (OpenRouter)
moderate → local Qwen ($0)  moderate → GPT-4o-mini (OpenRouter)
complex → GPT-4o (OpenRouter) complex → GPT-4o (OpenRouter)
```

Local model check uses a 60-second cached health probe — zero added latency.

### Failover Cascade

```
OpenRouter (primary)
    │ fails / 402 credit exhaustion
    ▼
Kilo Code (fallback gateway)
    │ fails
    ▼
Local Qwen (if available)
    │ fails
    ▼
Error with all-models-exhausted message
```

### Provider Health Monitoring

Each provider tracks:
- Status: `healthy` → `degraded` (2 failures) → `down` (5 failures) → `exhausted` (402)
- Latency: Exponential moving average (alpha=0.3)
- Total requests/failures count
- Last model used

**60-second background probes** against each configured provider's `/models` endpoint.

**Credit exhaustion detection:** HTTP 402 or `insufficient_credit` patterns trigger 5-minute cooldown with immediate failover.

### Credential Proxy

**File:** `server/infra/credential-proxy.ts`

12-service registry with execution-boundary isolation:

| Service | Key |
|---------|-----|
| OpenRouter | `OPENROUTER_API_KEY` |
| Kilo Code | `KILOCODE_API_KEY` |
| OpenAI | `OPENAI_API_KEY` |
| Brave Search | `BRAVE_SEARCH_API_KEY` |
| Telegram | `TELEGRAM_BOT_TOKEN` |
| WhatsApp | `WHATSAPP_TOKEN` |
| Vercel | `VERCEL_TOKEN` |
| Railway | `RAILWAY_TOKEN` |
| Google | `GOOGLE_CLIENT_ID/SECRET` |
| Resend | `RESEND_API_KEY` |
| FalkorDB | `FALKORDB_URL` |
| Pinecone | `PINECONE_API_KEY` |

**Principle:** Agents reference services by name, never by env var. Keys injected only at tool-execution boundary. Output scrubbed via `scrubCredentials()`.

### Cost Tracking

Every LLM call logs to `token_usage_log`:
- Model used, provider
- Prompt tokens, completion tokens
- Estimated cost (cents) using per-model pricing table
- Agent ID (if from agent)
- Source (web_chat, telegram, scheduler, etc.)

---

## 5. Multi-Model Council (High-Stakes Decisions)

**File:** `server/agents/multi-model-council.ts`

For venture strategy, investment decisions, or architecture choices, the council queries multiple models in parallel.

### Standard Mode

3 models answer the same question independently:

| Model | Role |
|-------|------|
| Claude Sonnet 4 | Analytical Advisor |
| GPT-4o | Strategic Thinker |
| Gemini 2.5 Flash | Pragmatic Engineer |

Each response includes: confidence score (25-95%), key points, risks.

### Fractal Mode

4 sub-agents (via GPT-4o-mini, cheap) research from different angles:

| Perspective | Focus |
|------------|-------|
| Researcher | Evidence, data, what supports/contradicts |
| Devil's Advocate | Challenge assumptions, hidden risks |
| Feasibility Analyst | Resources, timeline, constraints |
| Creative Strategist | Unconventional approaches, opportunities |

### Synthesis

A synthesis model (default: Claude Sonnet 4) integrates all responses:
- Weighs by confidence level
- Resolves contradictions
- Produces unified recommendation

### Output

```json
{
  "question": "Should we pivot SyntheLIQ to vertical SaaS?",
  "mode": "fractal",
  "members": [/* 4 sub-agent responses with confidence */],
  "synthesis": "## Synthesis\n...\n## Recommendation\n...",
  "consensusLevel": "moderate",
  "contradictions": ["Confidence split: GPT-4o (85%) vs Gemini (45%)"],
  "recommendation": "...",
  "totalLatencyMs": 8500
}
```

**API:** `POST /api/agents/council`

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `server/memory/hybrid-retriever.ts` | Main retrieval pipeline (expansion → search → RRF → rerank) |
| `server/memory/query-expander.ts` | Multi-angle query expansion |
| `server/memory/reranker.ts` | Cross-encoder reranking |
| `server/memory/qdrant-store.ts` | Qdrant client (3 collections) |
| `server/memory/graph-store.ts` | FalkorDB graph operations |
| `server/memory/pinecone-store.ts` | Pinecone backup store |
| `server/memory/entity-extractor.ts` | Named entity extraction (GPT-4o-mini) |
| `server/memory/entity-linker.ts` | Entity relationship linking |
| `server/memory/memory-lifecycle.ts` | Autonomous memory crons |
| `server/memory/schemas.ts` | Zod schemas for all memory types |
| `server/compaction/compactor.ts` | Session compaction pipeline |
| `server/compaction/memory-rescue.ts` | Pre-compaction fact extraction |
| `server/model-manager.ts` | LLM routing, failover, health monitoring |
| `server/infra/credential-proxy.ts` | Credential isolation |
| `server/agents/multi-model-council.ts` | Multi-model deliberation |

---

*This document is a living reference. Update it as the memory system evolves.*
