/**
 * Tests for Ralph Workflow Definition (DSL-based)
 *
 * Verifies that the defineWorkflow().compile() chain produces a valid
 * WorkflowDefinition with correct metadata, stage definitions, and graph.
 */

import "./definition.task-list-config.suite.ts";

import { describe, test, expect } from "bun:test";
import { getRalphWorkflowDefinition } from "@/services/workflows/builtin/ralph/ralph-workflow.ts";

const ralphWorkflowDefinition = getRalphWorkflowDefinition();
import { isStageDefinition } from "@/services/workflows/conductor/guards.ts";
import type { StageContext, StageOutput } from "@/services/workflows/conductor/types.ts";
import { VERSION } from "@/version.ts";

function makeStageContext(overrides?: Partial<StageContext>): StageContext {
  return {
    userPrompt: "Build a user authentication module",
    stageOutputs: new Map(),
    tasks: [],
    abortSignal: new AbortController().signal,
    state: { executionId: "", lastUpdated: "", outputs: {} },
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
    expect(planner.indicator).toContain("PLANNER");
    expect(planner.shouldRun).toBeUndefined();
  });

  test("orchestrator stage has correct indicator and no shouldRun", () => {
    const orchestrator = ralphWorkflowDefinition.conductorStages![1]!;
    expect(orchestrator.id).toBe("orchestrator");
    expect(orchestrator.indicator).toContain("ORCHESTRATOR");
    expect(orchestrator.shouldRun).toBeUndefined();
  });

  test("reviewer stage has correct indicator and no shouldRun", () => {
    const reviewer = ralphWorkflowDefinition.conductorStages![2]!;
    expect(reviewer.id).toBe("reviewer");
    expect(reviewer.indicator).toContain("REVIEWER");
    expect(reviewer.shouldRun).toBeUndefined();
  });

  test("debugger stage has shouldRun from .if() condition", () => {
    const debugger_ = ralphWorkflowDefinition.conductorStages![3]!;
    expect(debugger_.id).toBe("debugger");
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
    // 4 stage nodes + 4 loop-control nodes (__loop_start_0, __loop_check_1, __break_2, __loop_exit_3)
    expect(graph.nodes.size).toBe(8);
    expect(graph.startNode).toBe("planner");
    // The loop exit node is the terminal node (not debugger)
    expect(graph.endNodes.has("__loop_exit_3")).toBe(true);
    // 9 edges: planner→orchestrator, orchestrator→loop_start, loop_start→reviewer,
    //          reviewer→break, break→debugger (break_continue), debugger→loop_check,
    //          loop_check→loop_start (back), loop_check→loop_exit (exit), break→loop_exit (break_exit)
    expect(graph.edges).toHaveLength(9);
  });

  test("conductor graph node IDs match conductor stage IDs", () => {
    const graph = ralphWorkflowDefinition.createConductorGraph!();
    const stageIds = ralphWorkflowDefinition.conductorStages!.map((s) => s.id);
    for (const stageId of stageIds) {
      expect(graph.nodes.has(stageId)).toBe(true);
    }
  });

  test("conductor graph edges form planner→orchestrator→loop(reviewer→break→debugger)", () => {
    const graph = ralphWorkflowDefinition.createConductorGraph!();
    const edgePairs = graph.edges.map((e) => [e.from, e.to]);
    expect(edgePairs).toEqual([
      ["planner", "orchestrator"],
      ["orchestrator", "__loop_start_0"],
      ["__loop_start_0", "reviewer"],
      ["reviewer", "__break_2"],              // reviewer feeds into break node
      ["__break_2", "debugger"],              // break_continue (condition false)
      ["debugger", "__loop_check_1"],
      ["__loop_check_1", "__loop_start_0"],   // back-edge (continue loop)
      ["__loop_check_1", "__loop_exit_3"],    // exit-edge (terminate loop)
      ["__break_2", "__loop_exit_3"],         // break_exit (condition true)
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
    // The outputMapper returns { tasks: [...] }, so parseOutput returns a Record.
    expect(typeof result).toBe("object");
    expect(result).not.toBeNull();
    const parsed = result as Record<string, unknown>;
    const tasks = parsed.tasks as Array<{ description: string }>;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.description).toBe("Task A");
  });

  // -------------------------------------------------------------------------
  // Graph nodes carry reads/outputs for data-flow verification
  // -------------------------------------------------------------------------

  test("conductor graph nodes carry inferred reads/outputs metadata", () => {
    const graph = ralphWorkflowDefinition.createConductorGraph!();
    const planner = graph.nodes.get("planner");
    expect(planner?.outputs).toEqual(["tasks"]);

    // Reads are inferred from ctx.state.* accesses in prompt functions.
    // Ralph stages use ctx.stageOutputs/ctx.tasks instead of ctx.state,
    // so inferred reads are empty.
    const orchestrator = graph.nodes.get("orchestrator");
    expect(orchestrator?.reads).toEqual([]);

    const reviewer = graph.nodes.get("reviewer");
    expect(reviewer?.reads).toEqual([]);
    expect(reviewer?.outputs).toEqual(["reviewResult"]);

    const debugger_ = graph.nodes.get("debugger");
    expect(debugger_?.reads).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Runtime outputMapper key validation
  // -------------------------------------------------------------------------

  test("outputs are inferred from outputMapper keys (no explicit outputs needed)", () => {
    // Compile a workflow and verify that the graph node's outputs are
    // inferred from the outputMapper return keys.
    const { defineWorkflow: dw } = require("@/services/workflows/dsl/define-workflow.ts");
    const workflow = dw({ name: "test-infer", description: "test" })
      .stage({
        name: "infer-stage",
        agent: "infer-stage",
        description: "test",
        prompt: () => "test",
        outputMapper: (_r: string) => ({ inferredKey: "value", otherKey: 42 }),
      })
      .compile();

    const graph = workflow.createConductorGraph!();
    const node = graph.nodes.get("infer-stage")!;
    expect(node.outputs).toEqual(["inferredKey", "otherKey"]);
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
    expect(stageIds).not.toContain("__break_2");
    expect(stageIds).not.toContain("__loop_exit_3");
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

  // -------------------------------------------------------------------------
  // Orchestrator handles empty task list from task_list tool flow
  // -------------------------------------------------------------------------

  test("orchestrator buildPrompt falls through to empty task list when planner used task_list tool", () => {
    const orchestrator = ralphWorkflowDefinition.conductorStages![1]!;
    // Simulate: planner used task_list tool, so parsedOutput.tasks is []
    // and rawResponse is text (no JSON)
    const ctx = makeStageContext({
      tasks: [],
      stageOutputs: new Map([
        [
          "planner",
          makeStageOutput({
            stageId: "planner",
            rawResponse: "I have created the tasks using the task_list tool.",
            parsedOutput: { tasks: [] },
          }),
        ],
      ]),
    });
    const prompt = orchestrator.buildPrompt(ctx);
    // Should still produce a valid orchestrator prompt with empty task list
    expect(prompt).toContain("orchestrator managing");
    expect(prompt).toContain("[]");
    // Should include the list_tasks instruction for retrieving tasks from SQLite
    expect(prompt).toContain("list_tasks");
  });

  test("orchestrator buildPrompt uses ctx.tasks when available (legacy flow)", () => {
    const orchestrator = ralphWorkflowDefinition.conductorStages![1]!;
    const ctx = makeStageContext({
      tasks: [
        { id: "1", description: "Setup project", status: "pending", summary: "Setting up", blockedBy: [] },
      ],
    });
    const prompt = orchestrator.buildPrompt(ctx);
    expect(prompt).toContain("Setup project");
    // Should NOT include the empty-task note since tasks were provided
    expect(prompt).not.toContain("The task list above is empty");
  });
});
