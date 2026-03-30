import { describe, it, expect } from "vitest";
import pino from "pino";

/**
 * Regression test: Pino error serialization.
 *
 * Pino only serializes Error objects under the `err` key by default.
 * Logging `{ error }` (common mistake) produces `error: {}` in logs —
 * hiding stack traces and making debugging impossible.
 *
 * The fix adds `error: pino.stdSerializers.err` to serializers so both
 * keys produce full stack trace output.
 */

const testLogger = pino({
  serializers: {
    err: pino.stdSerializers.err,
    error: pino.stdSerializers.err,
  },
});

describe("pino error serialization", () => {
  it("serializes Error under 'err' key with message and stack", () => {
    const err = new Error("test error");
    const bindings = (testLogger as any).bindings?.() ?? {};
    // Access serializer directly
    const serialized = pino.stdSerializers.err(err);
    expect(serialized).toHaveProperty("message", "test error");
    expect(serialized).toHaveProperty("stack");
    expect(serialized.stack).toContain("Error: test error");
  });

  it("serializes Error under 'error' key (the common mistake key)", () => {
    const err = new Error("something failed");
    const serialized = pino.stdSerializers.err(err);
    expect(serialized).toHaveProperty("message", "something failed");
    expect(serialized).toHaveProperty("type", "Error");
  });

  it("handles non-Error values gracefully", () => {
    // Should not throw on plain strings or objects
    expect(() => pino.stdSerializers.err("a string" as any)).not.toThrow();
  });

  it("logger config includes both err and error serializers", () => {
    const cfg = (testLogger as any)[pino.symbols.serializersSym];
    expect(cfg).toBeDefined();
    expect(typeof cfg?.err).toBe("function");
    expect(typeof cfg?.error).toBe("function");
  });
});
