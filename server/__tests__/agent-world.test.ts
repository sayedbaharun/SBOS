/**
 * Agent World State Tests
 *
 * Tests for the buildWorldState() function in server/agent-world/builder.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock the storage module before importing the builder
// ---------------------------------------------------------------------------

const mockGetAllActiveGoalsWithProgress = vi.fn();
const mockGetTasks = vi.fn();
const mockGetHealthEntryByDate = vi.fn();
const mockGetVentures = vi.fn();

// Mock drizzle query chain returned by database
function makeMockDb(countValue = 0) {
  const selectResult = [{ count: countValue }];
  const whereImpl = vi.fn().mockResolvedValue(selectResult);
  const fromImpl = vi.fn().mockReturnValue({ where: whereImpl });
  const selectImpl = vi.fn().mockReturnValue({ from: fromImpl });
  return {
    select: selectImpl,
    _whereImpl: whereImpl,
  };
}

let mockDb = makeMockDb(0);

vi.mock("../storage", () => ({
  storage: {
    getAllActiveGoalsWithProgress: (...args: unknown[]) =>
      mockGetAllActiveGoalsWithProgress(...args),
    getTasks: (...args: unknown[]) => mockGetTasks(...args),
    getHealthEntryByDate: (...args: unknown[]) =>
      mockGetHealthEntryByDate(...args),
    getVentures: (...args: unknown[]) => mockGetVentures(...args),
    get db() {
      return mockDb;
    },
  },
}));

// Mock shared schema tables (drizzle table objects only need to be truthy for where-clause usage)
vi.mock("@shared/schema", () => ({
  agentTasks: { status: "status_col" },
  tasks: { tags: "tags_col" },
}));

// Mock drizzle-orm operators
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, _val: unknown) => ({ type: "eq" })),
  sql: vi.fn((_strings: TemplateStringsArray, ..._values: unknown[]) => ({
    type: "sql",
  })),
}));

// Mock date utility
vi.mock("../utils/dates", () => ({
  getUserDate: () => "2026-04-12",
}));

import { buildWorldState, invalidateWorldStateCache, resetDbCache } from "../agent-world/builder";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGoal(overrides: Record<string, unknown> = {}) {
  return {
    id: "goal-1",
    ventureId: "venture-1",
    venture: { id: "venture-1", name: "Test Venture", slug: "test", icon: null, color: null, status: "active" },
    targetStatement: "Reach $10k MRR",
    period: "2026-Q2",
    status: "on_track",
    keyResults: [
      {
        id: "kr-1",
        title: "First KR",
        currentValue: 5000,
        targetValue: 10000,
        unit: "USD",
        status: "on_track",
      },
    ],
    ...overrides,
  };
}

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-1",
    title: "Ship feature",
    priority: "P1",
    status: "in_progress",
    ventureId: "venture-1",
    focusDate: "2026-04-12",
    ...overrides,
  };
}

function makeHealth(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    date: "2026-04-12",
    energyLevel: 4,
    sleepHours: 7.5,
    workoutDone: true,
    mood: "high",
    ...overrides,
  };
}

function makeVenture(overrides: Record<string, unknown> = {}) {
  return {
    id: "venture-1",
    name: "SB-OS",
    status: "active",
    domain: "saas",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildWorldState()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateWorldStateCache();
    resetDbCache();
    mockDb = makeMockDb(0);

    // Default: return empty arrays so tests don't fail on missing mock setup
    mockGetAllActiveGoalsWithProgress.mockResolvedValue([]);
    mockGetTasks.mockResolvedValue([]);
    mockGetHealthEntryByDate.mockResolvedValue(undefined);
    mockGetVentures.mockResolvedValue([]);
  });

  // -------------------------------------------------------------------------
  // 1. Response shape has all required fields
  // -------------------------------------------------------------------------
  it("returns all required top-level fields", async () => {
    const state = await buildWorldState();

    expect(state).toHaveProperty("generatedAt");
    expect(state).toHaveProperty("date");
    expect(state).toHaveProperty("activeGoals");
    expect(state).toHaveProperty("topTasks");
    expect(state).toHaveProperty("health");
    expect(state).toHaveProperty("openReviews");
    expect(state).toHaveProperty("agentReadyTasks");
    expect(state).toHaveProperty("ventures");
  });

  it("date field matches Dubai date", async () => {
    const state = await buildWorldState();
    expect(state.date).toBe("2026-04-12");
  });

  it("generatedAt is a valid ISO timestamp string", async () => {
    const state = await buildWorldState();
    expect(() => new Date(state.generatedAt)).not.toThrow();
    expect(new Date(state.generatedAt).toISOString()).toBeTruthy();
  });

  it("maps goals correctly including keyResults", async () => {
    mockGetAllActiveGoalsWithProgress.mockResolvedValue([makeGoal()]);

    const state = await buildWorldState();

    expect(state.activeGoals).toHaveLength(1);
    const goal = state.activeGoals[0];
    expect(goal.id).toBe("goal-1");
    expect(goal.ventureId).toBe("venture-1");
    expect(goal.ventureName).toBe("Test Venture");
    expect(goal.targetStatement).toBe("Reach $10k MRR");
    expect(goal.period).toBe("2026-Q2");
    expect(goal.status).toBe("on_track");
    expect(goal.keyResults).toHaveLength(1);

    const kr = goal.keyResults[0];
    expect(kr.id).toBe("kr-1");
    expect(kr.title).toBe("First KR");
    expect(kr.currentValue).toBe(5000);
    expect(kr.targetValue).toBe(10000);
    expect(kr.unit).toBe("USD");
    expect(kr.status).toBe("on_track");
  });

  it("maps topTasks correctly", async () => {
    mockGetTasks.mockResolvedValue([makeTask()]);

    const state = await buildWorldState();

    expect(state.topTasks).toHaveLength(1);
    const task = state.topTasks[0];
    expect(task.id).toBe("task-1");
    expect(task.title).toBe("Ship feature");
    expect(task.priority).toBe("P1");
    expect(task.status).toBe("in_progress");
    expect(task.ventureId).toBe("venture-1");
    expect(task.focusDate).toBe("2026-04-12");
  });

  it("calls getTasks with correct status filter", async () => {
    mockGetTasks.mockResolvedValue([]);
    await buildWorldState();
    expect(mockGetTasks).toHaveBeenCalledWith({
      status: "next,in_progress",
      limit: 10,
    });
  });

  it("maps health entry when present", async () => {
    mockGetHealthEntryByDate.mockResolvedValue(makeHealth());

    const state = await buildWorldState();

    expect(state.health).not.toBeNull();
    expect(state.health?.energyLevel).toBe(4);
    expect(state.health?.sleepHours).toBe(7.5);
    expect(state.health?.workoutDone).toBe(true);
    expect(state.health?.mood).toBe("high");
  });

  it("sets health to null when no health entry exists", async () => {
    mockGetHealthEntryByDate.mockResolvedValue(undefined);

    const state = await buildWorldState();

    expect(state.health).toBeNull();
  });

  it("maps ventures correctly", async () => {
    mockGetVentures.mockResolvedValue([makeVenture()]);

    const state = await buildWorldState();

    expect(state.ventures).toHaveLength(1);
    const v = state.ventures[0];
    expect(v.id).toBe("venture-1");
    expect(v.name).toBe("SB-OS");
    expect(v.status).toBe("active");
    expect(v.domain).toBe("saas");
  });

  it("returns openReviews count from DB", async () => {
    mockDb = makeMockDb(3);

    const state = await buildWorldState();

    // Both agentTasks and tasks query use the same mock returning 3
    expect(state.openReviews).toBe(3);
  });

  it("returns agentReadyTasks count from DB", async () => {
    mockDb = makeMockDb(5);

    const state = await buildWorldState();

    expect(state.agentReadyTasks).toBe(5);
  });

  // -------------------------------------------------------------------------
  // 2. Cache returns stale data within 60s
  // -------------------------------------------------------------------------
  it("returns cached data on second call without re-fetching", async () => {
    mockGetVentures.mockResolvedValue([makeVenture()]);
    mockGetAllActiveGoalsWithProgress.mockResolvedValue([makeGoal()]);

    const first = await buildWorldState();

    // Mutate mocks — subsequent calls should NOT reflect these changes
    mockGetVentures.mockResolvedValue([makeVenture({ name: "Changed" })]);
    mockGetAllActiveGoalsWithProgress.mockResolvedValue([]);

    const second = await buildWorldState();

    expect(second.ventures[0].name).toBe("SB-OS"); // cached value
    expect(second.activeGoals).toHaveLength(1); // cached value
    expect(first).toBe(second); // same object reference from cache
  });

  it("storage methods are only called once within cache window", async () => {
    await buildWorldState();
    await buildWorldState();
    await buildWorldState();

    expect(mockGetVentures).toHaveBeenCalledTimes(1);
    expect(mockGetTasks).toHaveBeenCalledTimes(1);
  });

  it("re-fetches after cache is invalidated", async () => {
    mockGetVentures.mockResolvedValue([makeVenture()]);
    await buildWorldState();

    invalidateWorldStateCache();
    mockGetVentures.mockResolvedValue([makeVenture({ name: "Updated" })]);

    const fresh = await buildWorldState();
    expect(fresh.ventures[0].name).toBe("Updated");
    expect(mockGetVentures).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // 3. Returns 200 with empty arrays if storage returns []
  // -------------------------------------------------------------------------
  it("returns valid shape with empty arrays when storage returns nothing", async () => {
    const state = await buildWorldState();

    expect(Array.isArray(state.activeGoals)).toBe(true);
    expect(state.activeGoals).toHaveLength(0);

    expect(Array.isArray(state.topTasks)).toBe(true);
    expect(state.topTasks).toHaveLength(0);

    expect(Array.isArray(state.ventures)).toBe(true);
    expect(state.ventures).toHaveLength(0);

    expect(state.health).toBeNull();
    expect(typeof state.openReviews).toBe("number");
    expect(typeof state.agentReadyTasks).toBe("number");
  });

  it("is JSON-serializable", async () => {
    mockGetAllActiveGoalsWithProgress.mockResolvedValue([makeGoal()]);
    mockGetTasks.mockResolvedValue([makeTask()]);
    mockGetHealthEntryByDate.mockResolvedValue(makeHealth());
    mockGetVentures.mockResolvedValue([makeVenture()]);

    const state = await buildWorldState();
    expect(() => JSON.stringify(state)).not.toThrow();
    const parsed = JSON.parse(JSON.stringify(state));
    expect(parsed.date).toBe("2026-04-12");
  });
});
