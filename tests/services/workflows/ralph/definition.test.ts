/**
 * Tests for Ralph Workflow Definition (DSL-based)
 *
 * Verifies that the defineWorkflow().compile() chain produces a valid
 * WorkflowDefinition with correct metadata, stage definitions, and graph.
 */

import { describe, test, expect } from "bun:test";
import { ralphWorkflowDefinition } from "@/services/workflows/ralph/definition.ts";
import { isStageDefinition } from "@/services/workflows/conductor/guards.ts";
import type { StageContext, StageOutput } from "@/services/workflows/conductor/types.ts";
import { VERSION } from "@/version.ts";

function makeStageContext(overrides?: Partial<StageContext>): StageContext {
  return {
    userPrompt: "Build a user authentication module",
    stageOutputs: new Map(),
    tasks: [],
    abortSignal: new AbortController().signal,
    ...overrides,
  };
}

function makeStageOutput(overrides?: Partial<StageOutput>): StageOutput {
  return {
    stageId: "test",
    rawResponse: "",
    status: "completed",
    ...overrides,
  };
}

describe("Ralph Workflow Definition (DSL)", () => {
  test("has correct metadata", () => {
    expect(ralphWorkflowDefinition.name).toBe("ralph");
    expect(ralphWorkflowDefinition.description).toBe(
      "Start autonomous implementation workflow",
    );
    expect(ralphWorkflowDefinition.version).toBe(VERSION);
    expect(ralphWorkflowDefinition.argumentHint).toBe(
      '"<prompt-or-spec-path>"',
    );
    expect(ralphWorkflowDefinition.source).toBe("builtin");
  });

  test("has createState factory", () => {
    expect(typeof ralphWorkflowDefinition.createState).toBe("function");
  });

  test("has nodeDescriptions", () => {
    expect(ralphWorkflowDefinition.nodeDescriptions).toBeDefined();
    const descs = ralphWorkflowDefinition.nodeDescriptions!;
    expect(descs["planner"]).toBe("planner");
    expect(descs["orchestrator"]).toBe("orchestrator");
    expect(descs["reviewer"]).toBe("reviewer");
    expect(descs["debugger"]).toBe("debugger");
  });

  // -------------------------------------------------------------------------
  // Conductor stages
  // -------------------------------------------------------------------------

  test("conductorStages contains 4 valid stage definitions", () => {
    const stages = ralphWorkflowDefinition.conductorStages!;
    expect(stages).toHaveLength(4);
    for (const stage of stages) {
      expect(isStageDefinition(stage)).toBe(true);
    }
  });

  test("conductorStages IDs match expected sequence", () => {
    const ids = ralphWorkflowDefinition.conductorStages!.map((s) => s.id);
    expect(ids).toEqual(["planner", "orchestrator", "reviewer", "debugger"]);
  });

  test("planner stage has correct indicator and no shouldRun", () => {
    const planner = ralphWorkflowDefinition.conductorStages![0]!;
    expect(planner.id).toBe("planner");
    expect(planner.name).toBe("planner");
    expect(planner.indicator).toContain("PLANNER");
    expect(planner.shouldRun).toBeUndefined();
  });

  test("orchestrator stage has correct indicator and no shouldRun", () => {
    const orchestrator = ralphWorkflowDefinition.conductorStages![1]!;
    expect(orchestrator.id).toBe("orchestrator");
    expect(orchestrator.name).toBe("orchestrator");
    expect(orchestrator.indicator).toContain("ORCHESTRATOR");
    expect(orchestrator.shouldRun).toBeUndefined();
  });

  test("reviewer stage has correct indicator and no shouldRun", () => {
    const reviewer = ralphWorkflowDefinition.conductorStages![2]!;
    expect(reviewer.id).toBe("reviewer");
    expect(reviewer.name).toBe("reviewer");
    expect(reviewer.indicator).toContain("REVIEWER");
    expect(reviewer.shouldRun).toBeUndefined();
  });

  test("debugger stage has shouldRun from .if() condition", () => {
    const debugger_ = ralphWorkflowDefinition.conductorStages![3]!;
    expect(debugger_.id).toBe("debugger");
    expect(debugger_.name).toBe("debugger");
    expect(debugger_.indicator).toContain("DEBUGGER");
    expect(typeof debugger_.shouldRun).toBe("function");
  });

  test("debugger shouldRun returns false when no reviewer output", () => {
    const debugger_ = ralphWorkflowDefinition.conductorStages![3]!;
    const ctx = makeStageContext();
    expect(debugger_.shouldRun!(ctx)).toBe(false);
  });

  test("debugger shouldRun returns false when reviewer found no issues", () => {
    const debugger_ = ralphWorkflowDefinition.conductorStages![3]!;
    const ctx = makeStageContext({
      stageOutputs: new Map([
        [
          "reviewer",
          makeStageOutput({
            stageId: "reviewer",
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
          }),
        ],
      ]),
    });
    expect(debugger_.shouldRun!(ctx)).toBe(false);
  });

  test("debugger shouldRun returns true when reviewer has findings", () => {
    const debugger_ = ralphWorkflowDefinition.conductorStages![3]!;
    const ctx = makeStageContext({
      stageOutputs: new Map([
        [
          "reviewer",
          makeStageOutput({
            stageId: "reviewer",
            rawResponse: JSON.stringify({
              findings: [{ title: "Bug found" }],
              overall_correctness: "patch is incorrect",
            }),
            parsedOutput: {
              reviewResult: {
                findings: [{ title: "Bug found" }],
                overall_correctness: "patch is incorrect",
              },
            },
          }),
        ],
      ]),
    });
    expect(debugger_.shouldRun!(ctx)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Conductor graph
  // -------------------------------------------------------------------------

  test("createConductorGraph is a function", () => {
    expect(typeof ralphWorkflowDefinition.createConductorGraph).toBe(
      "function",
    );
  });

  test("conductor graph has stage + loop-control nodes", () => {
    const graph = ralphWorkflowDefinition.createConductorGraph!();
    // 4 stage nodes + 3 loop-control nodes (__loop_start, __loop_check, __loop_exit)
    expect(graph.nodes.size).toBe(7);
    expect(graph.startNode).toBe("planner");
    // The loop exit node is the terminal node (not debugger)
    expect(graph.endNodes.has("__loop_exit_2")).toBe(true);
    // 7 edges: planner→orchestrator, orchestrator→loop_start, loop_start→reviewer,
    //          reviewer→debugger, debugger→loop_check, loop_check→loop_start (back), loop_check→loop_exit (exit)
    expect(graph.edges).toHaveLength(7);
  });

  test("conductor graph node IDs match conductor stage IDs", () => {
    const graph = ralphWorkflowDefinition.createConductorGraph!();
    const stageIds = ralphWorkflowDefinition.conductorStages!.map((s) => s.id);
    for (const stageId of stageIds) {
      expect(graph.nodes.has(stageId)).toBe(true);
    }
  });

  test("conductor graph edges form planner→orchestrator→loop(reviewer→debugger)", () => {
    const graph = ralphWorkflowDefinition.createConductorGraph!();
    const edgePairs = graph.edges.map((e) => [e.from, e.to]);
    expect(edgePairs).toEqual([
      ["planner", "orchestrator"],
      ["orchestrator", "__loop_start_0"],
      ["__loop_start_0", "reviewer"],
      ["reviewer", "debugger"],
      ["debugger", "__loop_check_1"],
      ["__loop_check_1", "__loop_start_0"],  // back-edge (continue loop)
      ["__loop_check_1", "__loop_exit_2"],    // exit-edge (terminate loop)
    ]);
  });

  // -------------------------------------------------------------------------
  // Stage prompt building
  // -------------------------------------------------------------------------

  test("planner buildPrompt includes user prompt", () => {
    const planner = ralphWorkflowDefinition.conductorStages![0]!;
    const ctx = makeStageContext({ userPrompt: "Build a REST API" });
    const prompt = planner.buildPrompt(ctx);
    expect(prompt).toContain("Build a REST API");
  });

  test("orchestrator buildPrompt uses tasks from context", () => {
    const orchestrator = ralphWorkflowDefinition.conductorStages![1]!;
    const ctx = makeStageContext({
      tasks: [
        {
          description: "Create user model",
          status: "pending",
          summary: "Creating model",
          blockedBy: [],
        },
      ],
    });
    const prompt = orchestrator.buildPrompt(ctx);
    expect(prompt).toContain("Create user model");
  });

  test("reviewer parseOutput extracts findings", () => {
    const reviewer = ralphWorkflowDefinition.conductorStages![2]!;
    const result = reviewer.parseOutput!(
      JSON.stringify({
        findings: [{ title: "Bug" }],
        overall_correctness: "patch is incorrect",
        overall_explanation: "Found a bug",
      }),
    );
    expect(result).toBeDefined();
    const parsed = result as Record<string, unknown>;
    expect(parsed.reviewResult).toBeDefined();
  });

  test("planner parseOutput extracts tasks as array", () => {
    const planner = ralphWorkflowDefinition.conductorStages![0]!;
    const result = planner.parseOutput!(
      JSON.stringify([
        {
          id: 1,
          description: "Task A",
          status: "pending",
          summary: "Doing A",
          blockedBy: [],
        },
      ]),
    );
    // The compiler unwraps single-key { tasks: [...] } to a raw array
    // for backward compatibility with the conductor's task detection.
    expect(Array.isArray(result)).toBe(true);
    const tasks = result as Array<{ description: string }>;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.description).toBe("Task A");
  });

  // -------------------------------------------------------------------------
  // Graph nodes carry reads/outputs for data-flow verification
  // -------------------------------------------------------------------------

  test("conductor graph nodes carry reads/outputs metadata", () => {
    const graph = ralphWorkflowDefinition.createConductorGraph!();
    const planner = graph.nodes.get("planner");
    expect(planner?.outputs).toEqual(["tasks"]);

    const orchestrator = graph.nodes.get("orchestrator");
    expect(orchestrator?.reads).toEqual(["tasks"]);

    const reviewer = graph.nodes.get("reviewer");
    expect(reviewer?.reads).toEqual(["tasks"]);
    expect(reviewer?.outputs).toEqual(["reviewResult"]);

    const debugger_ = graph.nodes.get("debugger");
    expect(debugger_?.reads).toEqual(["reviewResult"]);
  });

  // -------------------------------------------------------------------------
  // Runtime outputMapper key validation
  // -------------------------------------------------------------------------

  test("parseOutput throws when outputMapper keys do not match declared outputs", () => {
    // Compile a workflow with mismatched outputMapper keys vs declared outputs
    const { defineWorkflow: dw } = require("@/services/workflows/dsl/define-workflow.ts");
    const mismatchedWorkflow = dw("test-mismatch", "test")
      .stage({
        agent: "bad-stage",
        description: "test",
        prompt: () => "test",
        outputMapper: (_r: string) => ({ wrongKey: "value" }),
        outputs: ["correctKey"],
      })
      .compile();

    const stage = mismatchedWorkflow.conductorStages![0]!;
    expect(() => stage.parseOutput!("test response")).toThrow(
      /outputMapper keys do not match declared outputs/,
    );
  });

  // -------------------------------------------------------------------------
  // Review loop structure
  // -------------------------------------------------------------------------

  test("loop back-edge and exit-edge from __loop_check_1 have conditions", () => {
    const graph = ralphWorkflowDefinition.createConductorGraph!();
    const loopCheckEdges = graph.edges.filter((e) => e.from === "__loop_check_1");
    expect(loopCheckEdges).toHaveLength(2);
    // Both back-edge and exit-edge should be conditional
    for (const edge of loopCheckEdges) {
      expect(typeof edge.condition).toBe("function");
    }
  });

  test("loop start and exit nodes are decision nodes (no stage definition)", () => {
    const stages = ralphWorkflowDefinition.conductorStages!;
    const stageIds = stages.map((s) => s.id);
    // Loop-control nodes should NOT appear as conductor stages
    expect(stageIds).not.toContain("__loop_start_0");
    expect(stageIds).not.toContain("__loop_check_1");
    expect(stageIds).not.toContain("__loop_exit_2");
  });

  // -------------------------------------------------------------------------
  // Reviewer prompt wiring with prior debugger output
  // -------------------------------------------------------------------------

  test("reviewer buildPrompt excludes debugger context on first iteration", () => {
    const reviewer = ralphWorkflowDefinition.conductorStages![2]!;
    const ctx = makeStageContext({
      userPrompt: "Build a REST API",
      tasks: [
        {
          description: "Create endpoints",
          status: "completed",
          summary: "Creating endpoints",
          blockedBy: [],
        },
      ],
      stageOutputs: new Map([
        [
          "orchestrator",
          makeStageOutput({
            stageId: "orchestrator",
            rawResponse: "Orchestrator completed all tasks",
          }),
        ],
      ]),
    });
    const prompt = reviewer.buildPrompt(ctx);
    expect(prompt).toContain("Build a REST API");
    // Should NOT contain debugger-related content since there's no debugger output
    expect(prompt).not.toContain("Previous Debugger Output");
  });

  test("reviewer buildPrompt includes prior debugger output in subsequent iterations", () => {
    const reviewer = ralphWorkflowDefinition.conductorStages![2]!;
    const ctx = makeStageContext({
      userPrompt: "Build a REST API",
      tasks: [
        {
          description: "Create endpoints",
          status: "completed",
          summary: "Creating endpoints",
          blockedBy: [],
        },
      ],
      stageOutputs: new Map([
        [
          "orchestrator",
          makeStageOutput({
            stageId: "orchestrator",
            rawResponse: "Orchestrator completed all tasks",
          }),
        ],
        [
          "debugger",
          makeStageOutput({
            stageId: "debugger",
            rawResponse: "Fixed the null pointer issue in user controller",
          }),
        ],
      ]),
    });
    const prompt = reviewer.buildPrompt(ctx);
    expect(prompt).toContain("Build a REST API");
    // Should contain the prior debugger output
    expect(prompt).toContain("Fixed the null pointer issue in user controller");
  });
});
