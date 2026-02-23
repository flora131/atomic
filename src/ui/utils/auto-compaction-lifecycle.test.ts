import { describe, expect, test } from "bun:test";
import {
  AUTO_COMPACTION_INDICATOR_IDLE_STATE,
  clearRunningAutoCompactionIndicator,
  completeAutoCompactionIndicator,
  getAutoCompactionIndicatorLabel,
  isAutoCompactionToolName,
  shouldShowAutoCompactionIndicator,
  startAutoCompactionIndicator,
  type AutoCompactionIndicatorState,
} from "./auto-compaction-lifecycle.ts";

describe("auto compaction lifecycle", () => {
  test("detects compact tool name variants", () => {
    expect(isAutoCompactionToolName("compact")).toBe(true);
    expect(isAutoCompactionToolName("mcp/context_compact")).toBe(true);
    expect(isAutoCompactionToolName("mcp__server__compact")).toBe(true);
    expect(isAutoCompactionToolName("PreCompactHook")).toBe(true);
    expect(isAutoCompactionToolName("read")).toBe(false);
  });

  test("starts indicator when compaction begins", () => {
    const next = startAutoCompactionIndicator(
      AUTO_COMPACTION_INDICATOR_IDLE_STATE,
      "compact",
    );

    expect(next).toEqual({ status: "running" });
    expect(shouldShowAutoCompactionIndicator(next)).toBe(true);
    expect(getAutoCompactionIndicatorLabel(next)).toBe("in progress");
  });

  test("ignores non-compaction tool starts", () => {
    const current: AutoCompactionIndicatorState = { status: "idle" };
    const next = startAutoCompactionIndicator(current, "Read");

    expect(next).toBe(current);
  });

  test("transitions to completed on successful finish", () => {
    const running: AutoCompactionIndicatorState = { status: "running" };
    const next = completeAutoCompactionIndicator(running, "compact", true);

    expect(next).toEqual({ status: "completed" });
    expect(getAutoCompactionIndicatorLabel(next)).toBe("completed");
    expect(shouldShowAutoCompactionIndicator(next)).toBe(true);
  });

  test("transitions to error on failed finish", () => {
    const running: AutoCompactionIndicatorState = { status: "running" };
    const next = completeAutoCompactionIndicator(
      running,
      "context_compact",
      false,
      "token limit exceeded",
    );

    expect(next).toEqual({
      status: "error",
      errorMessage: "token limit exceeded",
    });
    expect(getAutoCompactionIndicatorLabel(next)).toContain("failed");
    expect(shouldShowAutoCompactionIndicator(next)).toBe(true);
  });

  test("keeps running indicator visible when unrelated tools complete", () => {
    const running: AutoCompactionIndicatorState = { status: "running" };
    const next = completeAutoCompactionIndicator(running, "read", true);

    expect(next).toBe(running);
    expect(shouldShowAutoCompactionIndicator(next)).toBe(true);
    expect(getAutoCompactionIndicatorLabel(next)).toBe("in progress");
  });

  test("visibility transitions from running to result to idle", () => {
    const started = startAutoCompactionIndicator(
      AUTO_COMPACTION_INDICATOR_IDLE_STATE,
      "compact",
    );
    const completed = completeAutoCompactionIndicator(started, "compact", true);

    expect(shouldShowAutoCompactionIndicator(started)).toBe(true);
    expect(shouldShowAutoCompactionIndicator(completed)).toBe(true);
    expect(getAutoCompactionIndicatorLabel(completed)).toBe("completed");
    expect(shouldShowAutoCompactionIndicator(AUTO_COMPACTION_INDICATOR_IDLE_STATE)).toBe(false);
  });

  test("clears running indicator on interruption", () => {
    const running: AutoCompactionIndicatorState = { status: "running" };
    const next = clearRunningAutoCompactionIndicator(running);

    expect(next).toEqual(AUTO_COMPACTION_INDICATOR_IDLE_STATE);
    expect(shouldShowAutoCompactionIndicator(next)).toBe(false);
  });

  test("keeps terminal states untouched when interrupted", () => {
    const completed: AutoCompactionIndicatorState = { status: "completed" };
    const errored: AutoCompactionIndicatorState = { status: "error" };

    expect(clearRunningAutoCompactionIndicator(completed)).toBe(completed);
    expect(clearRunningAutoCompactionIndicator(errored)).toBe(errored);
  });
});
