import type { StageOutput } from "@/services/workflows/conductor/types.ts";
import type { BaseState } from "@/services/workflows/graph/types.ts";
import { parseReviewResult, type ReviewResult } from "./prompts.ts";

export function getReviewResult(
  stageOutputs: ReadonlyMap<string, StageOutput>,
): ReviewResult | null {
  const reviewerOutput = stageOutputs.get("reviewer");
  if (!reviewerOutput || reviewerOutput.status !== "completed") {
    return null;
  }
  if (reviewerOutput.parsedOutput !== undefined) {
    const mapped = reviewerOutput.parsedOutput as {
      reviewResult: ReviewResult | null;
    };
    return mapped.reviewResult ?? null;
  }
  return parseReviewResult(reviewerOutput.rawResponse);
}

export function hasActionableFindings(
  stageOutputs: ReadonlyMap<string, StageOutput>,
): boolean {
  const reviewerOutput = stageOutputs.get("reviewer");
  if (!reviewerOutput || reviewerOutput.status !== "completed") {
    return false;
  }
  const review = getReviewResult(stageOutputs);
  if (review !== null && review.findings.length > 0) {
    return true;
  }
  if (review === null && reviewerOutput.rawResponse.trim().length > 0) {
    return true;
  }
  return false;
}

/**
 * Factory that creates a stateful predicate for terminating the
 * reviewer↔debugger loop. The returned closure tracks **consecutive
 * clean reviews** — reviews where `hasActionableFindings` returns
 * `false`.
 *
 * - When the review is clean: increment the counter. If the counter
 *   reaches `threshold`, return `true` (terminate the loop).
 * - When the review has actionable findings: reset the counter to 0
 *   and return `false` (continue the loop).
 *
 * Designed to be passed as the condition factory for `.break()`.
 *
 * @param threshold - Number of consecutive clean reviews required
 *   before the loop terminates. Defaults to `2`.
 * @returns A `(state: BaseState) => boolean` predicate compatible
 *   with `.break()`.
 */
export function createReviewLoopTerminator(
  threshold: number = 2,
): (state: BaseState) => boolean {
  let consecutiveCleanCount = 0;

  return (state: BaseState): boolean => {
    const stageOutputs = new Map<string, StageOutput>(
      Object.entries(state.outputs) as Array<[string, StageOutput]>,
    );

    if (hasActionableFindings(stageOutputs)) {
      consecutiveCleanCount = 0;
      return false;
    }

    consecutiveCleanCount++;
    return consecutiveCleanCount >= threshold;
  };
}
