/**
 * Tests for src/theme/spinner-verbs.ts
 */

import { describe, expect, test } from "bun:test";
import { SPINNER_VERBS, getRandomVerb, COMPLETION_VERBS, getRandomCompletionVerb } from "@/theme/spinner-verbs.ts";

describe("SPINNER_VERBS", () => {
  test("is an array", () => { expect(Array.isArray(SPINNER_VERBS)).toBe(true); });
  test("is non-empty", () => { expect(SPINNER_VERBS.length).toBeGreaterThan(0); });
  test("contains at least 10 verbs", () => { expect(SPINNER_VERBS.length).toBeGreaterThanOrEqual(10); });
  test("contains exactly 13 verbs", () => { expect(SPINNER_VERBS).toHaveLength(13); });
  test("all entries are non-empty strings", () => {
    for (const verb of SPINNER_VERBS) {
      expect(typeof verb).toBe("string");
      expect(verb.length).toBeGreaterThan(0);
    }
  });
  test("all entries are unique", () => { expect(new Set(SPINNER_VERBS).size).toBe(SPINNER_VERBS.length); });
  test("all entries start with an uppercase letter", () => {
    for (const verb of SPINNER_VERBS) { expect(verb[0]).toMatch(/[A-Z]/); }
  });
  test("contains canonical verbs: Thinking, Analyzing, Processing", () => {
    expect(SPINNER_VERBS).toContain("Thinking");
    expect(SPINNER_VERBS).toContain("Analyzing");
    expect(SPINNER_VERBS).toContain("Processing");
  });
  test("all entries are present-tense gerunds (ending in -ing)", () => {
    for (const verb of SPINNER_VERBS) { expect(verb).toMatch(/ing$/); }
  });
});

describe("getRandomVerb", () => {
  test("returns a string", () => { expect(typeof getRandomVerb()).toBe("string"); });
  test("returns a verb from SPINNER_VERBS", () => { expect(SPINNER_VERBS).toContain(getRandomVerb()); });
  test("returns a non-empty string", () => { expect(getRandomVerb().length).toBeGreaterThan(0); });
  test("returns values from the SPINNER_VERBS pool over multiple calls", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) { seen.add(getRandomVerb()); }
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });
  test("all returned values are present in SPINNER_VERBS (50 samples)", () => {
    const verbSet = new Set(SPINNER_VERBS);
    for (let i = 0; i < 50; i++) { expect(verbSet.has(getRandomVerb())).toBe(true); }
  });
});

describe("COMPLETION_VERBS", () => {
  test("is an array", () => { expect(Array.isArray(COMPLETION_VERBS)).toBe(true); });
  test("is non-empty", () => { expect(COMPLETION_VERBS.length).toBeGreaterThan(0); });
  test("contains exactly 8 verbs", () => { expect(COMPLETION_VERBS).toHaveLength(8); });
  test("all entries are non-empty strings", () => {
    for (const verb of COMPLETION_VERBS) {
      expect(typeof verb).toBe("string");
      expect(verb.length).toBeGreaterThan(0);
    }
  });
  test("all entries are unique", () => { expect(new Set(COMPLETION_VERBS).size).toBe(COMPLETION_VERBS.length); });
  test("all entries start with an uppercase letter", () => {
    for (const verb of COMPLETION_VERBS) { expect(verb[0]).toMatch(/[A-Z]/); }
  });
  test("contains canonical verbs: Worked, Crafted", () => {
    expect(COMPLETION_VERBS).toContain("Worked");
    expect(COMPLETION_VERBS).toContain("Crafted");
  });
  test("all entries are past-tense (ending in -ed)", () => {
    for (const verb of COMPLETION_VERBS) { expect(verb).toMatch(/ed$/); }
  });
});

describe("getRandomCompletionVerb", () => {
  test("returns a string", () => { expect(typeof getRandomCompletionVerb()).toBe("string"); });
  test("returns a verb from COMPLETION_VERBS", () => { expect(COMPLETION_VERBS).toContain(getRandomCompletionVerb()); });
  test("returns a non-empty string", () => { expect(getRandomCompletionVerb().length).toBeGreaterThan(0); });
  test("returns values from the COMPLETION_VERBS pool over multiple calls", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) { seen.add(getRandomCompletionVerb()); }
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });
  test("all returned values are present in COMPLETION_VERBS (50 samples)", () => {
    const verbSet = new Set(COMPLETION_VERBS);
    for (let i = 0; i < 50; i++) { expect(verbSet.has(getRandomCompletionVerb())).toBe(true); }
  });
});

describe("SPINNER_VERBS vs COMPLETION_VERBS", () => {
  test("are separate arrays (different references)", () => { expect(SPINNER_VERBS).not.toBe(COMPLETION_VERBS); });
  test("have different lengths", () => { expect(SPINNER_VERBS.length).not.toBe(COMPLETION_VERBS.length); });
  test("do not share all entries (different semantic domains)", () => {
    const spinnerSet = new Set(SPINNER_VERBS);
    const overlap = [...new Set(COMPLETION_VERBS)].filter((v) => spinnerSet.has(v));
    expect(overlap.length).toBeLessThan(COMPLETION_VERBS.length);
  });
});
