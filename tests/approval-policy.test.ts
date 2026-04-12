/**
 * Tests for server/agents/approval-policy-evaluator.ts
 *
 * We mock `../server/storage` so the evaluator never hits a real database,
 * and reset the lazy `db` handle between tests by re-importing the module
 * with a fresh mock each time via vi.resetModules().
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal policy row matching the approvalPolicies schema shape. */
function makePolicy(overrides: Record<string, any> = {}) {
  return {
    id: "policy-" + Math.random().toString(36).slice(2),
    ventureId: null,
    agentSlug: null,
    deliverableType: null,
    maxCostUSD: null,
    autoApprove: true,
    reason: "test policy",
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock setup helpers
// ---------------------------------------------------------------------------

/** Create a mock db that returns `rows` from select().from().where() */
function makeMockDb(rows: any[]) {
  return {
    select: () => ({
      from: () => ({
        where: vi.fn().mockResolvedValue(rows),
      }),
    }),
  };
}

/** Create a mock db that returns `rows` from select().from() (no where) */
function makeMockDbNoWhere(rows: any[]) {
  return {
    select: () => ({
      from: vi.fn().mockResolvedValue(rows),
    }),
  };
}

/** Create a mock db that throws on select */
function makeMockDbError() {
  return {
    select: () => {
      throw new Error("DB connection refused");
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("evaluatePolicy", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  // 1. No policies → default false
  it("returns { autoApprove: false } when no policies exist", async () => {
    vi.doMock("../server/storage", () => ({
      storage: { db: makeMockDb([]) },
    }));

    const { evaluatePolicy } = await import(
      "../server/agents/approval-policy-evaluator"
    );

    const result = await evaluatePolicy("social_post", "smm-syntheliq", null, 0.5);
    expect(result.autoApprove).toBe(false);
    expect(result.matchedPolicyId).toBeUndefined();
  });

  // 2. Exact three-way match wins → autoApprove true
  it("auto-approves when exact (ventureId + agentSlug + deliverableType) policy matches", async () => {
    const exactPolicy = makePolicy({
      id: "exact-policy-1",
      ventureId: "venture-abc",
      agentSlug: "smm-syntheliq",
      deliverableType: "social_post",
      autoApprove: true,
      reason: "trusted SMM posts for this venture",
    });

    vi.doMock("../server/storage", () => ({
      storage: { db: makeMockDb([exactPolicy]) },
    }));

    const { evaluatePolicy } = await import(
      "../server/agents/approval-policy-evaluator"
    );

    const result = await evaluatePolicy(
      "social_post",
      "smm-syntheliq",
      "venture-abc",
      0.10,
    );

    expect(result.autoApprove).toBe(true);
    expect(result.matchedPolicyId).toBe("exact-policy-1");
    expect(result.reason).toBe("trusted SMM posts for this venture");
  });

  // 3. Specific policy misses, falls through to global wildcard
  it("falls through to global policy (all nulls) when specific policy does not match", async () => {
    const specificPolicy = makePolicy({
      id: "specific-policy",
      agentSlug: "cmo",          // different agent — won't match
      deliverableType: "social_post",
      autoApprove: true,
    });

    const globalPolicy = makePolicy({
      id: "global-policy",
      ventureId: null,
      agentSlug: null,
      deliverableType: null,
      autoApprove: true,
      reason: "global catch-all",
    });

    vi.doMock("../server/storage", () => ({
      storage: { db: makeMockDb([specificPolicy, globalPolicy]) },
    }));

    const { evaluatePolicy } = await import(
      "../server/agents/approval-policy-evaluator"
    );

    const result = await evaluatePolicy(
      "social_post",
      "smm-syntheliq",   // does NOT match specificPolicy.agentSlug ("cmo")
      null,
      0.05,
    );

    expect(result.autoApprove).toBe(true);
    expect(result.matchedPolicyId).toBe("global-policy");
    expect(result.reason).toBe("global catch-all");
  });

  // 4. maxCostUSD exceeded → do NOT auto-approve
  it("does not auto-approve when costUSD exceeds policy maxCostUSD", async () => {
    const cappedPolicy = makePolicy({
      id: "capped-policy",
      deliverableType: "video_script",
      maxCostUSD: 1.00,
      autoApprove: true,
    });

    vi.doMock("../server/storage", () => ({
      storage: { db: makeMockDb([cappedPolicy]) },
    }));

    const { evaluatePolicy } = await import(
      "../server/agents/approval-policy-evaluator"
    );

    const result = await evaluatePolicy(
      "video_script",
      "script-writer-syntheliq",
      null,
      2.50,  // exceeds maxCostUSD of 1.00
    );

    expect(result.autoApprove).toBe(false);
    // matchedPolicyId is still set so the caller knows which policy was hit
    expect(result.matchedPolicyId).toBe("capped-policy");
  });

  // 5. Inactive policies are ignored
  it("ignores inactive policies (active: false)", async () => {
    const inactivePolicy = makePolicy({
      id: "inactive-policy",
      deliverableType: "social_post",
      active: false,
      autoApprove: true,
    });

    // The DB query filters active=true at DB level; we simulate by returning []
    vi.doMock("../server/storage", () => ({
      storage: { db: makeMockDb([]) },  // DB already filtered it out
    }));

    const { evaluatePolicy } = await import(
      "../server/agents/approval-policy-evaluator"
    );

    const result = await evaluatePolicy("social_post", "any-agent", null, 0);
    expect(result.autoApprove).toBe(false);
  });

  // 6. DB error → graceful degradation, return false
  it("returns { autoApprove: false } and does not throw on DB error", async () => {
    vi.doMock("../server/storage", () => ({
      storage: { db: makeMockDbError() },
    }));

    const { evaluatePolicy } = await import(
      "../server/agents/approval-policy-evaluator"
    );

    // Should not throw — errors are swallowed, pipeline falls through to review queue
    await expect(
      evaluatePolicy("carousel", "cmo", "venture-xyz", 0.01),
    ).resolves.toEqual({ autoApprove: false });
  });

  // 7. Most specific policy wins over less specific ones
  it("picks the most specific policy when multiple candidates match", async () => {
    const globalPolicy = makePolicy({
      id: "global",
      autoApprove: false,   // global says "no" — should be overridden
      reason: "default deny",
    });

    const agentPolicy = makePolicy({
      id: "agent-level",
      agentSlug: "smm-syntheliq",
      autoApprove: true,
      reason: "smm is trusted",
    });

    const exactPolicy = makePolicy({
      id: "exact",
      ventureId: "venture-abc",
      agentSlug: "smm-syntheliq",
      deliverableType: "social_post",
      autoApprove: true,
      reason: "exact match",
    });

    vi.doMock("../server/storage", () => ({
      storage: { db: makeMockDb([globalPolicy, agentPolicy, exactPolicy]) },
    }));

    const { evaluatePolicy } = await import(
      "../server/agents/approval-policy-evaluator"
    );

    const result = await evaluatePolicy(
      "social_post",
      "smm-syntheliq",
      "venture-abc",
      0.10,
    );

    expect(result.autoApprove).toBe(true);
    expect(result.matchedPolicyId).toBe("exact");
    expect(result.reason).toBe("exact match");
  });

  // 8. autoApprove: false on matched policy is respected
  it("returns autoApprove: false when matched policy has autoApprove=false", async () => {
    const denyPolicy = makePolicy({
      id: "deny-policy",
      deliverableType: "carousel",
      autoApprove: false,
      reason: "carousels always need review",
    });

    vi.doMock("../server/storage", () => ({
      storage: { db: makeMockDb([denyPolicy]) },
    }));

    const { evaluatePolicy } = await import(
      "../server/agents/approval-policy-evaluator"
    );

    const result = await evaluatePolicy("carousel", "any-agent", null, 0.05);
    expect(result.autoApprove).toBe(false);
    expect(result.matchedPolicyId).toBe("deny-policy");
  });
});
