import { describe, expect, mock, test } from "bun:test";
import {
  consumeWorkflowInputSubmission,
  rejectPendingWorkflowInput,
  STALE_WORKFLOW_INPUT_REASON,
} from "./workflow-input-resolver.ts";

describe("consumeWorkflowInputSubmission", () => {
  test("resolves pending workflow input when workflow is active", () => {
    const resolve = mock((_prompt: string) => {});
    const reject = mock((_error: Error) => {});

    const result = consumeWorkflowInputSubmission(
      { resolve, reject },
      true,
      "Continue with implementation",
    );

    expect(result).toEqual({ consumed: true, nextResolver: null });
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith("Continue with implementation");
    expect(reject).not.toHaveBeenCalled();
  });

  test("rejects stale pending workflow input when workflow is inactive", () => {
    const resolve = mock((_prompt: string) => {});
    const reject = mock((_error: Error) => {});

    const result = consumeWorkflowInputSubmission(
      { resolve, reject },
      false,
      "Follow-up message",
    );

    expect(result).toEqual({ consumed: false, nextResolver: null });
    expect(resolve).not.toHaveBeenCalled();
    expect(reject).toHaveBeenCalledTimes(1);
    const rejectionError = reject.mock.calls[0]?.[0];
    expect(rejectionError).toBeInstanceOf(Error);
    expect((rejectionError as Error).message).toBe(STALE_WORKFLOW_INPUT_REASON);
  });
});

describe("rejectPendingWorkflowInput", () => {
  test("rejects and clears a pending resolver", () => {
    const resolve = mock((_prompt: string) => {});
    const reject = mock((_error: Error) => {});

    const next = rejectPendingWorkflowInput(
      { resolve, reject },
      "Workflow ended before input was received",
    );

    expect(next).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
    expect(reject).toHaveBeenCalledTimes(1);
    const rejectionError = reject.mock.calls[0]?.[0];
    expect(rejectionError).toBeInstanceOf(Error);
    expect((rejectionError as Error).message).toBe(
      "Workflow ended before input was received",
    );
  });

  test("no-ops when resolver is already null", () => {
    const next = rejectPendingWorkflowInput(null);
    expect(next).toBeNull();
  });
});
