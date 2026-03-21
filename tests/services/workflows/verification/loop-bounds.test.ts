/**
 * Tests for loop-bounds verification (Property 4).
 *
 * Since z3-solver is incompatible with Bun's runtime, we mock the Z3 API
 * with a correct integer arithmetic solver that implements the ranking
 * function check: `ranking >= 0 AND iterCount < maxIter AND ranking <= 0`.
 *
 * The mock solver evaluates these constraints arithmetically to return
 * the correct sat/unsat result, matching real Z3 behavior.
 */

import { describe, test, expect, mock } from "bun:test";
import type { EncodedGraph } from "@/services/workflows/verification/types";

// ---------------------------------------------------------------------------
// Z3 mock: integer arithmetic solver for the ranking function check
// ---------------------------------------------------------------------------

interface MockIntExpr {
  _type: "int";
  _kind: "const" | "val" | "sub";
  _name?: string;
  _value?: number;
  _left?: MockIntExpr;
  _right?: MockIntExpr;
}

interface MockConstraint {
  _type: "ge" | "lt" | "le";
  _left: MockIntExpr;
  _right: MockIntExpr;
}

function mkConst(name: string): MockIntExpr {
  return { _type: "int", _kind: "const", _name: name };
}

function mkVal(n: number): MockIntExpr {
  return { _type: "int", _kind: "val", _value: n };
}

function mkSub(a: MockIntExpr, b: MockIntExpr): MockIntExpr {
  return { _type: "int", _kind: "sub", _left: a, _right: b };
}

/**
 * Evaluate a MockIntExpr given an assignment for the free variable.
 * The ranking function check uses a single free variable (iterCount).
 */
function evaluate(expr: MockIntExpr, varValue: number): number {
  switch (expr._kind) {
    case "val":
      return expr._value ?? 0;
    case "const":
      return varValue; // Only one free variable in our encoding
    case "sub":
      return evaluate(expr._left!, varValue) - evaluate(expr._right!, varValue);
  }
}

function checkConstraint(c: MockConstraint, varValue: number): boolean {
  const left = evaluate(c._left, varValue);
  const right = evaluate(c._right, varValue);
  switch (c._type) {
    case "ge":
      return left >= right;
    case "lt":
      return left < right;
    case "le":
      return left <= right;
  }
}

function createMockContext() {
  return {
    Int: {
      const: (name: string) => mkConst(name),
      val: (n: number) => mkVal(n),
    },
    Sub: (a: MockIntExpr, b: MockIntExpr) => mkSub(a, b),
    GE: (a: MockIntExpr, b: MockIntExpr): MockConstraint => ({
      _type: "ge",
      _left: a,
      _right: b,
    }),
    LT: (a: MockIntExpr, b: MockIntExpr): MockConstraint => ({
      _type: "lt",
      _left: a,
      _right: b,
    }),
    LE: (a: MockIntExpr, b: MockIntExpr): MockConstraint => ({
      _type: "le",
      _left: a,
      _right: b,
    }),
    Solver: class MockSolver {
      constraints: MockConstraint[] = [];
      add(constraint: MockConstraint) {
        this.constraints.push(constraint);
      }
      async check(): Promise<"sat" | "unsat"> {
        // Try all integer values in a reasonable range to find a satisfying assignment
        // For the ranking function encoding:
        //   ranking >= 0  =>  maxIter - iter >= 0  =>  iter <= maxIter
        //   iter < maxIter
        //   ranking <= 0  =>  maxIter - iter <= 0  =>  iter >= maxIter
        // Combined: iter <= maxIter AND iter < maxIter AND iter >= maxIter
        // => iter = maxIter AND iter < maxIter => contradiction => unsat
        //
        // We brute-force check a range of integer values.
        for (let v = -100; v <= 200; v++) {
          if (this.constraints.every((c) => checkConstraint(c, v))) {
            return "sat";
          }
        }
        return "unsat";
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
const { checkLoopBounds } = await import(
  "@/services/workflows/verification/loop-bounds"
);

describe("checkLoopBounds", () => {
  test("should pass when graph has no loops", async () => {
    const graph: EncodedGraph = {
      nodes: [
        { id: "start", type: "entry" },
        { id: "end", type: "exit" },
      ],
      edges: [{ from: "start", to: "end", hasCondition: false }],
      startNode: "start",
      endNodes: ["end"],
      loops: [],
      stateFields: [],
    };

    const result = await checkLoopBounds(graph);
    expect(result.verified).toBe(true);
  });

  test("should pass for a loop with positive maxIterations", async () => {
    const graph: EncodedGraph = {
      nodes: [
        { id: "start", type: "entry" },
        { id: "loop-entry", type: "agent" },
        { id: "loop-body", type: "agent" },
        { id: "end", type: "exit" },
      ],
      edges: [
        { from: "start", to: "loop-entry", hasCondition: false },
        { from: "loop-entry", to: "loop-body", hasCondition: true },
        { from: "loop-body", to: "loop-entry", hasCondition: false },
        { from: "loop-entry", to: "end", hasCondition: true },
      ],
      startNode: "start",
      endNodes: ["end"],
      loops: [
        {
          entryNode: "loop-entry",
          exitNode: "end",
          maxIterations: 5,
          bodyNodes: ["loop-body"],
        },
      ],
      stateFields: [],
    };

    const result = await checkLoopBounds(graph);
    expect(result.verified).toBe(true);
  });

  test("should pass for a loop with maxIterations = 1", async () => {
    const graph: EncodedGraph = {
      nodes: [
        { id: "start", type: "entry" },
        { id: "loop-entry", type: "agent" },
        { id: "end", type: "exit" },
      ],
      edges: [
        { from: "start", to: "loop-entry", hasCondition: false },
        { from: "loop-entry", to: "loop-entry", hasCondition: true },
        { from: "loop-entry", to: "end", hasCondition: true },
      ],
      startNode: "start",
      endNodes: ["end"],
      loops: [
        {
          entryNode: "loop-entry",
          exitNode: "end",
          maxIterations: 1,
          bodyNodes: [],
        },
      ],
      stateFields: [],
    };

    const result = await checkLoopBounds(graph);
    expect(result.verified).toBe(true);
  });

  test("should pass for multiple loops with positive maxIterations", async () => {
    const graph: EncodedGraph = {
      nodes: [
        { id: "start", type: "entry" },
        { id: "loop1-entry", type: "agent" },
        { id: "loop2-entry", type: "agent" },
        { id: "end", type: "exit" },
      ],
      edges: [
        { from: "start", to: "loop1-entry", hasCondition: false },
        { from: "loop1-entry", to: "loop2-entry", hasCondition: false },
        { from: "loop2-entry", to: "end", hasCondition: false },
      ],
      startNode: "start",
      endNodes: ["end"],
      loops: [
        {
          entryNode: "loop1-entry",
          exitNode: "loop2-entry",
          maxIterations: 10,
          bodyNodes: [],
        },
        {
          entryNode: "loop2-entry",
          exitNode: "end",
          maxIterations: 3,
          bodyNodes: [],
        },
      ],
      stateFields: [],
    };

    const result = await checkLoopBounds(graph);
    expect(result.verified).toBe(true);
  });

  test("should pass for loop with large maxIterations", async () => {
    const graph: EncodedGraph = {
      nodes: [
        { id: "start", type: "entry" },
        { id: "loop-entry", type: "agent" },
        { id: "end", type: "exit" },
      ],
      edges: [
        { from: "start", to: "loop-entry", hasCondition: false },
        { from: "loop-entry", to: "end", hasCondition: false },
      ],
      startNode: "start",
      endNodes: ["end"],
      loops: [
        {
          entryNode: "loop-entry",
          exitNode: "end",
          maxIterations: 100,
          bodyNodes: [],
        },
      ],
      stateFields: [],
    };

    const result = await checkLoopBounds(graph);
    expect(result.verified).toBe(true);
  });

  test("should return verified true and no counterexample when passing", async () => {
    const graph: EncodedGraph = {
      nodes: [
        { id: "start", type: "entry" },
        { id: "end", type: "exit" },
      ],
      edges: [{ from: "start", to: "end", hasCondition: false }],
      startNode: "start",
      endNodes: ["end"],
      loops: [],
      stateFields: [],
    };

    const result = await checkLoopBounds(graph);
    expect(result.verified).toBe(true);
    expect(result.counterexample).toBeUndefined();
    expect(result.details).toBeUndefined();
  });
});
