/**
 * Review analysis helpers for the Ralph workflow.
 *
 * Simplified versions of the internal conductor-based helpers,
 * operating on direct values instead of StageOutput maps.
 */

import type { ReviewResult } from "./prompts.ts";

/**
 * Check whether the reviewer produced actionable findings.
 *
 * Returns true when:
 * 1. The parsed ReviewResult has one or more findings, OR
 * 2. The review could not be parsed (null) but the raw response
 *    text is non-empty (treat unparseable output as actionable).
 *
 * @param review  - Parsed ReviewResult, or null if parsing failed.
 * @param rawText - The raw reviewer response text.
 */
export function hasActionableFindings(
  review: ReviewResult | null,
  rawText: string,
): boolean {
  if (review !== null && review.findings.length > 0) {
    return true;
  }
  if (review === null && rawText.trim().length > 0) {
    return true;
  }
  return false;
}
