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
    expect(ralphWorkflowDefinition.version).toBe("1.0.0");
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
    expect(descs["planner"]).toBe("Planner");
    expect(descs["orchestrator"]).toBe("Orchestrator");
    expect(descs["reviewer"]).toBe("Reviewer");
    expect(descs["debugger"]).toBe("Debugger");
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
    expect(planner.name).toBe("Planner");
    expect(planner.indicator).toContain("PLANNER");
    expect(planner.shouldRun).toBeUndefined();
  });

  test("orchestrator stage has correct indicator and no shouldRun", () => {
    const orchestrator = ralphWorkflowDefinition.conductorStages![1]!;
    expect(orchestrator.id).toBe("orchestrator");
    expect(orchestrator.name).toBe("Orchestrator");
    expect(orchestrator.indicator).toContain("ORCHESTRATOR");
    expect(orchestrator.shouldRun).toBeUndefined();
  });

  test("reviewer stage has correct indicator and no shouldRun", () => {
    const reviewer = ralphWorkflowDefinition.conductorStages![2]!;
    expect(reviewer.id).toBe("reviewer");
    expect(reviewer.name).toBe("Reviewer");
    expect(reviewer.indicator).toContain("REVIEWER");
    expect(reviewer.shouldRun).toBeUndefined();
  });

  test("debugger stage has shouldRun from .if() condition", () => {
    const debugger_ = ralphWorkflowDefinition.conductorStages![3]!;
    expect(debugger_.id).toBe("debugger");
    expect(debugger_.name).toBe("Debugger");
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
              findings: [],
              overall_correctness: "patch is correct",
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
              findings: [{ title: "Bug found" }],
              overall_correctness: "patch is incorrect",
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

  test("conductor graph has 4 nodes in linear sequence", () => {
    const graph = ralphWorkflowDefinition.createConductorGraph!();
    expect(graph.nodes.size).toBe(4);
    expect(graph.startNode).toBe("planner");
    expect(graph.endNodes.has("debugger")).toBe(true);
    expect(graph.edges).toHaveLength(3);
  });

  test("conductor graph node IDs match conductor stage IDs", () => {
    const graph = ralphWorkflowDefinition.createConductorGraph!();
    const stageIds = ralphWorkflowDefinition.conductorStages!.map((s) => s.id);
    for (const stageId of stageIds) {
      expect(graph.nodes.has(stageId)).toBe(true);
    }
  });

  test("conductor graph edges form a linear chain", () => {
    const graph = ralphWorkflowDefinition.createConductorGraph!();
    const edgePairs = graph.edges.map((e) => [e.from, e.to]);
    expect(edgePairs).toEqual([
      ["planner", "orchestrator"],
      ["orchestrator", "reviewer"],
      ["reviewer", "debugger"],
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

  test("planner parseOutput extracts tasks", () => {
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
    expect(result).toBeDefined();
    const parsed = result as Record<string, unknown>;
    expect(Array.isArray(parsed.tasks)).toBe(true);
  });
});
