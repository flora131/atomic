import { describe, expect, mock, test } from "bun:test";
import {
  consumeWorkflowInputSubmission,
  rejectPendingWorkflowInput,
  STALE_WORKFLOW_INPUT_REASON,
  type WorkflowInputResolver,
} from "@/services/workflows/helpers/workflow-input-resolver.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createResolver(): WorkflowInputResolver & {
  resolveMock: ReturnType<typeof mock>;
  rejectMock: ReturnType<typeof mock>;
} {
  const resolveMock = mock((_prompt: string) => {});
  const rejectMock = mock((_error: Error) => {});
  return {
    resolve: resolveMock,
    reject: rejectMock,
    resolveMock,
    rejectMock,
  };
}

// ---------------------------------------------------------------------------
// STALE_WORKFLOW_INPUT_REASON constant
// ---------------------------------------------------------------------------

describe("STALE_WORKFLOW_INPUT_REASON", () => {
  test("is a non-empty string", () => {
    expect(typeof STALE_WORKFLOW_INPUT_REASON).toBe("string");
    expect(STALE_WORKFLOW_INPUT_REASON.length).toBeGreaterThan(0);
  });

  test("contains expected message", () => {
    expect(STALE_WORKFLOW_INPUT_REASON).toBe("Workflow is no longer active");
  });
});

// ---------------------------------------------------------------------------
// consumeWorkflowInputSubmission
// ---------------------------------------------------------------------------

describe("consumeWorkflowInputSubmission", () => {
  test("resolves pending workflow input when workflow is active", () => {
    const { resolve, reject, resolveMock, rejectMock } = createResolver();

    const result = consumeWorkflowInputSubmission(
      { resolve, reject },
      true,
      "Continue with implementation",
    );

    expect(result).toEqual({ consumed: true, nextResolver: null });
    expect(resolveMock).toHaveBeenCalledTimes(1);
    expect(resolveMock).toHaveBeenCalledWith("Continue with implementation");
    expect(rejectMock).not.toHaveBeenCalled();
  });

  test("rejects stale pending workflow input when workflow is inactive", () => {
    const { resolve, reject, resolveMock, rejectMock } = createResolver();

    const result = consumeWorkflowInputSubmission(
      { resolve, reject },
      false,
      "Follow-up message",
    );

    expect(result).toEqual({ consumed: false, nextResolver: null });
    expect(resolveMock).not.toHaveBeenCalled();
    expect(rejectMock).toHaveBeenCalledTimes(1);
    const rejectionError = rejectMock.mock.calls[0]?.[0];
    expect(rejectionError).toBeInstanceOf(Error);
    expect((rejectionError as Error).message).toBe(STALE_WORKFLOW_INPUT_REASON);
  });

  test("returns consumed=false with null nextResolver when resolver is null", () => {
    const result = consumeWorkflowInputSubmission(null, true, "any prompt");

    expect(result).toEqual({ consumed: false, nextResolver: null });
  });

  test("returns consumed=false when resolver is null and workflow inactive", () => {
    const result = consumeWorkflowInputSubmission(null, false, "any prompt");

    expect(result).toEqual({ consumed: false, nextResolver: null });
  });

  test("always clears the resolver (returns nextResolver: null)", () => {
    const { resolve, reject } = createResolver();

    const activeResult = consumeWorkflowInputSubmission(
      { resolve, reject },
      true,
      "prompt",
    );
    expect(activeResult.nextResolver).toBeNull();

    const { resolve: resolve2, reject: reject2 } = createResolver();
    const inactiveResult = consumeWorkflowInputSubmission(
      { resolve: resolve2, reject: reject2 },
      false,
      "prompt",
    );
    expect(inactiveResult.nextResolver).toBeNull();
  });

  test("handles empty prompt string", () => {
    const { resolve, reject, resolveMock } = createResolver();

    const result = consumeWorkflowInputSubmission(
      { resolve, reject },
      true,
      "",
    );

    expect(result.consumed).toBe(true);
    expect(resolveMock).toHaveBeenCalledWith("");
  });

  test("handles prompt with special characters", () => {
    const { resolve, reject, resolveMock } = createResolver();

    const specialPrompt = "Fix the bug in `src/index.ts`\nLine 42: undefined is not a function";
    const result = consumeWorkflowInputSubmission(
      { resolve, reject },
      true,
      specialPrompt,
    );

    expect(result.consumed).toBe(true);
    expect(resolveMock).toHaveBeenCalledWith(specialPrompt);
  });
});

// ---------------------------------------------------------------------------
// rejectPendingWorkflowInput
// ---------------------------------------------------------------------------

describe("rejectPendingWorkflowInput", () => {
  test("rejects and clears a pending resolver with custom reason", () => {
    const { resolve, reject, resolveMock, rejectMock } = createResolver();

    const next = rejectPendingWorkflowInput(
      { resolve, reject },
      "Workflow ended before input was received",
    );

    expect(next).toBeNull();
    expect(resolveMock).not.toHaveBeenCalled();
    expect(rejectMock).toHaveBeenCalledTimes(1);
    const rejectionError = rejectMock.mock.calls[0]?.[0];
    expect(rejectionError).toBeInstanceOf(Error);
    expect((rejectionError as Error).message).toBe(
      "Workflow ended before input was received",
    );
  });

  test("uses default STALE_WORKFLOW_INPUT_REASON when no reason is provided", () => {
    const { resolve, reject, rejectMock } = createResolver();

    const next = rejectPendingWorkflowInput({ resolve, reject });

    expect(next).toBeNull();
    expect(rejectMock).toHaveBeenCalledTimes(1);
    const rejectionError = rejectMock.mock.calls[0]?.[0];
    expect(rejectionError).toBeInstanceOf(Error);
    expect((rejectionError as Error).message).toBe(STALE_WORKFLOW_INPUT_REASON);
  });

  test("no-ops when resolver is already null", () => {
    const next = rejectPendingWorkflowInput(null);
    expect(next).toBeNull();
  });

  test("no-ops with custom reason when resolver is null", () => {
    const next = rejectPendingWorkflowInput(null, "Custom reason");
    expect(next).toBeNull();
  });

  test("always returns null regardless of input", () => {
    const { resolve, reject } = createResolver();

    expect(rejectPendingWorkflowInput({ resolve, reject })).toBeNull();
    expect(rejectPendingWorkflowInput({ resolve, reject }, "reason")).toBeNull();
    expect(rejectPendingWorkflowInput(null)).toBeNull();
    expect(rejectPendingWorkflowInput(null, "reason")).toBeNull();
  });
});
