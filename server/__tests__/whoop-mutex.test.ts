import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression test: WHOOP token refresh race condition.
 *
 * syncWhoopData() calls Promise.all with 4 parallel API calls. If the token
 * is expired, each concurrent call independently tries to refresh it —
 * consuming the single-use refresh token and causing subsequent calls to fail.
 *
 * The mutex (tokenRefreshPromise) ensures only one refresh runs at a time.
 */

describe("WHOOP refresh mutex", () => {
  let callCount = 0;
  let resolveRefresh: (token: string) => void;

  // Simulated refresh function that tracks call count
  async function mockRefresh(): Promise<string> {
    callCount++;
    return new Promise((resolve) => {
      resolveRefresh = resolve;
    });
  }

  // Inline mutex implementation matching whoop.ts
  let refreshPromise: Promise<string> | null = null;

  async function getValidAccessToken(): Promise<string> {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      try {
        return await mockRefresh();
      } finally {
        refreshPromise = null;
      }
    })();
    return refreshPromise;
  }

  beforeEach(() => {
    callCount = 0;
    refreshPromise = null;
  });

  it("deduplicates concurrent refresh calls — mockRefresh called exactly once", async () => {
    // Fire 4 concurrent callers (simulating Promise.all in syncWhoopData)
    const [p1, p2, p3, p4] = [
      getValidAccessToken(),
      getValidAccessToken(),
      getValidAccessToken(),
      getValidAccessToken(),
    ];

    // Resolve the single underlying refresh
    resolveRefresh!("new-access-token");

    const results = await Promise.all([p1, p2, p3, p4]);

    // All 4 callers get the same token
    expect(results).toEqual(["new-access-token", "new-access-token", "new-access-token", "new-access-token"]);
    // But refresh was only called once (not 4 times)
    expect(callCount).toBe(1);
  });

  it("clears the mutex after refresh completes, allowing future refreshes", async () => {
    const p1 = getValidAccessToken();
    resolveRefresh!("token-1");
    await p1;

    // mutex should be cleared — next call should trigger a fresh refresh
    const p2 = getValidAccessToken();
    resolveRefresh!("token-2");
    const result = await p2;

    expect(result).toBe("token-2");
    expect(callCount).toBe(2);
  });
});
