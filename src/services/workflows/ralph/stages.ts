/**
 * Ralph Stage Definitions
 *
 * Declares the four conductor stages for the Ralph workflow:
 *   1. PLANNER    — decomposes the user prompt into a structured task list
 *   2. ORCHESTRATOR — dispatches tasks in parallel via native sub-agent tools
 *   3. REVIEWER   — reviews completed implementation for correctness issues
 *   4. DEBUGGER   — applies fixes for actionable review findings (conditional)
 *
 * Each stage implements the {@link StageDefinition} contract from the conductor
 * module. The conductor sequences these stages, creating a fresh agent session
 * per stage with an isolated context window.
 *
 * @see specs/ralph-workflow-redesign.md §5.2 for the graph definition.
 * @see src/services/workflows/conductor/types.ts for the StageDefinition contract.
 */

import type { StageDefinition, StageContext, StageOutput } from "@/services/workflows/conductor/types.ts";
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

/**
 * Extract parsed review findings from the reviewer stage output.
 * Returns `null` when the reviewer stage hasn't run or produced no output.
 */
function getReviewResult(stageOutputs: ReadonlyMap<string, StageOutput>): ReviewResult | null {
  const reviewerOutput = stageOutputs.get("reviewer");
  if (!reviewerOutput || reviewerOutput.status !== "completed") {
    return null;
  }

  // Prefer pre-parsed output stored by the reviewer's parseOutput
  if (reviewerOutput.parsedOutput !== undefined) {
    return reviewerOutput.parsedOutput as ReviewResult;
  }

  // Fallback: attempt to parse from raw response
  return parseReviewResult(reviewerOutput.rawResponse);
}

/**
 * Determine whether the reviewer found actionable issues that warrant
 * running the debugger stage.
 *
 * Actionable = the reviewer produced structured findings with at least one
 * entry, OR the raw response is non-empty when structured parsing failed.
 */
function hasActionableFindings(stageOutputs: ReadonlyMap<string, StageOutput>): boolean {
  const reviewerOutput = stageOutputs.get("reviewer");
  if (!reviewerOutput || reviewerOutput.status !== "completed") {
    return false;
  }

  const review = getReviewResult(stageOutputs);
  if (review !== null && review.findings.length > 0) {
    return true;
  }

  // If structured parsing failed but there's raw content, treat as actionable
  if (review === null && reviewerOutput.rawResponse.trim().length > 0) {
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Stage 1: PLANNER
// ---------------------------------------------------------------------------

/**
 * Planner stage — decomposes the user's prompt into a structured task list.
 *
 * Builds a task-decomposition prompt from the user's original request and
 * captures the raw JSON task list. The `parseOutput` function extracts
 * structured `TaskItem[]` for downstream stages to consume.
 */
export const plannerStage: StageDefinition = {
  id: "planner",
  name: "Planner",
  indicator: "⌕ PLANNER",

  buildPrompt(context: StageContext): string {
    return buildSpecToTasksPrompt(context.userPrompt);
  },

  parseOutput(response: string): unknown {
    return parseTasks(response);
  },
};

// ---------------------------------------------------------------------------
// Stage 2: ORCHESTRATOR
// ---------------------------------------------------------------------------

/**
 * Orchestrator stage — manages parallel task execution via the agent's
 * native sub-agent capabilities.
 *
 * Reads the planner's parsed task list and constructs an orchestration
 * prompt that instructs the agent to spawn workers, track progress, and
 * handle failures — replacing the former programmatic dispatch coordinator.
 */
export const orchestratorStage: StageDefinition = {
  id: "orchestrator",
  name: "Orchestrator",
  indicator: "⚡ ORCHESTRATOR",

  buildPrompt(context: StageContext): string {
    // Use tasks from context (populated after planner + parse-tasks)
    if (context.tasks.length > 0) {
      return buildOrchestratorPrompt([...context.tasks]);
    }

    // Fallback: extract tasks from the planner's parsed output
    const plannerOutput = context.stageOutputs.get("planner");
    if (plannerOutput?.parsedOutput) {
      const tasks = plannerOutput.parsedOutput as Array<{ id?: string; description: string; status: string; summary: string; blockedBy?: string[] }>;
      return buildOrchestratorPrompt(tasks);
    }

    // Last resort: re-parse from raw planner response
    if (plannerOutput?.rawResponse) {
      const tasks = parseTasks(plannerOutput.rawResponse);
      if (tasks.length > 0) {
        return buildOrchestratorPrompt(tasks);
      }
    }

    return buildOrchestratorPrompt([]);
  },
};

// ---------------------------------------------------------------------------
// Stage 3: REVIEWER
// ---------------------------------------------------------------------------

/**
 * Reviewer stage — reviews all changes made during the orchestrator stage.
 *
 * Produces structured review findings (JSON) that the debugger stage
 * consumes. The `parseOutput` function extracts `ReviewResult` from the
 * agent's response.
 */
export const reviewerStage: StageDefinition = {
  id: "reviewer",
  name: "Reviewer",
  indicator: "🔍 REVIEWER",

  buildPrompt(context: StageContext): string {
    const tasks = [...context.tasks];

    // Build a progress summary from orchestrator output
    const orchestratorOutput = context.stageOutputs.get("orchestrator");
    const progressSummary = orchestratorOutput?.rawResponse ?? "";

    return buildReviewPrompt(tasks, context.userPrompt, progressSummary);
  },

  parseOutput(response: string): unknown {
    return parseReviewResult(response);
  },
};

// ---------------------------------------------------------------------------
// Stage 4: DEBUGGER
// ---------------------------------------------------------------------------

/**
 * Debugger stage — applies fixes for actionable review findings.
 *
 * Only runs when the reviewer found issues (controlled by `shouldRun`).
 * Constructs a fix specification from the reviewer's structured findings
 * (or raw output as fallback) and sends it to a fresh agent session.
 */
export const debuggerStage: StageDefinition = {
  id: "debugger",
  name: "Debugger",
  indicator: "🔧 DEBUGGER",

  shouldRun(context: StageContext): boolean {
    return hasActionableFindings(context.stageOutputs);
  },

  buildPrompt(context: StageContext): string {
    const review = getReviewResult(context.stageOutputs);
    const tasks = [...context.tasks];

    // Build fix spec from structured review if available
    if (review !== null) {
      const fixSpec = buildFixSpecFromReview(review, tasks, context.userPrompt);
      if (fixSpec.trim().length > 0) {
        return fixSpec;
      }
    }

    // Fallback: build from raw reviewer response
    const reviewerOutput = context.stageOutputs.get("reviewer");
    if (reviewerOutput?.rawResponse) {
      const fixSpec = buildFixSpecFromRawReview(reviewerOutput.rawResponse, context.userPrompt);
      if (fixSpec.trim().length > 0) {
        return fixSpec;
      }
    }

    // Defensive fallback — should not reach here if shouldRun is true
    return `# Fix Request\n\nReview the recent implementation for "${context.userPrompt}" and fix any issues found.`;
  },
};

// ---------------------------------------------------------------------------
// Stage Registry
// ---------------------------------------------------------------------------

/**
 * Ordered array of all Ralph stage definitions.
 *
 * The conductor executes stages in this order, skipping any whose
 * `shouldRun` returns `false`.
 */
export const RALPH_STAGES: readonly StageDefinition[] = [
  plannerStage,
  orchestratorStage,
  reviewerStage,
  debuggerStage,
] as const;
