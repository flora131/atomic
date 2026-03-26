/**
 * Integration tests for the Ralph workflow review/debug loop.
 *
 * These tests exercise the full conductor → graph → loop terminator pipeline
 * using mock sessions, verifying that:
 *
 *   1. Two consecutive clean reviews terminate the loop (clean-code path).
 *   2. Findings → fix → two clean reviews terminate correctly (fix-then-clean path).
 *   3. maxCycles caps the loop when reviews never come back clean.
 *   4. Aborting mid-iteration stops the workflow cleanly.
 */

import { describe, test, expect, mock } from "bun:test";
import { WorkflowSessionConductor } from "@/services/workflows/conductor/conductor.ts";
import type {
  ConductorConfig,
  StageDefinition,
  StageOutput,
} from "@/services/workflows/conductor/types.ts";
import type {
  BaseState,
  CompiledGraph,
} from "@/services/workflows/graph/types.ts";
import type {
  Session,
  AgentMessage,
  SessionConfig,
} from "@/services/agents/types.ts";
import {
  getRalphWorkflowDefinition,
  createReviewLoopTerminator,
} from "@/services/workflows/builtin/ralph/ralph-workflow.ts";

const ralphWorkflowDefinition = getRalphWorkflowDefinition();
import { defineWorkflow } from "@/services/workflows/dsl/define-workflow.ts";
import { parseReviewResult } from "@/services/workflows/builtin/ralph/helpers/prompts.ts";
import { parseTasks } from "@/services/workflows/builtin/ralph/helpers/tasks.ts";

// ---------------------------------------------------------------------------
// Canned Responses
// ---------------------------------------------------------------------------

const PLANNER_RESPONSE = JSON.stringify([
  {
    id: "1",
    description: "Create REST API endpoints",
    status: "pending",
    summary: "Creating API",
    blockedBy: [],
  },
]);

const ORCHESTRATOR_RESPONSE = "All tasks completed successfully.";

const CLEAN_REVIEW = JSON.stringify({
  findings: [],
  overall_correctness: "patch is correct",
  overall_explanation: "Implementation looks clean — no issues found.",
});

const FINDINGS_REVIEW = JSON.stringify({
  findings: [
    {
      title: "Bug",
      body: "Null pointer dereference in request handler",
      priority: 0,
    },
  ],
  overall_correctness: "patch is incorrect",
  overall_explanation: "Found a critical bug that needs fixing.",
});

const DEBUGGER_FIX = "Fixed the issue by adding null checks.";

// ---------------------------------------------------------------------------
// Mock Session Factory
// ---------------------------------------------------------------------------

function createMockSession(response: string): Session {
  return {
    id: `session-${Math.random().toString(36).slice(2, 8)}`,
    send: mock(async () => ({
      type: "text" as const,
      content: response,
    })),
    stream: async function* (
      _message: string,
      _options?: { agent?: string; abortSignal?: AbortSignal },
    ) {
      yield { type: "text" as const, content: response } as AgentMessage;
    },
    summarize: mock(async () => {}),
    getContextUsage: mock(async () => ({
      inputTokens: 100,
      outputTokens: 50,
      maxTokens: 100_000,
      usagePercentage: 0.15,
    })),
    getSystemToolsTokens: () => 0,
    destroy: mock(async () => {}),
  };
}

// ---------------------------------------------------------------------------
// Conductor Builder
// ---------------------------------------------------------------------------

interface MockSessionOptions {
  /**
   * Returns the canned response text for a given stage and its
   * 1-based invocation count within the workflow run.
   */
  getResponse: (stageId: string, callCount: number) => string;

  /** Pre-created AbortController (defaults to a fresh one). */
  abortController?: AbortController;

  /**
   * When set, the session created for this stage (at the given call
   * count) will abort the controller mid-stream instead of yielding
   * a normal response.
   */
  abortDuringStage?: { stage: string; callCount: number };
}

function buildConductor(
  opts: MockSessionOptions,
  graph: CompiledGraph<BaseState>,
  stages: readonly StageDefinition[],
) {
  let currentTargetStage = "";
  const stageCalls: Record<string, number> = {};
  const transitions: Array<{ from: string | null; to: string }> = [];
  const abortController = opts.abortController ?? new AbortController();

  const config: ConductorConfig = {
    graph,
    createSession: async (_config?: SessionConfig) => {
      const stageId = currentTargetStage;
      const count = stageCalls[stageId] ?? 1;

      // Abort-during-stream mock
      if (
        opts.abortDuringStage &&
        opts.abortDuringStage.stage === stageId &&
        opts.abortDuringStage.callCount === count
      ) {
        const base = createMockSession("");
        return {
          ...base,
          stream: async function* () {
            yield {
              type: "text" as const,
              content: "partial output before abort",
            } as AgentMessage;
            abortController.abort();
          },
        } as Session;
      }

      const response = opts.getResponse(stageId, count);
      return createMockSession(response);
    },
    destroySession: mock(async () => {}),
    onStageTransition: (_from: string | null, to: string) => {
      currentTargetStage = to;
      stageCalls[to] = (stageCalls[to] ?? 0) + 1;
      transitions.push({ from: _from, to });
    },
    onTaskUpdate: mock(() => {}),
    abortSignal: abortController.signal,
  };

  const conductor = new WorkflowSessionConductor(config, stages);
  return { conductor, transitions, stageCalls, abortController };
}

// ---------------------------------------------------------------------------
// Helper: hasActionableFindings (mirrors the private function in definition.ts)
//
// Needed by the custom maxCycles test workflow since the original is not
// exported.
// ---------------------------------------------------------------------------

function hasActionableFindings(
  stageOutputs: ReadonlyMap<string, StageOutput>,
): boolean {
  const reviewerOutput = stageOutputs.get("reviewer");
  if (!reviewerOutput || reviewerOutput.status !== "completed") return false;

  // Check parsed output first (preferred path)
  if (reviewerOutput.parsedOutput !== undefined) {
    const mapped = reviewerOutput.parsedOutput as {
      reviewResult: { findings: unknown[] } | null;
    };
    const review = mapped.reviewResult;
    if (review !== null && review !== undefined) {
      return review.findings.length > 0;
    }
  }

  // Fallback: parse the raw response
  const review = parseReviewResult(reviewerOutput.rawResponse);
  if (review !== null) return review.findings.length > 0;

  // Unparseable non-empty response is treated as actionable
  return reviewerOutput.rawResponse.trim().length > 0;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Ralph workflow review/debug loop (integration)", () => {
  // -----------------------------------------------------------------------
  // Test 1 — clean-code path
  // -----------------------------------------------------------------------

  test("clean-code path: 2 consecutive clean reviews terminate the loop", async () => {
    const graph = ralphWorkflowDefinition.createConductorGraph!();
    const stages = ralphWorkflowDefinition.conductorStages!;

    const { conductor, transitions } = buildConductor(
      {
        getResponse: (stageId) => {
          switch (stageId) {
            case "planner":
              return PLANNER_RESPONSE;
            case "orchestrator":
              return ORCHESTRATOR_RESPONSE;
            case "reviewer":
              return CLEAN_REVIEW;
            case "debugger":
              return DEBUGGER_FIX; // should never be reached
            default:
              return "";
          }
        },
      },
      graph,
      stages,
    );

    const result = await conductor.execute("Build a REST API");

    // Workflow succeeds
    expect(result.success).toBe(true);

    // Reviewer ran exactly 2 times (the createReviewLoopTerminator(2) threshold)
    const reviewerRuns = transitions.filter((t) => t.to === "reviewer");
    expect(reviewerRuns).toHaveLength(2);

    // Debugger never executed (hasActionableFindings was false every time)
    const debuggerRuns = transitions.filter((t) => t.to === "debugger");
    expect(debuggerRuns).toHaveLength(0);

    // stageOutputs contains planner, orchestrator, reviewer — but NOT debugger
    expect(result.stageOutputs.has("planner")).toBe(true);
    expect(result.stageOutputs.has("orchestrator")).toBe(true);
    expect(result.stageOutputs.has("reviewer")).toBe(true);
    expect(result.stageOutputs.has("debugger")).toBe(false);

    // The reviewer output stored should be a clean review
    const reviewerOutput = result.stageOutputs.get("reviewer")!;
    expect(reviewerOutput.status).toBe("completed");
    expect(reviewerOutput.rawResponse).toBe(CLEAN_REVIEW);
  });

  // -----------------------------------------------------------------------
  // Test 2 — fix-then-clean path
  // -----------------------------------------------------------------------

  test("fix-then-clean path: findings → fix → clean → clean terminates the loop", async () => {
    const graph = ralphWorkflowDefinition.createConductorGraph!();
    const stages = ralphWorkflowDefinition.conductorStages!;

    const { conductor, transitions } = buildConductor(
      {
        getResponse: (stageId, callCount) => {
          switch (stageId) {
            case "planner":
              return PLANNER_RESPONSE;
            case "orchestrator":
              return ORCHESTRATOR_RESPONSE;
            case "reviewer":
              // 1st call → findings; 2nd & 3rd calls → clean
              return callCount === 1 ? FINDINGS_REVIEW : CLEAN_REVIEW;
            case "debugger":
              return DEBUGGER_FIX;
            default:
              return "";
          }
        },
      },
      graph,
      stages,
    );

    const result = await conductor.execute("Build a REST API");

    // Workflow succeeds
    expect(result.success).toBe(true);

    // Reviewer ran 3 times: findings, clean, clean
    const reviewerRuns = transitions.filter((t) => t.to === "reviewer");
    expect(reviewerRuns).toHaveLength(3);

    // Debugger executed exactly once (after the 1st reviewer found issues)
    const debuggerRuns = transitions.filter((t) => t.to === "debugger");
    expect(debuggerRuns).toHaveLength(1);

    // Debugger output is present in stageOutputs
    expect(result.stageOutputs.has("debugger")).toBe(true);
    const debuggerOutput = result.stageOutputs.get("debugger")!;
    expect(debuggerOutput.status).toBe("completed");
    expect(debuggerOutput.rawResponse).toBe(DEBUGGER_FIX);

    // Final reviewer output should be the last clean review
    const reviewerOutput = result.stageOutputs.get("reviewer")!;
    expect(reviewerOutput.status).toBe("completed");
    expect(reviewerOutput.rawResponse).toBe(CLEAN_REVIEW);
  });

  // -----------------------------------------------------------------------
  // Test 3 — maxCycles cap
  // -----------------------------------------------------------------------

  test("maxCycles cap prevents infinite loop", async () => {
    // Build a minimal workflow identical to Ralph but with maxCycles: 3
    const testWorkflow = defineWorkflow({ name: "test-ralph-maxcycles", description: "test" })
      .stage({
        name: "planner",
        agent: "planner",
        description: "PLANNER",
        prompt: (ctx) => ctx.userPrompt,
        outputMapper: (response) => ({ tasks: parseTasks(response) }),
      })
      .stage({
        name: "orchestrator",
        agent: "orchestrator",
        description: "ORCHESTRATOR",
        prompt: () => "orchestrate",
        outputMapper: () => ({}),
      })
      .loop({ maxCycles: 3 })
      .stage({
        name: "reviewer",
        agent: "reviewer",
        description: "REVIEWER",
        prompt: () => "review",
        outputMapper: (response) => ({
          reviewResult: parseReviewResult(response),
        }),
      })
      .break(() => createReviewLoopTerminator(2))
      .if((ctx) => hasActionableFindings(ctx.stageOutputs))
      .stage({
        name: "debugger",
        agent: "debugger",
        description: "DEBUGGER",
        prompt: () => "debug",
        outputMapper: () => ({}),
      })
      .endIf()
      .endLoop()
      .compile();

    const graph = testWorkflow.createConductorGraph!();
    const stages = testWorkflow.conductorStages!;

    const { conductor, transitions } = buildConductor(
      {
        getResponse: (stageId) => {
          switch (stageId) {
            case "planner":
              return PLANNER_RESPONSE;
            case "orchestrator":
              return ORCHESTRATOR_RESPONSE;
            case "reviewer":
              // ALWAYS returns findings — loop can never terminate naturally
              return FINDINGS_REVIEW;
            case "debugger":
              return DEBUGGER_FIX;
            default:
              return "";
          }
        },
      },
      graph,
      stages,
    );

    const result = await conductor.execute("Build a REST API");

    // maxCycles is a normal exit, not an error
    expect(result.success).toBe(true);

    // Loop ran exactly 3 iterations (reviewer + debugger each iteration)
    const reviewerRuns = transitions.filter((t) => t.to === "reviewer");
    expect(reviewerRuns).toHaveLength(3);

    const debuggerRuns = transitions.filter((t) => t.to === "debugger");
    expect(debuggerRuns).toHaveLength(3);

    // Planner and orchestrator each ran once
    const plannerRuns = transitions.filter((t) => t.to === "planner");
    expect(plannerRuns).toHaveLength(1);

    const orchestratorRuns = transitions.filter((t) => t.to === "orchestrator");
    expect(orchestratorRuns).toHaveLength(1);
  });

  // -----------------------------------------------------------------------
  // Test 4 — abort signal mid-iteration
  // -----------------------------------------------------------------------

  test("abort signal mid-iteration stops the workflow", async () => {
    const graph = ralphWorkflowDefinition.createConductorGraph!();
    const stages = ralphWorkflowDefinition.conductorStages!;

    const abortController = new AbortController();

    const { conductor, transitions } = buildConductor(
      {
        getResponse: (stageId) => {
          switch (stageId) {
            case "planner":
              return PLANNER_RESPONSE;
            case "orchestrator":
              return ORCHESTRATOR_RESPONSE;
            case "reviewer":
              return CLEAN_REVIEW;
            default:
              return "";
          }
        },
        abortController,
        abortDuringStage: { stage: "reviewer", callCount: 1 },
      },
      graph,
      stages,
    );

    const result = await conductor.execute("Build a REST API");

    // Workflow was aborted
    expect(result.success).toBe(false);

    // Planner and orchestrator completed before the abort
    expect(result.stageOutputs.has("planner")).toBe(true);
    expect(result.stageOutputs.get("planner")!.status).toBe("completed");

    expect(result.stageOutputs.has("orchestrator")).toBe(true);
    expect(result.stageOutputs.get("orchestrator")!.status).toBe("completed");

    // Reviewer started but was interrupted
    expect(result.stageOutputs.has("reviewer")).toBe(true);
    expect(result.stageOutputs.get("reviewer")!.status).toBe("interrupted");

    // Debugger never ran (abort happened during reviewer)
    const debuggerRuns = transitions.filter((t) => t.to === "debugger");
    expect(debuggerRuns).toHaveLength(0);
  });
});
