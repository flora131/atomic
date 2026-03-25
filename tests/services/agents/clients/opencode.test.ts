import { describe, expect, test } from "bun:test";
import {
  isContextOverflowError,
  CONTEXT_OVERFLOW_PATTERNS,
} from "@/services/agents/clients/opencode/shared.ts";
import {
  AUTO_COMPACTION_THRESHOLD,
  COMPACTION_TERMINAL_ERROR_MESSAGE,
  OpenCodeCompactionError,
  transitionOpenCodeCompactionControl,
} from "@/services/agents/clients/opencode/compaction.ts";
import type { OpenCodeCompactionControl } from "@/services/agents/clients/opencode/compaction.ts";

// ---------------------------------------------------------------------------
// isContextOverflowError
// ---------------------------------------------------------------------------
describe("isContextOverflowError", () => {
  test('returns true for "ContextOverflowError" message', () => {
    expect(isContextOverflowError("ContextOverflowError")).toBe(true);
  });

  test('returns true for "context_length_exceeded"', () => {
    expect(isContextOverflowError("context_length_exceeded")).toBe(true);
  });

  test('returns true for "context window" substring', () => {
    expect(isContextOverflowError("The context window has been exceeded")).toBe(
      true,
    );
  });

  test('returns true for "too many tokens"', () => {
    expect(isContextOverflowError("too many tokens in the request")).toBe(true);
  });

  test("returns true for Error object with matching message", () => {
    const err = new Error("context_length_exceeded");
    expect(isContextOverflowError(err)).toBe(true);
  });

  test("returns false for empty string", () => {
    expect(isContextOverflowError("")).toBe(false);
  });

  test("returns false for unrelated error message", () => {
    expect(isContextOverflowError("Something went wrong")).toBe(false);
  });

  test("matching is case insensitive", () => {
    expect(isContextOverflowError("CONTEXT_LENGTH_EXCEEDED")).toBe(true);
    expect(isContextOverflowError("Context Window Full")).toBe(true);
    expect(isContextOverflowError("TOO MANY TOKENS")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CONTEXT_OVERFLOW_PATTERNS
// ---------------------------------------------------------------------------
describe("CONTEXT_OVERFLOW_PATTERNS", () => {
  test("is a non-empty array", () => {
    expect(Array.isArray(CONTEXT_OVERFLOW_PATTERNS)).toBe(true);
    expect(CONTEXT_OVERFLOW_PATTERNS.length).toBeGreaterThan(0);
  });

  test("contains expected patterns", () => {
    expect(CONTEXT_OVERFLOW_PATTERNS).toContain("context_length_exceeded");
    expect(CONTEXT_OVERFLOW_PATTERNS).toContain("context window");
    expect(CONTEXT_OVERFLOW_PATTERNS).toContain("too many tokens");
    expect(CONTEXT_OVERFLOW_PATTERNS).toContain("token limit");
  });
});

// ---------------------------------------------------------------------------
// AUTO_COMPACTION_THRESHOLD
// ---------------------------------------------------------------------------
describe("AUTO_COMPACTION_THRESHOLD", () => {
  test("is a positive number", () => {
    expect(typeof AUTO_COMPACTION_THRESHOLD).toBe("number");
    expect(AUTO_COMPACTION_THRESHOLD).toBeGreaterThan(0);
  });

  test("is between 0 and 1 (a ratio)", () => {
    expect(AUTO_COMPACTION_THRESHOLD).toBeGreaterThan(0);
    expect(AUTO_COMPACTION_THRESHOLD).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// COMPACTION_TERMINAL_ERROR_MESSAGE
// ---------------------------------------------------------------------------
describe("COMPACTION_TERMINAL_ERROR_MESSAGE", () => {
  test("is a non-empty string", () => {
    expect(typeof COMPACTION_TERMINAL_ERROR_MESSAGE).toBe("string");
    expect(COMPACTION_TERMINAL_ERROR_MESSAGE.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// OpenCodeCompactionError
// ---------------------------------------------------------------------------
describe("OpenCodeCompactionError", () => {
  test("can be instantiated", () => {
    const error = new OpenCodeCompactionError(
      "COMPACTION_FAILED",
      "test message",
    );
    expect(error).toBeDefined();
    expect(error.message).toBe("test message");
    expect(error.code).toBe("COMPACTION_FAILED");
    expect(error.name).toBe("OpenCodeCompactionError");
  });

  test("is an instance of Error", () => {
    const error = new OpenCodeCompactionError(
      "COMPACTION_TIMEOUT",
      "timeout error",
    );
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(OpenCodeCompactionError);
  });
});

// ---------------------------------------------------------------------------
// transitionOpenCodeCompactionControl
// ---------------------------------------------------------------------------
describe("transitionOpenCodeCompactionControl", () => {
  const fixedNow = 1_700_000_000_000;

  function makeControl(
    overrides: Partial<OpenCodeCompactionControl> = {},
  ): OpenCodeCompactionControl {
    return {
      state: "STREAMING",
      startedAt: null,
      ...overrides,
    };
  }

  test("stream.start transitions any state to STREAMING", () => {
    const result = transitionOpenCodeCompactionControl(
      makeControl({ state: "COMPACTING", startedAt: fixedNow }),
      "stream.start",
      { now: fixedNow },
    );
    expect(result.state).toBe("STREAMING");
    expect(result.startedAt).toBeNull();
  });

  test("compaction.start transitions STREAMING to COMPACTING", () => {
    const result = transitionOpenCodeCompactionControl(
      makeControl({ state: "STREAMING" }),
      "compaction.start",
      { now: fixedNow },
    );
    expect(result.state).toBe("COMPACTING");
    expect(result.startedAt).toBe(fixedNow);
  });

  test("compaction.start from non-STREAMING throws OpenCodeCompactionError", () => {
    expect(() =>
      transitionOpenCodeCompactionControl(
        makeControl({ state: "COMPACTING", startedAt: fixedNow }),
        "compaction.start",
        { now: fixedNow },
      ),
    ).toThrow(OpenCodeCompactionError);
  });

  test("compaction.complete.success from COMPACTING transitions to STREAMING", () => {
    const result = transitionOpenCodeCompactionControl(
      makeControl({ state: "COMPACTING", startedAt: fixedNow }),
      "compaction.complete.success",
      { now: fixedNow },
    );
    expect(result.state).toBe("STREAMING");
    expect(result.startedAt).toBeNull();
  });

  test("compaction.complete.success from TERMINAL_ERROR is a no-op", () => {
    const current = makeControl({
      state: "TERMINAL_ERROR",
      startedAt: fixedNow,
      errorCode: "COMPACTION_FAILED",
    });
    const result = transitionOpenCodeCompactionControl(
      current,
      "compaction.complete.success",
      { now: fixedNow },
    );
    expect(result).toBe(current); // same reference — no-op
  });

  test("compaction.complete.success from ENDED is a no-op", () => {
    const current = makeControl({
      state: "ENDED",
      startedAt: fixedNow,
      errorCode: "COMPACTION_FAILED",
    });
    const result = transitionOpenCodeCompactionControl(
      current,
      "compaction.complete.success",
      { now: fixedNow },
    );
    expect(result).toBe(current);
  });

  test("compaction.complete.error from COMPACTING transitions to TERMINAL_ERROR", () => {
    const result = transitionOpenCodeCompactionControl(
      makeControl({ state: "COMPACTING", startedAt: fixedNow }),
      "compaction.complete.error",
      { now: fixedNow, errorCode: "COMPACTION_TIMEOUT", errorMessage: "timed out" },
    );
    expect(result.state).toBe("TERMINAL_ERROR");
    expect(result.errorCode).toBe("COMPACTION_TIMEOUT");
    expect(result.errorMessage).toBe("timed out");
    expect(result.startedAt).toBe(fixedNow);
  });

  test("compaction.complete.error uses default errorCode and errorMessage when not provided", () => {
    const result = transitionOpenCodeCompactionControl(
      makeControl({ state: "COMPACTING", startedAt: fixedNow }),
      "compaction.complete.error",
      { now: fixedNow },
    );
    expect(result.state).toBe("TERMINAL_ERROR");
    expect(result.errorCode).toBe("COMPACTION_FAILED");
    expect(result.errorMessage).toBe(COMPACTION_TERMINAL_ERROR_MESSAGE);
  });

  test("compaction.complete.error from non-COMPACTING (non-terminal) throws", () => {
    expect(() =>
      transitionOpenCodeCompactionControl(
        makeControl({ state: "STREAMING" }),
        "compaction.complete.error",
        { now: fixedNow },
      ),
    ).toThrow(OpenCodeCompactionError);
  });

  test("compaction.complete.error from TERMINAL_ERROR is a no-op", () => {
    const current = makeControl({
      state: "TERMINAL_ERROR",
      startedAt: fixedNow,
      errorCode: "COMPACTION_FAILED",
    });
    const result = transitionOpenCodeCompactionControl(
      current,
      "compaction.complete.error",
      { now: fixedNow },
    );
    expect(result).toBe(current);
  });

  test("turn.ended from TERMINAL_ERROR transitions to ENDED", () => {
    const current = makeControl({
      state: "TERMINAL_ERROR",
      startedAt: fixedNow,
      errorCode: "COMPACTION_FAILED",
      errorMessage: "failed",
    });
    const result = transitionOpenCodeCompactionControl(
      current,
      "turn.ended",
      { now: fixedNow },
    );
    expect(result.state).toBe("ENDED");
    expect(result.errorCode).toBe("COMPACTION_FAILED");
    expect(result.errorMessage).toBe("failed");
    expect(result.startedAt).toBe(fixedNow);
  });

  test("turn.ended from non-TERMINAL_ERROR is a no-op", () => {
    const current = makeControl({ state: "STREAMING" });
    const result = transitionOpenCodeCompactionControl(
      current,
      "turn.ended",
      { now: fixedNow },
    );
    expect(result).toBe(current);
  });
});
