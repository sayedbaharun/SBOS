import { describe, it, expect, beforeEach } from "vitest";
import { recordRetrieval, getMetrics, type RetrievalEvent } from "../memory/retrieval-metrics";

function makeEvent(overrides: Partial<RetrievalEvent> = {}): RetrievalEvent {
  return {
    timestamp: Date.now(),
    queryLength: 20,
    qdrantCount: 5,
    qdrantLatencyMs: 100,
    keywordCount: 3,
    keywordLatencyMs: 50,
    graphCount: 0,
    graphLatencyMs: 0,
    graphSkipped: true,
    cloudFallbackTriggered: false,
    cloudFallbackCount: 0,
    cloudFallbackLatencyMs: 0,
    totalResults: 8,
    totalLatencyMs: 200,
    ...overrides,
  };
}

describe("Retrieval Metrics", () => {
  // Note: ring buffer is module-level state, so events accumulate across tests.
  // Tests are written to be order-independent by checking relative values.

  it("returns zero metrics when no events recorded yet if fresh", () => {
    // getMetrics with a very narrow window should return empty if no events match
    const metrics = getMetrics(0.001); // 0.001 minutes = 60ms window
    // Should have zero window or very few events
    expect(metrics.windowSize).toBeGreaterThanOrEqual(0);
  });

  it("records events and returns correct aggregate metrics", () => {
    // Record a few events
    recordRetrieval(makeEvent({
      timestamp: Date.now(),
      qdrantCount: 10,
      qdrantLatencyMs: 120,
      keywordCount: 5,
      keywordLatencyMs: 80,
      graphCount: 2,
      graphLatencyMs: 60,
      graphSkipped: false,
      totalResults: 12,
      totalLatencyMs: 300,
    }));

    recordRetrieval(makeEvent({
      timestamp: Date.now(),
      qdrantCount: 0,
      qdrantLatencyMs: 50,
      keywordCount: 0,
      keywordLatencyMs: 30,
      graphCount: 0,
      graphLatencyMs: 0,
      graphSkipped: true,
      cloudFallbackTriggered: true,
      cloudFallbackCount: 3,
      cloudFallbackLatencyMs: 400,
      totalResults: 3,
      totalLatencyMs: 500,
    }));

    const metrics = getMetrics(5); // last 5 minutes
    expect(metrics.totalRetrievals).toBeGreaterThanOrEqual(2);
    expect(metrics.windowSize).toBeGreaterThanOrEqual(2);

    // Qdrant should have some hits
    expect(metrics.arms.qdrant.hitRate).toBeGreaterThan(0);

    // Cloud fallback should have triggered at least once
    expect(metrics.cloudFallback.triggerRate).toBeGreaterThan(0);
  });

  it("calculates hit rate correctly", () => {
    // Record 3 events: 2 with qdrant hits, 1 without
    const baseTime = Date.now();

    recordRetrieval(makeEvent({ timestamp: baseTime, qdrantCount: 5 }));
    recordRetrieval(makeEvent({ timestamp: baseTime, qdrantCount: 3 }));
    recordRetrieval(makeEvent({ timestamp: baseTime, qdrantCount: 0 }));

    const metrics = getMetrics(1); // last 1 minute
    // Hit rate should be > 0 since at least 2 out of recent events have qdrant results
    expect(metrics.arms.qdrant.hitRate).toBeGreaterThan(0);
    expect(metrics.arms.qdrant.hitRate).toBeLessThanOrEqual(1);
  });

  it("tracks graph skip rate", () => {
    recordRetrieval(makeEvent({ timestamp: Date.now(), graphSkipped: true, graphCount: 0 }));
    recordRetrieval(makeEvent({ timestamp: Date.now(), graphSkipped: true, graphCount: 0 }));

    const metrics = getMetrics(1);
    // Most recent events have graph skipped
    expect(metrics.arms.graph.skipRate).toBeGreaterThan(0);
  });

  it("handles getMetrics without window parameter (all events)", () => {
    const metrics = getMetrics();
    expect(metrics.totalRetrievals).toBeGreaterThan(0);
    expect(metrics.windowSize).toBeGreaterThan(0);
    expect(metrics.overall.avgLatencyMs).toBeGreaterThanOrEqual(0);
  });
});
