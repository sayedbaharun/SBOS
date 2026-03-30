# Tools & Systems — SB's Environment

> What SB uses daily and how everything connects.

---

## Development & AI

| Tool | What for | Access |
|------|----------|--------|
| **Claude Code** | Building/coding SB-OS | Terminal CLI, has MCP tools to SB-OS DB |
| **Cowork** | Strategy, planning, content, non-code work | Desktop app, reads SBOS folder |
| **GitHub** | Code repo (sayedbaharun/SBOS) | Push to main → auto-deploy |
| **Railway** | Production hosting | Auto-deploy from GitHub main branch |
| **OpenRouter** | Multi-model AI gateway | API key in env |
| **Cerebras** | Fast inference for compaction | API key in env |

## Databases & Storage

| Service | Purpose | Key |
|---------|---------|-----|
| **PostgreSQL** | Primary database (71 tables) | Railway-managed, `DATABASE_URL` |
| **Qdrant** | Vector search (3 collections) | `QDRANT_URL` + `QDRANT_API_KEY` |
| **Pinecone** | Backup vector store (nightly sync) | `PINECONE_API_KEY` |
| **FalkorDB** | Entity graph relationships | `FALKORDB_URL` |

## Communication Channels

| Channel | Purpose | Config |
|---------|---------|--------|
| **Telegram** | Quick capture, agent chat (@SBNexusBot) | `TELEGRAM_BOT_TOKEN` |
| **WhatsApp** | Client comms, Arabic auto-detect | Cloud API, `WHATSAPP_ACCESS_TOKEN` |
| **Gmail** | Email triage + reply via agents | Google OAuth |

## Integrations

| Service | Purpose | Status |
|---------|---------|--------|
| **Google Drive** | File sync and search | ✅ Connected |
| **Gmail** | Email triage via agent jobs | ✅ Connected |
| **Google Calendar** | Task ↔ event sync | 🚧 Planned |
| **WHOOP** | Health data (recovery, HRV, sleep) | ✅ OAuth2 connected |
| **TickTick** | Mobile capture → SB-OS inbox | ✅ Connected |

## Cowork Skills (Available in Desktop App)

| Skill | Domain |
|-------|--------|
| sigma-content-researcher | My Sigma Mindset content |
| sigma-script-writer | My Sigma Mindset scripts |
| sales-interaction | Aivant Realty client comms |
| deal-structuring | Business deals & licensing |
| lead-intelligence | Lead scoring & qualification |
| content-flywheel | Multi-channel content distribution |
| research-intelligence | Market research & opportunities |
| knowledge-base-synthesizer | Organize knowledge into training data |
| automation-builder | Workflow automation design |
| system-architect | Technical architecture & PRDs |
| execution-supervisor | Meta-agent routing |
| signal-detection | Strategic change monitoring |
| skill-creator | Create/optimize Cowork skills |

## How Claude Code and Cowork Connect

```
Claude Code (terminal)              Cowork (desktop app)
    │                                    │
    ├── Reads CLAUDE.md ✅               ├── Reads CLAUDE.md ✅
    ├── Reads memory/MEMORY.md ✅        ├── Reads memory/MEMORY.md ✅
    ├── Reads memory/**/*.md ✅          ├── Reads memory/**/*.md ✅
    ├── MCP → SB-OS database ✅          ├── MCP → PostgreSQL (unreliable)
    ├── MCP → store/search memory ✅     ├── No MCP memory tools ✗
    ├── Hooks save context auto ✅       ├── Writes session logs manually ✅
    │                                    │
    └── WRITES code, runs builds         └── WRITES strategy, content, plans
```

**The bridge:** `memory/` folder. Both tools read and write to it.
**The deep store:** SB-OS database (agent_memory table). Only Claude Code has reliable access.
**Session handoff:** `memory/sessions/YYYY-MM-DD.md` — each tool logs what happened so the other picks up context.
