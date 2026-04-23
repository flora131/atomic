/**
 * Review analysis helpers for the Ralph workflow.
 *
 * Simplified versions of the internal conductor-based helpers,
 * operating on direct values instead of StageOutput maps.
 */

import type { ReviewResult } from "./prompts.ts";

/**
 * Check whether the loop should iterate again.
 *
 * Returns true when:
 * 1. The review could not be parsed (null) but the raw response text is
 *    non-empty — treat unparseable output as actionable so the loop keeps
 *    iterating instead of silently exiting on a missing reviewer.
 * 2. The merged review reports `overall_correctness === "patch is incorrect"`.
 *    {@link mergeReviewResults} sets the merged value to "patch is incorrect"
 *    if EITHER reviewer flagged it, so "patch is correct" here means BOTH
 *    reviewers signed off — the only stop condition.
 *
 * @param review  - Parsed (merged) ReviewResult, or null if parsing failed.
 * @param rawText - The raw reviewer response text.
 */
export function hasActionableFindings(
  review: ReviewResult | null,
  rawText: string,
): boolean {
  if (review === null) {
    return rawText.trim().length > 0;
  }
  return review.overall_correctness === "patch is incorrect";
}
