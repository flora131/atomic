/**
 * Ralph Node Utilities
 *
 * Re-exports Ralph prompt builders from the workflow module and retains
 * parser utilities used by node-level tests and call sites.
 */

import type { ReviewFinding, ReviewResult } from "../../ralph/prompts.ts";

export {
    type TaskItem,
    type ReviewFinding,
    type ReviewResult,
    buildSpecToTasksPrompt,
    buildTaskListPreamble,
    buildWorkerAssignment,
    buildBootstrappedTaskContext,
    buildContinuePrompt,
    buildDagDispatchPrompt,
    buildReviewPrompt,
    buildFixSpecFromReview,
} from "../../ralph/prompts.ts";

/** Parse the reviewer's JSON output, handling various formats */
export function parseReviewResult(content: string): ReviewResult | null {
    try {
        // First try: direct JSON parsing
        const parsed = JSON.parse(content);
        if (parsed.findings && parsed.overall_correctness) {
            // Filter out low-priority findings (P3)
            const actionableFindings = (
                parsed.findings as ReviewFinding[]
            ).filter((f) => f.priority === undefined || f.priority <= 2);
            return {
                ...parsed,
                findings: actionableFindings,
            };
        }
    } catch {
        // Continue to next attempt
    }

    try {
        // Second try: extract from markdown code fence
        const codeBlockMatch = content.match(
            /```(?:json)?\s*\n([\s\S]*?)\n```/,
        );
        if (codeBlockMatch?.[1]) {
            const parsed = JSON.parse(codeBlockMatch[1]);
            if (parsed.findings && parsed.overall_correctness) {
                const actionableFindings = (
                    parsed.findings as ReviewFinding[]
                ).filter((f) => f.priority === undefined || f.priority <= 2);
                return {
                    ...parsed,
                    findings: actionableFindings,
                };
            }
        }
    } catch {
        // Continue to next attempt
    }

    try {
        // Third try: extract JSON object from surrounding prose
        const jsonObjectMatch = content.match(/\{[\s\S]*"findings"[\s\S]*\}/);
        if (jsonObjectMatch) {
            const parsed = JSON.parse(jsonObjectMatch[0]);
            if (parsed.findings && parsed.overall_correctness) {
                const actionableFindings = (
                    parsed.findings as ReviewFinding[]
                ).filter((f) => f.priority === undefined || f.priority <= 2);
                return {
                    ...parsed,
                    findings: actionableFindings,
                };
            }
        }
    } catch {
        // All attempts failed
    }

    return null;
}
