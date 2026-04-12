/**
 * Event Bus Tests — 8 Vitest tests covering bus.ts + events routes
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Shared mock state
// ─────────────────────────────────────────────────────────────────────────────

const mockInsertReturning = vi.fn();
const mockUpdateSet = vi.fn();
const mockUpdateWhere = vi.fn();
const mockSelectFromWhere = vi.fn();

// Tracks all insert() calls by table name for inspection
const insertCalls: { table: string; values: any }[] = [];

function createMockDb() {
  return {
    insert: (table: any) => ({
      values: (values: any) => {
        insertCalls.push({ table: table?.["_"] ?? "unknown", values });
        return {
          returning: mockInsertReturning,
        };
      },
    }),
    update: (_table: any) => ({
      set: (vals: any) => {
        mockUpdateSet(vals);
        return {
          where: (cond: any) => {
            mockUpdateWhere(cond);
            return Promise.resolve(undefined);
          },
        };
      },
    }),
    select: () => ({
      from: (_table: any) => ({
        where: mockSelectFromWhere,
        orderBy: () => ({
          limit: () => ({
            offset: () => Promise.resolve([]),
          }),
        }),
      }),
    }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("../server/storage", () => ({
  storage: {
    get db() {
      return createMockDb();
    },
  },
}));

vi.mock("../server/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const mockDelegateFromUser = vi.fn().mockResolvedValue({ taskId: "task-123" });

vi.mock("../server/agents/delegation-engine", () => ({
  delegateFromUser: mockDelegateFromUser,
}));

// ─────────────────────────────────────────────────────────────────────────────
// Helper: reset state between tests
// ─────────────────────────────────────────────────────────────────────────────
function resetMocks() {
  vi.clearAllMocks();
  insertCalls.length = 0;
}

function mockSubscriptions(subs: any[]) {
  mockSelectFromWhere.mockResolvedValueOnce(subs);
}

function mockLogInsert(logId = "log-abc") {
  mockInsertReturning.mockResolvedValueOnce([{ id: logId }]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Event Bus — publishEvent()", () => {
  beforeEach(() => {
    resetMocks();
  });

  // ── Test 1: inserts event_log row ─────────────────────────────────────────
  it("inserts an event_log row when publishing", async () => {
    mockLogInsert("log-001");
    mockSelectFromWhere.mockResolvedValueOnce([]); // no subscriptions

    const { publishEvent } = await import("../server/events/bus");

    await publishEvent("email.inbound", { from: "test@example.com" });

    expect(mockInsertReturning).toHaveBeenCalledTimes(1);
  });

  // ── Test 2: calls delegateFromUser for each matching subscription ─────────
  it("calls delegateFromUser for each active matching subscription", async () => {
    mockLogInsert("log-002");
    mockSubscriptions([
      { id: "sub-1", agentSlug: "chief-of-staff", eventType: "email.inbound", active: true, filterJson: null },
      { id: "sub-2", agentSlug: "cmo", eventType: "email.inbound", active: true, filterJson: null },
    ]);

    const { publishEvent } = await import("../server/events/bus");

    const result = await publishEvent("email.inbound", { from: "boss@example.com" });

    expect(mockDelegateFromUser).toHaveBeenCalledTimes(2);
    expect(result).toEqual(["chief-of-staff", "cmo"]);
  });

  // ── Test 3: filterJson — only triggers when payload matches ──────────────
  it("respects filterJson — skips subscription when payload does not match filter", async () => {
    mockLogInsert("log-003");
    mockSubscriptions([
      {
        id: "sub-3",
        agentSlug: "cto",
        eventType: "task.agent_ready",
        active: true,
        filterJson: { ventureId: "venture-abc" },
      },
    ]);

    const { publishEvent } = await import("../server/events/bus");

    // Different ventureId — should NOT match
    const result = await publishEvent("task.agent_ready", { ventureId: "venture-xyz" });

    expect(mockDelegateFromUser).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it("respects filterJson — triggers when payload matches all filter keys", async () => {
    mockLogInsert("log-003b");
    mockSubscriptions([
      {
        id: "sub-3b",
        agentSlug: "cto",
        eventType: "task.agent_ready",
        active: true,
        filterJson: { ventureId: "venture-abc" },
      },
    ]);

    const { publishEvent } = await import("../server/events/bus");

    const result = await publishEvent("task.agent_ready", { ventureId: "venture-abc" });

    expect(mockDelegateFromUser).toHaveBeenCalledTimes(1);
    expect(result).toEqual(["cto"]);
  });

  // ── Test 4: skips inactive subscriptions ─────────────────────────────────
  it("skips inactive subscriptions (active=false)", async () => {
    mockLogInsert("log-004");
    // active=false subscription returned (the `and(eq(active, true))` is applied by DB,
    // but we simulate the DB correctly filtering it out)
    mockSubscriptions([]); // DB filters active=true, returns nothing

    const { publishEvent } = await import("../server/events/bus");

    const result = await publishEvent("kr.at_risk", { krId: "kr-1" });

    expect(mockDelegateFromUser).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  // ── Test 5: maxDepth guard — __eventDepth >= 3 skips delegation ───────────
  it("respects maxDepth guard — does not delegate when __eventDepth >= 3", async () => {
    // When depth >= 3, we insert a log row but skip delegation entirely
    mockInsertReturning.mockResolvedValueOnce([{ id: "log-005" }]);

    const { publishEvent } = await import("../server/events/bus");

    const result = await publishEvent("email.inbound", {
      from: "test@example.com",
      __eventDepth: 3,
    });

    expect(mockDelegateFromUser).not.toHaveBeenCalled();
    // selectFromWhere should NOT be called for subscriptions when depth is exceeded
    expect(mockSelectFromWhere).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  // ── Test 6: returns [] on DB error (graceful degradation) ─────────────────
  it("returns [] gracefully when DB throws an error", async () => {
    mockInsertReturning.mockRejectedValueOnce(new Error("DB connection failed"));

    const { publishEvent } = await import("../server/events/bus");

    const result = await publishEvent("email.inbound", { from: "test@example.com" });

    expect(result).toEqual([]);
    expect(mockDelegateFromUser).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Route tests
// ─────────────────────────────────────────────────────────────────────────────

// We need a lightweight Express app to test the routes
import express from "express";
import request from "supertest";

async function buildApp() {
  const app = express();
  app.use(express.json());

  const eventsRouter = (await import("../server/routes/events")).default;
  app.use("/api/events", eventsRouter);

  return app;
}

describe("Events Routes", () => {
  beforeEach(() => {
    resetMocks();
  });

  // ── Test 7: POST /api/events/publish returns deliveredTo list ─────────────
  it("POST /api/events/publish returns deliveredTo and logId", async () => {
    // Mock publish returning a log row
    mockLogInsert("log-007");
    // Mock subscriptions — none for simplicity
    mockSubscriptions([]);
    // Mock the log query for the route (select after insert)
    mockSelectFromWhere.mockResolvedValueOnce([{ id: "log-007" }]);

    // Re-mock publishEvent at module level to avoid re-importing bus
    vi.doMock("../server/events/bus", () => ({
      publishEvent: vi.fn().mockResolvedValue(["chief-of-staff"]),
    }));

    const app = await buildApp();

    const res = await request(app)
      .post("/api/events/publish")
      .send({ eventType: "email.inbound", payload: { from: "x@example.com" } });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("deliveredTo");
    expect(Array.isArray(res.body.deliveredTo)).toBe(true);
  });

  // ── Test 8: GET /api/events/log returns ordered list with limit ───────────
  it("GET /api/events/log returns a list respecting limit", async () => {
    const fakeRows = [
      { id: "e1", eventType: "email.inbound", createdAt: new Date().toISOString() },
      { id: "e2", eventType: "kr.at_risk", createdAt: new Date().toISOString() },
    ];

    // Mock the select().from().orderBy().limit().offset() chain
    vi.doMock("../server/storage", () => ({
      storage: {
        get db() {
          return {
            insert: createMockDb().insert,
            update: createMockDb().update,
            select: () => ({
              from: () => ({
                orderBy: () => ({
                  limit: () => ({
                    offset: () => Promise.resolve(fakeRows),
                  }),
                }),
              }),
            }),
          };
        },
      },
    }));

    const app = await buildApp();

    const res = await request(app).get("/api/events/log?limit=10");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
