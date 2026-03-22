/**
 * Tests for reachability verification (Property 1).
 *
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
// Solver mock: boolean constraint solver that computes reachability
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

