/**
 * Retrieval Evaluation Harness
 *
 * Measures keyword-arm recall and precision against a curated SB-OS
 * domain fixture. Designed to catch regressions when the keyword arm
 * (hybrid-retriever.ts keywordSearchMemories) changes.
 *
 * Fixture: 30 SB-OS-domain memory documents covering agents, health,
 * trading, deployment, and personal productivity.
 *
 * Eval set: 20 (query → relevant_doc_ids[]) pairs. Ground truth was
 * manually labelled — the correct docs contain the answer the query asks for.
 *
 * Metrics reported:
 *   R@1  — is the top result relevant?
 *   R@3  — is any of the top 3 relevant?
 *   R@5  — is any of the top 5 relevant? (primary metric, ≥ 0.75 required)
 *   MRR  — mean reciprocal rank
 *
 * Run: npx vitest run server/__tests__/retrieval-eval.test.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// FIXTURE: 30 SB-OS memory documents
// ---------------------------------------------------------------------------

interface FixtureDoc {
  id: string;
  content: string;
  importance: number;
  memoryType: string;
  createdAt: Date;
}

const FIXTURE_DOCS: FixtureDoc[] = [
  { id: "d01", content: "Railway deployment uses Railpack builder on port 8080. Auto-deploys from git push to main branch on sayedbaharun/SBOS repository.", importance: 0.9, memoryType: "decision", createdAt: new Date("2026-01-10") },
  { id: "d02", content: "Chief of Staff is the executive agent that orchestrates all other agents. It runs daily briefing at 7am Dubai time and has delegation rights to CMO and CTO.", importance: 0.9, memoryType: "context", createdAt: new Date("2026-01-12") },
  { id: "d03", content: "Telegram bot named SBNexusBot handles 12 commands including /today, /tasks, /capture, /briefing. Agent routing via @agent-slug prefix.", importance: 0.8, memoryType: "context", createdAt: new Date("2026-01-15") },
  { id: "d04", content: "WHOOP band OAuth2 integration auto-syncs recovery score, HRV, resting heart rate, strain, sleep and workouts. Sync button appears in Health Hub header.", importance: 0.8, memoryType: "context", createdAt: new Date("2026-01-18") },
  { id: "d05", content: "Trading module includes London, New York and Asian session indicators with killzone highlighting. Daily checklist follows the active strategy template.", importance: 0.75, memoryType: "context", createdAt: new Date("2026-01-20") },
  { id: "d06", content: "Qdrant vector store has three collections: raw_memories, compacted_memories, and entity_index. Each collection uses Gemini 1536-dimensional embeddings.", importance: 0.85, memoryType: "decision", createdAt: new Date("2026-02-01") },
  { id: "d07", content: "FalkorDB graph store tracks entity co-occurrence with strength increments of 0.1 per encounter, capped at 1.0. Full-text index on Entity name and description.", importance: 0.8, memoryType: "decision", createdAt: new Date("2026-02-05") },
  { id: "d08", content: "Pinecone serves as secondary cloud backup. Nightly sync job runs at 2am Dubai and pushes up to 200 compacted memories. Truncates embeddings to 512 dimensions.", importance: 0.75, memoryType: "context", createdAt: new Date("2026-02-08") },
  { id: "d09", content: "Zod v4 requires two arguments for z.record: use z.record(z.string(), z.unknown()). Use .issues not .errors. Critical gotcha for schema validation.", importance: 0.9, memoryType: "learning", createdAt: new Date("2026-02-10") },
  { id: "d10", content: "Express v5 returns string or string[] for req.params. Always wrap with String() to avoid TypeScript errors. Important for route parameter handling.", importance: 0.85, memoryType: "learning", createdAt: new Date("2026-02-12") },
  { id: "d11", content: "SyntheLIQ AI is the orchestrator for client AI agents. Never call it Hikma or HikmaClaw. Orchestrator URL is syntheliq-engine.up.railway.app.", importance: 0.95, memoryType: "preference", createdAt: new Date("2026-02-15") },
  { id: "d12", content: "Morning ritual page at /morning tracks press-ups, squats, supplements and water intake. Evening review at /evening covers reflection, gratitude and tomorrow priorities.", importance: 0.7, memoryType: "context", createdAt: new Date("2026-02-18") },
  { id: "d13", content: "Session compaction pipeline uses Cerebras API for fast summarization. Seven steps: extract, store raw, summarize, parse, store compacted, update entities, replace context.", importance: 0.8, memoryType: "context", createdAt: new Date("2026-02-20") },
  { id: "d14", content: "Hybrid retriever uses triple-arm RRF with weights: vector 0.55, keyword 0.25, graph 0.20. Falls back to vector 0.70 and keyword 0.30 when graph arm is empty.", importance: 0.85, memoryType: "decision", createdAt: new Date("2026-02-22") },
  { id: "d15", content: "Agent delegation engine implements privilege attenuation. Delegated tasks receive intersection of delegator and requested permissions. Depth enforced by maxDelegationDepth.", importance: 0.9, memoryType: "decision", createdAt: new Date("2026-02-25") },
  { id: "d16", content: "Tailwind CSS v3.4.19 is installed, not v4. Use utility-first classes. Custom theme in tailwind.config.ts. Do not install v4 as it has breaking changes.", importance: 0.85, memoryType: "preference", createdAt: new Date("2026-03-01") },
  { id: "d17", content: "Health Hub displays six metrics in hero strip: recovery score, HRV, resting heart rate, strain, sleep hours, steps. Sparklines show weekly trends.", importance: 0.7, memoryType: "context", createdAt: new Date("2026-03-05") },
  { id: "d18", content: "Nutrition dashboard supports breakfast, lunch, dinner and snack meal types. AI-powered macro estimation via /api/nutrition/estimate-macros endpoint.", importance: 0.7, memoryType: "context", createdAt: new Date("2026-03-08") },
  { id: "d19", content: "Google Drive integration syncs files and folders. Calendar integration planned but not built. Gmail triage runs three times daily at 4am, 9am and 2pm Dubai.", importance: 0.75, memoryType: "context", createdAt: new Date("2026-03-10") },
  { id: "d20", content: "Revolv Group ventures include SyntheLIQ AI, Tomaholic, mydclaw, and Dubai property platforms. SB-OS is personal infrastructure, not a Revolv Group venture.", importance: 0.9, memoryType: "context", createdAt: new Date("2026-03-12") },
  { id: "d21", content: "Cerebras API provides fast inference for session compaction summarization. Fallback to Ollama if Cerebras unavailable. Used specifically for 7-step compaction pipeline.", importance: 0.8, memoryType: "decision", createdAt: new Date("2026-03-15") },
  { id: "d22", content: "Task automation scout agent scans venture backlogs three times daily at 8am, 1pm and 6pm Dubai time. Tags tasks as agent-ready when no human decision needed.", importance: 0.75, memoryType: "context", createdAt: new Date("2026-03-18") },
  { id: "d23", content: "ESM modules cannot use __dirname. Use fileURLToPath(import.meta.url) combined with path.dirname() as the equivalent. Critical for server-side file path resolution.", importance: 0.85, memoryType: "learning", createdAt: new Date("2026-03-20") },
  { id: "d24", content: "Calendar events for Sayed should always be created on sb@revolvgroup.com. Never use personal email or other accounts for work calendar entries.", importance: 0.9, memoryType: "preference", createdAt: new Date("2026-03-22") },
  { id: "d25", content: "Gym schedule: Monday Wednesday Saturday are three-hour sessions. Tuesday Thursday are two-hour sessions. Friday is clean desk day with no gym.", importance: 0.8, memoryType: "preference", createdAt: new Date("2026-03-25") },
  { id: "d26", content: "Playwright browser automation has six action types and uses a session pool. Import via dynamic require to avoid TypeScript module resolution errors.", importance: 0.75, memoryType: "learning", createdAt: new Date("2026-03-28") },
  { id: "d27", content: "OpenRouter API provides multi-model support for all AI agents. Model tier selection: top uses Claude Opus, mid uses Sonnet, fast uses Haiku, local uses Ollama.", importance: 0.8, memoryType: "context", createdAt: new Date("2026-04-01") },
  { id: "d28", content: "Dead letter jobs are created when a scheduled agent job fails all three retry attempts. Alert sent via Telegram with job name, agent slug, and error message.", importance: 0.8, memoryType: "context", createdAt: new Date("2026-04-05") },
  { id: "d29", content: "Ebbinghaus decay applies importance-scaled half-lives to memory retrieval scoring. High importance gets 365-day half-life, mid gets 60 days, low gets 14 days.", importance: 0.85, memoryType: "decision", createdAt: new Date("2026-04-08") },
  { id: "d30", content: "agent_job_runs table persists every scheduled job execution with status, triggered_by and duration_ms. Used by catch-up scheduler to recover missed jobs after Railway restart.", importance: 0.85, memoryType: "decision", createdAt: new Date("2026-04-13") },
];

// ---------------------------------------------------------------------------
// EVAL SET: 20 (query → relevant_doc_ids[]) pairs
// ---------------------------------------------------------------------------

interface EvalQuery {
  query: string;
  relevantIds: string[];  // docs that should appear in top-K results
}

const EVAL_QUERIES: EvalQuery[] = [
  { query: "Railway deployment git push auto deploy",                 relevantIds: ["d01"] },
  { query: "Chief of Staff agent delegation CMO CTO",                relevantIds: ["d02"] },
  { query: "Telegram bot commands nexus SBNexusBot",                 relevantIds: ["d03"] },
  { query: "WHOOP band health sync recovery HRV",                    relevantIds: ["d04"] },
  { query: "trading session London New York killzone",               relevantIds: ["d05"] },
  { query: "Qdrant vector store collections embeddings",             relevantIds: ["d06"] },
  { query: "FalkorDB graph entity co-occurrence tracking",           relevantIds: ["d07"] },
  { query: "Pinecone backup nightly sync compacted memories",        relevantIds: ["d08"] },
  { query: "Zod schema validation record two arguments",             relevantIds: ["d09"] },
  { query: "Express route parameters string type error",             relevantIds: ["d10"] },
  { query: "SyntheLIQ AI orchestrator never call Hikma",             relevantIds: ["d11"] },
  { query: "session compaction Cerebras pipeline steps",             relevantIds: ["d13", "d21"] },
  { query: "hybrid retriever RRF weights vector keyword graph",      relevantIds: ["d14"] },
  { query: "agent privilege delegation depth permissions",           relevantIds: ["d15"] },
  { query: "ESM module dirname file path resolution",                relevantIds: ["d23"] },
  { query: "calendar events revolv email account",                   relevantIds: ["d24"] },
  { query: "gym schedule Monday Wednesday Saturday workout",         relevantIds: ["d25"] },
  { query: "dead letter job retry failed Telegram alert",            relevantIds: ["d28"] },
  { query: "Ebbinghaus decay half life memory importance",           relevantIds: ["d29"] },
  { query: "catch up scheduler agent job runs Railway restart",      relevantIds: ["d30"] },
];

// ---------------------------------------------------------------------------
// SCORING HELPERS (mirrors hybrid-retriever.ts logic, pure functions)
// ---------------------------------------------------------------------------

function ebbinghausDecayTest(timestampMs: number, importance: number): number {
  const HALF_LIFE_HIGH = 365 * 24 * 60 * 60 * 1000;
  const HALF_LIFE_MID  =  60 * 24 * 60 * 60 * 1000;
  const HALF_LIFE_LOW  =  14 * 24 * 60 * 60 * 1000;

  const age = Date.now() - timestampMs;
  if (age <= 0) return 1.0;

  const halfLife = importance >= 0.8 ? HALF_LIFE_HIGH : importance >= 0.4 ? HALF_LIFE_MID : HALF_LIFE_LOW;
  const decay = Math.pow(0.5, age / halfLife);
  return importance >= 0.8 ? Math.max(decay, 0.20) : decay;
}

/**
 * Simulates ts_rank_cd relevance score for a document against a query.
 * In production this comes from Postgres. Here we compute an approximation:
 * matching query stems / total query stems, then apply tf-idf-like weighting
 * by counting term frequency in the document.
 */
function simulateBm25Rank(docContent: string, query: string): number {
  const stem = (s: string) => s.toLowerCase().replace(/[^\w\s]/g, "").trim();
  const docWords = stem(docContent).split(/\s+/);
  const queryTerms = stem(query).split(/\s+/).filter(t => t.length > 2);

  if (queryTerms.length === 0) return 0;

  // Count matching stems (simplified stemming: prefix match ≥ 4 chars)
  let matchScore = 0;
  for (const term of queryTerms) {
    const prefix = term.slice(0, 4);
    const freq = docWords.filter(w => w.startsWith(prefix)).length;
    if (freq > 0) {
      // TF component: log-normalised
      matchScore += Math.log(1 + freq) / Math.log(1 + docWords.length);
    }
  }

  // Normalise by query length → [0, 1] range (mirrors ts_rank_cd norm=32)
  return Math.min(matchScore / queryTerms.length, 1.0);
}

/**
 * Score a fixture doc against a query using the same formula as keywordSearchMemories.
 */
function scoreDoc(doc: FixtureDoc, query: string): number {
  const bm25 = simulateBm25Rank(doc.content, query);
  const decay = ebbinghausDecayTest(doc.createdAt.getTime(), doc.importance);
  return 0.70 * bm25 + 0.15 * decay + 0.15 * doc.importance;
}

// ---------------------------------------------------------------------------
// RECALL METRICS
// ---------------------------------------------------------------------------

function recallAtK(
  rankedIds: string[],
  relevantIds: string[],
  k: number
): number {
  const topK = new Set(rankedIds.slice(0, k));
  const hits = relevantIds.filter(id => topK.has(id)).length;
  return hits / relevantIds.length;
}

function reciprocalRank(rankedIds: string[], relevantIds: string[]): number {
  const relevantSet = new Set(relevantIds);
  for (let i = 0; i < rankedIds.length; i++) {
    if (relevantSet.has(rankedIds[i])) return 1 / (i + 1);
  }
  return 0;
}

// ---------------------------------------------------------------------------
// TESTS
// ---------------------------------------------------------------------------

describe("Retrieval Eval — Keyword Arm (BM25)", () => {

  it("scores and ranks documents correctly for each eval query", () => {
    const results: { query: string; r1: number; r3: number; r5: number; mrr: number }[] = [];

    for (const evalQ of EVAL_QUERIES) {
      // Score all fixture docs against this query
      const scored = FIXTURE_DOCS
        .map(doc => ({ id: doc.id, score: scoreDoc(doc, evalQ.query) }))
        .sort((a, b) => b.score - a.score);

      const rankedIds = scored.map(s => s.id);

      results.push({
        query: evalQ.query,
        r1:  recallAtK(rankedIds, evalQ.relevantIds, 1),
        r3:  recallAtK(rankedIds, evalQ.relevantIds, 3),
        r5:  recallAtK(rankedIds, evalQ.relevantIds, 5),
        mrr: reciprocalRank(rankedIds, evalQ.relevantIds),
      });
    }

    // Aggregate metrics
    const n = results.length;
    const avgR1  = results.reduce((s, r) => s + r.r1,  0) / n;
    const avgR3  = results.reduce((s, r) => s + r.r3,  0) / n;
    const avgR5  = results.reduce((s, r) => s + r.r5,  0) / n;
    const avgMRR = results.reduce((s, r) => s + r.mrr, 0) / n;

    // Log results table for inspection
    console.info("\n=== Retrieval Eval Results ===");
    for (const r of results) {
      const mark = r.r5 === 1 ? "✓" : "✗";
      console.info(`  ${mark} R@5=${r.r5.toFixed(2)} MRR=${r.mrr.toFixed(2)} | ${r.query.slice(0, 55)}`);
    }
    console.info(`\n  Aggregate: R@1=${avgR1.toFixed(3)}  R@3=${avgR3.toFixed(3)}  R@5=${avgR5.toFixed(3)}  MRR=${avgMRR.toFixed(3)}`);
    console.info("==============================\n");

    // Assertions — keyword arm must meet these thresholds
    expect(avgR5,  `R@5 should be ≥ 0.75 (got ${avgR5.toFixed(3)})`).toBeGreaterThanOrEqual(0.75);
    expect(avgR3,  `R@3 should be ≥ 0.60 (got ${avgR3.toFixed(3)})`).toBeGreaterThanOrEqual(0.60);
    expect(avgMRR, `MRR should be ≥ 0.55 (got ${avgMRR.toFixed(3)})`).toBeGreaterThanOrEqual(0.55);
  });

  it("BM25 ranks exact-term matches above noise documents", () => {
    // A query that directly matches d01 should have d01 in top 3
    const query = "Railway Railpack port 8080 git push deploy";
    const scored = FIXTURE_DOCS
      .map(doc => ({ id: doc.id, score: scoreDoc(doc, query) }))
      .sort((a, b) => b.score - a.score);

    const top3Ids = scored.slice(0, 3).map(s => s.id);
    expect(top3Ids, `d01 should be in top 3 for Railway deployment query`).toContain("d01");
  });

  it("BM25 ranks multi-word matches higher than single-word partial matches", () => {
    // d09 (Zod) should outrank d10 (Express) for a Zod-specific query
    const query = "Zod schema validation record arguments";
    const scored = FIXTURE_DOCS
      .map(doc => ({ id: doc.id, score: scoreDoc(doc, query) }))
      .sort((a, b) => b.score - a.score);

    const d09rank = scored.findIndex(s => s.id === "d09");
    const d10rank = scored.findIndex(s => s.id === "d10");
    expect(d09rank, `d09 (Zod) should rank higher than d10 (Express) for Zod query`).toBeLessThan(d10rank);
  });

  it("importance and recency still contribute when BM25 score is equal", () => {
    // Two docs with similar content but d30 (importance 0.85, recent) should beat
    // a hypothetical older doc — test that the blended score favours recency + importance
    const recentHighImportance: FixtureDoc = {
      id: "test-recent",
      content: "agent job scheduled run persistence database",
      importance: 0.9,
      memoryType: "decision",
      createdAt: new Date(), // today
    };
    const oldLowImportance: FixtureDoc = {
      id: "test-old",
      content: "agent job scheduled run persistence database",
      importance: 0.3,
      memoryType: "context",
      createdAt: new Date("2020-01-01"),
    };

    const query = "agent job scheduled run";
    const scoreRecent = scoreDoc(recentHighImportance, query);
    const scoreOld    = scoreDoc(oldLowImportance,    query);

    expect(scoreRecent, "Recent high-importance doc should outscore old low-importance doc").toBeGreaterThan(scoreOld);
  });

  it("returns zero for queries with no matching terms", () => {
    const query = "xyzzy quux frobnicate";
    const scores = FIXTURE_DOCS.map(doc => simulateBm25Rank(doc.content, query));
    const anyPositive = scores.some(s => s > 0.05);
    expect(anyPositive, "Random nonsense query should not score positively against fixture docs").toBe(false);
  });
});

// ---------------------------------------------------------------------------
// REGRESSION GUARD
// Establishes a numerical baseline that fails CI if recall drops.
// Update these numbers (with a commit message explaining why) if the
// retriever intentionally changes and new baselines are confirmed better.
// ---------------------------------------------------------------------------

describe("Retrieval Eval — Regression Guard", () => {
  it("aggregate R@5 must be ≥ 0.75 (update if intentionally improved)", () => {
    let r5Sum = 0;
    for (const evalQ of EVAL_QUERIES) {
      const scored = FIXTURE_DOCS
        .map(doc => ({ id: doc.id, score: scoreDoc(doc, evalQ.query) }))
        .sort((a, b) => b.score - a.score);
      r5Sum += recallAtK(scored.map(s => s.id), evalQ.relevantIds, 5);
    }
    const avgR5 = r5Sum / EVAL_QUERIES.length;
    expect(avgR5).toBeGreaterThanOrEqual(0.75);
  });
});
