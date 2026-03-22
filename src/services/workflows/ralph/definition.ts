/**
 * Ralph Workflow Definition
 *
 * Autonomous implementation workflow using the chainable DSL.
 * Replaces the previous multi-file definition with a single defineWorkflow() chain.
 *
 * The DSL chain defines four stages:
 *   1. PLANNER    - decomposes the user prompt into a structured task list
 *   2. ORCHESTRATOR - dispatches tasks in parallel via native sub-agent tools
 *   3. REVIEWER   - reviews completed implementation for correctness issues
 *   4. DEBUGGER   - applies fixes for actionable review findings (conditional)
 *
 * The .compile() call validates the instruction sequence, generates
 * StageDefinition[] and a CompiledGraph, and assembles a WorkflowDefinition.
 */

import { defineWorkflow } from "@/services/workflows/dsl/define-workflow.ts";
import type { StageOutput } from "@/services/workflows/conductor/types.ts";
import type { BaseState } from "@/services/workflows/graph/types.ts";
import {
  buildSpecToTasksPrompt,
  buildOrchestratorPrompt,
  buildReviewPrompt,
  buildFixSpecFromReview,
  buildFixSpecFromRawReview,
  parseReviewResult,
  type ReviewResult,
} from "@/services/workflows/ralph/prompts.ts";
import { parseTasks } from "@/services/workflows/ralph/graph/task-helpers.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getReviewResult(
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

function hasActionableFindings(
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

// ---------------------------------------------------------------------------
// Review Loop Terminator
// ---------------------------------------------------------------------------

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
 * Designed to be passed as the `until` callback in a `LoopConfig`.
 *
 * @param threshold - Number of consecutive clean reviews required
 *   before the loop terminates. Defaults to `2`.
 * @returns A `(state: BaseState) => boolean` predicate compatible
 *   with `LoopConfig.until`.
 */
export function createReviewLoopTerminator(
  threshold: number = 2,
): (state: BaseState) => boolean {
  let consecutiveCleanCount = 0;

  return (state: BaseState): boolean => {
    // Reconstruct a ReadonlyMap<string, StageOutput> from BaseState.outputs
    // so we can reuse the existing hasActionableFindings helper.
    // The conductor stores StageOutput values in state.outputs keyed by stage ID.
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

// ---------------------------------------------------------------------------
// Workflow Definition via DSL
// ---------------------------------------------------------------------------

export const ralphWorkflowDefinition = defineWorkflow(
  "ralph",
  "Start autonomous implementation workflow",
)
  .version("1.0.0")
  .argumentHint('"<prompt-or-spec-path>"')
  .stage("planner", {
    name: "Planner",
    description: "\u2315 PLANNER",
    outputs: ["tasks"],
    prompt: (ctx) => buildSpecToTasksPrompt(ctx.userPrompt),
    outputMapper: (response) => ({ tasks: parseTasks(response) }),
  })
  .stage("orchestrator", {
    name: "Orchestrator",
    description: "\u26A1 ORCHESTRATOR",
    reads: ["tasks"],
    prompt: (ctx) => {
      if (ctx.tasks.length > 0) {
        return buildOrchestratorPrompt([...ctx.tasks]);
      }
      const plannerOutput = ctx.stageOutputs.get("planner");
      if (plannerOutput?.parsedOutput) {
        return buildOrchestratorPrompt(
          plannerOutput.parsedOutput as Array<{
            id?: string;
            description: string;
            status: string;
            summary: string;
            blockedBy?: string[];
          }>,
        );
      }
      if (plannerOutput?.rawResponse) {
        const tasks = parseTasks(plannerOutput.rawResponse);
        if (tasks.length > 0) return buildOrchestratorPrompt(tasks);
      }
      return buildOrchestratorPrompt([]);
    },
    outputMapper: () => ({}),
  })
  .loop({
    createUntil: () => createReviewLoopTerminator(2),
    maxCycles: 10,
  })
  .stage("reviewer", {
    name: "Reviewer",
    description: "\uD83D\uDD0D REVIEWER",
    reads: ["tasks"],
    outputs: ["reviewResult"],
    prompt: (ctx) => {
      const orchestratorOutput = ctx.stageOutputs.get("orchestrator");
      const progressSummary = orchestratorOutput?.rawResponse ?? "";

      // Get prior debugger output from previous loop iteration (if any)
      const debuggerStageOutput = ctx.stageOutputs.get("debugger");
      const priorDebuggerOutput = debuggerStageOutput?.rawResponse;

      return buildReviewPrompt(
        [...ctx.tasks],
        ctx.userPrompt,
        progressSummary,
        priorDebuggerOutput,
      );
    },
    outputMapper: (response) => ({
      reviewResult: parseReviewResult(response),
    }),
  })
  .if((ctx) => hasActionableFindings(ctx.stageOutputs))
  .stage("debugger", {
    name: "Debugger",
    description: "\uD83D\uDD27 DEBUGGER",
    reads: ["reviewResult"],
    prompt: (ctx) => {
      const review = getReviewResult(ctx.stageOutputs);
      const tasks = [...ctx.tasks];
      if (review !== null) {
        const fixSpec = buildFixSpecFromReview(review, tasks, ctx.userPrompt);
        if (fixSpec.trim().length > 0) return fixSpec;
      }
      const reviewerOutput = ctx.stageOutputs.get("reviewer");
      if (reviewerOutput?.rawResponse) {
        const fixSpec = buildFixSpecFromRawReview(
          reviewerOutput.rawResponse,
          ctx.userPrompt,
        );
        if (fixSpec.trim().length > 0) return fixSpec;
      }
      return "# Fix Request\n\nReview the recent implementation for \"" + ctx.userPrompt + "\" and fix any issues found.";
    },
    outputMapper: () => ({}),
  })
  .endIf()
  .endLoop()
  .compile();
