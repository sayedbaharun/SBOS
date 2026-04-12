/**
 * Tests for POST /api/nl/query
 *
 * Verifies:
 * - Response shape { answer, action }
 * - Graceful fallback when OPENAI_API_KEY is missing
 * - Tool call routing (answer_question, create_task, get_world_state)
 * - Error handling when OpenAI call fails
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createMockOpenAIClient,
  createMockOpenAIResponse,
  createMockToolCall,
} from "./test-utils";

// ── Mock storage ─────────────────────────────────────────────────────────────

const mockTasks = [
  { id: "task-1", title: "Fix auth bug", priority: "P0", status: "in_progress", ventureId: null },
  { id: "task-2", title: "Write docs", priority: "P2", status: "next", ventureId: null },
];

const mockGoals = [
  {
    id: "goal-1",
    title: "Launch SyntheLIQ v2",
    keyResults: [{ id: "kr-1" }],
    venture: { id: "v-1", name: "SyntheLIQ", slug: "syntheliq", icon: null, color: null, status: "building" },
  },
];

const mockStorage = {
  getTasks: vi.fn().mockResolvedValue(mockTasks),
  getAllActiveGoalsWithProgress: vi.fn().mockResolvedValue(mockGoals),
  createTask: vi.fn().mockResolvedValue({
    id: "task-new",
    title: "New Task",
    priority: "P2",
    status: "next",
    ventureId: null,
  }),
};

vi.mock("../storage", () => ({
  storage: mockStorage,
}));

// ── Mock OpenAI ───────────────────────────────────────────────────────────────

let mockOpenAIInstance = createMockOpenAIClient();

vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(() => mockOpenAIInstance),
}));

// ── Import route handler ──────────────────────────────────────────────────────

// We test the route module by calling its handler via a lightweight mock
// request/response — no HTTP overhead needed.

type MockRes = {
  statusCode: number;
  body: any;
  status: (code: number) => MockRes;
  json: (data: any) => MockRes;
};

function createMockRes(): MockRes {
  const res: MockRes = {
    statusCode: 200,
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(data: any) {
      this.body = data;
      return this;
    },
  };
  return res;
}

function createMockReq(body: Record<string, unknown> = {}) {
  return { body } as any;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Dynamically import the router and extract the POST /query handler.
 * We do this after mocks are set up so the module sees the mocked deps.
 */
async function getRouteHandler() {
  // Reset module registry so each test gets a fresh module with current env
  vi.resetModules();

  // Re-apply mocks after resetModules
  vi.mock("../storage", () => ({ storage: mockStorage }));
  vi.mock("openai", () => ({
    default: vi.fn().mockImplementation(() => mockOpenAIInstance),
  }));

  const mod = await import("../routes/nl");
  const router = mod.default;

  // Extract the registered POST /query handler from the router stack
  const layer = (router as any).stack.find(
    (l: any) => l.route?.path === "/query" && l.route?.methods?.post
  );

  if (!layer) throw new Error("POST /query handler not found in router stack");

  // The actual handler is the last function in the route stack
  const handlers: Function[] = layer.route.stack.map((s: any) => s.handle);
  return handlers[handlers.length - 1];
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/nl/query", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOpenAIInstance = createMockOpenAIClient();
    process.env.OPENAI_API_KEY = "sk-test-key";
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── 1. Response shape ──────────────────────────────────────────────────────

  it("always returns { answer, action } shape", async () => {
    mockOpenAIInstance.chat.completions.create.mockResolvedValueOnce(
      createMockOpenAIResponse("You have 2 active tasks.", [
        createMockToolCall("answer_question", { answer: "You have 2 active tasks." }),
      ])
    );

    const handler = await getRouteHandler();
    const req = createMockReq({ q: "What tasks do I have?" });
    const res = createMockRes();

    await handler(req, res);

    expect(res.body).toHaveProperty("answer");
    expect(res.body).toHaveProperty("action");
    expect(typeof res.body.answer).toBe("string");
  });

  // ── 2. Missing OPENAI_API_KEY ──────────────────────────────────────────────

  it("returns fallback message when OPENAI_API_KEY is not set", async () => {
    delete process.env.OPENAI_API_KEY;

    // Re-import with no key set
    vi.resetModules();
    vi.mock("../storage", () => ({ storage: mockStorage }));
    vi.mock("openai", () => ({
      default: vi.fn().mockImplementation(() => mockOpenAIInstance),
    }));

    const mod = await import("../routes/nl");
    const router = mod.default;
    const layer = (router as any).stack.find(
      (l: any) => l.route?.path === "/query" && l.route?.methods?.post
    );
    const handlers: Function[] = layer.route.stack.map((s: any) => s.handle);
    const handler = handlers[handlers.length - 1];

    const req = createMockReq({ q: "What is my top task?" });
    const res = createMockRes();

    await handler(req, res);

    expect(res.body.answer).toContain("OPENAI_API_KEY");
    expect(res.body.action).toBeNull();

    // Restore
    process.env.OPENAI_API_KEY = "sk-test-key";
  });

  // ── 3. answer_question tool call ───────────────────────────────────────────

  it("routes answer_question tool call to answer field", async () => {
    const expectedAnswer = "You have 2 active tasks: Fix auth bug and Write docs.";
    mockOpenAIInstance.chat.completions.create.mockResolvedValueOnce(
      createMockOpenAIResponse("", [
        createMockToolCall("answer_question", { answer: expectedAnswer }),
      ])
    );

    const handler = await getRouteHandler();
    const req = createMockReq({ q: "What are my active tasks?" });
    const res = createMockRes();

    await handler(req, res);

    expect(res.body.answer).toBe(expectedAnswer);
    expect(res.body.action).toBeNull();
  });

  // ── 4. create_task tool call ───────────────────────────────────────────────

  it("creates a task when create_task tool is called", async () => {
    mockStorage.createTask.mockResolvedValueOnce({
      id: "task-xyz",
      title: "Review landing page copy",
      priority: "P1",
      status: "next",
      ventureId: null,
    });

    mockOpenAIInstance.chat.completions.create.mockResolvedValueOnce(
      createMockOpenAIResponse("", [
        createMockToolCall("create_task", {
          title: "Review landing page copy",
          priority: "P1",
        }),
      ])
    );

    const handler = await getRouteHandler();
    const req = createMockReq({ q: "Create a P1 task to review the landing page copy" });
    const res = createMockRes();

    await handler(req, res);

    expect(res.body.answer).toContain("Review landing page copy");
    expect(res.body.action).not.toBeNull();
    expect(res.body.action.type).toBe("create_task");
    expect(res.body.action.payload.title).toBe("Review landing page copy");
    expect(mockStorage.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Review landing page copy", priority: "P1" })
    );
  });

  // ── 5. get_world_state tool call ───────────────────────────────────────────

  it("returns world state summary when get_world_state is called", async () => {
    mockOpenAIInstance.chat.completions.create.mockResolvedValueOnce(
      createMockOpenAIResponse("", [
        createMockToolCall("get_world_state", {}),
      ])
    );

    const handler = await getRouteHandler();
    const req = createMockReq({ q: "What's going on right now?" });
    const res = createMockRes();

    await handler(req, res);

    expect(res.body.answer).toBeTruthy();
    expect(typeof res.body.answer).toBe("string");
    expect(res.body.action).not.toBeNull();
    expect(res.body.action.type).toBe("get_world_state");
  });

  // ── 6. OpenAI error → graceful 200 ────────────────────────────────────────

  it("returns 200 with error message when OpenAI call fails", async () => {
    mockOpenAIInstance.chat.completions.create.mockRejectedValueOnce(
      new Error("OpenAI rate limit exceeded")
    );

    const handler = await getRouteHandler();
    const req = createMockReq({ q: "What are my goals?" });
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.answer).toContain("Query failed");
    expect(res.body.answer).toContain("rate limit");
    expect(res.body.action).toBeNull();
  });

  // ── 7. Invalid body → 400 ─────────────────────────────────────────────────

  it("returns 400 when q field is missing", async () => {
    const handler = await getRouteHandler();
    const req = createMockReq({});
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.answer).toContain("required");
  });

  // ── 8. Plain text response (no tool call) ─────────────────────────────────

  it("handles plain text response when model does not use a tool", async () => {
    mockOpenAIInstance.chat.completions.create.mockResolvedValueOnce(
      createMockOpenAIResponse("I'm not sure how to help with that.")
    );

    const handler = await getRouteHandler();
    const req = createMockReq({ q: "Tell me a joke" });
    const res = createMockRes();

    await handler(req, res);

    expect(res.body.answer).toBe("I'm not sure how to help with that.");
    expect(res.body.action).toBeNull();
  });
});
