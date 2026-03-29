/**
 * Tests for src/theme/spacing.ts
 */

import { describe, expect, test } from "bun:test";
import { SPACING } from "@/theme/spacing.ts";

const EXPECTED_KEYS = ["NONE", "ELEMENT", "SECTION", "CONTAINER_PAD", "CONTAINER_PAD_LG", "INDENT", "GUTTER"] as const;

describe("SPACING shape", () => {
  test("contains all expected keys", () => {
    for (const key of EXPECTED_KEYS) { expect(SPACING).toHaveProperty(key); }
  });
  test("has exactly the expected number of keys (no extras)", () => {
    expect(Object.keys(SPACING)).toHaveLength(EXPECTED_KEYS.length);
  });
  test("all values are numbers", () => {
    for (const key of EXPECTED_KEYS) { expect(typeof SPACING[key]).toBe("number"); }
  });
  test("all values are non-negative integers", () => {
    for (const key of EXPECTED_KEYS) {
      expect(SPACING[key]).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(SPACING[key])).toBe(true);
    }
  });
});

describe("SPACING values", () => {
  test("NONE is 0", () => { expect(SPACING.NONE).toBe(0); });
  test("ELEMENT is 1", () => { expect(SPACING.ELEMENT).toBe(1); });
  test("SECTION is 1", () => { expect(SPACING.SECTION).toBe(1); });
  test("CONTAINER_PAD is 1", () => { expect(SPACING.CONTAINER_PAD).toBe(1); });
  test("CONTAINER_PAD_LG is 2", () => { expect(SPACING.CONTAINER_PAD_LG).toBe(2); });
  test("INDENT is 2", () => { expect(SPACING.INDENT).toBe(2); });
  test("GUTTER is 3", () => { expect(SPACING.GUTTER).toBe(3); });
});

describe("SPACING semantic ordering", () => {
  test("NONE <= ELEMENT", () => { expect(SPACING.NONE).toBeLessThanOrEqual(SPACING.ELEMENT); });
  test("CONTAINER_PAD <= CONTAINER_PAD_LG", () => { expect(SPACING.CONTAINER_PAD).toBeLessThanOrEqual(SPACING.CONTAINER_PAD_LG); });
  test("ELEMENT <= GUTTER", () => { expect(SPACING.ELEMENT).toBeLessThanOrEqual(SPACING.GUTTER); });
  test("NONE is the smallest value", () => {
    for (const value of Object.values(SPACING)) { expect(SPACING.NONE).toBeLessThanOrEqual(value); }
  });
});

describe("SPACING immutability", () => {
  test("is a non-null object", () => {
    expect(typeof SPACING).toBe("object");
    expect(SPACING).not.toBeNull();
  });
});
