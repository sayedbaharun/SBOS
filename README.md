# SB-OS — Personal Operating System

> Full-stack personal OS for managing multiple business ventures, projects, tasks, health, knowledge, and trading — powered by **18 AI agents** with persistent long-term memory.

Built for one founder: **Sayed Baharun** (Dubai, UAE).

---

## At a Glance

| Metric | Count |
|--------|-------|
| TypeScript files | **432** (193 server + 239 client) |
| Database tables | **72** |
| API endpoints | **403** across 49 route files |
| Client pages | **35** |
| AI agents | **18 active** (hierarchical, delegating, memory-enabled) |
| LLM providers | **5** (OpenRouter → Kilo → Groq → Cerebras → Ollama) |
| Available AI models | **15** across Anthropic, OpenAI, Google, DeepSeek, Meta |
| Memory stores | **4** (PostgreSQL + Qdrant + Pinecone + FalkorDB) |
| Embedding model | **Gemini Embedding 001** (MTEB 68.32, 8K context, 8 task types) |
| Deployment | **Railway** (auto-deploy on push to `main`) |

---

## Capabilities

- **Multi-venture management** — projects, phases, tasks, docs, and AI agents scoped per venture
- **18 AI agents** — hierarchical team (Chief of Staff → CMO/CTO → specialists → workers) with delegation, memory, and 30+ scheduled jobs
- **4-store memory pipeline** — Qdrant (local vector) + Pinecone (cloud backup) + FalkorDB (knowledge graph) + PostgreSQL (relational)
- **Gemini Embedding 001** — 8 task-type routing modes (RETRIEVAL_DOCUMENT, RETRIEVAL_QUERY, SEMANTIC_SIMILARITY, etc.) with Matryoshka 1536-dim
- **A-MAC quality gate** — pre-storage scoring (relevance + novelty + specificity), rejects noise before it hits the vector store
- **Ebbinghaus memory decay** — importance-scaled half-lives (365d/60d/14d), spaced-repetition boost per retrieval, 20% floor for critical memories
- **Inline dedup** — cosine > 0.92 + word overlap > 50% → update existing point instead of storing duplicate
- **Proactive memory surfacing** — push-based "surprising connections" surfaced from conversation context
- **7-step compaction pipeline** — Cerebras → Groq → Ollama cascade for fast session summarization
- **5 LLM providers** — automatic failover: OpenRouter → Kilo Code → Groq → error
- **Telegram bot** (@SBNexusBot) — 12 commands, `@agent-slug` routing, NLP intents, nudge engine
- **WhatsApp Cloud API** — bidirectional, Arabic auto-detect
- **WHOOP integration** — OAuth2 health data auto-sync (recovery, HRV, strain, sleep)
- **Trading module** — strategy templates, session tracking (London/NY/Asian), P&L journal
- **Knowledge Hub** — hierarchical docs with BlockNote editor, RAG search, web clipping
- **35 pages** — Command Center, Health Hub, Venture HQ, Deep Work, Trading, AI Chat, and more

---

## System Architecture

```mermaid
graph TB
    subgraph "Access Layer"
        WEB["Web Dashboard\n(React SPA)"]
        TG["Telegram Bot\n(@SBNexusBot)"]
        WA["WhatsApp\n(Cloud API)"]
    end

    subgraph "API Layer"
        API["Express 5 API Server\n403 endpoints · Rate limiting · CSRF · Session auth"]
    end

    subgraph "Agent Runtime"
        COS["Chief of Staff\n(executive)"]
        CMO["CMO"]
        CTO["CTO"]
        EA["Executive Assistant"]
        SPEC["7 CMO Specialists\n5 CTO Specialists\n1 Worker"]
        SCHED["Scheduler\n30+ cron jobs"]
        DELEG["Delegation Engine\nPrivilege attenuation"]
    end

    subgraph "Memory Pipeline"
        QG["A-MAC Quality Gate\n(relevance · novelty · specificity)"]
        COMPACT["Compactor\n7-step pipeline"]
        PROACTIVE["Proactive Surfacer\nSurprising connections"]
        HYBRID["Hybrid Retriever\nRRF: vector 0.55 · keyword 0.25 · graph 0.20"]
    end

    subgraph "Data Stores"
        PG["PostgreSQL\n72 tables · Railway"]
        QDRANT["Qdrant\n4 collections · 1536-dim"]
        PINECONE["Pinecone\nCloud backup · 512-dim"]
        FALKOR["FalkorDB\nKnowledge graph"]
    end

    subgraph "LLM Providers"
        OR["OpenRouter\n(primary)"]
        KILO["Kilo Code\n(fallback)"]
        GROQ["Groq LPU\n(fast fallback)"]
        CEREBRAS["Cerebras\n(compaction)"]
    end

    WEB --> API
    TG --> API
    WA --> API
    API --> COS
    COS --> CMO
    COS --> CTO
    COS --> EA
    CMO --> SPEC
    CTO --> SPEC
    EA --> SPEC
    COS --> SCHED
    COS --> DELEG
    API --> QG
    QG --> COMPACT
    COMPACT --> HYBRID
    HYBRID --> PROACTIVE
    COMPACT --> PG
    COMPACT --> QDRANT
    QDRANT -.->|nightly sync| PINECONE
    COMPACT --> FALKOR
    COS --> OR
    OR -->|exhausted| KILO
    KILO -->|failed| GROQ
    COMPACT --> CEREBRAS
    CEREBRAS -->|failed| GROQ
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18, Tailwind CSS v3, shadcn/ui, TanStack Query, Wouter |
| **Backend** | Express 5, Node.js 20+, TypeScript 5.9 |
| **Database** | Railway PostgreSQL, Drizzle ORM, 72 tables |
| **Embeddings** | Gemini Embedding 001 (primary), OpenRouter text-embedding-3-small (fallback) |
| **Vector DB** | Qdrant — 4 collections: `raw_memories`, `compacted_memories`, `entity_index`, `knowledge_base` |
| **Graph DB** | FalkorDB — entity relationships, fulltext index, co-occurrence tracking |
| **Cloud Vector** | Pinecone — nightly sync from Qdrant, 512-dim, 3 namespaces |
| **Fast LLM** | Cerebras API — Llama 3.3 70B, compaction summarization |
| **Cheap LLM** | Groq LPU — `llama-3.3-70b-versatile`, $0.06–0.18/1M tokens |
| **Primary LLM** | OpenRouter — 15 models across 5 providers |
| **Bot** | Telegraf (Telegram) + WhatsApp Cloud API |
| **Build** | Vite (client), esbuild (server) |
| **Deploy** | Railpack → Railway (auto-deploy from `main`) |

---

## Agent Hierarchy

```mermaid
graph TD
    USER["👤 Sayed"]
    COS["🎯 Chief of Staff\nexecutive · Claude Opus 4"]

    CMO["📣 CMO\nexecutive · Claude Sonnet 4"]
    CTO["⚙️ CTO\nexecutive · Claude Sonnet 4"]
    EA["📋 Executive Assistant\nspecialist"]

    CD["🎨 Creative Director"]
    GS["📈 Growth Specialist"]
    SEO["🔍 SEO Specialist"]
    CS["✍️ Content Strategist"]
    SMMS["📱 SMM – SyntheLIQ"]
    SMMC["📱 SMM – Content Intel"]
    SW["🎬 Script Writer – SyntheLIQ"]

    VA["🏗️ Venture Architect"]
    AE["🤖 Agent Engineer"]
    MB["🚀 MVP Builder"]
    RA["🔬 Research Analyst"]
    LIB["📚 Librarian"]
    OH["💡 Opportunity Hunter"]

    TAS["🤖 Task Automation Scout\nworker · Gemini Flash Lite\nScans backlogs 3×/day"]

    USER --> COS
    COS --> CMO
    COS --> CTO
    COS --> EA
    CMO --> CD
    CMO --> GS
    CMO --> SEO
    CMO --> CS
    CMO --> SMMS
    CMO --> SMMC
    CMO --> SW
    CTO --> VA
    CTO --> AE
    CTO --> MB
    CTO --> RA
    CTO --> LIB
    CTO --> OH
    EA --> TAS
```

**Model tiers:**
- `top` → Claude Opus 4 (executive reasoning only)
- `mid` → Claude Sonnet 4 (managers)
- `fast` → Gemini 2.5 Flash Lite or Groq Llama 3.3 70B (specialists/workers)

---

## Memory Pipeline

```mermaid
flowchart LR
    CONV["💬 Agent Conversation"]
    CTX["Context Monitor\n(ring buffer per session)"]
    QG["A-MAC Quality Gate\nrelevance + novelty + specificity\nthreshold: 0.40 composite"]
    DEDUP["Inline Dedup\ncosine > 0.92\n+ word overlap > 50%"]
    COMPACT["7-Step Compactor\nCerebras → Groq → Ollama"]

    subgraph "Qdrant Collections"
        RAW["raw_memories\n1536-dim · Gemini"]
        COMP["compacted_memories\n1536-dim"]
        ENT["entity_index\n1536-dim"]
        KB["knowledge_base\n1536-dim"]
    end

    PINECONE["Pinecone\n512-dim · nightly sync"]
    FALKOR["FalkorDB\nknowledge graph\nfulltext entity index"]
    HYBRID["Hybrid Retriever\nvector 0.55 + keyword 0.25 + graph 0.20\nRRF fusion · Ebbinghaus decay"]
    PROACTIVE["Proactive Surfacer\n'surprising connections'"]

    CONV --> CTX
    CTX --> QG
    QG -->|accepted| DEDUP
    QG -->|rejected| X["🗑️ Discarded"]
    DEDUP -->|new| RAW
    DEDUP -->|near-duplicate| RAW
    CTX --> COMPACT
    COMPACT --> COMP
    COMPACT --> ENT
    COMPACT --> FALKOR
    RAW & COMP & ENT -.->|nightly| PINECONE
    RAW & COMP & ENT & KB --> HYBRID
    HYBRID --> PROACTIVE
```

**Ebbinghaus decay half-lives:**

| Importance | Half-life | Notes |
|------------|-----------|-------|
| ≥ 0.8 | 365 days | Critical decisions, never below 20% strength |
| 0.4 – 0.79 | 60 days | Standard memories |
| < 0.4 | 14 days | Low-value, prune quickly |

Each retrieval extends half-life by 10% (capped at 2×) — spaced-repetition effect.

---

## LLM Provider Cascade

```mermaid
flowchart LR
    subgraph "Chat Completion"
        OR["OpenRouter\n15 models"]
        KILO["Kilo Code\n(credits exhausted)"]
        GROQ1["Groq LPU\n(fast fallback)"]
        ERR1["❌ Error"]
        OR -->|exhausted / failed| KILO
        KILO -->|failed| GROQ1
        GROQ1 -->|failed| ERR1
    end

    subgraph "Compaction"
        CER["Cerebras\nLlama 3.3 70B"]
        GROQ2["Groq LPU\nLlama 3.3 70B"]
        OLLAMA["Ollama\nLocal model"]
        CER -->|failed| GROQ2
        GROQ2 -->|failed| OLLAMA
    end
```

**Cost comparison (per 1M tokens):**

| Provider | Model | Input | Output |
|----------|-------|-------|--------|
| Anthropic | Claude Opus 4 | $15.00 | $75.00 |
| Anthropic | Claude Sonnet 4 | $3.00 | $15.00 |
| OpenAI | GPT-4o | $2.50 | $10.00 |
| Groq | Llama 3.3 70B | $0.06 | $0.06 |
| Cerebras | Llama 3.3 70B | — | — |

---

## Pages

| Category | Pages |
|----------|-------|
| **Dashboard** | Command Center V2, Live Tasks, Weekly Planning |
| **Ventures** | Venture HQ, Venture Detail, Venture Lab |
| **Tasks & Work** | All Tasks, Deep Work, Daily, Review Queue |
| **Knowledge** | Knowledge Hub, Doc Detail, Research Inbox |
| **Health** | Health Hub, Nutrition Dashboard |
| **Finance** | Finance |
| **AI & Agents** | AI Chat, Agents, Agent Detail, Delegation Log |
| **Daily Rituals** | Morning Ritual, Evening Review |
| **Life** | Shopping, Books, Calendar, Capture, People |
| **Trading** | Trading Dashboard |
| **Settings** | Settings, AI Settings, Integrations, Categories, External Agents, Notifications |

---

## Telegram Bot

**@SBNexusBot** — 12 commands, `@agent-slug` routing, and Arabic/English NLP.

| Command | Description |
|---------|-------------|
| `/start` | Welcome + usage guide |
| `/agents` | List all 18 agents |
| `/briefing` | Morning intelligence via Chief of Staff |
| `/capture <text>` | Add to inbox immediately |
| `/today` | Top 3 outcomes + urgent tasks + inbox count |
| `/tasks` | In-progress and next tasks (numbered, max 10) |
| `/done <number>` | Mark task done by number |
| `/shop <item> [#category]` | Add to shopping list |
| `/clip <url>` | Clip web article to Knowledge Hub + embed for RAG |
| `/emails` | Today's email triage (urgent / action needed / info) |
| `/email <id>` | Full triaged email + suggested reply |
| `/reply <id> <msg>` | Send Gmail reply |
| `@agent-slug <msg>` | Route message directly to any named agent |
| Plain text | Routes to Chief of Staff |

---

## Quick Start

```bash
# Clone
git clone https://github.com/sayedbaharun/SBOS.git sbos
cd sbos

# Install
npm install

# Configure environment
cp .env.example .env
# Required: DATABASE_URL, SESSION_SECRET
# AI features: OPENROUTER_API_KEY
# Memory: QDRANT_URL, PINECONE_API_KEY, FALKORDB_URL, GOOGLE_AI_API_KEY
# Groq fallback: GROQ_API_KEY
# Telegram: TELEGRAM_BOT_TOKEN, AUTHORIZED_TELEGRAM_CHAT_IDS

# Push database schema
npm run db:push

# Start development server (http://localhost:5000)
npm run dev
```

After first run, seed all 18 agents:
```bash
curl -X POST http://localhost:5000/api/agents/admin/seed
```

Check provider health (OpenRouter, Kilo, Groq all in one call):
```bash
curl http://localhost:5000/api/providers/health
```

---

## Documentation

| Document | Description |
|----------|-------------|
| [`CLAUDE.md`](./CLAUDE.md) | **Primary reference** — full technical spec, all APIs, schema, agent system |
| [`docs/README.md`](./docs/README.md) | Documentation index |
| [`docs/system/01-architecture-overview.md`](docs/system/01-architecture-overview.md) | Architecture deep-dive |
| [`docs/system/02-memory-and-intelligence.md`](docs/system/02-memory-and-intelligence.md) | Memory pipeline, RAG, Gemini embeddings |
| [`docs/system/03-agent-operating-system.md`](docs/system/03-agent-operating-system.md) | Agent hierarchy, delegation engine, tools |
| [`docs/system/04-infrastructure-resilience.md`](docs/system/04-infrastructure-resilience.md) | Circuit breakers, backoff, tool loop detection |
| [`docs/system/05-telegram-and-channels.md`](docs/system/05-telegram-and-channels.md) | Telegram commands, NLP, webhooks |
| [`docs/reference/api-reference.md`](docs/reference/api-reference.md) | 403 REST endpoints by domain |
| [`docs/reference/database-schema.md`](docs/reference/database-schema.md) | 72 tables with key columns |
| [`docs/guides/user-guide.md`](docs/guides/user-guide.md) | Daily execution workflows |
| [`docs/guides/agent-operating-rhythm.md`](docs/guides/agent-operating-rhythm.md) | Agent daily/weekly schedule (Dubai timezone) |

---

## License

Private project — not open source.
