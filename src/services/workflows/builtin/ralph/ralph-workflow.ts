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
import {
  buildSpecToTasksPrompt,
  buildOrchestratorPrompt,
  buildReviewPrompt,
  buildFixSpecFromReview,
  buildFixSpecFromRawReview,
  parseReviewResult,
} from "@/services/workflows/builtin/ralph/helpers/prompts.ts";
import { parseTasks } from "@/services/workflows/builtin/ralph/helpers/tasks.ts";
import {
  getReviewResult,
  hasActionableFindings,
  createReviewLoopTerminator,
} from "@/services/workflows/builtin/ralph/helpers/review.ts";

export { createReviewLoopTerminator } from "@/services/workflows/builtin/ralph/helpers/review.ts";
import { VERSION } from "@/version";

// ---------------------------------------------------------------------------
// Workflow Definition via DSL
// ---------------------------------------------------------------------------

// Build the workflow chain once (cheap — just records instructions).
// `.compile()` is deferred to first access via the getter below because it
// triggers agent discovery + YAML parsing (~60ms) which is wasted at import
// time when the workflow isn't actually used.
const _ralphWorkflowBuilder = defineWorkflow({
  name: "ralph",
  description: "Start autonomous implementation workflow",
})
  .version(VERSION)
  .argumentHint('"<prompt-or-spec-path>"')
  .stage({
    name: "planner",
    agent: "planner",
    description: "\u2315 PLANNER",
    prompt: (ctx) => buildSpecToTasksPrompt(ctx.userPrompt),
    outputMapper: (response) => ({ tasks: parseTasks(response) }),
  })
  .stage({
    name: "orchestrator",
    agent: "orchestrator",
    description: "\u26A1 ORCHESTRATOR",
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
  .loop({ maxCycles: 10 })
  .stage({
    name: "reviewer",
    agent: "reviewer",
    description: "\uD83D\uDD0D REVIEWER",
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
  .break(() => createReviewLoopTerminator(2))
  .if((ctx) => hasActionableFindings(ctx.stageOutputs))
  .stage({
    name: "debugger",
    agent: "debugger",
    description: "\uD83D\uDD27 DEBUGGER",
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
  .endLoop();

let _compiledRalphDefinition: ReturnType<typeof _ralphWorkflowBuilder.compile> | null = null;

/**
 * Lazily compiled Ralph workflow definition.
 * The first access triggers `.compile()` which runs agent discovery + YAML
 * parsing (~60ms). Subsequent accesses return the cached result.
 */
export function getRalphWorkflowDefinition() {
  if (!_compiledRalphDefinition) {
    _compiledRalphDefinition = _ralphWorkflowBuilder.compile();
  }
  return _compiledRalphDefinition;
}

