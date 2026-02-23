import { describe, expect, test } from "bun:test";
import { shouldShowCompletionSummary } from "./utils/loading-state.ts";

describe("shouldShowCompletionSummary", () => {
  test("returns true for completed assistant messages >= 1s with no active background agents", () => {
    expect(shouldShowCompletionSummary({ streaming: false, durationMs: 5000 }, false)).toBe(true);
  });

  test("returns false while streaming", () => {
    expect(shouldShowCompletionSummary({ streaming: true, durationMs: 5000 }, false)).toBe(false);
  });

  test("returns false when background agents are still active", () => {
    expect(shouldShowCompletionSummary({ streaming: false, durationMs: 5000 }, true)).toBe(false);
  });

  test("returns false when duration is below threshold", () => {
    expect(shouldShowCompletionSummary({ streaming: false, durationMs: 999 }, false)).toBe(false);
  });

  test("returns false when duration is missing", () => {
    expect(shouldShowCompletionSummary({ streaming: false }, false)).toBe(false);
  });
});
