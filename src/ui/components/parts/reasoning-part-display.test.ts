import { describe, expect, test } from "bun:test";
import { formatReasoningDurationSeconds } from "./reasoning-part-display.tsx";

describe("formatReasoningDurationSeconds", () => {
  test("returns empty string for non-positive durations", () => {
    expect(formatReasoningDurationSeconds(0)).toBe("");
    expect(formatReasoningDurationSeconds(-100)).toBe("");
  });

  test("formats duration as whole-number seconds", () => {
    expect(formatReasoningDurationSeconds(100)).toBe("1s");
    expect(formatReasoningDurationSeconds(1400)).toBe("1s");
    expect(formatReasoningDurationSeconds(1500)).toBe("2s");
    expect(formatReasoningDurationSeconds(5400)).toBe("5s");
  });
});
