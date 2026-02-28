/**
 * Tool loop detection for agent runtime.
 * Prevents agents from burning tokens by calling the same tools repeatedly.
 *
 * Three detectors:
 * 1. generic_repeat — same tool+args called N times
 * 2. known_poll_no_progress — polling tool returns identical results
 * 3. ping_pong — alternating A→B→A→B pattern
 *
 * Uses SHA256 hashing for efficient comparison.
 */

import { createHash } from "crypto";

export type LoopSeverity = "warning" | "critical" | "circuit_breaker";

export interface LoopDetectionResult {
  detected: boolean;
  severity?: LoopSeverity;
  detector?: "generic_repeat" | "known_poll_no_progress" | "ping_pong";
  message?: string;
  /** Number of repetitions detected */
  count?: number;
}

interface ToolCallRecord {
  /** SHA256 of tool name + sorted args */
  callHash: string;
  /** SHA256 of tool name + sorted args + result content */
  fullHash: string;
  /** Tool name for pattern matching */
  toolName: string;
  /** Timestamp */
  timestamp: number;
}

/** Thresholds for each severity level */
const THRESHOLDS = {
  /** Same exact call this many times → warning */
  repeatWarning: 3,
  /** Same exact call this many times → critical */
  repeatCritical: 5,
  /** Same exact call this many times → circuit breaker (hard stop) */
  repeatCircuitBreaker: 7,
  /** Polling with identical results this many times → warning */
  pollWarning: 3,
  /** Polling with identical results → critical */
  pollCritical: 5,
  /** Ping-pong alternation cycles → warning */
  pingPongWarning: 3,
  /** Ping-pong alternation cycles → critical */
  pingPongCritical: 5,
};

/** Sliding window size */
const WINDOW_SIZE = 30;

export class ToolLoopDetector {
  private history: ToolCallRecord[] = [];

  /**
   * Record a tool call and check for loops.
   * Call this after every tool execution in the tool-use loop.
   */
  recordAndCheck(
    toolName: string,
    args: Record<string, unknown>,
    result: string
  ): LoopDetectionResult {
    const callHash = this.hashCall(toolName, args);
    const fullHash = this.hashFull(toolName, args, result);

    this.history.push({
      callHash,
      fullHash,
      toolName,
      timestamp: Date.now(),
    });

    // Trim to sliding window
    if (this.history.length > WINDOW_SIZE) {
      this.history = this.history.slice(-WINDOW_SIZE);
    }

    // Run all three detectors, return the most severe
    const results = [
      this.detectGenericRepeat(callHash),
      this.detectPollNoProgress(fullHash),
      this.detectPingPong(),
    ];

    // Return the most severe detection
    const severityOrder: Record<LoopSeverity, number> = {
      circuit_breaker: 3,
      critical: 2,
      warning: 1,
    };

    let worst: LoopDetectionResult = { detected: false };
    for (const r of results) {
      if (
        r.detected &&
        (!worst.detected ||
          severityOrder[r.severity!] > severityOrder[worst.severity!])
      ) {
        worst = r;
      }
    }

    return worst;
  }

  /** Reset the detector (e.g., between sessions) */
  reset(): void {
    this.history = [];
  }

  /** Get current window size for diagnostics */
  getHistorySize(): number {
    return this.history.length;
  }

  // --- Detector 1: Generic Repeat ---

  private detectGenericRepeat(callHash: string): LoopDetectionResult {
    const count = this.history.filter((h) => h.callHash === callHash).length;

    if (count >= THRESHOLDS.repeatCircuitBreaker) {
      return {
        detected: true,
        severity: "circuit_breaker",
        detector: "generic_repeat",
        message: `Same tool call repeated ${count} times — circuit breaker triggered`,
        count,
      };
    }
    if (count >= THRESHOLDS.repeatCritical) {
      return {
        detected: true,
        severity: "critical",
        detector: "generic_repeat",
        message: `Same tool call repeated ${count} times`,
        count,
      };
    }
    if (count >= THRESHOLDS.repeatWarning) {
      return {
        detected: true,
        severity: "warning",
        detector: "generic_repeat",
        message: `Same tool call repeated ${count} times`,
        count,
      };
    }
    return { detected: false };
  }

  // --- Detector 2: Poll No Progress ---

  private detectPollNoProgress(fullHash: string): LoopDetectionResult {
    // Full hash includes result — identical full hashes mean same call + same result
    const count = this.history.filter((h) => h.fullHash === fullHash).length;

    if (count >= THRESHOLDS.pollCritical) {
      return {
        detected: true,
        severity: "critical",
        detector: "known_poll_no_progress",
        message: `Polling tool returned identical results ${count} times`,
        count,
      };
    }
    if (count >= THRESHOLDS.pollWarning) {
      return {
        detected: true,
        severity: "warning",
        detector: "known_poll_no_progress",
        message: `Polling tool returned identical results ${count} times`,
        count,
      };
    }
    return { detected: false };
  }

  // --- Detector 3: Ping-Pong ---

  private detectPingPong(): LoopDetectionResult {
    if (this.history.length < 4) return { detected: false };

    // Check the last N entries for alternating pattern A-B-A-B
    const recent = this.history.slice(-20);
    let maxCycles = 0;

    // Look at pairs: if recent[-1] == recent[-3] == recent[-5]... and
    // recent[-2] == recent[-4] == recent[-6]...
    if (recent.length >= 4) {
      const lastHash = recent[recent.length - 1].callHash;
      const secondLastHash = recent[recent.length - 2].callHash;

      if (lastHash === secondLastHash) return { detected: false }; // Not alternating

      let cycles = 1;
      for (let i = recent.length - 3; i >= 1; i -= 2) {
        if (
          recent[i].callHash === secondLastHash &&
          recent[i - 1]?.callHash === lastHash
        ) {
          cycles++;
        } else {
          break;
        }
      }
      maxCycles = cycles;
    }

    if (maxCycles >= THRESHOLDS.pingPongCritical) {
      return {
        detected: true,
        severity: "critical",
        detector: "ping_pong",
        message: `Ping-pong pattern detected: ${maxCycles} cycles of alternating tool calls`,
        count: maxCycles,
      };
    }
    if (maxCycles >= THRESHOLDS.pingPongWarning) {
      return {
        detected: true,
        severity: "warning",
        detector: "ping_pong",
        message: `Ping-pong pattern detected: ${maxCycles} cycles of alternating tool calls`,
        count: maxCycles,
      };
    }
    return { detected: false };
  }

  // --- Hashing ---

  private hashCall(toolName: string, args: Record<string, unknown>): string {
    const payload = JSON.stringify({ t: toolName, a: this.stableStringify(args) });
    return createHash("sha256").update(payload).digest("hex").slice(0, 16);
  }

  private hashFull(
    toolName: string,
    args: Record<string, unknown>,
    result: string
  ): string {
    const payload = JSON.stringify({
      t: toolName,
      a: this.stableStringify(args),
      r: result.slice(0, 2000), // Cap result size for hashing
    });
    return createHash("sha256").update(payload).digest("hex").slice(0, 16);
  }

  /** Deterministic JSON stringification (sorted keys) */
  private stableStringify(obj: unknown): string {
    if (obj === null || obj === undefined) return "null";
    if (typeof obj !== "object") return JSON.stringify(obj);
    if (Array.isArray(obj)) {
      return "[" + obj.map((v) => this.stableStringify(v)).join(",") + "]";
    }
    const sorted = Object.keys(obj as Record<string, unknown>)
      .sort()
      .map(
        (k) =>
          JSON.stringify(k) +
          ":" +
          this.stableStringify((obj as Record<string, unknown>)[k])
      );
    return "{" + sorted.join(",") + "}";
  }
}
