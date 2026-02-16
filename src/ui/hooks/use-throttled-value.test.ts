/**
 * Tests for useThrottledValue hook
 * 
 * Note: These are basic validation tests. Full hook testing would require
 * a React testing environment with @testing-library/react.
 */
import { describe, expect, test } from "bun:test";
import { useThrottledValue } from "./use-throttled-value";

describe("useThrottledValue", () => {
  test("should export the hook function", () => {
    expect(typeof useThrottledValue).toBe("function");
  });

  test("should accept at least one parameter", () => {
    // Function length is 1 because intervalMs has a default value
    expect(useThrottledValue.length).toBe(1);
  });

  test("should be a named export", () => {
    expect(useThrottledValue.name).toBe("useThrottledValue");
  });
});
