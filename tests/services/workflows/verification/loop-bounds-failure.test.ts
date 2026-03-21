/**
 * Tests for loop-bounds verification failure path (Property 4).
 *
 * Uses a mock Z3 solver that always returns "sat" (simulating a scenario
 * where the ranking function proof fails), to exercise the failure
 * reporting logic in checkLoopBounds.
 */

import { describe, test, expect, mock } from "bun:test";
import type { EncodedGraph } from "@/services/workflows/verification/types";

// ---------------------------------------------------------------------------
// Z3 mock: solver that always returns "sat" to simulate unbounded loops
// ---------------------------------------------------------------------------

function createAlwaysSatContext() {
  return {
    Int: {
      const: (_name: string) => ({ _type: "int" }),
      val: (_n: number) => ({ _type: "int" }),
    },
    Sub: (_a: unknown, _b: unknown) => ({ _type: "int" }),
    GE: (_a: unknown, _b: unknown) => ({ _type: "constraint" }),
    LT: (_a: unknown, _b: unknown) => ({ _type: "constraint" }),
    LE: (_a: unknown, _b: unknown) => ({ _type: "constraint" }),
    Solver: class AlwaysSatSolver {
      add(_constraint: unknown) {}
      async check(): Promise<"sat" | "unsat"> {
        return "sat"; // Always satisfiable => unbounded loop
      }
    },
  };
}

mock.module("z3-solver", () => ({
  init: async () => ({
    Context: () => createAlwaysSatContext(),
  }),
}));

// Must import AFTER mock.module
const { checkLoopBounds } = await import(
  "@/services/workflows/verification/loop-bounds"
);

describe("checkLoopBounds (failure path)", () => {
  test("should fail when solver returns sat (loop may not terminate)", async () => {
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
          maxIterations: 5,
          bodyNodes: [],
        },
      ],
      stateFields: [],
    };

    const result = await checkLoopBounds(graph);
    expect(result.verified).toBe(false);
    expect(result.counterexample).toContain("Unbounded loops detected");
    expect(result.counterexample).toContain('"loop-entry"');
    expect(result.counterexample).toContain("maxIterations=5");
  });

  test("should report multiple unbounded loops", async () => {
    const graph: EncodedGraph = {
      nodes: [
        { id: "start", type: "entry" },
        { id: "loop1", type: "agent" },
        { id: "loop2", type: "agent" },
        { id: "end", type: "exit" },
      ],
      edges: [
        { from: "start", to: "loop1", hasCondition: false },
        { from: "loop1", to: "loop2", hasCondition: false },
        { from: "loop2", to: "end", hasCondition: false },
      ],
      startNode: "start",
      endNodes: ["end"],
      loops: [
        {
          entryNode: "loop1",
          exitNode: "loop2",
          maxIterations: 10,
          bodyNodes: [],
        },
        {
          entryNode: "loop2",
          exitNode: "end",
          maxIterations: 3,
          bodyNodes: [],
        },
      ],
      stateFields: [],
    };

    const result = await checkLoopBounds(graph);
    expect(result.verified).toBe(false);
    expect(result.counterexample).toContain('"loop1"');
    expect(result.counterexample).toContain('"loop2"');
    const details = result.details as { unboundedLoops: Array<{ entryNode: string; maxIterations: number }> };
    expect(details.unboundedLoops).toHaveLength(2);
    expect(details.unboundedLoops[0]!.entryNode).toBe("loop1");
    expect(details.unboundedLoops[0]!.maxIterations).toBe(10);
    expect(details.unboundedLoops[1]!.entryNode).toBe("loop2");
    expect(details.unboundedLoops[1]!.maxIterations).toBe(3);
  });

  test("should include entry node and maxIterations in counterexample", async () => {
    const graph: EncodedGraph = {
      nodes: [
        { id: "start", type: "entry" },
        { id: "retry-loop", type: "agent" },
        { id: "end", type: "exit" },
      ],
      edges: [
        { from: "start", to: "retry-loop", hasCondition: false },
        { from: "retry-loop", to: "end", hasCondition: false },
      ],
      startNode: "start",
      endNodes: ["end"],
      loops: [
        {
          entryNode: "retry-loop",
          exitNode: "end",
          maxIterations: 42,
          bodyNodes: [],
        },
      ],
      stateFields: [],
    };

    const result = await checkLoopBounds(graph);
    expect(result.verified).toBe(false);
    expect(result.counterexample).toContain('"retry-loop"');
    expect(result.counterexample).toContain("maxIterations=42");
  });
});
