# Architecture

## System Overview

SB-OS is a full-stack monorepo application deployed as a single Docker container on Railway. It combines a React SPA frontend with an Express 5 API server, backed by Neon Serverless PostgreSQL, vector databases (Qdrant + Pinecone), and an optional graph database (FalkorDB).

## High-Level Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        USER (Sayed)                          │
│                                                              │
│   Browser (React SPA)          Telegram (@SBNexusBot)        │
│   └─ TanStack Query            └─ Telegraf Webhook           │
└────────┬───────────────────────────────┬─────────────────────┘
         │ HTTP/WS                       │ HTTPS POST
┌────────▼───────────────────────────────▼─────────────────────┐
│                    Express 5 API Server                       │
│                                                               │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────┐ │
│  │  REST API    │  │  Agent       │  │  Scheduled Jobs      │ │
│  │  170+ routes │  │  Runtime     │  │  (node-cron)         │ │
│  │  Zod valid.  │  │  13 agents   │  │  Briefings, reviews  │ │
│  └──────┬──────┘  └──────┬───────┘  └──────────┬───────────┘ │
│         │                │                      │             │
│  ┌──────▼────────────────▼──────────────────────▼───────────┐ │
│  │                  Storage Layer (Drizzle ORM)              │ │
│  │                  64 PostgreSQL tables                     │ │
│  └──────┬───────────────────────────────────────────────────┘ │
└─────────┼────────────────────────────────────────────────────┘
          │
┌─────────▼────────────────────────────────────────────────────┐
│                     Data Stores                               │
│                                                               │
│  ┌──────────────┐  ┌────────────┐  ┌──────────┐  ┌────────┐ │
│  │ Neon         │  │ Qdrant     │  │ Pinecone │  │FalkorDB│ │
│  │ PostgreSQL   │  │ Vector DB  │  │ Cloud    │  │ Graph  │ │
│  │ (primary)    │  │ (search)   │  │ (backup) │  │ (opt.) │ │
│  └──────────────┘  └────────────┘  └──────────┘  └────────┘ │
└──────────────────────────────────────────────────────────────┘
```

## Monorepo Structure

```
SBOS/
├── client/                  # React SPA (Vite)
│   └── src/
│       ├── components/      # UI components (shadcn/ui)
│       ├── pages/           # Route pages
│       ├── hooks/           # TanStack Query hooks
│       └── lib/             # Utilities
├── server/                  # Express backend
│   ├── routes/              # 40+ route modules
│   ├── agents/              # Agent system
│   │   ├── templates/       # 13 soul templates (.md)
│   │   ├── tools/           # Agent tools (research, deploy, code)
│   │   ├── agent-runtime.ts # Core execution loop
│   │   ├── context-budget.ts # Resonance Pentad Layer 1
│   │   ├── observer.ts      # Resonance Pentad Layer 2
│   │   ├── reflector.ts     # Resonance Pentad Layer 3
│   │   └── compaction-tuner.ts # Resonance Pentad Layer 4
│   ├── channels/            # Communication adapters
│   │   └── adapters/        # Telegram adapter
│   ├── infra/               # Infrastructure & resilience
│   ├── memory/              # Memory pipeline (Qdrant, Pinecone, graph)
│   ├── compaction/          # Cerebras/Ollama compaction
│   ├── telegram/            # Telegram bot (NLP, commands, nudge)
│   ├── storage.ts           # Database operations
│   └── index.ts             # Server entry point
├── shared/
│   └── schema.ts            # Drizzle ORM schema (64 tables)
├── Dockerfile
├── CLAUDE.md                # Claude Code instructions
└── package.json
```

## Data Flow

### User Request Flow

```
User Action (Web/Telegram)
    │
    ▼
Express Router → Route Handler
    │
    ├── Zod Validation
    ├── Storage Layer (Drizzle → PostgreSQL)
    ├── [If AI] → Agent Runtime or Chat Completion
    │              ├── Load agent soul template
    │              ├── Build memory context
    │              ├── Multi-turn tool loop (max 10)
    │              ├── Resonance Pentad (compaction)
    │              └── Save conversation + extract learnings
    │
    ▼
JSON Response → Client / Telegram
```

### Agent System Hierarchy

```
SAYED (CEO / Founder)
│
├── Chief of Staff (Opus) — daily briefing, coordination
│   ├── delegates to → CMO, Head of Products, CTO
│   └── schedule: daily briefing @ 9am, morning check-in @ 10am, evening review @ 6pm
│
├── CMO (Sonnet) — marketing strategy
│   ├── Growth Specialist (Haiku)
│   ├── SEO Specialist (Haiku)
│   ├── Social Media Manager (Haiku)
│   └── Content Strategist (Haiku)
│
├── Head of Products (Sonnet) — product strategy
│   ├── Research Analyst (Haiku)
│   └── MVP Builder (Haiku)
│
├── CTO (Sonnet) — technical strategy
│
└── Venture Architect (Haiku) — auto-planning for new ventures
```

Sentinel agents (non-interactive): `_claude-code`, `_shared-memory`

### Memory Pipeline

```
User Interaction / Agent Conversation
    │
    ▼
PostgreSQL (source of truth)
    │ agent_memory, agent_conversations, session_logs
    │
    ▼
OpenRouter Embeddings (text-embedding-3-small, 1536-dim)
    │
    ├──▶ Qdrant (primary vector search)
    │     Collections: raw_memories, compacted_memories,
    │                  entity_index, knowledge_base
    │
    ├──▶ Pinecone (cloud backup, 512-dim)
    │     Namespaces: compacted, entities, decisions
    │
    └──▶ FalkorDB (optional graph)
          Nodes: Entity, Memory, Decision, Agent, Venture

Retrieval: Hybrid search
  BM25 keyword (30%) + cosine vector (70%)
  Optional graph traversal (20% when FalkorDB available)
```

## Integration Points

| Integration | Purpose | Protocol |
|-------------|---------|----------|
| Telegram | Bot interface (@SBNexusBot) | Webhook (prod) / Polling (dev) |
| Google Calendar | Meeting sync, task scheduling | OAuth2 REST API |
| Google Drive | File storage for knowledge files | OAuth2 REST API |
| Gmail | Email features | OAuth2 REST API |
| TickTick | Mobile capture sync | OAuth2 REST API |
| OpenRouter | Multi-model AI inference | OpenAI-compatible API |
| Cerebras | Fast inference for compaction | OpenAI-compatible API |
| Brave Search | Web search for agents | REST API |
| MCP Server | Claude Code integration | Model Context Protocol |

## Security Model

- Session-based authentication with express-session
- CSRF protection on all mutating endpoints
- 2FA support (TOTP with backup codes)
- Rate limiting (global + per-route)
- Agent privilege attenuation (delegated tasks get intersection of permissions)
- Telegram access control via chat ID whitelist
- Tool sandboxing (code generation writes to `$TMPDIR` only)
- Production deployments require explicit approval
