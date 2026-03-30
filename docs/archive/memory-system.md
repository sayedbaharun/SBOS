# Memory System

> 4-layer memory architecture: PostgreSQL → Qdrant → Pinecone → FalkorDB

## Architecture Overview

```
User Interaction / Agent Conversation
    │
    ▼
┌─────────────────────────────────────┐
│  PostgreSQL (source of truth)       │
│  Tables: agent_memory,             │
│    agent_conversations, session_logs │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  OpenRouter Embeddings              │
│  text-embedding-3-small (1536-dim)  │
└──────────────┬──────────────────────┘
               │
    ┌──────────┼──────────────┐
    ▼          ▼              ▼
┌────────┐ ┌────────────┐ ┌────────┐
│ Qdrant │ │  Pinecone  │ │FalkorDB│
│ Vector │ │  Cloud     │ │ Graph  │
│ Search │ │  Backup    │ │ (opt.) │
└────────┘ └────────────┘ └────────┘
```

## Layer 1: PostgreSQL (Source of Truth)

### Key Tables

| Table | Purpose |
|-------|---------|
| `agent_memory` | Per-agent persistent memories with importance scoring |
| `agent_conversations` | Full conversation history with threading |
| `session_logs` | Cross-session continuity logs |
| `telegram_messages` | Raw Telegram message log |
| `venture_conversations` | Venture-scoped chat history |

### agent_memory Schema

| Column | Type | Purpose |
|--------|------|---------|
| `agent_id` | uuid | Owner agent (or sentinel for shared) |
| `memory_type` | enum | `learning`, `preference`, `context`, `relationship`, `decision` |
| `content` | text | Memory content |
| `importance` | real | 0.0–1.0 (higher = more important) |
| `scope` | text | `agent` (private), `shared` (cross-agent), `venture` |
| `tags` | jsonb | Semantic tags for categorization |
| `embedding` | text | JSON-serialized float[] |
| `expires_at` | timestamp | Optional TTL |

Shared memories use `SHARED_MEMORY_AGENT_ID` sentinel (UUID `00000000-...`).

## Layer 2: Qdrant (Primary Vector Search)

Qdrant Cloud instance accessed via `QDRANT_URL` + `QDRANT_API_KEY`.

### Collections

| Collection | Purpose | Dimensions |
|-----------|---------|-----------|
| `raw_memories` | Uncompacted conversation chunks | 1536 |
| `compacted_memories` | Dense summaries from compaction | 1536 |
| `entity_index` | People, orgs, projects, concepts | 1536 |
| `knowledge_base` | Knowledge Hub docs (auto-synced) | 1536 |

### Scoring

```
score = 0.70 × cosine_similarity
      + 0.15 × recency_factor
      + 0.15 × importance_factor
```

## Layer 3: Pinecone (Cloud Backup)

Index: `sbos-memory`. Embeddings truncated to 512 dimensions (Matryoshka) for 50% storage cost reduction.

### Namespaces

| Namespace | Purpose | Source |
|----------|---------|--------|
| `compacted` | Mirror of Qdrant compacted memories | Sync engine |
| `entities` | Mirror of Qdrant entity index | Sync engine |
| `decisions` | High-priority decisions from Reflector | Resonance routing |

## Layer 4: FalkorDB (Knowledge Graph)

Optional graph layer activated via `FALKORDB_URL`. Gracefully degrades when not set.

### Node Types

- `Entity` — people, organizations, projects, concepts
- `Memory` — compacted observations
- `Decision` — strategic decisions
- `Agent` — AI agents
- `Venture` — business ventures

### Ingestion

The Reflector (Resonance Pentad Layer 3) routes entities and decisions to FalkorDB via `ingestCompactionToGraph()`.

## Embedding Pipeline

- **Model**: OpenRouter `text-embedding-3-small` (1536 dimensions)
- **NOT** Ollama/local — all embeddings go through OpenRouter
- **Batch processing**: Background task generates embeddings for new memories
- **Auto-sync**: Knowledge Hub docs trigger Qdrant upsert on create/update/delete

## Hybrid Search

Memory retrieval uses triple-arm Reciprocal Rank Fusion (RRF):

```
Final Score = RRF(
  vector_arm × 0.55,    # Cosine similarity via Qdrant
  keyword_arm × 0.25,   # BM25 keyword matching
  graph_arm × 0.20      # FalkorDB graph traversal (when available)
)
```

### Search Flow

1. Generate query embedding (1536-dim via OpenRouter)
2. Search Qdrant collections (vector + keyword arms)
3. If FalkorDB available, traverse graph for related entities
4. Merge results via RRF, deduplicate by content checksum
5. Apply metadata pre-filters: `minImportance`, `maxAgeDays`, `entityTypes`
6. Return top-k results to agent context

## Session Persistence Pipeline

Cross-session continuity for Claude Code and other clients:

1. **Stop hook** → `curl POST /api/sessions/log` — captures session summary
2. **Storage** → `session_logs` table with embedding
3. **Nightly extraction** (2am Dubai / 10pm UTC):
   - Query unprocessed logs
   - GPT-4o-mini extracts structured learnings
   - Route to `agent_memory` + Qdrant + Pinecone
   - Mark as processed
4. **4 days of history** backfilled (Feb 22-25, 32 sections)

## Knowledge Hub Sync

Docs in the Knowledge Hub auto-sync to Qdrant `knowledge_base` collection:

- **Trigger**: On doc create, update, or delete
- **Bulk sync**: Runs on startup
- **Script**: `~/.claude/scripts/sync-memory-to-kb.py` pushes 5 local .md files
- **Tag**: `system-context` — agents search via `search_knowledge_base`

## Memory Context Building

`buildMemoryContext(agentId, maxTokens)` assembles context for agent system prompts:

| Section | Budget | Content |
|---------|--------|---------|
| Agent-specific | 60% | Private memories, sorted by importance |
| Shared | 30% | Cross-agent organization-wide memories |
| Venture-specific | 10% | Current venture context |

`buildRelevantMemoryContext(agentId, currentMessage, maxTokens)` does semantic search against the current message to surface contextually relevant past memories.

## Memory Rescue

When Layer 2 compaction discards older messages, `rescueMemories()` runs a 3-extractor pipeline to save critical content before it's lost:

1. **Facts** — key information and data points
2. **Decisions** — choices made and their rationale
3. **Skills** — learned patterns and approaches

## Consolidation Cycle (Nightly, 3am Dubai)

Per agent + shared memory pool:

1. **Merge duplicates**: Jaccard text similarity > 0.8 → keep higher importance, boost by +0.1
2. **Decay stale**: >90 days old + importance <0.3 → delete
3. **Reduce aging**: >30 days old + importance <0.5 → reduce importance by 0.05
4. **Compaction tuning**: Analyze 7-day compaction history, adjust thresholds (see [Resonance Pentad](resonance-pentad.md))

## Environment Variables

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `QDRANT_URL` | Yes | — | Qdrant Cloud endpoint |
| `QDRANT_API_KEY` | Yes | — | Qdrant authentication |
| `PINECONE_API_KEY` | No | — | Pinecone cloud backup |
| `PINECONE_INDEX` | No | `sbos-memory` | Pinecone index name |
| `FALKORDB_URL` | No | — | FalkorDB graph (optional) |
| `CEREBRAS_API_KEY` | No | — | Fast inference for compaction |
| `OPENROUTER_API_KEY` | Yes | — | Embeddings + LLM calls |
