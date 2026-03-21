/**
 * Tests for state data-flow verification (Property 5).
 *
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

