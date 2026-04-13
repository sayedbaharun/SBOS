/**
 * Proactive Morning Loop — Vitest unit tests
 *
 * All external dependencies are mocked:
 *   - storage (getTasks + updateTask)
 *   - approval-policy-evaluator (evaluatePolicy)
 *   - delegation-engine (delegateFromUser)
 *   - channel-manager + telegram-adapter (Telegram send)
 *   - events/bus (publishEvent)
 *   - @shared/schema dailyBriefs (DB select)
 *   - drizzle-orm desc
 *
 * Pattern follows approval-policy.test.ts — vi.resetModules() + vi.doMock()
 * so the lazy `db` handle is fresh per test.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Task factory
// ---------------------------------------------------------------------------

function makeTask(overrides: Record<string, any> = {}) {
  return {
    id: "task-" + Math.random().toString(36).slice(2),
    title: "Test Task",
    status: "next",
    notes: null,
    tags: [] as string[],
    priority: "P2",
    ventureId: null,
    updatedAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Minimal mock DB (used for dailyBriefs query)
// ---------------------------------------------------------------------------

function makeMockDb(briefRows: any[] = []) {
  return {
    select: () => ({
      from: () => ({
        orderBy: () => ({
          limit: vi.fn().mockResolvedValue(briefRows),
        }),
      }),
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runProactiveMorningLoop", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  // ── 1. Non-agent-ready tasks are skipped ────────────────────────────────
  it("skips tasks that do not have the 'agent-ready' tag", async () => {
    const delegateFn = vi.fn().mockResolvedValue({ taskId: "t1" });
    const sendFn = vi.fn().mockResolvedValue(undefined);
    const publishFn = vi.fn().mockResolvedValue([]);

    vi.doMock("../server/storage", () => ({
      storage: {
        db: makeMockDb([]),
        getTasks: vi.fn().mockResolvedValue([
          makeTask({ tags: [], title: "No tag task" }),
          makeTask({ tags: ["other-tag"], title: "Wrong tag task" }),
        ]),
        updateTask: vi.fn(),
      },
    }));
    vi.doMock("../server/agents/approval-policy-evaluator", () => ({
      evaluatePolicy: vi.fn().mockResolvedValue({ autoApprove: true }),
    }));
    vi.doMock("../server/agents/delegation-engine", () => ({
      delegateFromUser: delegateFn,
    }));
    vi.doMock("../server/channels/channel-manager", () => ({
      sendProactiveMessage: sendFn,
    }));
    vi.doMock("../server/channels/adapters/telegram-adapter", () => ({
      getAuthorizedChatIds: () => ["chat-1"],
    }));
    vi.doMock("../server/events/bus", () => ({
      publishEvent: publishFn,
    }));
    vi.doMock("@shared/schema", () => ({
      dailyBriefs: { _: "daily_briefs" },
    }));
    vi.doMock("drizzle-orm", () => ({
      desc: vi.fn((col) => col),
    }));

    const { runProactiveMorningLoop } = await import(
      "../server/agents/proactive-loop"
    );
    await runProactiveMorningLoop();

    // delegateFromUser must NOT have been called
    expect(delegateFn).not.toHaveBeenCalled();

    // Telegram is still sent (once)
    expect(sendFn).toHaveBeenCalledTimes(1);
  });

  // ── 2. agent-ready + matching policy → delegated ───────────────────────
  it("delegates tasks with 'agent-ready' tag when policy auto-approves", async () => {
    const task = makeTask({
      id: "task-delegate-me",
      title: "Write weekly report",
      tags: ["agent-ready"],
      notes: "suggested agent: script-writer-syntheliq",
      ventureId: "v-123",
    });

    const delegateFn = vi
      .fn()
      .mockResolvedValue({ taskId: "agent-task-99" });
    const updateTaskFn = vi.fn().mockResolvedValue(task);
    const sendFn = vi.fn().mockResolvedValue(undefined);
    const publishFn = vi.fn().mockResolvedValue([]);
    const evaluateFn = vi
      .fn()
      .mockResolvedValue({ autoApprove: true, matchedPolicyId: "pol-1" });

    vi.doMock("../server/storage", () => ({
      storage: {
        db: makeMockDb([]),
        getTasks: vi.fn().mockResolvedValue([task]),
        updateTask: updateTaskFn,
      },
    }));
    vi.doMock("../server/agents/approval-policy-evaluator", () => ({
      evaluatePolicy: evaluateFn,
    }));
    vi.doMock("../server/agents/delegation-engine", () => ({
      delegateFromUser: delegateFn,
    }));
    vi.doMock("../server/channels/channel-manager", () => ({
      sendProactiveMessage: sendFn,
    }));
    vi.doMock("../server/channels/adapters/telegram-adapter", () => ({
      getAuthorizedChatIds: () => ["chat-1"],
    }));
    vi.doMock("../server/events/bus", () => ({
      publishEvent: publishFn,
    }));
    vi.doMock("@shared/schema", () => ({
      dailyBriefs: { _: "daily_briefs" },
    }));
    vi.doMock("drizzle-orm", () => ({
      desc: vi.fn((col) => col),
    }));

    const { runProactiveMorningLoop } = await import(
      "../server/agents/proactive-loop"
    );
    await runProactiveMorningLoop();

    // evaluatePolicy called with correct deliverableType + extracted slug
    expect(evaluateFn).toHaveBeenCalledWith(
      "task_execution",
      "script-writer-syntheliq",
      "v-123",
      0,
    );

    // delegateFromUser called with correct args
    expect(delegateFn).toHaveBeenCalledWith(
      "script-writer-syntheliq",
      "Write weekly report",
      "suggested agent: script-writer-syntheliq",
      2,
    );

    // task updated to in_progress with agent-assigned tag
    expect(updateTaskFn).toHaveBeenCalledWith(
      "task-delegate-me",
      expect.objectContaining({ status: "in_progress" }),
    );
    const updateCall = updateTaskFn.mock.calls[0][1];
    expect(updateCall.tags).toContain("agent-assigned");
  });

  // ── 3. agent-ready but policy says no → pending list ───────────────────
  it("puts tasks in pending when policy does not auto-approve", async () => {
    const task = makeTask({
      id: "task-pending",
      title: "Manual review task",
      tags: ["agent-ready"],
      notes: null,
    });

    const delegateFn = vi.fn();
    const sendFn = vi.fn().mockResolvedValue(undefined);
    const publishFn = vi.fn().mockResolvedValue([]);
    const evaluateFn = vi
      .fn()
      .mockResolvedValue({ autoApprove: false });

    vi.doMock("../server/storage", () => ({
      storage: {
        db: makeMockDb([]),
        getTasks: vi.fn().mockResolvedValue([task]),
        updateTask: vi.fn(),
      },
    }));
    vi.doMock("../server/agents/approval-policy-evaluator", () => ({
      evaluatePolicy: evaluateFn,
    }));
    vi.doMock("../server/agents/delegation-engine", () => ({
      delegateFromUser: delegateFn,
    }));
    vi.doMock("../server/channels/channel-manager", () => ({
      sendProactiveMessage: sendFn,
    }));
    vi.doMock("../server/channels/adapters/telegram-adapter", () => ({
      getAuthorizedChatIds: () => ["chat-1"],
    }));
    vi.doMock("../server/events/bus", () => ({
      publishEvent: publishFn,
    }));
    vi.doMock("@shared/schema", () => ({
      dailyBriefs: { _: "daily_briefs" },
    }));
    vi.doMock("drizzle-orm", () => ({
      desc: vi.fn((col) => col),
    }));

    const { runProactiveMorningLoop } = await import(
      "../server/agents/proactive-loop"
    );
    await runProactiveMorningLoop();

    // NOT delegated
    expect(delegateFn).not.toHaveBeenCalled();

    // Telegram sent with "Needs your call (1)"
    expect(sendFn).toHaveBeenCalledTimes(1);
    const sentMsg: string = sendFn.mock.calls[0][2];
    expect(sentMsg).toContain("Needs your call");
    expect(sentMsg).toContain("Manual review task");
  });

  // ── 4. Telegram sent exactly once regardless of task count ──────────────
  it("sends Telegram exactly once even with multiple tasks", async () => {
    const tasks = [
      makeTask({ tags: ["agent-ready"], title: "Task A" }),
      makeTask({ tags: ["agent-ready"], title: "Task B" }),
      makeTask({ tags: ["agent-ready"], title: "Task C" }),
    ];

    const sendFn = vi.fn().mockResolvedValue(undefined);
    const publishFn = vi.fn().mockResolvedValue([]);

    vi.doMock("../server/storage", () => ({
      storage: {
        db: makeMockDb([]),
        getTasks: vi.fn().mockResolvedValue(tasks),
        updateTask: vi.fn().mockResolvedValue({}),
      },
    }));
    vi.doMock("../server/agents/approval-policy-evaluator", () => ({
      evaluatePolicy: vi.fn().mockResolvedValue({ autoApprove: true }),
    }));
    vi.doMock("../server/agents/delegation-engine", () => ({
      delegateFromUser: vi.fn().mockResolvedValue({ taskId: "t-x" }),
    }));
    vi.doMock("../server/channels/channel-manager", () => ({
      sendProactiveMessage: sendFn,
    }));
    vi.doMock("../server/channels/adapters/telegram-adapter", () => ({
      getAuthorizedChatIds: () => ["chat-1"],
    }));
    vi.doMock("../server/events/bus", () => ({
      publishEvent: publishFn,
    }));
    vi.doMock("@shared/schema", () => ({
      dailyBriefs: { _: "daily_briefs" },
    }));
    vi.doMock("drizzle-orm", () => ({
      desc: vi.fn((col) => col),
    }));

    const { runProactiveMorningLoop } = await import(
      "../server/agents/proactive-loop"
    );
    await runProactiveMorningLoop();

    // One Telegram message (to one chat ID) — regardless of 3 tasks
    expect(sendFn).toHaveBeenCalledTimes(1);
  });

  // ── 5. publishEvent called with correct event type + counts ─────────────
  it("calls publishEvent with 'morning.loop.completed' and correct counts", async () => {
    const tasks = [
      makeTask({ tags: ["agent-ready"], title: "Auto task" }),
      makeTask({ tags: ["agent-ready"], title: "Manual task" }),
    ];

    const publishFn = vi.fn().mockResolvedValue([]);
    let callCount = 0;

    vi.doMock("../server/storage", () => ({
      storage: {
        db: makeMockDb([]),
        getTasks: vi.fn().mockResolvedValue(tasks),
        updateTask: vi.fn().mockResolvedValue({}),
      },
    }));
    vi.doMock("../server/agents/approval-policy-evaluator", () => ({
      // First task: auto-approve, second: manual
      evaluatePolicy: vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve({ autoApprove: callCount === 1 });
      }),
    }));
    vi.doMock("../server/agents/delegation-engine", () => ({
      delegateFromUser: vi.fn().mockResolvedValue({ taskId: "t-delegated" }),
    }));
    vi.doMock("../server/channels/channel-manager", () => ({
      sendProactiveMessage: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock("../server/channels/adapters/telegram-adapter", () => ({
      getAuthorizedChatIds: () => ["chat-1"],
    }));
    vi.doMock("../server/events/bus", () => ({
      publishEvent: publishFn,
    }));
    vi.doMock("@shared/schema", () => ({
      dailyBriefs: { _: "daily_briefs" },
    }));
    vi.doMock("drizzle-orm", () => ({
      desc: vi.fn((col) => col),
    }));

    const { runProactiveMorningLoop } = await import(
      "../server/agents/proactive-loop"
    );
    await runProactiveMorningLoop();

    // Give the fire-and-forget a tick to resolve
    await Promise.resolve();

    expect(publishFn).toHaveBeenCalledWith(
      "morning.loop.completed",
      expect.objectContaining({
        delegated: 1,
        pending: 1,
      }),
    );
  });
});
