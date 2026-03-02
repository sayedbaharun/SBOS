# Database Schema

> 64 tables organized by domain. All defined in `shared/schema.ts` using Drizzle ORM.

## Schema Management

```bash
# Push schema changes to database
npm run db:push

# Modify schema
# Edit shared/schema.ts → npm run db:push
```

## Core & Authentication (5 tables)

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `users` | User profiles with security | `id`, `email`, `passwordHash`, `firstName`, `lastName`, `timezone`, `totpEnabled`, `totpSecret`, `trustedDevices`, `lastLoginAt` |
| `sessions` | Express session storage | `sid`, `sess`, `expire` |
| `user_preferences` | Settings, theme, AI config | `userId`, `theme`, `morningRitualConfig`, `notificationSettings`, `aiModel`, `aiTemperature`, `aiInstructions` |
| `audit_logs` | Security audit trail | `userId`, `action`, `resource`, `resourceId`, `ipAddress`, `userAgent`, `details`, `status` |
| `custom_categories` | User-defined enums | `type`, `value`, `label`, `color`, `icon`, `sortOrder`, `enabled` |

## Ventures & Projects (4 tables)

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `ventures` | Business initiatives | `id`, `name`, `slug`, `status`, `domain`, `oneLiner`, `primaryFocus`, `color`, `icon`, `notes` |
| `projects` | Initiatives within ventures | `id`, `name`, `ventureId`, `status`, `category`, `priority`, `startDate`, `targetEndDate`, `budget`, `budgetSpent`, `revenueGenerated` |
| `phases` | Project phases | `id`, `name`, `projectId`, `status`, `order`, `targetDate`, `notes` |
| `tasks` | Atomic execution units | `id`, `title`, `status`, `priority`, `type`, `domain`, `ventureId`, `projectId`, `phaseId`, `dayId`, `dueDate`, `focusDate`, `focusSlot`, `estEffort`, `actualEffort`, `tags` |

**Hierarchy**: Ventures → Projects → Phases → Tasks

## Daily Operations (4 tables)

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `days` | Daily logs (central hub) | `date`, `title`, `mood`, `top3Outcomes`, `oneThingToShip`, `reflectionAm`, `reflectionPm`, `morningRituals`, `eveningRituals`, `tradingJournal`, `primaryVentureFocus` |
| `weeks` | Weekly planning/review | `weekStart`, `weekNumber`, `year`, `weeklyBig3`, `theme`, `planningNotes`, `reviewNotes`, `wins`, `improvements`, `metrics` |
| `capture_items` | GTD-style inbox | `title`, `type` (idea/task/note/link), `source` (brain/email/chat/meeting), `domain`, `ventureId`, `clarified`, `linkedTaskId` |
| `shopping_items` | Shopping list | `item`, `priority` (P1/P2/P3), `status` (to_buy/purchased), `category`, `notes` |

## Health & Wellness (3 tables)

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `health_entries` | Daily health metrics | `dayId`, `date`, `sleepHours`, `sleepQuality`, `energyLevel`, `mood`, `steps`, `workoutDone`, `workoutType`, `workoutDurationMin`, `weightKg`, `bodyFatPercent`, `stressLevel` |
| `bloodwork_entries` | Quarterly lab results | `date`, `hba1c`, `fastingGlucose`, `testosterone`, `cortisol`, `tsh`, `vitaminD`, `crp`, `alt`, `ast`, `creatinine`, `egfr` |
| `nutrition_entries` | Meal logs with macros | `dayId`, `datetime`, `mealType`, `description`, `calories`, `proteinG`, `carbsG`, `fatsG`, `context`, `tags` |

## Knowledge Base (4 tables)

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `docs` | SOPs, prompts, specs (hierarchical) | `title`, `type`, `domain`, `ventureId`, `parentId`, `status`, `isFolder`, `body`, `content` (BlockNote JSON), `summary`, `qualityScore`, `embedding` |
| `attachments` | Files for docs | `docId`, `name`, `type`, `size`, `url`, `storageType`, `data` |
| `doc_chunks` | Chunked content for RAG | `docId`, `chunkIndex`, `content`, `embedding`, `startOffset`, `endOffset` |
| `books` | Reading list | `title`, `author`, `platforms`, `status` (to_read/reading/finished), `notes` |

## Trading (5 tables)

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `trading_strategies` | Strategy templates | `name`, `description`, `instruments`, `isActive`, `isDefault`, `config` |
| `daily_trading_checklists` | Daily strategy instances | `date`, `strategyId`, `data` (instrument, session, mental state, trades, review) |
| `trading_chat_sessions` | AI trading coach threads | `userId`, `title` |
| `trading_conversations` | Trading AI chat history | `userId`, `sessionId`, `role`, `content`, `metadata` |
| `trading_agent_config` | Trading AI configuration | `userId`, `systemPrompt`, `accountBalance`, `riskPerTradePercent`, `setupTypes`, `noTradeRules`, `preTradeChecklist`, `tradingBeliefs` |

## AI & Agents (7 tables)

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `ai_agent_prompts` | Venture-specific AI config | `ventureId`, `systemPrompt`, `capabilities`, `quickActions`, `preferredModel` |
| `coo_chat_sessions` | COO AI assistant threads | `userId`, `title` |
| `chat_messages` | Web AI chat history | `userId`, `sessionId`, `role`, `content`, `metadata` |
| `venture_conversations` | Venture-scoped chat | `ventureId`, `userId`, `role`, `content`, `metadata` |
| `venture_context_cache` | Cached AI context | `ventureId`, `contextType`, `content`, `tokenCount`, `validUntil` |
| `venture_agent_actions` | AI action audit log | `ventureId`, `conversationId`, `action`, `entityType`, `entityId`, `result` |
| `foresight_conversations` | Strategy AI chat | `ventureId`, `userId`, `role`, `content`, `metadata` |

## Agent System (7 tables)

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `agents` | Agent definitions | `name`, `slug`, `role`, `parentId`, `soul`, `expertise`, `availableTools`, `modelTier`, `memoryScope`, `schedule`, `isActive` |
| `agent_conversations` | Per-agent chat with threading | `agentId`, `role`, `content`, `metadata`, `delegationFrom`, `parentMessageId` |
| `agent_tasks` | Inter-agent delegation | `title`, `assignedBy`, `assignedTo`, `status`, `delegationChain`, `grantedPermissions`, `result` |
| `agent_memory` | Persistent memory with learning | `agentId`, `memoryType`, `content`, `importance`, `scope`, `tags`, `embedding` |
| `agent_compaction_events` | Resonance Pentad metrics | `agentId`, `taskId`, `layer`, `tokensBefore`, `tokensAfter`, `latencyMs`, `observation` |
| `agent_compaction_config` | Per-agent tuning | `agentId`, `thresholdPct`, `layer2Model`, `enableLayer3` |
| `external_agents` | Third-party agent registration | `name`, `slug`, `apiKeyHash`, `type`, `status`, `capabilities` |

## Strategic Foresight (6 tables)

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `venture_scenarios` | Future scenarios | `ventureId`, `title`, `timeHorizon`, `probability`, `impact`, `quadrant`, `keyAssumptions`, `strategicResponses` |
| `scenario_indicators` | Early warning signals | `scenarioId`, `ventureId`, `title`, `category` (PESTLE), `threshold`, `currentStatus` |
| `trend_signals` | Emerging trends | `ventureId`, `title`, `source`, `signalStrength`, `relevance`, `potentialImpact` |
| `strategic_analyses` | PESTLE/STEEP analyses | `ventureId`, `framework`, `political`, `economic`, `social`, `technological`, `legal`, `environmental` |
| `what_if_questions` | Strategic question bank | `ventureId`, `question`, `category`, `explored`, `linkedScenarioId` |
| `fear_settings` | Tim Ferriss fear-setting | `userId`, `title`, `fears`, `preventions`, `repairs`, `decision`, `status` |

## Financial (4 tables)

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `financial_accounts` | Account tracking | `name`, `type`, `institution`, `currentBalance`, `currency`, `isAsset` |
| `account_snapshots` | Balance history | `accountId`, `balance`, `note` |
| `holdings` | Individual investments | `name`, `symbol`, `assetType`, `quantity`, `currentPrice`, `currentValue`, `costBasis` |
| `net_worth_snapshots` | Periodic net worth | `snapshotDate`, `totalAssets`, `totalLiabilities`, `netWorth`, `holdingsSnapshot` |

## AI Learning & Feedback (4 tables)

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `doc_ai_feedback` | AI suggestion tracking | `docId`, `fieldName`, `aiSuggestion`, `userAction`, `editDistance`, `timeToDecide` |
| `doc_ai_examples` | Gold standard few-shot examples | `docType`, `fieldName`, `goldOutput`, `qualityScore`, `successRate` |
| `doc_ai_patterns` | Learned patterns from feedback | `docType`, `fieldName`, `pattern`, `confidence`, `sourceCount` |
| `doc_ai_teachings` | Direct user instructions | `docType`, `fieldName`, `teachingType`, `content` |

## Memory & Persistence (3 tables)

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `memory_task_queue` | Deferred processing queue | `taskType`, `payload`, `priority`, `status`, `retryCount` |
| `memory_sync_ledger` | Qdrant↔Pinecone version tracking | `entityType`, `entityId`, `localVersion`, `cloudVersion`, `status` |
| `session_logs` | Cross-session continuity | `source`, `summary`, `keyTopics`, `decisions`, `openThreads`, `embedding`, `processed` |

## Other (7 tables)

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `people` | Contact/relationship CRM | `name`, `email`, `company`, `relationship`, `importance`, `lastContactDate`, `nextFollowUp` |
| `knowledge_files` | Venture-linked file uploads | `ventureId`, `category`, `storageType`, `processingStatus`, `extractedText`, `aiSummary` |
| `trading_knowledge_docs` | Trading AI training docs | `title`, `category`, `extractedText`, `summary`, `includeInContext` |
| `venture_ideas` | Business idea pipeline | `name`, `status`, `scoreData`, `verdict`, `ventureId` |
| `decision_memories` | Decision capture with outcomes | `context`, `decision`, `reasoning`, `followUpAt`, `outcome` |
| `entity_relations` | Lightweight knowledge graph | `sourceName`, `targetName`, `relationType`, `strength`, `mentionCount` |
| `telegram_messages` | Raw Telegram message log | `chatId`, `messageId`, `direction`, `content`, `sender`, `messageType` |
| `research_submissions` | External agent findings | `externalAgentId`, `title`, `summary`, `category`, `confidence`, `status` |

## Enums

| Enum | Values |
|------|--------|
| `agent_role` | executive, manager, specialist, worker |
| `agent_task_status` | pending, in_progress, delegated, completed, failed, needs_review |
| `agent_memory_type` | learning, preference, context, relationship, decision |
| `trading_knowledge_doc_category` | strategy, playbook, notes, research, psychology, education, other |
| `knowledge_file_category` | document, strategy, playbook, notes, research, reference, template, image, spreadsheet, presentation, other |
| `knowledge_file_storage` | google_drive, base64, url |
| `knowledge_file_processing_status` | pending, processing, completed, failed |
| `scenario_time_horizon` | 1_year, 3_year, 5_year, 10_year |
| `scenario_probability` | low, medium, high |
| `scenario_impact` | low, medium, high, critical |

## Key Design Patterns

- **Hierarchical**: Ventures → Projects → Phases → Tasks; Docs with `parentId`; Agents with `parentId`
- **Daily hub**: Health, nutrition, trading entries link to `days` table
- **Multi-scope AI**: Venture-scoped conversations + global agent memory with scope inheritance
- **Vector-ready**: Embeddings on `docs`, `doc_chunks`, `agent_memory`, `session_logs`
- **Audit trail**: `audit_logs` + `telegram_messages` + `agent_conversations` + `doc_ai_feedback`
- **Learning loop**: `doc_ai_feedback` → `doc_ai_patterns` → `doc_ai_examples` → `doc_ai_teachings`
