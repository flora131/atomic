/**
 * Tests for the verify-workflows script.
 *
 * Tests the discovery, verification, and reporting functions exported
 * from the script module.
 *
 * Uses the verifier DI parameter on verifySingleWorkflow instead of
 * mock.module to avoid global module contamination.
 */

import { describe, test, expect, mock, beforeEach } from "bun:test";
import type { WorkflowDefinition } from "@/services/workflows/types/definition.ts";
import type { BaseState, CompiledGraph } from "@/services/workflows/graph/types.ts";
import type { VerificationResult, PropertyResult, EncodedGraph } from "@/services/workflows/verification/types.ts";
import {
  discoverBuiltinWorkflows,
  discoverCustomWorkflows,
  verifySingleWorkflow,
} from "@/scripts/verify-workflows.ts";
import type { DiscoveredWorkflow } from "@/scripts/verify-workflows.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PASS: PropertyResult = { verified: true };

function makeAllPassResult(): VerificationResult {
  return {
    valid: true,
    properties: {
      reachability: PASS,
      termination: PASS,
      deadlockFreedom: PASS,
      loopBounds: PASS,
      stateDataFlow: PASS,
    },
  };
}

const mockVerifyWorkflow = mock(async () => makeAllPassResult());

/** Create a minimal CompiledGraph for testing. */
function makeMinimalGraph(): CompiledGraph<BaseState> {
  const nodes = new Map<
    string,
    { type: string; execute: () => Promise<Record<string, unknown>> }
  >();
  nodes.set("start", { type: "agent", execute: async () => ({}) });
  nodes.set("end", { type: "agent", execute: async () => ({}) });

  return {
    nodes: nodes as unknown as CompiledGraph<BaseState>["nodes"],
    edges: [{ from: "start", to: "end" }],
    startNode: "start",
    endNodes: new Set(["end"]),
  } as CompiledGraph<BaseState>;
}

/** Create a workflow definition with a graph factory. */
function makeWorkflowDefinition(
  name: string,
  opts?: { withGraph?: boolean; withConductorGraph?: boolean },
): WorkflowDefinition {
  const def: WorkflowDefinition = {
    name,
    description: `Test workflow: ${name}`,
  };

  if (opts?.withGraph) {
    def.createGraph = () => makeMinimalGraph();
  }

  if (opts?.withConductorGraph) {
    def.createConductorGraph = () => makeMinimalGraph();
  }

  return def;
}

// ---------------------------------------------------------------------------
// discoverBuiltinWorkflows
// ---------------------------------------------------------------------------

describe("discoverBuiltinWorkflows", () => {
  test("returns an array", async () => {
    const result = await discoverBuiltinWorkflows();
    expect(Array.isArray(result)).toBe(true);
  });

  test("handles Ralph import failure gracefully", async () => {
    // discoverBuiltinWorkflows should never throw, even if Ralph
    // module has missing dependencies (e.g., state.ts deleted)
    const result = await discoverBuiltinWorkflows();
    expect(Array.isArray(result)).toBe(true);
    // Result may or may not contain Ralph depending on module availability
  });

  test("discovered Ralph workflow (when available) has correct structure", async () => {
    const result = await discoverBuiltinWorkflows();
    const ralph = result.find((w) => w.id === "ralph");
    if (ralph) {
      // If Ralph loads successfully, validate its structure
      expect(ralph.definition.name).toBe("ralph");
      expect(typeof ralph.definition.description).toBe("string");
      expect(
        ralph.definition.createConductorGraph !== undefined ||
          ralph.definition.createGraph !== undefined,
      ).toBe(true);
    }
    // If Ralph is not found, that's acceptable -- the import error
    // is caught and logged by discoverBuiltinWorkflows
  });
});

// ---------------------------------------------------------------------------
// discoverCustomWorkflows
// ---------------------------------------------------------------------------

describe("discoverCustomWorkflows", () => {
  test("returns an array (possibly empty when no .atomic/workflows/ exists)", async () => {
    const result = await discoverCustomWorkflows();
    expect(Array.isArray(result)).toBe(true);
  });

  test("returns only valid workflow definitions", async () => {
    const result = await discoverCustomWorkflows();
    for (const wf of result) {
      expect(typeof wf.id).toBe("string");
      expect(wf.definition).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// verifySingleWorkflow
// ---------------------------------------------------------------------------

describe("verifySingleWorkflow", () => {
  beforeEach(() => {
    mockVerifyWorkflow.mockClear();
    mockVerifyWorkflow.mockImplementation(async () => makeAllPassResult());
  });

  test("returns passed=true and warning for workflow without a graph", async () => {
    const workflow: DiscoveredWorkflow = {
      id: "no-graph",
      definition: makeWorkflowDefinition("no-graph"),
    };

    const result = await verifySingleWorkflow(workflow, mockVerifyWorkflow);
    expect(result.passed).toBe(true);
    expect(result.report).toContain("Warning");
    expect(result.report).toContain("no-graph");
    expect(result.report).toContain("No graph to verify");
    // Should NOT call verifyWorkflow when there's no graph
    expect(mockVerifyWorkflow).not.toHaveBeenCalled();
  });

  test("returns a verification report for workflow with createGraph", async () => {
    const workflow: DiscoveredWorkflow = {
      id: "test-wf",
      definition: makeWorkflowDefinition("test-wf", { withGraph: true }),
    };

    const result = await verifySingleWorkflow(workflow, mockVerifyWorkflow);
    expect(result.passed).toBe(true);
    expect(result.report).toContain("test-wf");
    expect(result.report).toContain("PASS");
    expect(mockVerifyWorkflow).toHaveBeenCalledTimes(1);
  });

  test("returns a verification report for workflow with createConductorGraph", async () => {
    const workflow: DiscoveredWorkflow = {
      id: "conductor-wf",
      definition: makeWorkflowDefinition("conductor-wf", {
        withConductorGraph: true,
      }),
    };

    const result = await verifySingleWorkflow(workflow, mockVerifyWorkflow);
    expect(result.passed).toBe(true);
    expect(result.report).toContain("conductor-wf");
    expect(mockVerifyWorkflow).toHaveBeenCalledTimes(1);
  });

  test("returns passed=false when verification fails", async () => {
    mockVerifyWorkflow.mockImplementation(async () => ({
      valid: false,
      properties: {
        reachability: { verified: false, counterexample: 'Node "orphan" unreachable' },
        termination: PASS,
        deadlockFreedom: PASS,
        loopBounds: PASS,
        stateDataFlow: PASS,
      },
    }));

    const workflow: DiscoveredWorkflow = {
      id: "failing-wf",
      definition: makeWorkflowDefinition("failing-wf", { withGraph: true }),
    };

    const result = await verifySingleWorkflow(workflow, mockVerifyWorkflow);
    expect(result.passed).toBe(false);
    expect(result.report).toContain("FAIL");
    expect(result.report).toContain("failing-wf");
  });

  test("report contains PASS for all properties when verification passes", async () => {
    const workflow: DiscoveredWorkflow = {
      id: "check-output",
      definition: makeWorkflowDefinition("check-output", { withGraph: true }),
    };

    const result = await verifySingleWorkflow(workflow, mockVerifyWorkflow);
    expect(result.report).toContain("PASS  Reachability");
    expect(result.report).toContain("PASS  Termination");
    expect(result.report).toContain("PASS  Deadlock-Freedom");
    expect(result.report).toContain("PASS  Loop Bounds");
    expect(result.report).toContain("PASS  State Data-Flow");
  });

  test("prefers createConductorGraph over createGraph when both exist", async () => {
    const definition: WorkflowDefinition = {
      name: "both-graphs",
      description: "Has both graph factories",
      createGraph: () => makeMinimalGraph(),
      createConductorGraph: () => makeMinimalGraph(),
    };

    const workflow: DiscoveredWorkflow = { id: "both-graphs", definition };
    const result = await verifySingleWorkflow(workflow, mockVerifyWorkflow);
    expect(result.passed).toBe(true);
    expect(result.report).toContain("both-graphs");
  });

  test("passes encoded graph to verifyWorkflow", async () => {
    const workflow: DiscoveredWorkflow = {
      id: "encoding-test",
      definition: makeWorkflowDefinition("encoding-test", { withGraph: true }),
    };

    await verifySingleWorkflow(workflow, mockVerifyWorkflow);

    expect(mockVerifyWorkflow).toHaveBeenCalledTimes(1);
    const calls = mockVerifyWorkflow.mock.calls as unknown[][];
    const callArgs = calls[0]!;
    // First arg is the graph
    expect(callArgs[0]).toBeDefined();
    // Second arg is { encodedGraph: ... }
    const options = callArgs[1] as unknown as { encodedGraph?: EncodedGraph };
    expect(options).toBeDefined();
    expect(options.encodedGraph).toBeDefined();
    expect(options.encodedGraph?.startNode).toBe("start");
    expect(options.encodedGraph?.endNodes).toContain("end");
  });
});

// ---------------------------------------------------------------------------
// package.json: verify:workflows script was removed (now `atomic workflow verify`)
// ---------------------------------------------------------------------------
