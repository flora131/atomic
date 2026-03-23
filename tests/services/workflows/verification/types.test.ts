import { describe, test, expect } from "bun:test";
import {
  WorkflowVerificationError,
  type PropertyResult,
  type VerificationResult,
  type VerificationNode,
  type VerificationEdge,
  type VerificationLoop,
  type EncodedGraph,
} from "@/services/workflows/verification/types";

describe("WorkflowVerificationError", () => {
  function makeResult(
    overrides: Partial<VerificationResult["properties"]> = {},
  ): VerificationResult {
    const passing: PropertyResult = { verified: true };
    return {
      valid: false,
      properties: {
        reachability: passing,
        termination: passing,
        deadlockFreedom: passing,
        loopBounds: passing,
        stateDataFlow: passing,
        ...overrides,
      },
    };
  }

  test("should list failed property names in the error message", () => {
    const result = makeResult({
      reachability: { verified: false, counterexample: "node X unreachable" },
      termination: { verified: false },
    });
    const error = new WorkflowVerificationError("my-workflow", result);

    expect(error.message).toBe(
      'Workflow "my-workflow" failed verification: reachability, termination',
    );
    expect(error.name).toBe("WorkflowVerificationError");
    expect(error.workflowId).toBe("my-workflow");
    expect(error.result).toBe(result);
  });

  test("should be an instance of Error", () => {
    const result = makeResult({
      deadlockFreedom: { verified: false },
    });
    const error = new WorkflowVerificationError("wf-1", result);

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(WorkflowVerificationError);
  });

  test("should handle a single failed property", () => {
    const result = makeResult({
      loopBounds: {
        verified: false,
        counterexample: "loop at node L exceeds max",
        details: { nodeId: "L", maxIterations: 10 },
      },
    });
    const error = new WorkflowVerificationError("bounded-wf", result);

    expect(error.message).toBe(
      'Workflow "bounded-wf" failed verification: loopBounds',
    );
  });

  test("should handle all properties failing", () => {
    const failing: PropertyResult = { verified: false };
    const result: VerificationResult = {
      valid: false,
      properties: {
        reachability: failing,
        termination: failing,
        deadlockFreedom: failing,
        loopBounds: failing,
        stateDataFlow: failing,
      },
    };
    const error = new WorkflowVerificationError("all-fail", result);

    expect(error.message).toBe(
      'Workflow "all-fail" failed verification: reachability, termination, deadlockFreedom, loopBounds, stateDataFlow',
    );
  });
});

describe("Verification type shapes", () => {
  test("PropertyResult accepts minimal shape", () => {
    const result: PropertyResult = { verified: true };
    expect(result.verified).toBe(true);
    expect(result.counterexample).toBeUndefined();
    expect(result.details).toBeUndefined();
  });

  test("PropertyResult accepts full shape with details", () => {
    const result: PropertyResult = {
      verified: false,
      counterexample: "node A is unreachable",
      details: { unreachableNodes: ["A"] },
    };
    expect(result.verified).toBe(false);
    expect(result.counterexample).toBe("node A is unreachable");
    expect(result.details).toEqual({ unreachableNodes: ["A"] });
  });

  test("VerificationNode accepts optional fields", () => {
    const minimal: VerificationNode = { id: "n1", type: "agent" };
    expect(minimal.reads).toBeUndefined();
    expect(minimal.outputs).toBeUndefined();

    const full: VerificationNode = {
      id: "n2",
      type: "tool",
      reads: ["stateA"],
      outputs: ["stateB"],
    };
    expect(full.reads).toEqual(["stateA"]);
    expect(full.outputs).toEqual(["stateB"]);
  });

  test("VerificationEdge accepts optional conditionGroup", () => {
    const simple: VerificationEdge = {
      from: "a",
      to: "b",
      hasCondition: false,
    };
    expect(simple.conditionGroup).toBeUndefined();

    const conditional: VerificationEdge = {
      from: "a",
      to: "c",
      hasCondition: true,
      conditionGroup: "group-1",
    };
    expect(conditional.conditionGroup).toBe("group-1");
  });

  test("VerificationLoop has all required fields", () => {
    const loop: VerificationLoop = {
      entryNode: "start",
      exitNode: "end",
      maxIterations: 5,
      bodyNodes: ["step1", "step2"],
    };
    expect(loop.entryNode).toBe("start");
    expect(loop.exitNode).toBe("end");
    expect(loop.maxIterations).toBe(5);
    expect(loop.bodyNodes).toEqual(["step1", "step2"]);
  });

  test("EncodedGraph has all required fields", () => {
    const graph: EncodedGraph = {
      nodes: [
        { id: "start", type: "entry" },
        { id: "end", type: "exit" },
      ],
      edges: [{ from: "start", to: "end", hasCondition: false }],
      startNode: "start",
      endNodes: ["end"],
      loops: [],
      stateFields: ["input", "output"],
    };
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(1);
    expect(graph.startNode).toBe("start");
    expect(graph.endNodes).toEqual(["end"]);
    expect(graph.loops).toHaveLength(0);
    expect(graph.stateFields).toEqual(["input", "output"]);
  });
});
