/**
 * Tests for state data-flow verification (Property 5).
 *
 * Since z3-solver is incompatible with Bun's runtime, we mock the Z3 API
 * with a boolean constraint solver that evaluates the data-flow propagation
 * constraints. The mock correctly handles:
 * - Boolean variables per (field, node) pair
 * - Equality constraints: Eq(a, b), Eq(a, And(b, c, ...))
 * - Assertion of positive/negative boolean values
 * - Push/pop scoping for per-read queries
 */

import { describe, test, expect, mock } from "bun:test";
import type { EncodedGraph } from "@/services/workflows/verification/types";

// ---------------------------------------------------------------------------
// Z3 mock: boolean constraint solver for data-flow analysis
// ---------------------------------------------------------------------------

type MockBool = { _type: "bool"; _name: string };
type MockNot = { _type: "not"; _arg: MockExpr };
type MockAnd = { _type: "and"; _args: MockExpr[] };
type MockEq = { _type: "eq"; _left: MockExpr; _right: MockExpr };
type MockExpr = MockBool | MockNot | MockAnd | MockEq;

function isMockBool(e: MockExpr): e is MockBool {
  return e._type === "bool";
}

/**
 * Evaluates a mock boolean expression given a variable assignment.
 */
function evalExpr(expr: MockExpr, assignment: Map<string, boolean>): boolean {
  switch (expr._type) {
    case "bool":
      return assignment.get(expr._name) ?? false;
    case "not":
      return !evalExpr(expr._arg, assignment);
    case "and":
      return expr._args.every((a) => evalExpr(a, assignment));
    case "eq":
      return evalExpr(expr._left, assignment) === evalExpr(expr._right, assignment);
  }
}

/**
 * Extract all boolean variable names from a set of constraints.
 */
function extractVars(constraints: MockExpr[]): Set<string> {
  const vars = new Set<string>();
  function walk(e: MockExpr) {
    switch (e._type) {
      case "bool":
        vars.add(e._name);
        break;
      case "not":
        walk(e._arg);
        break;
      case "and":
        e._args.forEach(walk);
        break;
      case "eq":
        walk(e._left);
        walk(e._right);
        break;
    }
  }
  constraints.forEach(walk);
  return vars;
}

/**
 * Brute-force SAT check over all boolean variable assignments.
 * For small graphs (< ~20 variables), this is tractable.
 */
function bruteForceSat(constraints: MockExpr[]): "sat" | "unsat" {
  const varNames = [...extractVars(constraints)];
  const n = varNames.length;

  // Try all 2^n assignments
  for (let mask = 0; mask < (1 << n); mask++) {
    const assignment = new Map<string, boolean>();
    for (let i = 0; i < n; i++) {
      assignment.set(varNames[i]!, !!(mask & (1 << i)));
    }
    if (constraints.every((c) => evalExpr(c, assignment))) {
      return "sat";
    }
  }
  return "unsat";
}

function createMockContext() {
  return {
    Bool: {
      const: (name: string): MockBool => ({ _type: "bool", _name: name }),
    },
    Not: (a: MockExpr): MockNot => ({ _type: "not", _arg: a }),
    And: (...args: MockExpr[]): MockAnd => ({ _type: "and", _args: args }),
    Eq: (a: MockExpr, b: MockExpr): MockEq => ({
      _type: "eq",
      _left: a,
      _right: b,
    }),
    Solver: class MockSolver {
      constraints: MockExpr[] = [];
      stack: MockExpr[][] = [];
      add(constraint: MockExpr) {
        this.constraints.push(constraint);
      }
      push() {
        this.stack.push([...this.constraints]);
      }
      pop() {
        this.constraints = this.stack.pop() ?? [];
      }
      async check(): Promise<"sat" | "unsat"> {
        return bruteForceSat(this.constraints);
      }
    },
  };
}

mock.module("z3-solver", () => ({
  init: async () => ({
    Context: () => createMockContext(),
  }),
}));

// Must import AFTER mock.module
const { checkStateDataFlow } = await import(
  "@/services/workflows/verification/state-data-flow"
);

describe("checkStateDataFlow", () => {
  test("should pass when no nodes declare reads", async () => {
    const graph: EncodedGraph = {
      nodes: [
        { id: "start", type: "entry", outputs: ["result"] },
        { id: "end", type: "exit" },
      ],
      edges: [{ from: "start", to: "end", hasCondition: false }],
      startNode: "start",
      endNodes: ["end"],
      loops: [],
      stateFields: ["result"],
    };

    const result = await checkStateDataFlow(graph);
    expect(result.verified).toBe(true);
  });

  test("should pass when read field is written by predecessor", async () => {
    const graph: EncodedGraph = {
      nodes: [
        { id: "start", type: "entry", outputs: ["data"] },
        { id: "consumer", type: "agent", reads: ["data"] },
        { id: "end", type: "exit" },
      ],
      edges: [
        { from: "start", to: "consumer", hasCondition: false },
        { from: "consumer", to: "end", hasCondition: false },
      ],
      startNode: "start",
      endNodes: ["end"],
      loops: [],
      stateFields: ["data"],
    };

    const result = await checkStateDataFlow(graph);
    expect(result.verified).toBe(true);
  });

  test("should fail when read field is never written", async () => {
    const graph: EncodedGraph = {
      nodes: [
        { id: "start", type: "entry" },
        { id: "consumer", type: "agent", reads: ["missing-field"] },
        { id: "end", type: "exit" },
      ],
      edges: [
        { from: "start", to: "consumer", hasCondition: false },
        { from: "consumer", to: "end", hasCondition: false },
      ],
      startNode: "start",
      endNodes: ["end"],
      loops: [],
      stateFields: ["missing-field"],
    };

    const result = await checkStateDataFlow(graph);
    expect(result.verified).toBe(false);
    expect(result.counterexample).toContain('"consumer"');
    expect(result.counterexample).toContain('"missing-field"');
  });

  test("should pass when read field is written on ALL paths (diamond graph)", async () => {
    // start -> left -> merge -> end
    // start -> right -> merge -> end
    // Both left and right write "data", merge reads "data"
    const graph: EncodedGraph = {
      nodes: [
        { id: "start", type: "entry" },
        { id: "left", type: "agent", outputs: ["data"] },
        { id: "right", type: "agent", outputs: ["data"] },
        { id: "merge", type: "agent", reads: ["data"] },
        { id: "end", type: "exit" },
      ],
      edges: [
        { from: "start", to: "left", hasCondition: false },
        { from: "start", to: "right", hasCondition: false },
        { from: "left", to: "merge", hasCondition: false },
        { from: "right", to: "merge", hasCondition: false },
        { from: "merge", to: "end", hasCondition: false },
      ],
      startNode: "start",
      endNodes: ["end"],
      loops: [],
      stateFields: ["data"],
    };

    const result = await checkStateDataFlow(graph);
    expect(result.verified).toBe(true);
  });

  test("should fail when read field is written on only SOME paths (diamond graph)", async () => {
    // start -> left -> merge -> end
    // start -> right -> merge -> end
    // Only left writes "data", merge reads "data"
    // Right path doesn't write "data" => violation
    const graph: EncodedGraph = {
      nodes: [
        { id: "start", type: "entry" },
        { id: "left", type: "agent", outputs: ["data"] },
        { id: "right", type: "agent" },
        { id: "merge", type: "agent", reads: ["data"] },
        { id: "end", type: "exit" },
      ],
      edges: [
        { from: "start", to: "left", hasCondition: false },
        { from: "start", to: "right", hasCondition: false },
        { from: "left", to: "merge", hasCondition: false },
        { from: "right", to: "merge", hasCondition: false },
        { from: "merge", to: "end", hasCondition: false },
      ],
      startNode: "start",
      endNodes: ["end"],
      loops: [],
      stateFields: ["data"],
    };

    const result = await checkStateDataFlow(graph);
    expect(result.verified).toBe(false);
    expect(result.counterexample).toContain('"merge"');
    expect(result.counterexample).toContain('"data"');
  });

  test("should pass when reader node itself outputs the field", async () => {
    const graph: EncodedGraph = {
      nodes: [
        { id: "start", type: "entry" },
        { id: "producer-consumer", type: "agent", reads: ["x"], outputs: ["x"] },
        { id: "end", type: "exit" },
      ],
      edges: [
        { from: "start", to: "producer-consumer", hasCondition: false },
        { from: "producer-consumer", to: "end", hasCondition: false },
      ],
      startNode: "start",
      endNodes: ["end"],
      loops: [],
      stateFields: ["x"],
    };

    // The node produces "x" itself, so it always has access
    // (our encoding: nodeProducesField => always true)
    const result = await checkStateDataFlow(graph);
    expect(result.verified).toBe(true);
  });

  test("should pass for a chain of producers and consumers", async () => {
    const graph: EncodedGraph = {
      nodes: [
        { id: "start", type: "entry", outputs: ["a"] },
        { id: "step1", type: "agent", reads: ["a"], outputs: ["b"] },
        { id: "step2", type: "agent", reads: ["b"], outputs: ["c"] },
        { id: "step3", type: "agent", reads: ["c"] },
        { id: "end", type: "exit" },
      ],
      edges: [
        { from: "start", to: "step1", hasCondition: false },
        { from: "step1", to: "step2", hasCondition: false },
        { from: "step2", to: "step3", hasCondition: false },
        { from: "step3", to: "end", hasCondition: false },
      ],
      startNode: "start",
      endNodes: ["end"],
      loops: [],
      stateFields: ["a", "b", "c"],
    };

    const result = await checkStateDataFlow(graph);
    expect(result.verified).toBe(true);
  });

  test("should fail when chain has a gap (field b never written)", async () => {
    const graph: EncodedGraph = {
      nodes: [
        { id: "start", type: "entry", outputs: ["a"] },
        { id: "step1", type: "agent", reads: ["a"] },
        { id: "step2", type: "agent", reads: ["b"] },
        { id: "end", type: "exit" },
      ],
      edges: [
        { from: "start", to: "step1", hasCondition: false },
        { from: "step1", to: "step2", hasCondition: false },
        { from: "step2", to: "end", hasCondition: false },
      ],
      startNode: "start",
      endNodes: ["end"],
      loops: [],
      stateFields: ["a", "b"],
    };

    const result = await checkStateDataFlow(graph);
    expect(result.verified).toBe(false);
    expect(result.counterexample).toContain('"step2"');
    expect(result.counterexample).toContain('"b"');
  });

  test("should report multiple violations", async () => {
    const graph: EncodedGraph = {
      nodes: [
        { id: "start", type: "entry" },
        { id: "consumer1", type: "agent", reads: ["x"] },
        { id: "consumer2", type: "agent", reads: ["y"] },
        { id: "end", type: "exit" },
      ],
      edges: [
        { from: "start", to: "consumer1", hasCondition: false },
        { from: "consumer1", to: "consumer2", hasCondition: false },
        { from: "consumer2", to: "end", hasCondition: false },
      ],
      startNode: "start",
      endNodes: ["end"],
      loops: [],
      stateFields: ["x", "y"],
    };

    const result = await checkStateDataFlow(graph);
    expect(result.verified).toBe(false);
    const violations = result.details?.violations as Array<{
      nodeId: string;
      field: string;
    }>;
    expect(violations).toBeDefined();
    expect(violations.length).toBe(2);
    const violationDescs = violations.map((v) => `${v.nodeId}:${v.field}`);
    expect(violationDescs).toContain("consumer1:x");
    expect(violationDescs).toContain("consumer2:y");
  });

  test("should pass when start node outputs the field directly", async () => {
    const graph: EncodedGraph = {
      nodes: [
        { id: "start", type: "entry", outputs: ["config"] },
        { id: "worker", type: "agent", reads: ["config"] },
        { id: "end", type: "exit" },
      ],
      edges: [
        { from: "start", to: "worker", hasCondition: false },
        { from: "worker", to: "end", hasCondition: false },
      ],
      startNode: "start",
      endNodes: ["end"],
      loops: [],
      stateFields: ["config"],
    };

    const result = await checkStateDataFlow(graph);
    expect(result.verified).toBe(true);
  });

  test("should handle nodes with no reads or outputs gracefully", async () => {
    const graph: EncodedGraph = {
      nodes: [
        { id: "start", type: "entry" },
        { id: "passthrough", type: "agent" },
        { id: "end", type: "exit" },
      ],
      edges: [
        { from: "start", to: "passthrough", hasCondition: false },
        { from: "passthrough", to: "end", hasCondition: false },
      ],
      startNode: "start",
      endNodes: ["end"],
      loops: [],
      stateFields: [],
    };

    const result = await checkStateDataFlow(graph);
    expect(result.verified).toBe(true);
  });
});
