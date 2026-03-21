/**
 * Tests for reachability verification (Property 1).
 *
 * Since z3-solver is incompatible with Bun's runtime, we mock the Z3 API
 * with a boolean constraint evaluator that correctly computes reachability
 * using the same constraint structure as checkReachability.
 *
 * The mock solver implements:
 * - Boolean variable tracking (true/false assignments)
 * - Constraint propagation for Eq, Not, Or
 * - Push/pop scoping for incremental checks
 *
 * This validates the graph-structural logic (predecessor computation,
 * constraint encoding, result interpretation).
 */

import { describe, test, expect, mock } from "bun:test";
import type { EncodedGraph } from "@/services/workflows/verification/types";

// ---------------------------------------------------------------------------
// Z3 mock: boolean constraint solver that computes reachability
// ---------------------------------------------------------------------------

interface MockExpr {
  _type: string;
  _name?: string;
  _args?: MockExpr[];
  _arg?: MockExpr;
  _a?: MockExpr;
  _b?: MockExpr;
}

function createMockBool(name: string): MockExpr {
  return { _type: "bool", _name: name };
}

function evaluate(
  expr: MockExpr,
  assignment: Map<string, boolean>,
): boolean | null {
  if (expr._type === "bool") {
    return assignment.get(expr._name!) ?? null;
  }
  if (expr._type === "not") {
    const val = evaluate(expr._arg!, assignment);
    return val === null ? null : !val;
  }
  if (expr._type === "or") {
    const vals = (expr._args ?? []).map((a) => evaluate(a, assignment));
    if (vals.some((v) => v === true)) return true;
    if (vals.every((v) => v === false)) return false;
    return null;
  }
  if (expr._type === "eq") {
    const a = evaluate(expr._a!, assignment);
    const b = evaluate(expr._b!, assignment);
    if (a === null || b === null) return null;
    return a === b;
  }
  return null;
}

/**
 * Simple constraint solver using BFS-based reachability.
 * For the reachability check, we know the constraint structure:
 * 1. reach[start] = true
 * 2. reach[node] = false (for no-predecessor nodes)
 * 3. reach[node] <=> reach[pred] (single predecessor)
 * 4. reach[node] <=> OR(reach[preds]) (multiple predecessors)
 *
 * We propagate constraints to determine unique assignments, then check
 * whether additional NOT(reach[x]) constraints are satisfiable.
 */
function createMockContext() {
  return {
    Bool: {
      const: (name: string) => createMockBool(name),
    },
    Not: (a: MockExpr): MockExpr => ({ _type: "not", _arg: a }),
    Or: (...args: MockExpr[]): MockExpr => ({ _type: "or", _args: args }),
    Eq: (a: MockExpr, b: MockExpr): MockExpr => ({
      _type: "eq",
      _a: a,
      _b: b,
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

      async check(): Promise<"sat" | "unsat" | "unknown"> {
        // Propagate constraints to find forced assignments
        const assignment = new Map<string, boolean>();
        let changed = true;

        // Iterate until convergence
        while (changed) {
          changed = false;
          for (const constraint of this.constraints) {
            // A bare boolean is asserted as true
            if (constraint._type === "bool") {
              if (!assignment.has(constraint._name!)) {
                assignment.set(constraint._name!, true);
                changed = true;
              }
            }
            // Not(bool) asserts the bool is false
            if (
              constraint._type === "not" &&
              constraint._arg?._type === "bool"
            ) {
              if (!assignment.has(constraint._arg._name!)) {
                assignment.set(constraint._arg._name!, false);
                changed = true;
              } else if (assignment.get(constraint._arg._name!) === true) {
                return "unsat"; // Contradiction
              }
            }
            // Eq(a, b) propagates known values
            if (constraint._type === "eq") {
              const aVal = evaluate(constraint._a!, assignment);
              const bVal = evaluate(constraint._b!, assignment);

              if (aVal !== null && bVal !== null && aVal !== bVal) {
                return "unsat";
              }
              if (
                aVal !== null &&
                bVal === null &&
                constraint._b?._type === "bool"
              ) {
                if (!assignment.has(constraint._b._name!)) {
                  assignment.set(constraint._b._name!, aVal);
                  changed = true;
                }
              }
              if (
                bVal !== null &&
                aVal === null &&
                constraint._a?._type === "bool"
              ) {
                if (!assignment.has(constraint._a._name!)) {
                  assignment.set(constraint._a._name!, bVal);
                  changed = true;
                }
              }
            }
          }
        }

        // Check all constraints are satisfied
        for (const constraint of this.constraints) {
          const val = evaluate(constraint, assignment);
          if (val === false) return "unsat";
        }

        return "sat";
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
const { checkReachability } = await import(
  "@/services/workflows/verification/reachability"
);

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeEncodedGraph(opts: {
  nodes: Array<{ id: string; type?: string }>;
  edges: Array<{ from: string; to: string }>;
  startNode: string;
  endNodes: string[];
}): EncodedGraph {
  return {
    nodes: opts.nodes.map((n) => ({ id: n.id, type: n.type ?? "agent" })),
    edges: opts.edges.map((e) => ({
      from: e.from,
      to: e.to,
      hasCondition: false,
    })),
    startNode: opts.startNode,
    endNodes: opts.endNodes,
    loops: [],
    stateFields: [],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("checkReachability", () => {
  test("verifies a simple linear graph (all nodes reachable)", async () => {
    const graph = makeEncodedGraph({
      nodes: [{ id: "A" }, { id: "B" }, { id: "C" }],
      edges: [
        { from: "A", to: "B" },
        { from: "B", to: "C" },
      ],
      startNode: "A",
      endNodes: ["C"],
    });

    const result = await checkReachability(graph);
    expect(result.verified).toBe(true);
    expect(result.counterexample).toBeUndefined();
  });

  test("detects an unreachable node (no edges leading to it)", async () => {
    const graph = makeEncodedGraph({
      nodes: [{ id: "A" }, { id: "B" }, { id: "C" }],
      edges: [{ from: "A", to: "B" }],
      startNode: "A",
      endNodes: ["B", "C"],
    });

    const result = await checkReachability(graph);
    expect(result.verified).toBe(false);
    expect(result.counterexample).toContain('"C"');
    expect(result.counterexample).toContain("unreachable");
    expect(result.details).toEqual({ unreachableNodes: ["C"] });
  });

  test("verifies a diamond-shaped graph (all reachable)", async () => {
    // A -> B, A -> C, B -> D, C -> D
    const graph = makeEncodedGraph({
      nodes: [{ id: "A" }, { id: "B" }, { id: "C" }, { id: "D" }],
      edges: [
        { from: "A", to: "B" },
        { from: "A", to: "C" },
        { from: "B", to: "D" },
        { from: "C", to: "D" },
      ],
      startNode: "A",
      endNodes: ["D"],
    });

    const result = await checkReachability(graph);
    expect(result.verified).toBe(true);
  });

  test("detects multiple unreachable nodes", async () => {
    const graph = makeEncodedGraph({
      nodes: [{ id: "A" }, { id: "B" }, { id: "X" }, { id: "Y" }],
      edges: [{ from: "A", to: "B" }],
      startNode: "A",
      endNodes: ["B"],
    });

    const result = await checkReachability(graph);
    expect(result.verified).toBe(false);
    const unreachable = result.details?.unreachableNodes as string[];
    expect(unreachable).toContain("X");
    expect(unreachable).toContain("Y");
  });

  test("verifies a single-node graph (start = end)", async () => {
    const graph = makeEncodedGraph({
      nodes: [{ id: "only" }],
      edges: [],
      startNode: "only",
      endNodes: ["only"],
    });

    const result = await checkReachability(graph);
    expect(result.verified).toBe(true);
  });

  test("handles start node not found in graph nodes", async () => {
    const graph = makeEncodedGraph({
      nodes: [{ id: "A" }],
      edges: [],
      startNode: "missing",
      endNodes: ["A"],
    });

    const result = await checkReachability(graph);
    expect(result.verified).toBe(false);
    expect(result.counterexample).toContain("not found");
  });

  test("verifies a graph with a cycle (all reachable)", async () => {
    // A -> B -> C -> A, with B -> D as end
    const graph = makeEncodedGraph({
      nodes: [{ id: "A" }, { id: "B" }, { id: "C" }, { id: "D" }],
      edges: [
        { from: "A", to: "B" },
        { from: "B", to: "C" },
        { from: "C", to: "A" },
        { from: "B", to: "D" },
      ],
      startNode: "A",
      endNodes: ["D"],
    });

    const result = await checkReachability(graph);
    expect(result.verified).toBe(true);
  });

  test("detects disconnected component as unreachable", async () => {
    // A -> B (connected), C -> D (disconnected from A)
    const graph = makeEncodedGraph({
      nodes: [{ id: "A" }, { id: "B" }, { id: "C" }, { id: "D" }],
      edges: [
        { from: "A", to: "B" },
        { from: "C", to: "D" },
      ],
      startNode: "A",
      endNodes: ["B", "D"],
    });

    const result = await checkReachability(graph);
    expect(result.verified).toBe(false);
    const unreachable = result.details?.unreachableNodes as string[];
    expect(unreachable).toContain("C");
    expect(unreachable).toContain("D");
  });

  test("returns verified true for a two-node graph", async () => {
    const graph = makeEncodedGraph({
      nodes: [{ id: "start" }, { id: "end" }],
      edges: [{ from: "start", to: "end" }],
      startNode: "start",
      endNodes: ["end"],
    });

    const result = await checkReachability(graph);
    expect(result.verified).toBe(true);
  });

  test("counterexample includes start node name", async () => {
    const graph = makeEncodedGraph({
      nodes: [{ id: "myStart" }, { id: "orphan" }],
      edges: [],
      startNode: "myStart",
      endNodes: ["myStart"],
    });

    const result = await checkReachability(graph);
    expect(result.verified).toBe(false);
    expect(result.counterexample).toContain('"myStart"');
  });
});
