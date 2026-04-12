import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock DB state ────────────────────────────────────────────────────────────
let mockSelectResult: any[] = [];
const mockInsertValues = vi.fn().mockResolvedValue(undefined);

function createMockDb() {
  return {
    select: () => ({
      from: () => ({
        where: vi.fn().mockImplementation(() =>
          Promise.resolve(mockSelectResult)
        ),
      }),
    }),
    insert: () => ({ values: mockInsertValues }),
  };
}

vi.mock("../storage", () => ({
  storage: {
    get db() {
      return createMockDb();
    },
  },
}));

vi.mock("../logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Import AFTER mocks are set up
import { recordReviewFeedback } from "../review-feedback";
import { logger } from "../logger";

// ── Test helpers ─────────────────────────────────────────────────────────────
function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-uuid-123",
    assignedTo: "agent-uuid-456",
    title: "Draft Blog Post",
    deliverableType: "document",
    ...overrides,
  };
}

beforeEach(() => {
  mockSelectResult = [];
  mockInsertValues.mockClear();
  vi.mocked(logger.warn).mockClear();
  vi.mocked(logger.info).mockClear();
});

// ── Tests ────────────────────────────────────────────────────────────────────
describe("recordReviewFeedback", () => {
  it("inserts a memory row with correct fields when the agentTask exists", async () => {
    mockSelectResult = [makeTask()];

    await recordReviewFeedback("task-uuid-123", "The tone is too formal.", "rejected");

    expect(mockInsertValues).toHaveBeenCalledOnce();

    const inserted = mockInsertValues.mock.calls[0][0];
    expect(inserted.agentId).toBe("agent-uuid-456");
    expect(inserted.memoryType).toBe("learning");
    expect(inserted.importance).toBe(0.7);
    expect(inserted.scope).toBe("agent");
    expect(inserted.content).toBe(
      "[rejected] Deliverable 'Draft Blog Post' (document): The tone is too formal."
    );
    expect(inserted.tags).toEqual(["review_feedback", "rejected", "document"]);
  });

  it("inserts a memory row for changes_requested outcome", async () => {
    mockSelectResult = [makeTask({ deliverableType: "social_post", title: "Instagram Caption" })];

    await recordReviewFeedback("task-uuid-123", "Needs more emojis.", "changes_requested");

    expect(mockInsertValues).toHaveBeenCalledOnce();
    const inserted = mockInsertValues.mock.calls[0][0];
    expect(inserted.content).toBe(
      "[changes_requested] Deliverable 'Instagram Caption' (social_post): Needs more emojis."
    );
    expect(inserted.tags).toEqual(["review_feedback", "changes_requested", "social_post"]);
  });

  it("returns without throwing when the agentTask is not found", async () => {
    mockSelectResult = []; // no task

    await expect(
      recordReviewFeedback("nonexistent-id", "some feedback", "rejected")
    ).resolves.toBeUndefined();

    expect(mockInsertValues).not.toHaveBeenCalled();
    expect(vi.mocked(logger.warn)).toHaveBeenCalledOnce();
  });

  it("uses 'No feedback provided' fallback when feedback is empty string", async () => {
    mockSelectResult = [makeTask()];

    await recordReviewFeedback("task-uuid-123", "", "rejected");

    expect(mockInsertValues).toHaveBeenCalledOnce();
    const inserted = mockInsertValues.mock.calls[0][0];
    expect(inserted.content).toContain("No feedback provided");
  });

  it("uses 'No feedback provided' fallback when feedback is whitespace only", async () => {
    mockSelectResult = [makeTask()];

    await recordReviewFeedback("task-uuid-123", "   ", "rejected");

    const inserted = mockInsertValues.mock.calls[0][0];
    expect(inserted.content).toContain("No feedback provided");
  });

  it("uses 'unknown' as deliverableType when the task has no deliverableType", async () => {
    mockSelectResult = [makeTask({ deliverableType: null })];

    await recordReviewFeedback("task-uuid-123", "Needs work.", "changes_requested");

    const inserted = mockInsertValues.mock.calls[0][0];
    expect(inserted.content).toContain("(unknown)");
    expect(inserted.tags).toContain("unknown");
  });
});
