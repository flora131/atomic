/**
 * Tests for deadlock-freedom verification (Property 3).
 *
 * with a minimal boolean satisfiability implementation. The mock solver
 * correctly handles the simple boolean cases used by checkDeadlockFreedom:
 * - "All conditions false" check: always SAT (conditions are independent booleans)
 *
 * This validates the graph-structural logic (edge grouping, exhaustiveness
 * detection) while the solver integration is covered by Node.js-based tests.
 */

import { describe, test, expect, mock, beforeEach } from "bun:test";
import type { EncodedGraph } from "@/services/workflows/verification/types";

// ---------------------------------------------------------------------------
// Solver mock: minimal boolean solver that supports the API used by deadlock-freedom
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

