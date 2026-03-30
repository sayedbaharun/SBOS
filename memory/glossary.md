# Glossary — SB-OS Full Decoder Ring

> Complete reference for all shorthand, acronyms, internal terms, and codenames.
> The hot cache in `MEMORY.md` covers the top ~30. This file has everything.

---

## Acronyms & Terms

| Term | Meaning | Context |
|------|---------|---------|
| SB-OS | Sayed Baharun Operating System | The app — full-stack personal OS |
| Aura | Old codename for SB-OS | Renamed, still in some old references |
| HUD | Heads-Up Display | The Command Center V2 dashboard |
| GTD | Getting Things Done | Capture → Clarify → Commit → Complete pipeline |
| RRF | Reciprocal Rank Fusion | Memory retrieval algorithm (merges 3 search arms) |
| MCP | Model Context Protocol | How Claude tools connect to external services |
| PRD | Product Requirements Document | Used by system-architect skill |
| SOP | Standard Operating Procedure | Stored in Knowledge Hub |
| P0 / P1 / P2 / P3 | Priority levels | P0 = drop everything, P3 = nice to have |
| ORM | Object-Relational Mapping | Drizzle ORM maps TypeScript to PostgreSQL |
| CSRF | Cross-Site Request Forgery | Security token on all API calls |
| RERA | Real Estate Regulatory Authority | Dubai real estate compliance |
| PnL / P&L | Profit and Loss | Trading journal metric |
| RAG | Retrieval Augmented Generation | AI pulls relevant docs before answering |
| LLM | Large Language Model | AI models like Claude, GPT |

## SB-OS Specific Terms

| Term | Meaning |
|------|---------|
| Venture | Top-level business or personal initiative |
| Project | Concrete initiative within a venture |
| Phase | Milestone within a project |
| Task | Atomic unit of work |
| Capture | Raw inbox item (idea, task, note, link, reminder) |
| Day | Daily log record — central hub linking tasks, health, meals, rituals |
| Focus Slot | Time block for scheduling (deep_work_1, admin_block_1, etc.) |
| Health Battery | Visual readiness indicator on dashboard (sleep + energy + mood) |
| Top 3 | Three priority outcomes set each morning |
| One Thing to Ship | Single most leveraged deliverable for the day |
| Morning Ritual | Daily morning habits (press-ups, squats, supplements, water) |
| Evening Review | Daily reflection (journal, gratitude, tomorrow priorities) |
| Command Center | Main dashboard / HUD at /dashboard |
| Knowledge Hub | Document library at /knowledge |
| Venture HQ | Venture overview page at /ventures |

## Agent System Terms

| Term | Meaning |
|------|---------|
| Chief of Staff | Top executive agent — routes requests, delegates |
| Soul file | Markdown file with YAML frontmatter defining an agent |
| Delegation engine | System that routes tasks down the agent hierarchy |
| Privilege attenuation | Delegated agents can never have MORE permissions than delegator |
| Tool loop detector | Circuit breaker that stops agents from repeating same tool calls |
| Session isolation | Each platform:sender combo gets its own conversation thread |
| Credential proxy | Secure registry for 12 service API keys |
| Agent seed | POST /api/agents/admin/seed — loads agent templates into DB |

## Memory & Intelligence Terms

| Term | Meaning |
|------|---------|
| Qdrant | Primary vector database (semantic search) |
| Pinecone | Cloud backup vector database (nightly sync from Qdrant) |
| FalkorDB | Graph database for entity relationships |
| Hybrid retriever | Triple-arm search: Vector (0.55) + Keyword (0.25) + Graph (0.20) |
| Compaction | Converting raw conversation into dense structured memory |
| Resonance Pentad | The 5-step compaction system preventing context overflow |
| Entity extraction | Pulling named entities (people, ventures, tools) from conversations |
| Co-occurrence | Tracking how often entities appear together (relationship strength) |
| Memory decay | Older, low-importance memories get archived over time |
| Sentinel | The Claude Code agent ID (11111111-1111-1111-1111-111111111111) |

## Trading Terms

| Term | Meaning |
|------|---------|
| Killzone | High-probability trading session window |
| London session | 8am-4pm GMT trading hours |
| New York session | 1pm-9pm GMT (8am-4pm EST) |
| Asian session | 11pm-7am GMT |
| Trading checklist | Daily pre-session checklist from strategy template |
| Strategy template | Reusable trading plan with dynamic sections |

## Infrastructure Terms

| Term | Meaning |
|------|---------|
| Railway | Production hosting platform (auto-deploy from main) |
| Railpack | Railway's builder (replaced Dockerfile 2026-03-25) |
| OpenRouter | Multi-model AI API gateway |
| Cerebras | Fast inference API for compaction summarization |
| Drizzle | TypeScript ORM for PostgreSQL |
| BlockNote | Rich text editor used in Knowledge Hub |
| shadcn/ui | UI component library (45+ components) |
| TanStack Query | React data fetching library |
| Wouter | Lightweight React router |

## Codenames & Nicknames

| Nickname | Full Name |
|----------|-----------|
| SB | Sayed Baharun |
| @SBNexusBot | Telegram bot for SB-OS |
| sbaura.up.railway.app | Production URL |
| sayedbaharun/SBOS | GitHub repository |
