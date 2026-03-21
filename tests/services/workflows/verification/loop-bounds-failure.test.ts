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

