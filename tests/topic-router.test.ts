/**
 * topic-router.test.ts
 *
 * Tests for the Telegram topic routing logic.
 * Uses vi.doMock to inject a fake DB without touching the real database.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Shared mock state ─────────────────────────────────────────────────────────

let mockRows: any[] = [];

// ── Module mocks (must be before any import of the module under test) ─────────

function buildDbMock() {
  return {
    select: () => ({
      from: () => ({
        // .where() must be awaitable (Promise) AND support .limit()
        where: (..._args: any[]) => {
          const p = Promise.resolve(mockRows) as any;
          p.limit = (_n: number) => Promise.resolve(mockRows);
          return p;
        },
      }),
    }),
  };
}

vi.mock("../server/storage", () => ({
  storage: {
    get db() { return buildDbMock(); },
  },
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: vi.fn((_col, _val) => `eq:${_val}`),
    and: vi.fn((...args) => `and(${args.join(",")})`),
    sql: actual.sql ?? vi.fn((parts: any, ...vals: any[]) => `sql:${parts[0]}${vals[0]}`),
  };
});

vi.mock("@shared/schema", () => ({
  telegramTopicMap: {
    active: "active_col",
    topicKey: "topicKey_col",
    eventTypes: "eventTypes_col",
  },
}));

// ── Import after mocks ────────────────────────────────────────────────────────

const { resolveTopic, resolveTopicByKey } = await import(
  "../server/channels/topic-router"
);

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRow(overrides: Partial<{
  topicKey: string;
  threadId: number;
  ventureId: string | null;
  eventTypes: string[];
  active: boolean;
}>): any {
  return {
    topicKey: "morning-loop",
    threadId: 42,
    ventureId: null,
    eventTypes: ["brief.morning.ready"],
    active: true,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("resolveTopic", () => {
  beforeEach(() => {
    mockRows = [];
    vi.clearAllMocks();
  });

  it("returns undefined when no matching rows exist", async () => {
    mockRows = [];
    const result = await resolveTopic("brief.morning.ready");
    expect(result).toBeUndefined();
  });

  it("returns threadId of the matching global row", async () => {
    mockRows = [makeRow({ threadId: 101, eventTypes: ["brief.morning.ready"] })];
    const result = await resolveTopic("brief.morning.ready");
    expect(result).toBe(101);
  });

  it("prefers venture-scoped row when ventureId in payload matches", async () => {
    const globalRow = makeRow({
      topicKey: "morning-loop",
      threadId: 10,
      ventureId: null,
      eventTypes: ["venture.update"],
    });
    const ventureRow = makeRow({
      topicKey: "venture:syntheliq",
      threadId: 99,
      ventureId: "venture-uuid-123",
      eventTypes: ["venture.update"],
    });
    mockRows = [globalRow, ventureRow];

    const result = await resolveTopic("venture.update", { ventureId: "venture-uuid-123" });
    expect(result).toBe(99);
  });

  it("falls back to global row when ventureId in payload does not match any venture topic", async () => {
    mockRows = [
      makeRow({ topicKey: "morning-loop", threadId: 10, ventureId: null, eventTypes: ["venture.update"] }),
    ];
    const result = await resolveTopic("venture.update", { ventureId: "other-id" });
    expect(result).toBe(10);
  });

  it("returns undefined and does not throw when DB returns null", async () => {
    mockRows = null as any;
    const result = await resolveTopic("brief.morning.ready");
    expect(result).toBeUndefined();
  });
});

describe("resolveTopicByKey", () => {
  beforeEach(() => {
    mockRows = [];
    vi.clearAllMocks();
  });

  it("returns threadId for a matching topicKey", async () => {
    mockRows = [makeRow({ topicKey: "morning-loop", threadId: 42 })];
    const result = await resolveTopicByKey("morning-loop");
    expect(result).toBe(42);
  });

  it("returns undefined when topicKey is not found", async () => {
    mockRows = [];
    const result = await resolveTopicByKey("nonexistent-key");
    expect(result).toBeUndefined();
  });

  it("returns undefined when DB returns null", async () => {
    mockRows = null as any;
    const result = await resolveTopicByKey("morning-loop");
    expect(result).toBeUndefined();
  });
});
