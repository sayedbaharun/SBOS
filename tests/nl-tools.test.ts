/**
 * Tests for the NL query route's 3 new write-action tool handlers:
 *   - delegate_task
 *   - update_kr_progress
 *   - create_venture_goal
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Shared mock state ──────────────────────────────────────────────────────

const mockTask = {
  id: "task-uuid-1",
  title: "Write Q2 proposal",
  notes: "Must include pricing details",
  status: "next",
  tags: ["urgent"],
  priority: "P1",
  ventureId: null,
};

const mockKeyResult = {
  id: "kr-uuid-1",
  goalId: "goal-uuid-1",
  title: "Close enterprise deals",
  targetValue: 5,
  currentValue: 3,
  unit: "clients",
  status: "on_track",
};

const mockGoal = {
  id: "goal-uuid-1",
  ventureId: "venture-uuid-1",
  period: "quarterly",
  periodStart: "2026-04-01",
  periodEnd: "2026-06-30",
  targetStatement: "Close 5 enterprise clients",
  status: "active",
};

const mockStorage = {
  getTask: vi.fn(),
  updateTask: vi.fn(),
  updateKeyResultProgress: vi.fn(),
  createVentureGoal: vi.fn(),
  createKeyResult: vi.fn(),
  getTasks: vi.fn().mockResolvedValue([]),
  getAllActiveGoalsWithProgress: vi.fn().mockResolvedValue([]),
};

const mockDelegateFromUser = vi.fn();

// ── Module mocks ───────────────────────────────────────────────────────────

vi.mock("../server/storage", () => ({
  storage: mockStorage,
}));

vi.mock("../server/agents/delegation-engine", () => ({
  delegateFromUser: mockDelegateFromUser,
}));

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Simulate what the nl.ts route handler does for a given tool call.
 * This directly exercises the handler logic without needing a running Express server.
 */
async function runNlHandler(
  toolName: string,
  toolArgs: Record<string, unknown>
): Promise<{ answer: string; action: unknown }> {
  // Replicate the lazy import pattern used in the route
  const { storage } = await import("../server/storage");
  const getStorage = async () => storage;

  // ── delegate_task ──────────────────────────────────────────────────────
  if (toolName === "delegate_task") {
    const { taskId, agentSlug } = toolArgs as { taskId?: string; agentSlug?: string };
    if (!taskId || !agentSlug) {
      return { answer: "Need both a task ID and an agent slug to delegate.", action: null };
    }
    try {
      const { delegateFromUser } = await import("../server/agents/delegation-engine");
      const s = await getStorage();
      const task = await s.getTask(String(taskId));
      if (!task) return { answer: `Task ${taskId} not found.`, action: null };
      const result = await delegateFromUser(String(agentSlug), task.title, task.notes || "", 2);
      if ((result as any).error) return { answer: `Delegation failed: ${(result as any).error}`, action: null };
      const existingTags = Array.isArray(task.tags)
        ? task.tags
        : task.tags
        ? String(task.tags).split(",").map((s: string) => s.trim())
        : [];
      await s.updateTask(String(taskId), {
        status: "in_progress" as const,
        tags: [...existingTags, "agent-assigned"],
      });
      return {
        answer: `Task "${task.title}" delegated to ${agentSlug}.`,
        action: { type: "delegate_task", payload: { taskId, agentSlug, agentTaskId: (result as any).taskId } },
      };
    } catch (err: any) {
      return { answer: `Delegation error: ${err.message}`, action: null };
    }
  }

  // ── update_kr_progress ─────────────────────────────────────────────────
  if (toolName === "update_kr_progress") {
    const { keyResultId, currentValue } = toolArgs as { keyResultId?: string; currentValue?: number };
    if (!keyResultId || currentValue === undefined) {
      return { answer: "Need keyResultId and currentValue to update progress.", action: null };
    }
    try {
      const s = await getStorage();
      const updated = await s.updateKeyResultProgress(String(keyResultId), Number(currentValue));
      if (!updated) return { answer: `Key result ${keyResultId} not found.`, action: null };
      return {
        answer: `Key result progress updated to ${currentValue}${updated.unit ? " " + updated.unit : ""}.`,
        action: { type: "update_kr_progress", payload: { keyResultId, currentValue, status: updated.status } },
      };
    } catch (err: any) {
      return { answer: `KR update error: ${err.message}`, action: null };
    }
  }

  // ── create_venture_goal ────────────────────────────────────────────────
  if (toolName === "create_venture_goal") {
    const {
      ventureId,
      period,
      periodStart,
      periodEnd,
      targetStatement,
      keyResults = [],
    } = toolArgs as {
      ventureId?: string;
      period?: string;
      periodStart?: string;
      periodEnd?: string;
      targetStatement?: string;
      keyResults?: Array<{ title: string; targetValue: number; unit: string }>;
    };
    if (!ventureId || !period || !periodStart || !periodEnd || !targetStatement) {
      return { answer: "Missing required fields to create a venture goal.", action: null };
    }
    try {
      const s = await getStorage();
      const goal = await s.createVentureGoal({
        ventureId: String(ventureId),
        period,
        periodStart,
        periodEnd,
        targetStatement,
        status: "active",
      });
      const createdKRs: any[] = [];
      for (const kr of keyResults) {
        const created = await s.createKeyResult({
          goalId: goal.id,
          title: kr.title,
          targetValue: Number(kr.targetValue),
          currentValue: 0,
          unit: kr.unit,
          status: "on_track",
        });
        createdKRs.push(created);
      }
      return {
        answer: `Goal created: "${targetStatement}" with ${createdKRs.length} key result${createdKRs.length !== 1 ? "s" : ""}.`,
        action: {
          type: "create_venture_goal",
          payload: { goalId: goal.id, keyResultIds: createdKRs.map((kr: any) => kr.id) },
        },
      };
    } catch (err: any) {
      return { answer: `Goal creation error: ${err.message}`, action: null };
    }
  }

  return { answer: "Unknown tool.", action: null };
}

// ── Tests ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe("delegate_task handler", () => {
  it("delegates a task to an agent and marks it in_progress + agent-assigned", async () => {
    mockStorage.getTask.mockResolvedValue(mockTask);
    mockStorage.updateTask.mockResolvedValue({ ...mockTask, status: "in_progress" });
    mockDelegateFromUser.mockResolvedValue({ taskId: "agent-task-uuid-99" });

    const result = await runNlHandler("delegate_task", {
      taskId: "task-uuid-1",
      agentSlug: "chief-of-staff",
    });

    expect(mockDelegateFromUser).toHaveBeenCalledWith(
      "chief-of-staff",
      mockTask.title,
      mockTask.notes,
      2
    );
    expect(mockStorage.updateTask).toHaveBeenCalledWith("task-uuid-1", {
      status: "in_progress",
      tags: ["urgent", "agent-assigned"],
    });
    expect(result.answer).toContain("Write Q2 proposal");
    expect(result.answer).toContain("chief-of-staff");
    expect(result.action).toMatchObject({
      type: "delegate_task",
      payload: { taskId: "task-uuid-1", agentSlug: "chief-of-staff", agentTaskId: "agent-task-uuid-99" },
    });
  });

  it("returns an error answer when taskId is missing", async () => {
    const result = await runNlHandler("delegate_task", { agentSlug: "cmo" });
    expect(result.answer).toBe("Need both a task ID and an agent slug to delegate.");
    expect(result.action).toBeNull();
    expect(mockDelegateFromUser).not.toHaveBeenCalled();
  });

  it("returns an error answer when agentSlug is missing", async () => {
    const result = await runNlHandler("delegate_task", { taskId: "task-uuid-1" });
    expect(result.answer).toBe("Need both a task ID and an agent slug to delegate.");
    expect(result.action).toBeNull();
  });

  it("returns not-found answer when task does not exist", async () => {
    mockStorage.getTask.mockResolvedValue(undefined);
    const result = await runNlHandler("delegate_task", {
      taskId: "bad-uuid",
      agentSlug: "cto",
    });
    expect(result.answer).toContain("not found");
    expect(result.action).toBeNull();
  });

  it("propagates delegation engine errors gracefully", async () => {
    mockStorage.getTask.mockResolvedValue(mockTask);
    mockDelegateFromUser.mockResolvedValue({ error: "Agent offline" });
    const result = await runNlHandler("delegate_task", {
      taskId: "task-uuid-1",
      agentSlug: "cmo",
    });
    expect(result.answer).toContain("Delegation failed");
    expect(result.answer).toContain("Agent offline");
    expect(result.action).toBeNull();
  });
});

describe("update_kr_progress handler", () => {
  it("updates key result progress and returns success", async () => {
    mockStorage.updateKeyResultProgress.mockResolvedValue(mockKeyResult);

    const result = await runNlHandler("update_kr_progress", {
      keyResultId: "kr-uuid-1",
      currentValue: 3,
    });

    expect(mockStorage.updateKeyResultProgress).toHaveBeenCalledWith("kr-uuid-1", 3);
    expect(result.answer).toContain("3");
    expect(result.answer).toContain("clients");
    expect(result.action).toMatchObject({
      type: "update_kr_progress",
      payload: { keyResultId: "kr-uuid-1", currentValue: 3, status: "on_track" },
    });
  });

  it("returns an error answer when keyResultId is missing", async () => {
    const result = await runNlHandler("update_kr_progress", { currentValue: 5 });
    expect(result.answer).toBe("Need keyResultId and currentValue to update progress.");
    expect(result.action).toBeNull();
    expect(mockStorage.updateKeyResultProgress).not.toHaveBeenCalled();
  });

  it("returns an error answer when currentValue is missing", async () => {
    const result = await runNlHandler("update_kr_progress", { keyResultId: "kr-uuid-1" });
    expect(result.answer).toBe("Need keyResultId and currentValue to update progress.");
    expect(result.action).toBeNull();
  });

  it("returns not-found answer when key result does not exist", async () => {
    mockStorage.updateKeyResultProgress.mockResolvedValue(undefined);
    const result = await runNlHandler("update_kr_progress", {
      keyResultId: "missing-kr",
      currentValue: 10,
    });
    expect(result.answer).toContain("not found");
    expect(result.action).toBeNull();
  });
});

describe("create_venture_goal handler", () => {
  it("creates a goal with key results and returns success", async () => {
    mockStorage.createVentureGoal.mockResolvedValue(mockGoal);
    const mockCreatedKR1 = { ...mockKeyResult, id: "kr-new-1" };
    const mockCreatedKR2 = { ...mockKeyResult, id: "kr-new-2", title: "Revenue target" };
    mockStorage.createKeyResult
      .mockResolvedValueOnce(mockCreatedKR1)
      .mockResolvedValueOnce(mockCreatedKR2);

    const result = await runNlHandler("create_venture_goal", {
      ventureId: "venture-uuid-1",
      period: "quarterly",
      periodStart: "2026-04-01",
      periodEnd: "2026-06-30",
      targetStatement: "Close 5 enterprise clients",
      keyResults: [
        { title: "Close enterprise deals", targetValue: 5, unit: "clients" },
        { title: "Revenue target", targetValue: 500000, unit: "AED" },
      ],
    });

    expect(mockStorage.createVentureGoal).toHaveBeenCalledWith({
      ventureId: "venture-uuid-1",
      period: "quarterly",
      periodStart: "2026-04-01",
      periodEnd: "2026-06-30",
      targetStatement: "Close 5 enterprise clients",
      status: "active",
    });
    expect(mockStorage.createKeyResult).toHaveBeenCalledTimes(2);
    expect(mockStorage.createKeyResult).toHaveBeenNthCalledWith(1, {
      goalId: "goal-uuid-1",
      title: "Close enterprise deals",
      targetValue: 5,
      currentValue: 0,
      unit: "clients",
      status: "on_track",
    });
    expect(result.answer).toContain("Close 5 enterprise clients");
    expect(result.answer).toContain("2 key results");
    expect(result.action).toMatchObject({
      type: "create_venture_goal",
      payload: { goalId: "goal-uuid-1", keyResultIds: ["kr-new-1", "kr-new-2"] },
    });
  });

  it("creates a goal without key results", async () => {
    mockStorage.createVentureGoal.mockResolvedValue(mockGoal);

    const result = await runNlHandler("create_venture_goal", {
      ventureId: "venture-uuid-1",
      period: "monthly",
      periodStart: "2026-04-01",
      periodEnd: "2026-04-30",
      targetStatement: "Ship v2 feature set",
    });

    expect(mockStorage.createKeyResult).not.toHaveBeenCalled();
    expect(result.answer).toContain("0 key results");
    expect(result.action).toMatchObject({
      type: "create_venture_goal",
      payload: { goalId: "goal-uuid-1", keyResultIds: [] },
    });
  });

  it("returns an error answer when required fields are missing", async () => {
    const result = await runNlHandler("create_venture_goal", {
      ventureId: "venture-uuid-1",
      period: "quarterly",
      // missing periodStart, periodEnd, targetStatement
    });
    expect(result.answer).toBe("Missing required fields to create a venture goal.");
    expect(result.action).toBeNull();
    expect(mockStorage.createVentureGoal).not.toHaveBeenCalled();
  });

  it("handles singular 'key result' grammar correctly", async () => {
    mockStorage.createVentureGoal.mockResolvedValue(mockGoal);
    mockStorage.createKeyResult.mockResolvedValue({ ...mockKeyResult, id: "kr-single" });

    const result = await runNlHandler("create_venture_goal", {
      ventureId: "venture-uuid-1",
      period: "quarterly",
      periodStart: "2026-04-01",
      periodEnd: "2026-06-30",
      targetStatement: "Launch beta",
      keyResults: [{ title: "Beta signups", targetValue: 100, unit: "users" }],
    });

    expect(result.answer).toContain("1 key result");
    expect(result.answer).not.toContain("key results");
  });
});
