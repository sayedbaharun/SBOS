# API Reference

> 180+ REST endpoints organized by resource. All require session authentication unless noted.

## Authentication

Session-based with CSRF protection. Login via `POST /api/auth/login`, check status via `GET /api/auth/status`.

## Auth & Security (15 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/auth/status` | Check if auth required & password configured |
| `GET` | `/api/auth/user` | Get current authenticated user |
| `POST` | `/api/auth/login` | Login with email/password |
| `POST` | `/api/auth/logout` | Logout & destroy session |
| `POST` | `/api/auth/setup` | Initial setup — create password |
| `POST` | `/api/auth/change-password` | Change password |
| `GET` | `/api/auth/csrf-token` | Get CSRF token |
| `GET` | `/api/auth/2fa/status` | Get 2FA status |
| `POST` | `/api/auth/2fa/setup` | Initiate 2FA setup (returns QR code) |
| `POST` | `/api/auth/2fa/enable` | Verify and enable 2FA |
| `POST` | `/api/auth/2fa/disable` | Disable 2FA |
| `POST` | `/api/auth/2fa/regenerate-backup-codes` | Regenerate backup codes |
| `POST` | `/api/auth/2fa/emergency-recovery` | Emergency recovery with key |
| `POST` | `/api/auth/reset-password` | Password reset with recovery key |
| `GET` | `/api/auth/security-log` | Get recent security audit log |

## Dashboard (9 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/dashboard/readiness` | Health battery (sleep, mood, energy) |
| `GET` | `/api/dashboard/ventures` | Venture overview with task counts |
| `GET` | `/api/dashboard/inbox` | Capture items inbox preview |
| `GET` | `/api/dashboard/tasks` | Today's tasks |
| `GET` | `/api/dashboard/urgent` | Urgent tasks + "On Fire" indicator |
| `GET` | `/api/dashboard/top3` | Top 3 priority tasks |
| `GET` | `/api/dashboard/day` | Current day data |
| `GET` | `/api/dashboard/next-meeting` | Next Google Calendar meeting |
| `GET` | `/api/dashboard/scorecard` | Daily scorecard metrics |

## Ventures (5 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/ventures` | List all ventures |
| `GET` | `/api/ventures/:idOrSlug` | Get venture (supports ID or slug) |
| `POST` | `/api/ventures` | Create venture |
| `PATCH` | `/api/ventures/:id` | Update venture |
| `DELETE` | `/api/ventures/:id` | Delete venture |

## Projects (5 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/projects` | List projects (`?venture_id=`) |
| `GET` | `/api/projects/:id` | Get project |
| `POST` | `/api/projects` | Create project |
| `PATCH` | `/api/projects/:id` | Update project |
| `DELETE` | `/api/projects/:id` | Delete project |

## Phases (5 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/phases` | List phases (`?project_id=`) |
| `GET` | `/api/phases/:id` | Get phase |
| `POST` | `/api/phases` | Create phase |
| `PATCH` | `/api/phases/:id` | Update phase |
| `DELETE` | `/api/phases/:id` | Delete phase |

## Tasks (6 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/tasks` | List tasks (filters: `venture_id`, `project_id`, `status`, `focus_date`, `due_date`) |
| `GET` | `/api/tasks/today` | Get today's tasks |
| `GET` | `/api/tasks/:id` | Get task |
| `POST` | `/api/tasks` | Create task |
| `PATCH` | `/api/tasks/:id` | Update task (includes calendar sync) |
| `DELETE` | `/api/tasks/:id` | Delete task |

## Captures (6 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/captures` | List captures (`?clarified=true/false`) |
| `GET` | `/api/captures/:id` | Get capture |
| `POST` | `/api/captures` | Create capture |
| `PATCH` | `/api/captures/:id` | Update capture |
| `POST` | `/api/captures/:id/convert` | Convert capture to task |
| `DELETE` | `/api/captures/:id` | Delete capture |

## Days (6 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/days` | List days (`?date_gte=`, `?date_lte=`) |
| `GET` | `/api/days/today` | Get or create today's day |
| `GET` | `/api/days/:date` | Get day by date (YYYY-MM-DD) |
| `POST` | `/api/days` | Create day |
| `PATCH` | `/api/days/:date` | Update day by date |
| `DELETE` | `/api/days/:date` | Delete day |

## Health (4 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | List entries (`?date_gte=`, `?date_lte=`) |
| `GET` | `/api/health/:id` | Get entry |
| `POST` | `/api/health` | Create entry (auto-links to day) |
| `PATCH` | `/api/health/:id` | Update entry |

## Nutrition (6 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/nutrition` | List entries (`?date=`, `?dayId=`) |
| `GET` | `/api/nutrition/:id` | Get entry |
| `POST` | `/api/nutrition` | Create entry (auto-links to day) |
| `PATCH` | `/api/nutrition/:id` | Update entry |
| `DELETE` | `/api/nutrition/:id` | Delete entry |
| `POST` | `/api/nutrition/estimate-macros` | AI macro estimation from description |

## Docs & Knowledge (16 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/docs` | List docs (filters: `venture_id`, `type`, `domain`, `status`, `parent_id`; pagination: `?limit=&offset=`) |
| `GET` | `/api/docs/search` | Search docs (`?q=term`) |
| `GET` | `/api/docs/tree/:ventureId` | Doc tree for venture |
| `GET` | `/api/docs/children/:parentId` | Direct children (`null` for root) |
| `GET` | `/api/docs/quality/review-queue` | Docs needing quality review |
| `GET` | `/api/docs/quality/metrics` | Quality metrics |
| `GET` | `/api/docs/:id` | Get doc |
| `GET` | `/api/docs/:id/quality` | Quality breakdown |
| `GET` | `/api/docs/:docId/attachments` | List attachments |
| `POST` | `/api/docs` | Create doc |
| `POST` | `/api/docs/reorder` | Reorder docs (drag-and-drop) |
| `PATCH` | `/api/docs/:id` | Update doc |
| `POST` | `/api/docs/:id/recalculate-quality` | Recalculate quality score |
| `POST` | `/api/docs/:id/mark-reviewed` | Mark as reviewed |
| `DELETE` | `/api/docs/:id` | Delete doc |
| `DELETE` | `/api/docs/:id/recursive` | Delete doc and all children |

## Trading (13 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/trading-strategies` | List strategies (`?isActive=`) |
| `GET` | `/api/trading-strategies/default/active` | Get default active strategy |
| `GET` | `/api/trading-strategies/:id` | Get strategy |
| `POST` | `/api/trading-strategies` | Create strategy |
| `POST` | `/api/trading-strategies/seed` | Seed default strategies |
| `PATCH` | `/api/trading-strategies/:id` | Update strategy |
| `DELETE` | `/api/trading-strategies/:id` | Delete strategy |
| `GET` | `/api/trading-checklists` | List daily checklists |
| `GET` | `/api/trading-checklists/today` | Get today's checklists |
| `GET` | `/api/trading-checklists/:id` | Get checklist |
| `POST` | `/api/trading-checklists` | Create checklist |
| `PATCH` | `/api/trading-checklists/:id` | Update checklist |
| `DELETE` | `/api/trading-checklists/:id` | Delete checklist |

## Agents (22+ endpoints)

See [Agent System](agent-system.md#api-endpoints) for full list. Key endpoints:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/agents` | List all agents |
| `POST` | `/api/agents/:slug/chat` | Chat with agent |
| `POST` | `/api/agents/:slug/delegate` | Delegate task |
| `GET` | `/api/agents/compaction-stats` | Compaction metrics |
| `POST` | `/api/agents/admin/seed` | Seed from templates |

## Venture AI (5 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/ventures/:ventureId/chat` | Venture-scoped AI chat |
| `GET` | `/api/ventures/:ventureId/chat/history` | Venture chat history |
| `GET` | `/api/ventures/:ventureId/ai/context-status` | AI context cache status |
| `POST` | `/api/ventures/:ventureId/ai/rebuild-context` | Rebuild context cache |
| `GET` | `/api/ventures/:ventureId/ai/actions` | Agent action audit log |

## AI Chat (8 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/ai-models` | List available AI models |
| `GET` | `/api/models` | List models (alias) |
| `POST` | `/api/chat` | Send chat message |
| `GET` | `/api/chat/history` | Get chat history |
| `DELETE` | `/api/chat/history` | Clear chat history |
| `GET` | `/api/ai-agent-prompts/venture/:ventureId` | Venture AI prompt |
| `POST` | `/api/ai-agent-prompts` | Create AI prompt |
| `PATCH` | `/api/ai-agent-prompts/:id` | Update AI prompt |

## Memory & RAG (6+ endpoints)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/memory/status` | Memory system status |
| `GET` | `/api/memory/search` | Hybrid search across memories |
| `POST` | `/api/memory/store` | Store memory/fact |
| `POST` | `/api/rag/search` | Hybrid search (vector + keyword). Returns `_search_meta` with method, weights, result_count, top_relevance |
| `POST` | `/api/rag/sync` | Sync knowledge base with Qdrant |
| `GET` | `/api/rag/status` | RAG system status |

## Settings (12+ endpoints)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/settings/preferences` | Get preferences |
| `PATCH` | `/api/settings/preferences` | Update preferences |
| `GET` | `/api/settings/morning-ritual` | Get morning ritual config |
| `PATCH` | `/api/settings/morning-ritual` | Update morning ritual |
| `GET` | `/api/settings/ai` | Get AI settings |
| `PATCH` | `/api/settings/ai` | Update AI settings |
| `GET` | `/api/settings/integrations` | List integration statuses |
| `GET` | `/api/settings/integrations/:service` | Get integration status |

## External Integrations

### TickTick (6 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/ticktick/status` | Connection status |
| `GET` | `/api/ticktick/projects` | List TickTick projects |
| `GET` | `/api/ticktick/projects/:projectId/tasks` | Get project tasks |
| `POST` | `/api/ticktick/inbox/setup` | Create SB-OS Inbox in TickTick |
| `POST` | `/api/ticktick/sync` | Sync inbox to captures |
| `POST` | `/api/ticktick/tasks/:id/complete` | Complete task in TickTick |

### Google Drive (8+ endpoints)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/drive/status` | Drive connection status |
| `GET` | `/api/drive/folders` | List folders |
| `GET` | `/api/drive/files` | List files |
| `GET` | `/api/drive/search` | Search files |
| `POST` | `/api/drive/sync` | Sync files |
| `GET` | `/api/drive/file/:fileId` | Get file info |
| `POST` | `/api/drive/upload` | Upload file |
| `DELETE` | `/api/drive/file/:fileId` | Delete file |

## Intelligence (10 endpoints)

Cross-domain intelligence synthesis, email triage, meeting prep, and nudge analytics.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/intelligence/daily` | Get today's intelligence synthesis (`?date=YYYY-MM-DD`) |
| `GET` | `/api/intelligence/history` | Past syntheses (`?limit=7`) |
| `POST` | `/api/intelligence/run` | Manually trigger synthesis |
| `GET` | `/api/intelligence/email/triage` | Today's email triage (`?date=&classification=&limit=50`) |
| `GET` | `/api/intelligence/email/triage/:id` | Single triaged email |
| `POST` | `/api/intelligence/email/triage/run` | Manually trigger email triage |
| `POST` | `/api/intelligence/email/reply` | Send email reply (`{ emailId, message }`) |
| `GET` | `/api/intelligence/meeting-preps` | Meeting preps (`?date=`) |
| `POST` | `/api/intelligence/meeting-preps/run` | Manually trigger meeting prep |
| `GET` | `/api/intelligence/nudges/stats` | Nudge response analytics (`?days=14`) |

## Other Resources

| Method | Path | Description |
|--------|------|-------------|
| `GET/POST/PATCH/DELETE` | `/api/shopping` | Shopping items CRUD |
| `GET/POST/PATCH/DELETE` | `/api/books` | Books CRUD |
| `GET/POST/PATCH/DELETE` | `/api/categories` | Custom categories CRUD |
| `GET/POST/PATCH/DELETE` | `/api/knowledge-files` | Knowledge files CRUD |
| `POST` | `/api/sessions/log` | Log session for persistence |
| `POST` | `/api/telegram/webhook` | Telegram webhook (registered before SPA catch-all) |
