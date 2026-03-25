import { describe, it, expect } from "vitest";
import { extractFactsWithPatterns } from "../memory/memory-lifecycle";

describe("Memory Lifecycle — extractFactsWithPatterns", () => {
  describe("decision patterns", () => {
    it("extracts 'decided to' patterns", () => {
      const text = "After discussion, we decided to use PostgreSQL for the main database instead of MongoDB.";
      const facts = extractFactsWithPatterns(text);
      expect(facts.length).toBeGreaterThan(0);
      expect(facts[0].pattern).toBe("decision");
      expect(facts[0].importance).toBe(0.8);
      expect(facts[0].text).toContain("Decision:");
    });

    it("extracts 'going with' patterns", () => {
      const text = "We're going with Railway for deployment because it supports Docker natively.";
      const facts = extractFactsWithPatterns(text);
      expect(facts.length).toBeGreaterThan(0);
      expect(facts[0].pattern).toBe("decision");
    });

    it("extracts 'chose to' patterns", () => {
      const text = "The team chose to implement rate limiting using express-rate-limit middleware.";
      const facts = extractFactsWithPatterns(text);
      expect(facts.length).toBeGreaterThan(0);
      expect(facts[0].pattern).toBe("decision");
    });
  });

  describe("preference patterns", () => {
    it("extracts 'prefer' patterns", () => {
      const text = "I prefer using TypeScript strict mode for all new modules in the project.";
      const facts = extractFactsWithPatterns(text);
      expect(facts.length).toBeGreaterThan(0);
      expect(facts[0].pattern).toBe("preference");
      expect(facts[0].importance).toBe(0.7);
    });

    it("extracts 'always use' patterns", () => {
      const text = "We should always use parameterized queries to prevent SQL injection attacks.";
      const facts = extractFactsWithPatterns(text);
      expect(facts.length).toBeGreaterThan(0);
      expect(facts[0].pattern).toBe("preference");
    });

    it("extracts 'never use' patterns", () => {
      const text = "Never use inline styles when Tailwind utility classes are available.";
      const facts = extractFactsWithPatterns(text);
      expect(facts.length).toBeGreaterThan(0);
      expect(facts[0].pattern).toBe("preference");
    });
  });

  describe("date/deadline patterns", () => {
    it("extracts ISO date deadlines", () => {
      const text = "The MVP deadline is 2026-04-15 and we need to have all features ready.";
      const facts = extractFactsWithPatterns(text);
      expect(facts.length).toBeGreaterThan(0);
      expect(facts[0].pattern).toBe("date");
      expect(facts[0].importance).toBe(0.9);
      expect(facts[0].text).toContain("Deadline:");
    });

    it("extracts 'launches on' date patterns", () => {
      const text = "The product launches on March 25th, 2026 with a soft rollout.";
      const facts = extractFactsWithPatterns(text);
      expect(facts.length).toBeGreaterThan(0);
      expect(facts[0].pattern).toBe("date");
    });

    it("extracts 'due' date patterns", () => {
      const text = "Report due 2026-03-30 needs to include Q1 financial summary.";
      const facts = extractFactsWithPatterns(text);
      expect(facts.length).toBeGreaterThan(0);
      expect(facts[0].pattern).toBe("date");
    });
  });

  describe("financial/numerical patterns", () => {
    it("extracts budget figures", () => {
      const text = "The marketing budget is $5,000 for Q2 campaigns.";
      const facts = extractFactsWithPatterns(text);
      expect(facts.length).toBeGreaterThan(0);
      expect(facts[0].pattern).toBe("number");
      expect(facts[0].importance).toBe(0.8);
      expect(facts[0].text).toContain("Financial:");
    });

    it("extracts AED amounts", () => {
      const text = "Total revenue of AED 25,000 was generated this month.";
      const facts = extractFactsWithPatterns(text);
      expect(facts.length).toBeGreaterThan(0);
      expect(facts[0].pattern).toBe("number");
    });

    it("extracts cost figures", () => {
      const text = "Infrastructure cost is $150.00 per month on Railway.";
      const facts = extractFactsWithPatterns(text);
      expect(facts.length).toBeGreaterThan(0);
      expect(facts[0].pattern).toBe("number");
    });
  });

  describe("edge cases", () => {
    it("returns empty array for text with no patterns", () => {
      const text = "Hello, how are you today? The weather is nice.";
      const facts = extractFactsWithPatterns(text);
      expect(facts).toEqual([]);
    });

    it("returns empty array for empty string", () => {
      const facts = extractFactsWithPatterns("");
      expect(facts).toEqual([]);
    });

    it("limits to max 10 facts", () => {
      // Build text with many matching patterns
      const decisions = Array.from({ length: 15 }, (_, i) =>
        `We decided to implement feature ${i} with a comprehensive testing strategy and documentation.`
      ).join(" ");
      const facts = extractFactsWithPatterns(decisions);
      expect(facts.length).toBeLessThanOrEqual(10);
    });

    it("extracts multiple pattern types from same text", () => {
      const text = "We decided to migrate the database by 2026-04-01. The budget is $10,000 and we should always use blue-green deployment strategy.";
      const facts = extractFactsWithPatterns(text);
      const patterns = new Set(facts.map((f) => f.pattern));
      expect(patterns.size).toBeGreaterThanOrEqual(2);
    });
  });
});
