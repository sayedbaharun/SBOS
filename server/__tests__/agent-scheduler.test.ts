import { describe, it, expect, vi, afterEach } from "vitest";

// Mock node-cron with inline factory (no external variable references)
vi.mock("node-cron", () => ({
  default: {
    schedule: vi.fn().mockReturnValue({ stop: vi.fn() }),
    validate: () => true,
  },
}));

// Mock storage
vi.mock("../storage", () => ({
  storage: {
    db: {
      select: () => ({ from: () => ({ where: vi.fn().mockResolvedValue([]) }) }),
    },
    createDeadLetterJob: vi.fn(),
  },
}));

// Mock scheduled-jobs
vi.mock("../agents/scheduled-jobs", () => ({
  executeScheduledJob: vi.fn().mockResolvedValue(undefined),
}));

// Mock telegram-format
vi.mock("../infra/telegram-format", () => ({
  msgHeader: vi.fn().mockReturnValue(""),
  formatMessage: vi.fn().mockReturnValue(""),
}));

import { getScheduleStatus, stopAllJobs } from "../agents/agent-scheduler";

describe("Agent Scheduler", () => {
  afterEach(() => {
    stopAllJobs();
    vi.clearAllMocks();
  });

  describe("getScheduleStatus", () => {
    it("returns empty array when no jobs registered", () => {
      const status = getScheduleStatus();
      expect(status).toEqual([]);
    });

    it("returns array type", () => {
      const status = getScheduleStatus();
      expect(Array.isArray(status)).toBe(true);
    });
  });

  describe("stopAllJobs", () => {
    it("clears all registered jobs", () => {
      stopAllJobs();
      const status = getScheduleStatus();
      expect(status).toEqual([]);
    });

    it("can be called multiple times safely", () => {
      stopAllJobs();
      stopAllJobs();
      expect(getScheduleStatus()).toEqual([]);
    });
  });
});
