/**
 * Tests for termination verification (Property 2).
 *
 * The mock solver stores constraints and evaluates termination by checking
 * if all non-end nodes can reach an end node through backward BFS from
 * end nodes along successor edges.
 *
 * Note: checkTermination has a pre-check that catches "dead-end" nodes
 * (non-end nodes with no successors) BEFORE calling the solver. The solver
 * only handles the remaining case: cycles that may or may not have an
 * exit to an end node. The mock solver handles both cases correctly.
 */

import { describe, test, expect, mock } from "bun:test";
import type { EncodedGraph } from "@/services/workflows/verification/types";

// ---------------------------------------------------------------------------
// Solver mock: captures constraints and evaluates termination
// ---------------------------------------------------------------------------

/**
 * We need to track which node IDs are "end nodes" (dist=0) and which have
 * successor relationships. The mock Int objects carry their variable name
 * so we can reconstruct the graph structure from constraints.
 */

interface MockArith {
  _mockType: "arith";
  _name: string;
  eq: (other: MockArith | MockIntVal) => MockBoolConstraint;
  add: (other: number | MockArith | MockIntVal) => MockArith;
}

interface MockIntVal {
  _mockType: "intval";
  _value: number;
}

interface MockBoolConstraint {
  _mockType: "constraint";
  _kind: string;
  _left?: MockArith | MockIntVal;
  _right?: MockArith | MockIntVal;
  _args?: MockBoolConstraint[];
}

function isArith(x: unknown): x is MockArith {
  return (x as MockArith)?._mockType === "arith";
}

function isIntVal(x: unknown): x is MockIntVal {
  return (x as MockIntVal)?._mockType === "intval";
}

function getNodeId(expr: MockArith | MockIntVal): string | null {
  if (isArith(expr) && expr._name.startsWith("dist_")) {
    return expr._name.slice(5);
  }
  return null;
}

function coerceToExpr(value: number | MockArith | MockIntVal): MockArith | MockIntVal {
  if (typeof value === "number") {
    return { _mockType: "intval", _value: value } as MockIntVal;
  }
  return value;
}

function createArith(name: string): MockArith {
  const self: MockArith = {
    _mockType: "arith",
    _name: name,
    eq(other: number | MockArith | MockIntVal): MockBoolConstraint {
      return { _mockType: "constraint", _kind: "eq", _left: self, _right: coerceToExpr(other) };
    },
    add(other: number | MockArith | MockIntVal): MockArith {
      // Create a synthetic arith that carries the name for the "added-to" variable
      // We create a wrapper that stores the "base + offset" info
      // For parsing: _name encodes the base variable
      const wrapper: MockArith = {
        _mockType: "arith",
        _name: `__add_${name}`, // Not a dist_ var, used as a marker
        eq: (o: number | MockArith | MockIntVal) => ({ _mockType: "constraint", _kind: "eq", _left: wrapper, _right: coerceToExpr(o) }),
        add: () => wrapper, // Should not be chained further
      };
      // Attach source info for the parser
      (wrapper as unknown as Record<string, unknown>).__baseExpr = self;
      (wrapper as unknown as Record<string, unknown>).__addend = coerceToExpr(other);
      return wrapper;
    },
  };
  return self;
}

function createMockContext() {
  return {
    Int: {
      const: (name: string) => createArith(name),
      val: (value: number): MockIntVal => ({ _mockType: "intval", _value: value }),
    },
    GT: (a: MockArith, b: MockIntVal): MockBoolConstraint => ({
      _mockType: "constraint",
      _kind: "gt",
      _left: a,
      _right: b,
    }),
    GE: (a: MockArith, b: MockIntVal): MockBoolConstraint => ({
      _mockType: "constraint",
      _kind: "ge",
      _left: a,
      _right: b,
    }),
    Or: (...args: MockBoolConstraint[]): MockBoolConstraint => ({
      _mockType: "constraint",
      _kind: "or",
      _args: args,
    }),
    Solver: class MockSolver {
      constraints: MockBoolConstraint[] = [];

      add(constraint: MockBoolConstraint) {
        this.constraints.push(constraint);
      }

      push() {}
      pop() {}

      async check(): Promise<"sat" | "unsat" | "unknown"> {
        // Extract graph structure from constraints
        const endNodes = new Set<string>();
        const successors = new Map<string, Set<string>>();
        const nonEndNodes = new Set<string>();

        const extractSuccessors = (c: MockBoolConstraint) => {
          // eq constraint: dist[node].eq(dist[succ].add(1))
          // The _left is dist[node], _right is dist[succ].add(1)
          if (c._kind === "eq" && isArith(c._left!)) {
            const fromId = getNodeId(c._left!);
            // Check if _right is a val(0) -> end node
            if (isIntVal(c._right!) && c._right!._value === 0 && fromId) {
              endNodes.add(fromId);
              return;
            }
            // Check if _right is an add expression (dist[succ].add(1))
            if (isArith(c._right!) && fromId) {
              const baseExpr = (c._right as unknown as Record<string, unknown>).__baseExpr;
              if (isArith(baseExpr)) {
                const toId = getNodeId(baseExpr);
                if (toId && fromId) {
                  if (!successors.has(fromId)) successors.set(fromId, new Set());
                  successors.get(fromId)!.add(toId);
                }
              }
            }
          }
        };

        for (const c of this.constraints) {
          if (c._kind === "gt" && isArith(c._left!)) {
            const nodeId = getNodeId(c._left!);
            if (nodeId) nonEndNodes.add(nodeId);
          }
          if (c._kind === "eq") {
            extractSuccessors(c);
          }
          if (c._kind === "or" && c._args) {
            for (const arg of c._args) {
              extractSuccessors(arg);
            }
          }
        }

        // BFS backward from end nodes
        const canReachEnd = new Set<string>(endNodes);
        const queue = [...endNodes];
        // Build reverse adjacency
        const predecessors = new Map<string, Set<string>>();
        for (const [from, tos] of successors) {
          for (const to of tos) {
            if (!predecessors.has(to)) predecessors.set(to, new Set());
            predecessors.get(to)!.add(from);
          }
        }
        while (queue.length > 0) {
          const current = queue.shift()!;
          const preds = predecessors.get(current);
          if (preds) {
            for (const pred of preds) {
              if (!canReachEnd.has(pred)) {
                canReachEnd.add(pred);
                queue.push(pred);
              }
            }
          }
        }

        // All non-end nodes must be able to reach an end
        for (const nodeId of nonEndNodes) {
          if (!canReachEnd.has(nodeId)) {
            return "unsat";
          }
        }

        return "sat";
      }
    },
  };
}

