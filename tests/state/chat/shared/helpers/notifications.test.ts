import { describe, expect, test } from "bun:test";
import {
  formatSessionTruncationMessage,
  getAutoCompactionIndicatorState,
} from "@/state/chat/shared/helpers/notifications.ts";
import { MISC } from "@/theme/icons.ts";

describe("formatSessionTruncationMessage", () => {
  test("formats singular message correctly", () => {
    const result = formatSessionTruncationMessage(1000, 1);
    expect(result).toBe(
      `${MISC.warning} Context truncated: ${(1000).toLocaleString()} tokens removed (1 message)`,
    );
    expect(result).toContain("1 message)");
    expect(result).not.toContain("messages");
  });

  test("formats plural messages correctly", () => {
    const result = formatSessionTruncationMessage(5000, 3);
    expect(result).toBe(
      `${MISC.warning} Context truncated: ${(5000).toLocaleString()} tokens removed (3 messages)`,
    );
    expect(result).toContain("3 messages)");
  });

  test("formats zero messages as plural", () => {
    const result = formatSessionTruncationMessage(0, 0);
    expect(result).toContain("0 messages)");
  });

  test("formats large token counts with locale separators", () => {
    const result = formatSessionTruncationMessage(1_000_000, 50);
    expect(result).toContain((1_000_000).toLocaleString());
  });

  test("includes warning icon", () => {
    const result = formatSessionTruncationMessage(100, 2);
    expect(result).toStartWith(MISC.warning);
  });
});

describe("getAutoCompactionIndicatorState", () => {
  test("returns running for start phase", () => {
    const state = getAutoCompactionIndicatorState("start");
    expect(state).toEqual({ status: "running" });
  });

  test("returns running for start phase even with success/error args", () => {
    const state = getAutoCompactionIndicatorState("start", false, "some error");
    expect(state).toEqual({ status: "running" });
  });

  test("returns completed for complete phase with default success", () => {
    const state = getAutoCompactionIndicatorState("complete");
    expect(state).toEqual({ status: "completed" });
  });

  test("returns completed for complete phase with success=true", () => {
    const state = getAutoCompactionIndicatorState("complete", true);
    expect(state).toEqual({ status: "completed" });
  });

  test("returns error for complete phase with success=false", () => {
    const state = getAutoCompactionIndicatorState("complete", false, "Something went wrong");
    expect(state).toEqual({ status: "error", errorMessage: "Something went wrong" });
  });

  test("trims error message whitespace", () => {
    const state = getAutoCompactionIndicatorState("complete", false, "  spaced error  ");
    expect(state).toEqual({ status: "error", errorMessage: "spaced error" });
  });

  test("returns undefined errorMessage for empty error string", () => {
    const state = getAutoCompactionIndicatorState("complete", false, "");
    expect(state).toEqual({ status: "error", errorMessage: undefined });
  });

  test("returns undefined errorMessage for whitespace-only error string", () => {
    const state = getAutoCompactionIndicatorState("complete", false, "   ");
    expect(state).toEqual({ status: "error", errorMessage: undefined });
  });

  test("returns undefined errorMessage when error is not provided on failure", () => {
    const state = getAutoCompactionIndicatorState("complete", false);
    expect(state).toEqual({ status: "error", errorMessage: undefined });
  });
});
