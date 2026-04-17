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

## Current Focus (2026-04-17)

### What shipped (2026-04-17) — 4 commits to SBOS
- **Agent OS Standards** (`6dc8d6b`) — `.agent-os/product/` with 7 files: mission, tech-stack, roadmap, decisions, code-style, dev-best-practices, mission-lite. AI-Native as Pillar 0.
- **CLAUDE.md (root) updated** (`aded847`) — Phase 13 complete, Phase 14 planned (Venture Onboarding System), hosting matrix, tech stack locked.
- **tsc hook** (`e55d804`) — auto-runs `tsc --noEmit` after every Edit/Write in SBOS. 6-layer memory stack added to roadmap.
- **Obsidian ventures knowledge** (`57dfda9`) — 5 files in `knowledge/ventures/`, seed script, watch script updated, startup auto-seed wired.

### Tech Stack (Locked 2026-04-17)
- Auth: Clerk (Vercel ventures) / session (SB-OS itself)
- DB: Neon (Vercel-hosted) / Railway PG (Railway-hosted)
- LLM: OpenRouter/Kilocode → OpenAI → Google. Never single model.
- Hosting: Railway (always-on, WebSockets, cron) / Vercel (serverless, static, Next.js)

### Phase 14: Venture Onboarding System (NEXT)
- Phase 1: SB-OS module (type classifier, checklist filter, task creator, Drive scaffolder)
- Phase 2: 4 skills (brand-identity-builder, legal-scaffolder, content-strategy-builder, offer-architect)
- **Blockers**: (1) skills API service token, (2) Google Drive service account on Railway
- **First venture to onboard**: run `/venture-audit` to decide

### Obsidian Vault
- Location: `~/Documents/SBOS/` — symlinked to `~/GitHub/SBOS/`
- `knowledge/ventures/` — 5 venture context files, auto-indexed into Qdrant via watch script
- `memory/` — Claude Code ↔ Cowork session bridge
- Edit in Obsidian → saved to repo → Qdrant updated within ~60s

### Open Threads
- [ ] Skills API auth — service token for Phase 2 skills to call SB-OS
- [ ] Google Drive service account env vars confirm on Railway
- [ ] Run `/venture-audit` on SyntheLIQ → decide first onboarding candidate
- [ ] `/create-spec` for Phase 14 Phase 1 once blockers resolved
