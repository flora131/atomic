/**
 * Tests for loop-bounds verification (Property 4).
 *
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

