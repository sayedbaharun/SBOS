# SB-OS Memory Architecture

## System Diagram

```
                           ┌─────────────────────────────────────┐
                           │         USER INTERACTION            │
                           │   Telegram  /  Web App  /  Agents   │
                           └──────────────┬──────────────────────┘
                                          │
                                          ▼
                    ┌─────────────────────────────────────────────┐
                    │            AGENT RUNTIME                     │
                    │                                              │
                    │  Chief of Staff / CTO / CMO / Specialists   │
                    │  Tools: search_knowledge_base, remember,     │
                    │         get_life_context, web_search, etc.   │
                    └──────┬──────────────────┬───────────────────┘
                           │                  │
                  Raw conversation      Memory queries
                   messages flow         (search/store)
                           │                  │
              ┌────────────▼────────┐         │
              │  CONTEXT MONITOR    │         │
              │                     │         │
              │  Tracks messages    │         │
              │  per session.       │         │
              │  Triggers           │         │
              │  compaction when    │         │
              │  threshold hit.     │         │
              └────────┬────────────┘         │
                       │                      │
                       │ 50+ messages          │
                       │ need compaction       │
                       ▼                      │
    ┌──────────────────────────────────┐      │
    │                                  │      │
    │   ☁️  CEREBRAS                    │      │
    │   Llama 3.3 70b                  │      │
    │   api.cerebras.ai/v1             │      │
    │                                  │      │
    │   Purpose: FAST COMPACTION       │      │
    │                                  │      │
    │   Input:  50 raw messages        │      │
    │   Output: Structured summary     │      │
    │     ├─ summary (2-4 paragraphs)  │      │
    │     ├─ key_decisions[]           │      │
    │     ├─ key_facts[]               │      │
    │     ├─ key_entities[]            │      │
    │     ├─ action_items[]            │      │
    │     ├─ domain                    │      │
    │     └─ emotional_tone            │      │
    │                                  │      │
    │   Fallback: Ollama (local)       │      │
    │   deepseek-r1:32b               │      │
    │   Timeout: 30s / 120s fallback   │      │
    │                                  │      │
    └─────────────┬────────────────────┘      │
                  │                           │
                  │ Compacted summary          │
                  ▼                           │
    ┌──────────────────────────────────┐      │
    │                                  │      │
    │   💾 QDRANT (Local Vector DB)    │◄─────┘
    │   Runs on same server            │
    │                                  │
    │   Collections:                   │
    │   ┌────────────────────────────┐ │
    │   │ raw_memories               │ │ ← Uncompacted conversation chunks
    │   │ (short-lived, get merged)  │ │
    │   └────────────────────────────┘ │
    │   ┌────────────────────────────┐ │
    │   │ compacted_memories         │ │ ← Dense summaries from Cerebras
    │   │ (long-lived, high signal)  │ │
    │   └────────────────────────────┘ │
    │   ┌────────────────────────────┐ │
    │   │ entity_index               │ │ ← People, orgs, projects, concepts
    │   │ (living snapshots)         │ │
    │   └────────────────────────────┘ │
    │                                  │
    │   Embeddings: 1024-dim           │
    │   (Ollama nomic-embed-text-v1.5) │
    │                                  │
    │   Search: cosine similarity      │
    │   Score: 0.70×cosine +           │
    │          0.15×recency +          │
    │          0.15×importance          │
    │                                  │
    └─────────────┬────────────────────┘
                  │
                  │ Sync events (event bus)
                  │ ├─ compacted → 30s
                  │ ├─ entities  → 5min batch
                  │ └─ full reconciliation → 15min
                  │
                  ▼
    ┌──────────────────────────────────┐
    │                                  │
    │   🔄 SYNC ENGINE                 │
    │                                  │
    │   Event-driven orchestration     │
    │   ├─ In-memory event buffer      │
    │   ├─ Sync ledger (status track)  │
    │   ├─ Offline resilience          │
    │   └─ Conflict detection          │
    │                                  │
    │   States: pending → synced       │
    │           pending → conflict     │
    │                                  │
    └─────────────┬────────────────────┘
                  │
                  │ Batched upserts
                  │ (100 records max per call)
                  ▼
    ┌──────────────────────────────────┐
    │                                  │
    │   ☁️  PINECONE (Cloud Vector DB)  │
    │   Index: sbos-memory             │
    │                                  │
    │   Namespaces:                    │
    │   ┌────────────────────────────┐ │
    │   │ compacted                  │ │ ← Mirror of Qdrant compacted
    │   └────────────────────────────┘ │
    │   ┌────────────────────────────┐ │
    │   │ entities                   │ │ ← Mirror of Qdrant entities
    │   └────────────────────────────┘ │
    │   ┌────────────────────────────┐ │
    │   │ decisions                  │ │ ← Decision log entries
    │   └────────────────────────────┘ │
    │                                  │
    │   Embeddings: 512-dim            │
    │   (Matryoshka truncation from    │
    │    1024-dim, renormalized)        │
    │   50% storage cost reduction     │
    │                                  │
    │   Purpose:                       │
    │   ├─ Cloud backup / DR           │
    │   ├─ Multi-device access         │
    │   └─ Fallback when local weak    │
    │                                  │
    └──────────────────────────────────┘


    ╔══════════════════════════════════════════════════════════════╗
    ║                    RETRIEVAL FLOW                           ║
    ║                                                             ║
    ║  Agent asks "What did we discuss about Aivant pricing?"     ║
    ║                                                             ║
    ║  1. Generate query embedding (Ollama, 1024-dim)             ║
    ║                          │                                  ║
    ║  2. Search QDRANT first  │  (local, fast, <10ms)            ║
    ║           │              │                                  ║
    ║           ├─ ≥3 quality results? ──► Return results         ║
    ║           │                                                 ║
    ║           └─ <3 quality results?                            ║
    ║                    │                                        ║
    ║  3. Fallback: Search PINECONE  (cloud, ~50-100ms)           ║
    ║           │        (truncate query to 512-dim)              ║
    ║           │                                                 ║
    ║  4. Merge + deduplicate by content checksum                 ║
    ║           │                                                 ║
    ║  5. Score: 0.70×cosine + 0.15×recency + 0.15×importance    ║
    ║           │                                                 ║
    ║  6. Return top results to agent context                     ║
    ║                                                             ║
    ╚══════════════════════════════════════════════════════════════╝


    ╔══════════════════════════════════════════════════════════════╗
    ║                  COMPACTION FLOW                            ║
    ║                                                             ║
    ║  Session accumulates 50+ messages                           ║
    ║           │                                                 ║
    ║  Context Monitor triggers compaction                        ║
    ║           │                                                 ║
    ║  ┌───────▼──────────────────────────────────┐               ║
    ║  │ CEREBRAS (Llama 3.3 70b)                 │               ║
    ║  │ "Summarize these 50 messages into a      │               ║
    ║  │  dense summary with structured fields"   │               ║
    ║  │                                          │               ║
    ║  │  If fails → OLLAMA (deepseek-r1:32b)     │               ║
    ║  └───────┬──────────────────────────────────┘               ║
    ║          │                                                  ║
    ║  Structured JSON output (Zod-validated)                     ║
    ║          │                                                  ║
    ║  ┌───────▼──────────┐    ┌──────────────────┐               ║
    ║  │ Store in QDRANT   │    │ Extract entities  │               ║
    ║  │ compacted_memories│    │ → entity_index    │               ║
    ║  └───────┬──────────┘    └──────────────────┘               ║
    ║          │                                                  ║
    ║  Mark raw messages as compacted                             ║
    ║          │                                                  ║
    ║  Sync event emitted → SYNC ENGINE                           ║
    ║          │                                                  ║
    ║  ┌───────▼──────────┐                                       ║
    ║  │ Push to PINECONE  │  (within 30 seconds)                 ║
    ║  │ 512-dim truncated │                                      ║
    ║  └──────────────────┘                                       ║
    ║                                                             ║
    ╚══════════════════════════════════════════════════════════════╝
```

## Component Summary

| Component | Type | Purpose | Location |
|-----------|------|---------|----------|
| **Qdrant** | Local vector DB | Primary storage for all memories | Same server |
| **Pinecone** | Cloud vector DB | Backup, multi-device, fallback search | `sbos-memory` index |
| **Cerebras** | Cloud LLM inference | Fast compaction (50 msgs → 1 summary) | Llama 3.3 70b |
| **Ollama** | Local LLM inference | Fallback for Cerebras + embeddings | nomic-embed-text / deepseek-r1 |
| **Sync Engine** | Orchestrator | Event-driven local→cloud sync | In-process |

## Key Numbers

| Metric | Value |
|--------|-------|
| Local embedding dimensions | 1024 (Ollama nomic-embed-text-v1.5) |
| Cloud embedding dimensions | 512 (Matryoshka truncated) |
| Compaction trigger | ~50 messages |
| Sync latency (compacted) | 30 seconds |
| Sync latency (entities) | 5 minutes |
| Full reconciliation | 15 minutes |
| Retrieval scoring | 70% cosine + 15% recency + 15% importance |
| Cerebras timeout | 30 seconds |
| Ollama fallback timeout | 120 seconds |
| Pinecone batch limit | 100 records per call |
