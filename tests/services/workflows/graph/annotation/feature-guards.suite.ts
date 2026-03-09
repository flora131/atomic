import { describe, expect, test } from "bun:test";
import { isFeature } from "@/services/workflows/graph/annotation.ts";
import type { Feature } from "@/services/workflows/graph/annotation.ts";
import { createTestFeature } from "./fixtures.ts";

describe("isFeature", () => {
  test("returns true for valid Feature object", () => {
    expect(isFeature(createTestFeature())).toBe(true);
  });

  test("returns true for Feature with all required fields", () => {
    const feature: Feature = {
      category: "functional",
      description: "Add login button",
      steps: ["step1", "step2", "step3"],
      passes: true,
    };
    expect(isFeature(feature)).toBe(true);
  });

  test("returns false for nullish and primitive values", () => {
    expect(isFeature(null)).toBe(false);
    expect(isFeature(undefined)).toBe(false);
    expect(isFeature("string")).toBe(false);
    expect(isFeature(42)).toBe(false);
    expect(isFeature(true)).toBe(false);
  });

  test("returns false when required fields are missing or invalid", () => {
    expect(isFeature({ description: "test", steps: [], passes: false })).toBe(false);
    expect(isFeature({ category: "test", steps: [], passes: false })).toBe(false);
    expect(
      isFeature({
        category: "test",
        description: "test",
        steps: "not-array",
        passes: false,
      }),
    ).toBe(false);
    expect(
      isFeature({
        category: "test",
        description: "test",
        steps: [],
        passes: "yes",
      }),
    ).toBe(false);
  });
});

describe("isFeature — gap coverage", () => {
  test("returns true for Feature with empty steps array", () => {
    expect(isFeature(createTestFeature({ steps: [] }))).toBe(true);
  });

  test("returns true for Feature with extra properties", () => {
    expect(
      isFeature({ ...createTestFeature(), extraProp: "hello", anotherProp: 42 }),
    ).toBe(true);
  });

  test("returns false for malformed objects", () => {
    expect(isFeature({})).toBe(false);
    expect(
      isFeature({
        category: 123,
        description: "test",
        steps: [],
        passes: false,
      }),
    ).toBe(false);
  });
});
