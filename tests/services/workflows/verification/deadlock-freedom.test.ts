/**
 * Tests for deadlock-freedom verification (Property 3).
 *
 * Since z3-solver is incompatible with Bun's runtime, we mock the Z3 API
 * with a minimal boolean satisfiability implementation. The mock solver
 * correctly handles the simple boolean cases used by checkDeadlockFreedom:
 * - "All conditions false" check: always SAT (conditions are independent booleans)
 *
 * This validates the graph-structural logic (edge grouping, exhaustiveness
 * detection) while the Z3 integration is covered by Node.js-based tests.
 */

import { describe, test, expect, mock, beforeEach } from "bun:test";
import type { EncodedGraph } from "@/services/workflows/verification/types";

// ---------------------------------------------------------------------------
// Z3 mock: minimal boolean solver that supports the API used by deadlock-freedom
// ---------------------------------------------------------------------------

function createMockBool(name: string) {
  return { _type: "bool", _name: name };
}

function createMockContext() {
  const constraints: unknown[] = [];
  const stack: unknown[][] = [];

  const ctx = {
    Bool: {
      const: (name: string) => createMockBool(name),
    },
    Not: (a: unknown) => ({ _type: "not", _arg: a }),
    Or: (...args: unknown[]) => ({ _type: "or", _args: args }),
    And: (...args: unknown[]) => ({ _type: "and", _args: args }),
    Eq: (a: unknown, b: unknown) => ({ _type: "eq", _a: a, _b: b }),
    Solver: class MockSolver {
      constraints: unknown[] = [];
      stack: unknown[][] = [];
      add(constraint: unknown) {
        this.constraints.push(constraint);
      }
      push() {
        this.stack.push([...this.constraints]);
      }
      pop() {
        this.constraints = this.stack.pop() ?? [];
      }
      async check(): Promise<"sat" | "unsat" | "unknown"> {
        // For the deadlock-freedom check: when all conditions are asserted
        // as Not(cond), it's always satisfiable (independent booleans can be false)
        return "sat";
      }
    },
  };
  return ctx;
}

mock.module("z3-solver", () => ({
  init: async () => ({
    Context: () => createMockContext(),
  }),
}));

// Must import AFTER mock.module
const { checkDeadlockFreedom } = await import(
  "@/services/workflows/verification/deadlock-freedom"
);

describe("checkDeadlockFreedom", () => {
  test("should pass for a simple linear graph (start -> end)", async () => {
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

    const result = await checkDeadlockFreedom(graph);
    expect(result.verified).toBe(true);
  });

  test("should pass for a chain with unconditional edges", async () => {
    const graph: EncodedGraph = {
      nodes: [
        { id: "start", type: "entry" },
        { id: "step1", type: "agent" },
        { id: "step2", type: "agent" },
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
      stateFields: [],
    };

    const result = await checkDeadlockFreedom(graph);
    expect(result.verified).toBe(true);
  });

  test("should fail when a non-end node has no outgoing edges", async () => {
    const graph: EncodedGraph = {
      nodes: [
        { id: "start", type: "entry" },
        { id: "orphan", type: "agent" },
        { id: "end", type: "exit" },
      ],
      edges: [
        { from: "start", to: "orphan", hasCondition: false },
        // orphan has no outgoing edge and is not an end node
      ],
      startNode: "start",
      endNodes: ["end"],
      loops: [],
      stateFields: [],
    };

    const result = await checkDeadlockFreedom(graph);
    expect(result.verified).toBe(false);
    expect(result.counterexample).toContain('"orphan"');
    expect(result.details?.deadlockedNodes).toEqual(["orphan"]);
  });

  test("should pass when end nodes have no outgoing edges", async () => {
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

    const result = await checkDeadlockFreedom(graph);
    expect(result.verified).toBe(true);
  });

  test("should pass for exhaustive condition group with else branch", async () => {
    const graph: EncodedGraph = {
      nodes: [
        { id: "start", type: "entry" },
        { id: "then-branch", type: "agent" },
        { id: "else-branch", type: "agent" },
        { id: "end", type: "exit" },
      ],
      edges: [
        {
          from: "start",
          to: "then-branch",
          hasCondition: true,
          conditionGroup: "group-1",
        },
        {
          from: "start",
          to: "else-branch",
          hasCondition: false,
          conditionGroup: "group-1",
        },
        { from: "then-branch", to: "end", hasCondition: false },
        { from: "else-branch", to: "end", hasCondition: false },
      ],
      startNode: "start",
      endNodes: ["end"],
      loops: [],
      stateFields: [],
    };

    const result = await checkDeadlockFreedom(graph);
    expect(result.verified).toBe(true);
  });

  test("should fail for non-exhaustive conditional edges (if without else)", async () => {
    const graph: EncodedGraph = {
      nodes: [
        { id: "start", type: "entry" },
        { id: "then-branch", type: "agent" },
        { id: "end", type: "exit" },
      ],
      edges: [
        // Only a conditional edge with no else -- not exhaustive
        {
          from: "start",
          to: "then-branch",
          hasCondition: true,
        },
        { from: "then-branch", to: "end", hasCondition: false },
      ],
      startNode: "start",
      endNodes: ["end"],
      loops: [],
      stateFields: [],
    };

    const result = await checkDeadlockFreedom(graph);
    expect(result.verified).toBe(false);
    expect(result.counterexample).toContain('"start"');
  });

  test("should fail for grouped conditional edges without else", async () => {
    const graph: EncodedGraph = {
      nodes: [
        { id: "start", type: "entry" },
        { id: "case-a", type: "agent" },
        { id: "case-b", type: "agent" },
        { id: "end", type: "exit" },
      ],
      edges: [
        {
          from: "start",
          to: "case-a",
          hasCondition: true,
          conditionGroup: "group-1",
        },
        {
          from: "start",
          to: "case-b",
          hasCondition: true,
          conditionGroup: "group-1",
        },
        // No else branch in the group -- not exhaustive
        { from: "case-a", to: "end", hasCondition: false },
        { from: "case-b", to: "end", hasCondition: false },
      ],
      startNode: "start",
      endNodes: ["end"],
      loops: [],
      stateFields: [],
    };

    const result = await checkDeadlockFreedom(graph);
    expect(result.verified).toBe(false);
    expect(result.counterexample).toContain('"start"');
  });

  test("should report multiple deadlocked nodes", async () => {
    const graph: EncodedGraph = {
      nodes: [
        { id: "start", type: "entry" },
        { id: "dead1", type: "agent" },
        { id: "dead2", type: "agent" },
        { id: "end", type: "exit" },
      ],
      edges: [
        { from: "start", to: "dead1", hasCondition: false },
        { from: "start", to: "dead2", hasCondition: false },
        // Both dead1 and dead2 have no outgoing edges
      ],
      startNode: "start",
      endNodes: ["end"],
      loops: [],
      stateFields: [],
    };

    const result = await checkDeadlockFreedom(graph);
    expect(result.verified).toBe(false);
    expect(result.details?.deadlockedNodes).toContain("dead1");
    expect(result.details?.deadlockedNodes).toContain("dead2");
  });

  test("should pass for diamond graph with unconditional edges", async () => {
    const graph: EncodedGraph = {
      nodes: [
        { id: "start", type: "entry" },
        { id: "left", type: "agent" },
        { id: "right", type: "agent" },
        { id: "end", type: "exit" },
      ],
      edges: [
        { from: "start", to: "left", hasCondition: false },
        { from: "start", to: "right", hasCondition: false },
        { from: "left", to: "end", hasCondition: false },
        { from: "right", to: "end", hasCondition: false },
      ],
      startNode: "start",
      endNodes: ["end"],
      loops: [],
      stateFields: [],
    };

    const result = await checkDeadlockFreedom(graph);
    expect(result.verified).toBe(true);
  });

  test("should pass when conditional edges mixed with one unconditional edge", async () => {
    const graph: EncodedGraph = {
      nodes: [
        { id: "start", type: "entry" },
        { id: "fast-path", type: "agent" },
        { id: "default-path", type: "agent" },
        { id: "end", type: "exit" },
      ],
      edges: [
        // Conditional edge to fast-path
        { from: "start", to: "fast-path", hasCondition: true },
        // Unconditional edge to default-path (acts as fallback)
        { from: "start", to: "default-path", hasCondition: false },
        { from: "fast-path", to: "end", hasCondition: false },
        { from: "default-path", to: "end", hasCondition: false },
      ],
      startNode: "start",
      endNodes: ["end"],
      loops: [],
      stateFields: [],
    };

    const result = await checkDeadlockFreedom(graph);
    expect(result.verified).toBe(true);
  });

  test("should handle multiple end nodes correctly", async () => {
    const graph: EncodedGraph = {
      nodes: [
        { id: "start", type: "entry" },
        { id: "success-end", type: "exit" },
        { id: "error-end", type: "exit" },
      ],
      edges: [
        {
          from: "start",
          to: "success-end",
          hasCondition: true,
          conditionGroup: "g1",
        },
        {
          from: "start",
          to: "error-end",
          hasCondition: false,
          conditionGroup: "g1",
        },
      ],
      startNode: "start",
      endNodes: ["success-end", "error-end"],
      loops: [],
      stateFields: [],
    };

    const result = await checkDeadlockFreedom(graph);
    expect(result.verified).toBe(true);
  });
});
