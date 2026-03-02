# SB-OS — Personal Operating System

**SB-OS** is a full-stack personal operating system for managing multiple business ventures, projects, tasks, health, knowledge, and trading — powered by a hierarchical team of 13 AI agents. Built as a custom "second brain" to replace Notion, Todoist, and other fragmented productivity tools.

Built for one founder: **Sayed Baharun**.

## Key Capabilities

- **Multi-venture management** — projects, tasks, and knowledge organized per venture
- **13 AI agents** — hierarchical team (Chief of Staff, CMO, CTO, specialists) with delegation, memory, and learning
- **4-layer memory pipeline** — PostgreSQL → Qdrant → Pinecone → FalkorDB for persistent, searchable AI memory
- **Telegram bot** (@SBNexusBot) — 9 commands, 8 NLP intents, voice/image processing, nudge engine
- **Context compaction** (Resonance Pentad) — 4-layer system preventing context overflow in agent tool loops
- **Daily execution loop** — morning briefings, smart check-ins, evening reviews
- **Health & nutrition tracking** — with AI macro estimation
- **Trading module** — journal, session tracking, AI trading coach
- **Knowledge Hub** — docs, SOPs, web clipping with full-text search
- **Strategic foresight** — scenario planning, PESTLE analysis, trend signals
- **Infrastructure resilience** — backoff policies, circuit breakers, tool loop detection

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Tailwind CSS v3, shadcn/ui, TanStack Query, Wouter |
| Backend | Express 5, Node.js 20+, TypeScript 5.9 |
| Database | Neon Serverless PostgreSQL, Drizzle ORM |
| AI Models | OpenRouter (multi-model), Cerebras (fast inference) |
| Vector DB | Qdrant (primary), Pinecone (cloud backup) |
| Graph DB | FalkorDB (optional) |
| Bot | Telegraf (Telegram) |
| Build | Vite, esbuild |
| Deploy | Docker, Railway |

## Quick Start

```bash
# Clone
git clone https://github.com/sayedbaharun/aura.git sbos
cd sbos

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your DATABASE_URL, OPENROUTER_API_KEY, SESSION_SECRET, etc.

# Push database schema
npm run db:push

# Start development server
npm run dev
```

The server starts at `http://localhost:5000`. After first run, seed agents via:
```bash
curl -X POST http://localhost:5000/api/agents/admin/seed
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     USER (Sayed)                        │
│              Web Dashboard  │  Telegram Bot              │
└────────────────┬────────────┴────────────┬──────────────┘
                 │                         │
    ┌────────────▼─────────┐  ┌────────────▼──────────────┐
    │   React SPA (Vite)   │  │  Telegraf (@SBNexusBot)   │
    │   TanStack Query     │  │  Webhook / Polling        │
    └────────────┬─────────┘  └────────────┬──────────────┘
                 │                         │
    ┌────────────▼─────────────────────────▼──────────────┐
    │              Express 5 API Server                    │
    │   147+ endpoints │ Session auth │ Rate limiting      │
    ├──────────────────┴──────────────────────────────────┤
    │              Agent Runtime (13 agents)               │
    │   Tool loops │ Delegation │ Memory │ Learning        │
    ├─────────────────────────────────────────────────────┤
    │          Storage Layer (Drizzle ORM)                 │
    │   64 tables │ Neon Serverless PostgreSQL             │
    ├─────────────────────────────────────────────────────┤
    │          Memory Pipeline                             │
    │   Qdrant → Pinecone → FalkorDB │ Embeddings         │
    └─────────────────────────────────────────────────────┘
```

## Documentation

Full documentation is in [`docs/`](./docs/):

| Document | Description |
|----------|-------------|
| [Architecture](docs/architecture.md) | System architecture and data flows |
| [Tech Stack](docs/tech-stack.md) | Dependencies and versions |
| [Database Schema](docs/database-schema.md) | 64 tables organized by domain |
| [API Reference](docs/api-reference.md) | 147+ endpoints by resource |
| [Agent System](docs/agent-system.md) | 13 agents, hierarchy, tools, runtime |
| [Memory System](docs/memory-system.md) | 4-layer memory pipeline |
| [Resonance Pentad](docs/resonance-pentad.md) | Context compaction system |
| [Telegram Bot](docs/telegram-bot.md) | Commands, NLP, webhooks |
| [Infrastructure](docs/infrastructure.md) | Resilience patterns |
| [Deployment](docs/deployment.md) | Railway, Docker, env vars |
| [User Guide](docs/user-guide.md) | Daily workflows |
| [Development](docs/development.md) | Local setup and code patterns |

## License

MIT
