/**
 * Tests for createReviewLoopTerminator
 *
 * Verifies the stateful predicate factory that tracks consecutive clean
 * reviews and terminates the reviewer↔debugger loop when the threshold
 * is reached.
 */

import { describe, test, expect } from "bun:test";
import { createReviewLoopTerminator } from "@/services/workflows/builtin/ralph/ralph-workflow.ts";
import type { BaseState } from "@/services/workflows/graph/types.ts";
import type { StageOutput } from "@/services/workflows/conductor/types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBaseState(
  reviewerOutput?: Partial<StageOutput>,
): BaseState {
  const outputs: Record<string, unknown> = {};
  if (reviewerOutput) {
    outputs["reviewer"] = {
      stageId: "reviewer",
      rawResponse: "",
      status: "completed",
      ...reviewerOutput,
    } satisfies StageOutput;
  }
  return {
    executionId: "test-execution",
    lastUpdated: new Date().toISOString(),
    outputs,
  };
}

/** State where the reviewer found issues (has actionable findings). */
function stateWithFindings(): BaseState {
  return makeBaseState({
    rawResponse: JSON.stringify({
      findings: [{ title: "Bug", description: "Something is wrong" }],
      overall_correctness: "patch is incorrect",
    }),
    parsedOutput: {
      reviewResult: {
        findings: [{ title: "Bug", description: "Something is wrong" }],
        overall_correctness: "patch is incorrect",
      },
    },
  });
}

/** State where the reviewer found no issues (clean review). */
function stateWithCleanReview(): BaseState {
  return makeBaseState({
    rawResponse: JSON.stringify({
      findings: [],
      overall_correctness: "patch is correct",
    }),
    parsedOutput: {
      reviewResult: {
        findings: [],
        overall_correctness: "patch is correct",
      },
    },
  });
}

/** State where there is no reviewer output at all. */
function stateWithNoReviewer(): BaseState {
  return makeBaseState();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createReviewLoopTerminator", () => {
  // -----------------------------------------------------------------------
  // Basic factory behavior
  // -----------------------------------------------------------------------

  test("returns a function", () => {
    const terminator = createReviewLoopTerminator();
    expect(typeof terminator).toBe("function");
  });

  test("default threshold is 2", () => {
    const terminator = createReviewLoopTerminator();

    // First clean review: counter = 1, threshold = 2 → continue
    expect(terminator(stateWithCleanReview())).toBe(false);

    // Second clean review: counter = 2, threshold = 2 → terminate
    expect(terminator(stateWithCleanReview())).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Threshold = 1 (terminate on first clean review)
  // -----------------------------------------------------------------------

  test("threshold 1 terminates on first clean review", () => {
    const terminator = createReviewLoopTerminator(1);
    expect(terminator(stateWithCleanReview())).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Increment behavior (consecutive clean reviews)
  // -----------------------------------------------------------------------

  test("increments consecutive clean count on each clean review", () => {
    const terminator = createReviewLoopTerminator(3);

    // 1st clean: counter = 1 < 3
    expect(terminator(stateWithCleanReview())).toBe(false);
    // 2nd clean: counter = 2 < 3
    expect(terminator(stateWithCleanReview())).toBe(false);
    // 3rd clean: counter = 3 >= 3 → terminate
    expect(terminator(stateWithCleanReview())).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Reset behavior (findings reset counter)
  // -----------------------------------------------------------------------

  test("resets counter when findings are detected", () => {
    const terminator = createReviewLoopTerminator(2);

    // 1st clean: counter = 1
    expect(terminator(stateWithCleanReview())).toBe(false);

    // Findings detected: counter resets to 0
    expect(terminator(stateWithFindings())).toBe(false);

    // 1st clean after reset: counter = 1
    expect(terminator(stateWithCleanReview())).toBe(false);

    // 2nd clean after reset: counter = 2 >= 2 → terminate
    expect(terminator(stateWithCleanReview())).toBe(true);
  });

  test("multiple resets before reaching threshold", () => {
    const terminator = createReviewLoopTerminator(2);

    // Clean → findings → clean → findings → clean → clean → terminate
    expect(terminator(stateWithCleanReview())).toBe(false); // counter = 1
    expect(terminator(stateWithFindings())).toBe(false); // counter = 0
    expect(terminator(stateWithCleanReview())).toBe(false); // counter = 1
    expect(terminator(stateWithFindings())).toBe(false); // counter = 0
    expect(terminator(stateWithCleanReview())).toBe(false); // counter = 1
    expect(terminator(stateWithCleanReview())).toBe(true); // counter = 2 → done
  });

  // -----------------------------------------------------------------------
  // Edge: no reviewer output (treated as clean, no findings)
  // -----------------------------------------------------------------------

  test("no reviewer output counts as clean (no findings)", () => {
    const terminator = createReviewLoopTerminator(2);

    expect(terminator(stateWithNoReviewer())).toBe(false); // counter = 1
    expect(terminator(stateWithNoReviewer())).toBe(true); // counter = 2
  });

  // -----------------------------------------------------------------------
  // Edge: reviewer output with non-empty rawResponse but no parsedOutput
  // (hasActionableFindings treats this as having findings)
  // -----------------------------------------------------------------------

  test("raw response without parsed output counts as findings", () => {
    const terminator = createReviewLoopTerminator(2);

    const stateWithRawOnly = makeBaseState({
      rawResponse: "Something went wrong with the implementation",
      // no parsedOutput → parseReviewResult returns null, but rawResponse is non-empty
    });

    // hasActionableFindings returns true for non-empty rawResponse with null review
    expect(terminator(stateWithRawOnly)).toBe(false); // counter reset to 0
    expect(terminator(stateWithCleanReview())).toBe(false); // counter = 1
    expect(terminator(stateWithCleanReview())).toBe(true); // counter = 2
  });

  // -----------------------------------------------------------------------
  // Each factory call creates independent state
  // -----------------------------------------------------------------------

  test("each factory call creates independent closures", () => {
    const terminator1 = createReviewLoopTerminator(2);
    const terminator2 = createReviewLoopTerminator(2);

    // Advance terminator1 but not terminator2
    terminator1(stateWithCleanReview()); // t1: counter = 1

    // terminator2 should still be at 0
    expect(terminator2(stateWithCleanReview())).toBe(false); // t2: counter = 1
    expect(terminator1(stateWithCleanReview())).toBe(true); // t1: counter = 2 → done
    expect(terminator2(stateWithCleanReview())).toBe(true); // t2: counter = 2 → done
  });

  // -----------------------------------------------------------------------
  // Findings-only sequences never terminate
  // -----------------------------------------------------------------------

  test("never terminates with continuous findings", () => {
    const terminator = createReviewLoopTerminator(2);

    for (let i = 0; i < 10; i++) {
      expect(terminator(stateWithFindings())).toBe(false);
    }
  });

  // -----------------------------------------------------------------------
  // Continues returning true after threshold is reached
  // -----------------------------------------------------------------------

  test("continues returning true after threshold is reached", () => {
    const terminator = createReviewLoopTerminator(1);

    expect(terminator(stateWithCleanReview())).toBe(true); // counter = 1 → done
    // Subsequent calls with clean reviews keep incrementing past threshold
    expect(terminator(stateWithCleanReview())).toBe(true); // counter = 2 → still done
  });

  // -----------------------------------------------------------------------
  // Reviewer with error status has no actionable findings
  // -----------------------------------------------------------------------

  test("reviewer with error status has no actionable findings", () => {
    const terminator = createReviewLoopTerminator(2);

    const stateWithError = makeBaseState({
      status: "error",
      rawResponse: "Error occurred",
      error: "Something failed",
    });

    // hasActionableFindings returns false for non-completed status
    expect(terminator(stateWithError)).toBe(false); // counter = 1
    expect(terminator(stateWithError)).toBe(true); // counter = 2
  });
});
