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

## Current Focus (2026-04-11)

### What shipped (2026-04-11)
- **Model cascade bulletproofed** — 8-shot fallback: OpenRouter → Kilo → direct OpenAI → Groq. `OPENAI_API_KEY` added to Railway. Deprecated `claude-3.5-sonnet` removed. Commit `294f34b`.
- **Personal Brand + Learning pages** — `/brand` + `/learning` routes. New `courses` + `podcasts` DB tables. Sidebar links added.
- **Notion export imported** — 53 books, 7 Knowledge Base docs (trading strategy, command board, brand prompt, quotes, investors, trading journal, project taxonomy), 4 Qdrant memory files. Source deleted.
- **Command Center V4** — Full 3-column CEO dashboard (Your Day | Execution | Business Health). Commits `0477abb` + `d6dc93e`.
- **Venture OKR system** — `venture_goals` + `key_results` tables, Goals tab on venture detail, venture pack Drive staging, OKR agent tools.
- **Daily Operating Workflow** — Scout suggestions banner, per-task agent delegation, Review Queue re-added, daily_briefing counts agent-ready tasks + pending reviews.

### Open Threads
- [ ] Verify `db:push` on Railway — `venture_goals` + `key_results` tables may need push
- [ ] Test venture pack end-to-end: stage → Drive docs → approve → DB records created
- [ ] Populate DB with real ventures/projects/tasks (using real data since 2026-03-30 wipe)
- [x] Model cascade — 8 shots, 5 providers, effectively bulletproof
- [x] Notion export fully imported + source deleted
