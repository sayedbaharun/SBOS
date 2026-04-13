/**
 * Scheduled Job Events Tests
 *
 * Verifies that `daily_briefing`, `evening_review`, and `github_actions_sha_audit`
 * handlers publish the correct events via `publishEvent` when they complete.
 *
 * Strategy:
 * - Mock publishEvent to capture calls
 * - Mock all heavy dependencies (storage, executeAgentChat, Telegram, etc.)
 *   so handlers run to completion without real I/O
 * - Call executeScheduledJob(agentId, agentSlug, jobName) and assert on publishEvent args
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Core mock: publishEvent — must be set up BEFORE importing scheduled-jobs
// ─────────────────────────────────────────────────────────────────────────────

const mockPublishEvent = vi.fn().mockResolvedValue([]);

vi.mock("../server/events/bus", () => ({
  publishEvent: mockPublishEvent,
}));

// ─────────────────────────────────────────────────────────────────────────────
// Storage mock
// ─────────────────────────────────────────────────────────────────────────────

const mockDb = {
  select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
  insert: (_t: any) => ({ values: (_v: any) => ({ onConflictDoUpdate: () => Promise.resolve() }) }),
};

vi.mock("../server/storage", () => ({
  storage: {
    get db() { return mockDb; },
    getTasks: vi.fn().mockResolvedValue([]),
    getDayOrCreate: vi.fn().mockResolvedValue({
      id: "day_2026-04-13",
      date: "2026-04-13",
      top3Outcomes: [],
      reflectionPm: null,
      eveningRituals: null,
      morningRituals: null,
    }),
    getHealthEntries: vi.fn().mockResolvedValue([]),
    getVentures: vi.fn().mockResolvedValue([]),
  },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Logger mock
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("../server/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─────────────────────────────────────────────────────────────────────────────
// agent-runtime mock (executeAgentChat)
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("../server/agents/agent-runtime", () => ({
  executeAgentChat: vi.fn().mockResolvedValue({
    response: "Mocked briefing response for testing purposes.",
    tokensUsed: 100,
  }),
}));

// ─────────────────────────────────────────────────────────────────────────────
// report-generator mock (dailyBriefing, weeklySummary, ventureStatus)
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("../server/agents/tools/report-generator", () => ({
  dailyBriefing: vi.fn().mockResolvedValue({
    result: JSON.stringify({
      report: "Daily report data",
      oneThing: "Ship the feature",
      taskSummary: "5 tasks",
      urgentCount: 0,
    }),
  }),
  weeklySummary: vi.fn().mockResolvedValue({
    result: JSON.stringify({ report: "Weekly report" }),
  }),
  ventureStatus: vi.fn().mockResolvedValue({
    result: JSON.stringify({ report: "Venture status" }),
  }),
}));

// ─────────────────────────────────────────────────────────────────────────────
// conversation-manager mock (getAllAgentActivity)
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("../server/agents/conversation-manager", () => ({
  getAllAgentActivity: vi.fn().mockResolvedValue([]),
}));

// ─────────────────────────────────────────────────────────────────────────────
// message-bus mock
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("../server/agents/message-bus", () => ({
  messageBus: {
    broadcast: vi.fn(),
    subscribe: vi.fn(),
  },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Telegram / channel-manager mocks (lazy imports inside handlers)
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("../server/channels/channel-manager", () => ({
  sendProactiveMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../server/channels/adapters/telegram-adapter", () => ({
  getAuthorizedChatIds: vi.fn().mockReturnValue(["123456"]),
}));

// ─────────────────────────────────────────────────────────────────────────────
// intelligence-synthesizer mock (lazy import inside daily_briefing)
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("../server/agents/intelligence-synthesizer", () => ({
  runDailyIntelligence: vi.fn().mockResolvedValue({
    synthesis: "Intelligence synthesis",
    conflicts: [],
    priorities: [],
  }),
}));

// ─────────────────────────────────────────────────────────────────────────────
// syntheliq-client mock (lazy import inside daily_briefing)
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("../server/integrations/syntheliq-client.js", () => ({
  getSyntheliqDashboard: vi.fn().mockResolvedValue({
    health: true,
    pipeline: {},
    runs: [],
  }),
}));

// ─────────────────────────────────────────────────────────────────────────────
// shared schema mock (lazy import for dailyBriefs upsert)
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("@shared/schema", async (importOriginal) => {
  const original = await importOriginal<typeof import("@shared/schema")>();
  return {
    ...original,
    dailyBriefs: { date: "date" },
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// drizzle-orm sql mock (lazy import inside daily_briefing)
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("drizzle-orm", async (importOriginal) => {
  const original = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...original,
    sql: vi.fn((strings: TemplateStringsArray, ...values: any[]) => `sql(${strings.join("")})`),
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// utils/dates mock
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("../server/utils/dates", () => ({
  getUserDate: vi.fn().mockReturnValue("2026-04-13"),
}));

// ─────────────────────────────────────────────────────────────────────────────
// infra/telegram-format mock
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("../server/infra/telegram-format", () => ({
  msgHeader: vi.fn((_icon: string, title: string) => title),
  msgSection: vi.fn((_icon: string, title: string, items: string[]) => `${title}: ${items.join(", ")}`),
  msgTruncate: vi.fn((text: string) => text),
  formatMessage: vi.fn((opts: any) => JSON.stringify(opts)),
  escapeHtml: vi.fn((text: string) => text),
}));

// ─────────────────────────────────────────────────────────────────────────────
// GitHub fetch mock (for sha audit)
// ─────────────────────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ─────────────────────────────────────────────────────────────────────────────
// Import the module under test AFTER all mocks are set up
// ─────────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line import/first
import { executeScheduledJob } from "../server/agents/scheduled-jobs";
import { seedDefaultEventSubscriptions } from "../server/events/seed-subscriptions";

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Scheduled Job → publishEvent wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPublishEvent.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Test 1: daily_briefing publishes brief.morning.ready ──────────────────
  it('daily_briefing: calls publishEvent with "brief.morning.ready" after completing', async () => {
    await executeScheduledJob("agent-id-1", "chief-of-staff", "daily_briefing");

    const calls = mockPublishEvent.mock.calls;
    const morningReadyCall = calls.find(([eventType]: [string]) => eventType === "brief.morning.ready");

    expect(morningReadyCall).toBeDefined();
    const [, payload] = morningReadyCall!;
    expect(payload).toHaveProperty("date");
    expect(payload).toHaveProperty("summary");
    expect(typeof payload.summary).toBe("string");
    expect(payload.summary.length).toBeLessThanOrEqual(500);
  });

  // ── Test 2: evening_review publishes brief.evening.ready ─────────────────
  it('evening_review: calls publishEvent with "brief.evening.ready" after completing', async () => {
    // evening_review skips when all outcomes done + no open tasks
    // We need at least one in-progress task to prevent early return

    const { storage } = await import("../server/storage");
    (storage.getTasks as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "task-1",
        title: "Pending task",
        status: "in_progress",
        focusDate: "2026-04-13",
        dueDate: "2026-04-13",
        completedAt: null,
        updatedAt: new Date().toISOString(),
      },
    ]);

    await executeScheduledJob("agent-id-2", "chief-of-staff", "evening_review");

    const calls = mockPublishEvent.mock.calls;
    const eveningReadyCall = calls.find(([eventType]: [string]) => eventType === "brief.evening.ready");

    expect(eveningReadyCall).toBeDefined();
    const [, payload] = eveningReadyCall!;
    expect(payload).toHaveProperty("date");
    expect(payload.date).toBe("2026-04-13");
  });

  // ── Test 3: github_actions_sha_audit publishes audit.security.completed ───
  it('github_actions_sha_audit: calls publishEvent with "audit.security.completed" when issues found', async () => {
    // Simulate GitHub API returning a workflow file with unpinned action
    const workflowContent = `
on: push
jobs:
  build:
    steps:
      - uses: actions/checkout@v3
`;
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([{ name: "ci.yml", download_url: "https://raw.github.com/ci.yml" }]),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(workflowContent),
      } as any);

    // Only one repo check — remaining repos return 404
    mockFetch.mockResolvedValue({ ok: false } as any);

    await executeScheduledJob("agent-id-3", "security-agent", "github_actions_sha_audit");

    const calls = mockPublishEvent.mock.calls;
    const auditCall = calls.find(([eventType]: [string]) => eventType === "audit.security.completed");

    expect(auditCall).toBeDefined();
    const [, payload] = auditCall!;
    expect(payload).toHaveProperty("unpinnedCount");
    expect(typeof payload.unpinnedCount).toBe("number");
    expect(payload.unpinnedCount).toBeGreaterThan(0);
    expect(payload).toHaveProperty("date");
  });

  // ── Test 4: github_actions_sha_audit publishes event even when all pinned ─
  it('github_actions_sha_audit: calls publishEvent with unpinnedCount=0 when all actions are SHA-pinned', async () => {
    // All repo fetches return 404 (no workflow files) → issues stays empty
    mockFetch.mockResolvedValue({ ok: false } as any);

    await executeScheduledJob("agent-id-4", "security-agent", "github_actions_sha_audit");

    const calls = mockPublishEvent.mock.calls;
    const auditCall = calls.find(([eventType]: [string]) => eventType === "audit.security.completed");

    expect(auditCall).toBeDefined();
    const [, payload] = auditCall!;
    expect(payload.unpinnedCount).toBe(0);
    expect(payload).toHaveProperty("date");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Seed subscriptions tests
//
// seedDefaultEventSubscriptions uses the module-level storage mock (mockDb).
// We spy on mockDb.insert to capture which event types get seeded.
// The module-level select mock returns [] (no existing subscription), so all
// entries in defaultSubscriptions will trigger an insert call.
// ─────────────────────────────────────────────────────────────────────────────

describe("seedDefaultEventSubscriptions — new entries", () => {
  // Collect inserts via a spy on the module-level mockDb
  const insertedValues: { eventType: string; agentSlug: string }[] = [];

  beforeEach(() => {
    insertedValues.length = 0;
    // Override mockDb.insert to capture values; select returns [] (no existing)
    mockDb.select = () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve([]) }),
      }),
    }) as any;
    mockDb.insert = (_table: any) => ({
      values: (values: any) => {
        insertedValues.push({ eventType: values.eventType, agentSlug: values.agentSlug });
        return Promise.resolve();
      },
    }) as any;
  });

  it('includes "audit.security.completed" → chief-of-staff subscription', async () => {
    await seedDefaultEventSubscriptions();

    const eventTypes = insertedValues.map((r) => r.eventType);
    expect(eventTypes).toContain("audit.security.completed");
    const entry = insertedValues.find((r) => r.eventType === "audit.security.completed");
    expect(entry?.agentSlug).toBe("chief-of-staff");
  });

  it('includes "morning.loop.completed" → chief-of-staff subscription', async () => {
    await seedDefaultEventSubscriptions();

    const eventTypes = insertedValues.map((r) => r.eventType);
    expect(eventTypes).toContain("morning.loop.completed");
    const entry = insertedValues.find((r) => r.eventType === "morning.loop.completed");
    expect(entry?.agentSlug).toBe("chief-of-staff");
  });

  it('does NOT include default subscriber for "brief.morning.ready" or "brief.evening.ready"', async () => {
    // These event types are intentionally left without a default subscriber —
    // they are hook points for user-defined subscriptions only.
    await seedDefaultEventSubscriptions();

    const eventTypes = insertedValues.map((r) => r.eventType);
    expect(eventTypes).not.toContain("brief.morning.ready");
    expect(eventTypes).not.toContain("brief.evening.ready");

    // Sanity check: the 5 expected default subs are all present
    expect(eventTypes).toContain("task.agent_ready");
    expect(eventTypes).toContain("review.rejected");
    expect(eventTypes).toContain("kr.at_risk");
    expect(eventTypes).toContain("audit.security.completed");
    expect(eventTypes).toContain("morning.loop.completed");
  });
});
