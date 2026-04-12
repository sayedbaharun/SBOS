/**
 * Tests for morning brief route and widget integration.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ─── mocks ───────────────────────────────────────────────────────────────────

vi.mock("../utils/dates", () => ({
  getUserDate: vi.fn(() => "2026-04-12"),
}));

vi.mock("../logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

// ─── helpers ─────────────────────────────────────────────────────────────────

function buildApp(mockDb: any) {
  // Override the lazy db getter by mocking the storage module
  vi.doMock("../storage", () => ({
    storage: { db: mockDb },
  }));

  // Re-import router after mock is in place
  const router = require("../routes/morning-brief").default;
  const app = express();
  app.use(express.json());
  app.use("/api/dashboard", router);
  return app;
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe("GET /api/dashboard/morning-brief", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns the stored brief for today when one exists", async () => {
    const mockRow = {
      id: "abc-123",
      date: "2026-04-12",
      headline: "Big day ahead — 3 deep-work blocks available.",
      bullets: ["5 tasks on deck", "2 urgent items", "3 tasks ready for agents"],
      agentReadyCount: 3,
      reviewPendingCount: 2,
      generatedAt: new Date("2026-04-12T07:00:00Z"),
      agentSlug: "chief-of-staff",
    };

    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([mockRow]),
    };

    vi.doMock("../storage", () => ({ storage: { db: mockDb } }));
    vi.doMock("@shared/schema", () => ({
      dailyBriefs: "daily_briefs_table_symbol",
    }));
    vi.doMock("drizzle-orm", () => ({ eq: vi.fn() }));

    const router = (await import("../routes/morning-brief")).default;
    const app = express();
    app.use(express.json());
    app.use("/api/dashboard", router);

    const res = await request(app).get("/api/dashboard/morning-brief");

    expect(res.status).toBe(200);
    expect(res.body.date).toBe("2026-04-12");
    expect(res.body.headline).toBe("Big day ahead — 3 deep-work blocks available.");
    expect(res.body.bullets).toHaveLength(3);
    expect(res.body.agentReadyCount).toBe(3);
    expect(res.body.reviewPendingCount).toBe(2);
    expect(res.body.agentSlug).toBe("chief-of-staff");
  });

  it("returns the fallback placeholder when no brief exists for today", async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]), // empty result
    };

    vi.doMock("../storage", () => ({ storage: { db: mockDb } }));
    vi.doMock("@shared/schema", () => ({
      dailyBriefs: "daily_briefs_table_symbol",
    }));
    vi.doMock("drizzle-orm", () => ({ eq: vi.fn() }));

    const router = (await import("../routes/morning-brief")).default;
    const app = express();
    app.use(express.json());
    app.use("/api/dashboard", router);

    const res = await request(app).get("/api/dashboard/morning-brief");

    expect(res.status).toBe(200);
    expect(res.body.date).toBe("2026-04-12");
    expect(res.body.headline).toBe("No brief yet — will generate at 7am.");
    expect(res.body.bullets).toEqual([]);
    expect(res.body.agentReadyCount).toBe(0);
    expect(res.body.reviewPendingCount).toBe(0);
    expect(res.body.generatedAt).toBeNull();
  });

  it("returns the fallback when the DB call throws", async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockRejectedValue(new Error("DB connection failed")),
    };

    vi.doMock("../storage", () => ({ storage: { db: mockDb } }));
    vi.doMock("@shared/schema", () => ({
      dailyBriefs: "daily_briefs_table_symbol",
    }));
    vi.doMock("drizzle-orm", () => ({ eq: vi.fn() }));

    const router = (await import("../routes/morning-brief")).default;
    const app = express();
    app.use(express.json());
    app.use("/api/dashboard", router);

    const res = await request(app).get("/api/dashboard/morning-brief");

    // Even on DB error, returns 200 with fallback shape
    expect(res.status).toBe(200);
    expect(res.body.headline).toBe("No brief yet — will generate at 7am.");
    expect(res.body.bullets).toEqual([]);
  });

  it("response always includes all required shape fields", async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };

    vi.doMock("../storage", () => ({ storage: { db: mockDb } }));
    vi.doMock("@shared/schema", () => ({
      dailyBriefs: "daily_briefs_table_symbol",
    }));
    vi.doMock("drizzle-orm", () => ({ eq: vi.fn() }));

    const router = (await import("../routes/morning-brief")).default;
    const app = express();
    app.use(express.json());
    app.use("/api/dashboard", router);

    const res = await request(app).get("/api/dashboard/morning-brief");

    const body = res.body;
    expect(body).toHaveProperty("date");
    expect(body).toHaveProperty("headline");
    expect(body).toHaveProperty("bullets");
    expect(body).toHaveProperty("agentReadyCount");
    expect(body).toHaveProperty("reviewPendingCount");
    expect(body).toHaveProperty("generatedAt");
    expect(Array.isArray(body.bullets)).toBe(true);
  });
});
