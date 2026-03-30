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

- DB wiped clean — testing all systems with real data from scratch
- Shared memory bridge between Claude Code ↔ Cowork: **COMPLETE**
  - `memory/` folder in SBOS root is now the bridge
  - `.claude/CLAUDE.md` updated: reads `memory/MEMORY.md` first, saves to `memory/sessions/` for Cowork pickup
- CLAUDE.md and docs fully updated and reorganized
- Next: populate DB with real ventures/projects/tasks and begin actual system testing

## Open Threads

- [ ] Verify venture list in MEMORY.md against actual DB (DB was wiped 2026-03-30 — ventures may have changed)
- [ ] CLAUDE.md numbers slightly off (26 pages listed vs 35 actual, 24 tables detailed vs 71 actual) — sync when convenient
- [ ] ArabMoneyOfficial and MyDub.ai project files in memory/projects/ are sparse — fill in when ready
- [x] OpenRouter account resolved — key updated to sk-or-v1-f74...1e56, account is sb@revolvgroup.com
