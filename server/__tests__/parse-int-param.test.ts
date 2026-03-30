import { describe, it, expect } from "vitest";
import { parseIntParam } from "../utils/params";

describe("parseIntParam", () => {
  it("returns fallback for undefined", () => {
    expect(parseIntParam(undefined, 7)).toBe(7);
  });

  it("returns fallback for null", () => {
    expect(parseIntParam(null, 50)).toBe(50);
  });

  it("returns fallback for non-numeric string (the old bug)", () => {
    // String(undefined) = "undefined" — this used to defeat the || fallback
    expect(parseIntParam("undefined", 7)).toBe(7);
  });

  it("returns fallback for empty string", () => {
    expect(parseIntParam("", 10)).toBe(10);
  });

  it("returns fallback for NaN string", () => {
    expect(parseIntParam("abc", 30)).toBe(30);
  });

  it("parses a valid numeric string", () => {
    expect(parseIntParam("14", 7)).toBe(14);
  });

  it("parses a number passed directly", () => {
    expect(parseIntParam(42, 7)).toBe(42);
  });

  it("returns fallback for zero-length string", () => {
    expect(parseIntParam("  ", 5)).toBe(5);
  });

  it("truncates float strings to integer", () => {
    expect(parseIntParam("3.9", 1)).toBe(3);
  });

  it("handles negative values", () => {
    expect(parseIntParam("-1", 10)).toBe(-1);
  });
});
