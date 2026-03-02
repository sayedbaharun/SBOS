# Resonance Pentad — Context Compaction System

> 4-layer system preventing context overflow in agent tool loops.

## The Problem

Agent conversations use multi-turn tool loops (max 10 turns). Each turn adds messages to `conversationMessages`:

- User message
- Assistant response with tool calls
- Tool results (often large: search results, reports, code)

Without compaction, context grows unboundedly. A 10-turn tool loop can easily exceed model context windows, causing `context_length_exceeded` errors and lost work.

## The Solution: 4 Layers

```
Layer 1: stripToolResults()        — sync, <5ms, 30-50% reduction
Layer 2: observer.ts               — async, 2-3s, 60-80% reduction
Layer 3: reflector.ts              — fire-and-forget, routes to shared memory
Layer 4: compaction-tuner.ts       — nightly, adaptive per-agent tuning
```

### Layer 1: Strip Tool Results (Synchronous)

**File**: `server/agents/context-budget.ts` → `stripToolResults()`

- Keeps the last 3 assistant+tool rounds intact
- Replaces older tool results with compact references:
  ```
  [Tool: web_search() → "Top 5 results for competitor analysis..." (2,340 tokens stripped)]
  ```
- Zero LLM cost, <5ms latency
- Typically achieves 30-50% token reduction
- Runs every turn when context exceeds 75% of model window

### Layer 2: Observer (LLM-Powered)

**File**: `server/agents/observer.ts` → `generateObservation()`

Triggered when Layer 1 is insufficient (context still over threshold).

1. Formats older messages into `ROLE: content` blocks (truncated to ~24K chars)
2. Sends to LLM with structured extraction prompt
3. Generates an `ObservationOutput`:
   ```
   {
     summary: "2-4 paragraph summary of conversation so far",
     key_decisions: [{ text, priority: "high|medium|low" }],
     key_facts: ["fact1", "fact2"],
     key_entities: ["person1", "project1"],
     domain: "personal|project|business|health|finance",
     action_items: ["action1"],
     nextSteps: [{ text, priority }],
     openQuestions: ["question1"]
   }
   ```
4. Replaces compacted messages with:
   ```
   [COMPACTED CONTEXT — Prior conversation summarized by Observer]
   ```
5. Observation stored for Layer 3

**Backend priority**: Cerebras (Llama 3.3 70b, cheaper) → OpenRouter (GPT-4o-mini, fallback)

**Before discarding**: `rescueMemories()` runs a 3-extractor pipeline to save facts, decisions, and skills.

### Layer 3: Reflector (Shared Memory Routing)

**File**: `server/agents/reflector.ts` → `reflectAndRoute()`

When 3+ observations accumulate during a task:

1. **Condense**: Merge observations deterministically (no LLM for simple merges, Cerebras for >4K chars)
2. **Route to shared memory** (fire-and-forget):
   - **Qdrant**: Full observation → `compacted_memories` collection (semantic search)
   - **FalkorDB**: Entities and decisions → knowledge graph nodes
   - **Pinecone**: High-priority decisions only → `decisions` namespace

This creates **cross-agent value**: Agent A's observations become searchable by Agent B.

### Layer 4: Compaction Tuner (Adaptive Feedback)

**File**: `server/agents/compaction-tuner.ts` → `tuneAllAgentCompaction()`

Runs nightly (3am Dubai) as part of `memory_consolidation`:

1. Analyze 7-day compaction event history per agent
2. Compute success rate: tasks completed after compaction / total tasks with compaction
3. Adjust configuration:
   - Success rate <70% → raise threshold (compact less, +5%, max 90%)
   - Success rate >90% → lower threshold back toward 75%
   - Layer 2 latency >5s avg → flag for model review
   - ≥5 Layer 2 events/week → enable Layer 3 (reflection)

## Emergency Handling

If an LLM call returns HTTP 400 `context_length_exceeded`:

1. Run `stripToolResults()` (Layer 1)
2. Run `compactWithObserver()` (Layer 2)
3. Retry the LLM call once
4. If retry fails → throw `ContextOverflowError`

## Integration Points

Both `executeAgentChat()` and `executeAgentTask()` in `agent-runtime.ts` have identical compaction integration:

```
Turn N:
  1. Context budget check (≥75% of window?)
     ├── YES → Layer 1: stripToolResults() [sync, <5ms]
     ├── Still over? → Layer 2: compactWithObserver() [async, 2-3s]
     │   └── 3+ observations? → Layer 3: reflectAndRoute() [fire-and-forget]
     └── rescueMemories() [fire-and-forget]
  2. LLM call
  3. Tool execution + loop detection
  4. Repeat
```

## Database Tables

### `agent_compaction_events`

Tracks every compaction event with metrics.

| Column | Type | Purpose |
|--------|------|---------|
| `agent_id` | uuid | Agent that was compacted |
| `task_id` | uuid | Associated task (if any) |
| `session_id` | text | Session identifier |
| `layer` | integer | Which layer (1, 2, or 3) |
| `tokens_before` | integer | Token count before compaction |
| `tokens_after` | integer | Token count after compaction |
| `latency_ms` | integer | Time taken |
| `compaction_model` | text | Model used (Layer 2 only) |
| `observation` | jsonb | Structured observation (Layer 2 only) |
| `task_outcome` | text | Whether task completed after compaction |

### `agent_compaction_config`

Per-agent tuning settings (auto-adjusted by Layer 4).

| Column | Type | Default | Purpose |
|--------|------|---------|---------|
| `agent_id` | uuid | — | One row per agent |
| `threshold_pct` | real | 0.75 | Context % that triggers compaction |
| `layer2_model` | text | `openai/gpt-4o-mini` | Model for Layer 2 |
| `max_observation_tokens` | integer | 2000 | Max tokens for observations |
| `enable_layer3` | boolean | false | Whether reflection is active |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/agents/compaction-stats` | Aggregate compaction stats across all agents |
| `GET` | `/api/agents/:slug/compaction-stats` | Per-agent compaction stats (7-day window) |

**Route ordering gotcha**: `/compaction-stats` MUST be registered before `/:slug` in Express to avoid matching as a slug parameter.

## Pentad Metrics

The five dimensions that the system optimizes:

| Metric | What It Measures |
|--------|-----------------|
| **Speed** | Layer 1 latency (<5ms), Layer 2 latency (2-3s target) |
| **Fidelity** | Task success rate after compaction (target >85%) |
| **Cost** | LLM tokens spent on compaction vs. tokens saved |
| **Resonance** | Cross-agent retrieval rate from shared memory |
| **Adaptivity** | Config changes from tuner (threshold, model, L3 toggle) |

## Model Context Windows

| Model Family | Context Window |
|-------------|---------------|
| Claude Opus/Sonnet/Haiku | 200,000 tokens |
| GPT-4o | 128,000 tokens |
| Gemini 1.5 Pro | 1,000,000 tokens |
| Local models | 32,000 tokens |
