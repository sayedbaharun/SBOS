/**
 * Retrieval Metrics — In-Memory Ring Buffer
 *
 * Tracks per-arm latency, hit counts, and cloud fallback rates
 * for the hybrid retriever pipeline. No DB writes — lightweight
 * enough to run on every retrieval.
 */

export interface RetrievalEvent {
  timestamp: number;
  queryLength: number;
  qdrantCount: number;
  qdrantLatencyMs: number;
  keywordCount: number;
  keywordLatencyMs: number;
  graphCount: number;
  graphLatencyMs: number;
  graphSkipped: boolean;
  cloudFallbackTriggered: boolean;
  cloudFallbackCount: number;
  cloudFallbackLatencyMs: number;
  totalResults: number;
  totalLatencyMs: number;
}

const RING_SIZE = 1000;
const events: RetrievalEvent[] = [];
let writeIdx = 0;
let totalRecorded = 0;

export function recordRetrieval(event: RetrievalEvent): void {
  if (events.length < RING_SIZE) {
    events.push(event);
  } else {
    events[writeIdx % RING_SIZE] = event;
  }
  writeIdx++;
  totalRecorded++;
}

export interface AggregatedMetrics {
  totalRetrievals: number;
  windowSize: number; // how many events are in the buffer
  arms: {
    qdrant: { avgLatencyMs: number; avgCount: number; hitRate: number };
    keyword: { avgLatencyMs: number; avgCount: number; hitRate: number };
    graph: { avgLatencyMs: number; avgCount: number; hitRate: number; skipRate: number };
  };
  cloudFallback: {
    triggerRate: number;
    avgCount: number;
    avgLatencyMs: number;
  };
  overall: {
    avgLatencyMs: number;
    avgResults: number;
  };
}

export function getMetrics(windowMinutes?: number): AggregatedMetrics {
  let subset = events;

  if (windowMinutes) {
    const cutoff = Date.now() - windowMinutes * 60 * 1000;
    subset = events.filter((e) => e.timestamp >= cutoff);
  }

  const n = subset.length;

  if (n === 0) {
    return {
      totalRetrievals: totalRecorded,
      windowSize: 0,
      arms: {
        qdrant: { avgLatencyMs: 0, avgCount: 0, hitRate: 0 },
        keyword: { avgLatencyMs: 0, avgCount: 0, hitRate: 0 },
        graph: { avgLatencyMs: 0, avgCount: 0, hitRate: 0, skipRate: 0 },
      },
      cloudFallback: { triggerRate: 0, avgCount: 0, avgLatencyMs: 0 },
      overall: { avgLatencyMs: 0, avgResults: 0 },
    };
  }

  const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
  const avg = (arr: number[]) => (arr.length > 0 ? sum(arr) / arr.length : 0);

  const qdrantHits = subset.filter((e) => e.qdrantCount > 0).length;
  const keywordHits = subset.filter((e) => e.keywordCount > 0).length;
  const graphHits = subset.filter((e) => e.graphCount > 0).length;
  const graphSkipped = subset.filter((e) => e.graphSkipped).length;
  const cloudTriggered = subset.filter((e) => e.cloudFallbackTriggered);

  return {
    totalRetrievals: totalRecorded,
    windowSize: n,
    arms: {
      qdrant: {
        avgLatencyMs: Math.round(avg(subset.map((e) => e.qdrantLatencyMs))),
        avgCount: +(avg(subset.map((e) => e.qdrantCount)).toFixed(1)),
        hitRate: +(qdrantHits / n).toFixed(3),
      },
      keyword: {
        avgLatencyMs: Math.round(avg(subset.map((e) => e.keywordLatencyMs))),
        avgCount: +(avg(subset.map((e) => e.keywordCount)).toFixed(1)),
        hitRate: +(keywordHits / n).toFixed(3),
      },
      graph: {
        avgLatencyMs: Math.round(avg(subset.filter((e) => !e.graphSkipped).map((e) => e.graphLatencyMs))),
        avgCount: +(avg(subset.map((e) => e.graphCount)).toFixed(1)),
        hitRate: +(graphHits / n).toFixed(3),
        skipRate: +(graphSkipped / n).toFixed(3),
      },
    },
    cloudFallback: {
      triggerRate: +(cloudTriggered.length / n).toFixed(3),
      avgCount: +(avg(cloudTriggered.map((e) => e.cloudFallbackCount)).toFixed(1)),
      avgLatencyMs: Math.round(avg(cloudTriggered.map((e) => e.cloudFallbackLatencyMs))),
    },
    overall: {
      avgLatencyMs: Math.round(avg(subset.map((e) => e.totalLatencyMs))),
      avgResults: +(avg(subset.map((e) => e.totalResults)).toFixed(1)),
    },
  };
}
