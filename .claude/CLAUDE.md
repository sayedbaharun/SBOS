# Claude Code Behavioral Instructions — SB-OS

> For the SB-OS technical specification (architecture, schema, APIs, agent system, memory pipeline, etc.), see the root `CLAUDE.md`.

---

## Shared Memory System (Claude Code ↔ Cowork)

SB-OS has a **file-based shared memory** at `memory/` in the project root. This is the bridge between Claude Code (terminal CLI) and Cowork (desktop app). Both tools read and write these files.

### Memory Structure

```
memory/
├── MEMORY.md                    ← Hot cache — READ THIS FIRST on session start
├── glossary.md                  ← All terms, acronyms, codenames
├── projects/
│   ├── sb-os.md                 ← SB-OS project details
│   ├── syntheliq.md             ← SyntheLIQ trading platform
│   ├── my-sigma-mindset.md      ← Sigma content brand
│   └── aivant-realty.md         ← Dubai real estate venture
├── context/
│   └── tools-and-stack.md       ← All tools, databases, integrations
├── sessions/
│   └── YYYY-MM-DD.md            ← Daily session logs (handoff between tools)
└── people/                      ← Contact profiles (empty, ready)
```

### Two-Layer Architecture

| Layer | What | Who reads/writes |
|-------|------|-----------------|
| **Files** (`memory/`) | Shared hot cache, session logs, project context | Claude Code + Cowork |
| **Database** (`agent_memory` table + Qdrant) | Deep semantic store, embeddings, vector search | Claude Code only (Cowork PG MCP times out) |

### Session Handoff Protocol

When Cowork works on something, it writes to `memory/sessions/YYYY-MM-DD.md`. When Claude Code starts a session, it reads that file to pick up Cowork's context — and vice versa. This is how context flows between the two tools without duplication.

---

## Hooks System

Hooks at `~/.claude/hooks/` fire automatically on Claude Code tool events.

| Hook File | Trigger | Purpose |
|-----------|---------|---------|
| `sync-memory-to-sbos.py` | PostToolUse: Write on `memory/*.md` | Sends memory file content to SB-OS Qdrant via `/api/memory/ingest-markdown`. Skips session logs and MEMORY.md index. |
| `save-context.sh` | PostToolUse (general) | Saves conversation context to session log |
| `post-response-save.sh` | Post-response | Persists response context |

**`sync-memory-to-sbos.py` details:**
- Reads `MEMORY_API_KEY` from env (set in `~/.zshenv`)
- `SBOS_URL` defaults to `https://sbaura.up.railway.app`
- Only fires for `~/.claude/projects/*/memory/*.md` files
- Skips `/sessions/` files and `MEMORY.md`
- Hook config: `~/.claude/settings.local.json`

---

## MCP Persistent Memory Tools

Claude Code has 3 MCP tools for persistent memory, reusing the existing `agent_memory` table:

| Tool | Purpose |
|------|---------|
| `store_claude_memory` | Store a learning, preference, decision, or context. Supports `scope: "shared"` to make it visible to all agents. |
| `search_claude_memory` | Hybrid semantic + keyword search across Claude Code and shared memories. |
| `get_claude_session_context` | Load accumulated memory context at the start of complex work. Optionally focus by topic. |

**Sentinel:** `CLAUDE_CODE_AGENT_ID = "11111111-1111-1111-1111-111111111111"` (inactive agent row, slug: `_claude-code`)

---

## MANDATORY Memory Protocol — MUST FOLLOW

These rules are **non-negotiable**. Sayed requires full conversation continuity across sessions. Dropped context is unacceptable.

**Rule 1: Checkpoint Before Proceeding**
Before starting work on ANY new user request, you MUST first save a summary of the conversation so far. This includes:
- What was just discussed/decided
- Any bugs found or fixed
- User preferences or feedback expressed
- Decisions made and their reasoning

Save to ALL of:
- **Shared session log**: append to `memory/sessions/YYYY-MM-DD.md` (project root) — Cowork reads this
- **Claude Code session log**: update `~/.claude/projects/-Users-sayedbaharun/memory/sessions/YYYY-MM-DD.md`
- **MCP** (if available): call `store_claude_memory` for key decisions/learnings

**This ensures nothing is lost to context window compression.** The old conversation is saved before new work begins.

**Rule 2: Session Start**
At the start of every session:
1. Read `memory/MEMORY.md` (project root) — shared hot cache, preferences, active ventures, current focus
2. Read `memory/sessions/YYYY-MM-DD.md` — today's session log (includes Cowork handoff context if Cowork worked on it)
3. Read `~/.claude/projects/-Users-sayedbaharun/memory/MEMORY.md` — persistent Claude Code memory index
4. Call `get_claude_session_context` (MCP) if available for deep semantic context

**Rule 3: What to Save**
After EVERY user interaction, save:
- Bugs reported and their fix status
- Features requested and implementation decisions
- User preferences ("I want X", "don't do Y", "this doesn't work")
- Architecture decisions and trade-offs
- Open questions and unresolved issues

**Rule 4: Proactive Updates**
During long coding stretches, update the session log after completing each major task (not just at the end).
