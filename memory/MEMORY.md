# Memory — SB-OS Shared Context

> **Hot cache** for both Claude Code and Cowork.
> Both tools read this file automatically. Keep it under ~100 lines.
> Full details live in `memory/` subdirectories.

---

## Me

**Sayed Baharun (SB)** — Founder running multiple ventures across SaaS, media, real estate, trading, and personal projects. Based in **Dubai (Asia/Dubai timezone)**. Non-coder — uses AI tools (Claude Code, Cowork) to build and operate everything. Prefers simple, clear explanations. Copy-paste approach to code.

## Preferences

- Explain what you're about to do before doing it
- Keep code as simple as possible — I don't code, I copy-paste
- Don't assume I know technical terms — explain them
- When coding: give me the full file or exact copy-paste instructions
- Health and clarity first, then output
- One source of truth — never duplicate data
- Always save context between sessions — dropped context is unacceptable

## Active Ventures

| Name | Domain | What |
|------|--------|------|
| **SB-OS** | SaaS/Personal | Personal operating system — the app itself |
| **SyntheLIQ** | SaaS/Trading | AI trading platform |
| **My Sigma Mindset** | Media | Faceless social media brand for young men |
| **Aivant Realty** | Real Estate | AI-powered real estate (Dubai) |
| **ArabMoneyOfficial** | Media | Finance/money content brand |
| **MyDub.ai** | SaaS | AI product (Dubai-focused) |

→ Full details: `memory/projects/`

## Key Terms (Quick Reference)

| Term | Meaning |
|------|---------|
| SB-OS | The personal operating system app (this codebase) |
| Aura | Old name for SB-OS |
| Command Center | Main dashboard / HUD |
| Capture | GTD-style inbox item — raw thought to be processed |
| Focus Slot | Time block (deep_work_1, admin_block, etc.) |
| Venture | Top-level business/personal initiative |
| Chief of Staff | Top AI agent — routes to other agents |
| Resonance Pentad | Context compaction system for agents |
| Soul file | Markdown file defining an agent's personality/tools |
| Killzone | High-probability trading session windows |

→ Full glossary: `memory/glossary.md`

## Tools I Use

| Tool | What for |
|------|----------|
| **Claude Code** | Building/coding SB-OS (terminal CLI) |
| **Cowork** | Strategy, planning, content, non-code tasks (desktop app) |
| **Telegram** | Quick capture, agent chat via @SBNexusBot |
| **Railway** | SB-OS production hosting |
| **GitHub** | Code repo: sayedbaharun/SBOS |
| **TickTick** | Mobile task capture → syncs to SB-OS inbox |
| **WHOOP** | Health/fitness tracking → syncs to SB-OS |

→ Full stack: `memory/context/tools-and-stack.md`

## Current Focus (Phase 11 — 2026-03-30)

### What shipped today
- **Groq as 4th LLM provider** — `server/groq-client.ts` + model-manager + cerebras cascade (Cerebras → Groq → Ollama)
- **Memory system upgraded**: Gemini Embedding 001, A-MAC quality gate, Ebbinghaus decay, inline dedup, proactive surfacing (`POST /api/memory/proactive`)
- **README rewritten** — 4 Mermaid diagrams, accurate stats (432 TS files, 72 tables, 403 endpoints, 18 agents)
- **Docs restructured** — flat `docs/*.md` → `docs/system/`, `docs/reference/`, `docs/guides/`, `docs/ventures/`, `docs/archive/`
- **Shared memory bridge** — `memory/` in SBOS root, `.claude/CLAUDE.md` reads it on session start
- **Knowledge Hub file processing upgraded** (`1a5548d`) — Gemini 2.5 Flash replaces GPT-4o for image OCR (94% cheaper) + scanned PDF vision path added. `server/file-extraction.ts`.

### Memory system health (verified 2026-03-30)
- Qdrant: ✅ 176 raw_memories, 0 compacted, 39 entity_index
- Gemini Embedding 001: ✅ 1536-dim, 8 task types
- Quality gate: ✅ "ok" → rejected, real content → stored
- Pinecone: ✅ configured, sync running (was 0 records, backfill triggered)
- Proactive surfacer: ✅ `POST /api/memory/proactive` returning results
- Ingest-markdown bridge: ✅ `POST /api/memory/ingest-markdown` accepting content
- LLM providers: OpenRouter ✅ · Kilo ✅ · Groq ✅ (configured) · Local ❌ (not set up)

## Open Threads

- [ ] Pinecone backfill — sync triggered, confirm record count > 0 on next status check
- [ ] Populate DB with real ventures/projects/tasks (DB wiped 2026-03-30 — testing with real data)
- [ ] ArabMoneyOfficial and MyDub.ai project files in memory/projects/ are sparse — fill in when ready
- [ ] Verify Knowledge Hub file upload on Railway: check `metadata.processingModel = "gemini-2.5-flash"` after uploading image/PDF
- [x] OpenRouter account: sb@revolvgroup.com
- [x] CLAUDE.md numbers fixed: 72 tables, 35 pages, 403 endpoints, 18 agents
- [x] Groq API key added to Railway
- [x] Gemini 2.5 Flash for file extraction (commit `1a5548d`)
