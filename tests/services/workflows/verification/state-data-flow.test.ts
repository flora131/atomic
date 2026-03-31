/**
 * Tests for state data-flow verification.
 *
 * Property: Every state field a node reads has been written by a
 * preceding node on all execution paths.
 */

import { test, expect, describe } from "bun:test";
import { checkStateDataFlow } from "@/services/workflows/verification/state-data-flow.ts";
import { buildGraph } from "./test-support.ts";
import type { VerificationNode } from "@/services/workflows/verification/types.ts";

describe("checkStateDataFlow", () => {
  describe("passing cases", () => {
    test("no reads at all — trivially valid", async () => {
      const graph = buildGraph({
        nodes: [
          { id: "A", type: "agent", outputs: ["x"] },
          { id: "B", type: "agent" },
        ],
        edges: [["A", "B"]],
        start: "A",
        ends: ["B"],
      });
      const result = await checkStateDataFlow(graph);
      expect(result.verified).toBe(true);
    });

    test("read after write on linear path", async () => {
      const graph = buildGraph({
        nodes: [
          { id: "writer", type: "agent", outputs: ["result"] },
          { id: "reader", type: "agent", reads: ["result"] },
        ],
        edges: [["writer", "reader"]],
        start: "writer",
        ends: ["reader"],
      });
      const result = await checkStateDataFlow(graph);
      expect(result.verified).toBe(true);
    });

    test("read after write through multiple hops", async () => {
      const graph = buildGraph({
        nodes: [
          { id: "A", type: "agent", outputs: ["data"] },
          { id: "B", type: "agent" },
          { id: "C", type: "agent", reads: ["data"] },
        ],
        edges: [
          ["A", "B"],
          ["B", "C"],
        ],
        start: "A",
        ends: ["C"],
      });
      const result = await checkStateDataFlow(graph);
      expect(result.verified).toBe(true);
    });

    test("diamond graph — field written on both branches before merge read", async () => {
      const nodes: VerificationNode[] = [
        { id: "start", type: "agent" },
        { id: "left", type: "agent", outputs: ["val"] },
        { id: "right", type: "agent", outputs: ["val"] },
        { id: "merge", type: "agent", reads: ["val"] },
      ];
      const graph = buildGraph({
        nodes,
        edges: [
          ["start", "left"],
          ["start", "right"],
          ["left", "merge"],
          ["right", "merge"],
        ],
        start: "start",
        ends: ["merge"],
      });
      const result = await checkStateDataFlow(graph);
      expect(result.verified).toBe(true);
    });

    test("node writes and reads the same field (produces before read check)", async () => {
      const graph = buildGraph({
        nodes: [
          { id: "A", type: "agent", outputs: ["x"], reads: ["x"] },
        ],
        edges: [],
        start: "A",
        ends: ["A"],
      });
      // Node outputs the field, so produced is true for itself
      const result = await checkStateDataFlow(graph);
      expect(result.verified).toBe(true);
    });

    test("multiple fields — all satisfied", async () => {
      const graph = buildGraph({
        nodes: [
          { id: "A", type: "agent", outputs: ["x", "y"] },
          { id: "B", type: "agent", reads: ["x", "y"], outputs: ["z"] },
          { id: "C", type: "agent", reads: ["z"] },
        ],
        edges: [
          ["A", "B"],
          ["B", "C"],
        ],
        start: "A",
        ends: ["C"],
      });
      const result = await checkStateDataFlow(graph);
      expect(result.verified).toBe(true);
    });
  });

  describe("failing cases", () => {
    test("read without any prior write", async () => {
      const graph = buildGraph({
        nodes: [
          { id: "A", type: "agent" },
          { id: "B", type: "agent", reads: ["missing"] },
        ],
        edges: [["A", "B"]],
        start: "A",
        ends: ["B"],
      });
      const result = await checkStateDataFlow(graph);
      expect(result.verified).toBe(false);
      expect(result.counterexample).toContain("B");
      expect(result.counterexample).toContain("missing");
    });

    test("diamond graph — field written on only one branch", async () => {
      const nodes: VerificationNode[] = [
        { id: "start", type: "agent" },
        { id: "left", type: "agent", outputs: ["val"] },
        { id: "right", type: "agent" }, // does NOT write "val"
        { id: "merge", type: "agent", reads: ["val"] },
      ];
      const graph = buildGraph({
        nodes,
        edges: [
          ["start", "left"],
          ["start", "right"],
          ["left", "merge"],
          ["right", "merge"],
        ],
        start: "start",
        ends: ["merge"],
      });
      const result = await checkStateDataFlow(graph);
      expect(result.verified).toBe(false);
      const violations = result.details?.violations as Array<{ nodeId: string; field: string }>;
      expect(violations.some((v) => v.nodeId === "merge" && v.field === "val")).toBe(true);
    });

    test("read at start node with no predecessors", async () => {
      const graph = buildGraph({
        nodes: [
          { id: "start", type: "agent", reads: ["x"] },
          { id: "end", type: "agent" },
        ],
        edges: [["start", "end"]],
        start: "start",
        ends: ["end"],
      });
      const result = await checkStateDataFlow(graph);
      expect(result.verified).toBe(false);
      expect(result.counterexample).toContain("start");
      expect(result.counterexample).toContain("x");
    });

    test("multiple violations reported", async () => {
      const graph = buildGraph({
        nodes: [
          { id: "A", type: "agent" },
          { id: "B", type: "agent", reads: ["x", "y"] },
        ],
        edges: [["A", "B"]],
        start: "A",
        ends: ["B"],
      });
      const result = await checkStateDataFlow(graph);
      expect(result.verified).toBe(false);
      const violations = result.details?.violations as Array<{ nodeId: string; field: string }>;
      expect(violations).toHaveLength(2);
      const fields = violations.map((v) => v.field);
      expect(fields).toContain("x");
      expect(fields).toContain("y");
    });
  });

  describe("edge cases", () => {
    test("graph with no nodes that read or write — trivially valid", async () => {
      const graph = buildGraph({
        nodes: ["A", "B"],
        edges: [["A", "B"]],
        start: "A",
        ends: ["B"],
      });
      const result = await checkStateDataFlow(graph);
      expect(result.verified).toBe(true);
    });

    test("single node that outputs but nothing reads — valid", async () => {
      const graph = buildGraph({
        nodes: [
          { id: "A", type: "agent", outputs: ["orphan-field"] },
        ],
        edges: [],
        start: "A",
        ends: ["A"],
      });
      const result = await checkStateDataFlow(graph);
      expect(result.verified).toBe(true);
    });

    test("chain: write -> passthrough -> read", async () => {
      const graph = buildGraph({
        nodes: [
          { id: "writer", type: "agent", outputs: ["data"] },
          { id: "passthrough", type: "agent" },
          { id: "reader", type: "agent", reads: ["data"] },
        ],
        edges: [
          ["writer", "passthrough"],
          ["passthrough", "reader"],
        ],
        start: "writer",
        ends: ["reader"],
      });
      const result = await checkStateDataFlow(graph);
      expect(result.verified).toBe(true);
    });
  });

  describe("stateFields validation", () => {
    test("read referencing undefined field fails when stateFields provided", async () => {
      const graph = buildGraph({
        nodes: [
          { id: "A", type: "agent", reads: ["nonExistent"] },
        ],
        edges: [],
        start: "A",
        ends: ["A"],
        stateFields: ["validField"],
      });
      const result = await checkStateDataFlow(graph);
      expect(result.verified).toBe(false);
      expect(result.counterexample).toContain("nonExistent");
      expect(result.counterexample).toContain("not declared in globalState");
    });

    test("output referencing undefined field fails when stateFields provided", async () => {
      const graph = buildGraph({
        nodes: [
          { id: "A", type: "agent", outputs: ["nonExistent"] },
        ],
        edges: [],
        start: "A",
        ends: ["A"],
        stateFields: ["validField"],
      });
      const result = await checkStateDataFlow(graph);
      expect(result.verified).toBe(false);
      expect(result.counterexample).toContain("nonExistent");
      expect(result.counterexample).toContain("not declared in globalState");
    });

    test("read and output referencing valid fields passes", async () => {
      const graph = buildGraph({
        nodes: [
          { id: "writer", type: "agent", outputs: ["result"] },
          { id: "reader", type: "agent", reads: ["result"] },
        ],
        edges: [["writer", "reader"]],
        start: "writer",
        ends: ["reader"],
        stateFields: ["result"],
      });
      const result = await checkStateDataFlow(graph);
      expect(result.verified).toBe(true);
    });

    test("no stateFields skips schema validation (backward compat)", async () => {
      const graph = buildGraph({
        nodes: [
          { id: "writer", type: "agent", outputs: ["anything"] },
          { id: "reader", type: "agent", reads: ["anything"] },
        ],
        edges: [["writer", "reader"]],
        start: "writer",
        ends: ["reader"],
      });
      const result = await checkStateDataFlow(graph);
      expect(result.verified).toBe(true);
    });

    test("multiple undefined references reported separately", async () => {
      const graph = buildGraph({
        nodes: [
          { id: "A", type: "agent", reads: ["bad1"], outputs: ["bad2"] },
        ],
        edges: [],
        start: "A",
        ends: ["A"],
        stateFields: ["good"],
      });
      const result = await checkStateDataFlow(graph);
      expect(result.verified).toBe(false);
      const violations = result.details?.violations as Array<{ nodeId: string; field: string; reason: string }>;
      expect(violations.length).toBeGreaterThanOrEqual(2);
      expect(violations.some((v) => v.field === "bad1")).toBe(true);
      expect(violations.some((v) => v.field === "bad2")).toBe(true);
    });

    test("mix of valid and invalid references — only invalid flagged", async () => {
      const graph = buildGraph({
        nodes: [
          { id: "A", type: "agent", outputs: ["good", "bad"] },
          { id: "B", type: "agent", reads: ["good"] },
        ],
        edges: [["A", "B"]],
        start: "A",
        ends: ["B"],
        stateFields: ["good"],
      });
      const result = await checkStateDataFlow(graph);
      expect(result.verified).toBe(false);
      const violations = result.details?.violations as Array<{ nodeId: string; field: string; reason: string }>;
      expect(violations.some((v) => v.field === "bad")).toBe(true);
      expect(violations.some((v) => v.field === "good")).toBe(false);
    });
  });

  describe("globalState defaults as initial writes", () => {
    test("read at start node passes when field is in stateFields (has default)", async () => {
      const graph = buildGraph({
        nodes: [
          { id: "start", type: "agent", reads: ["counter"] },
          { id: "end", type: "agent" },
        ],
        edges: [["start", "end"]],
        start: "start",
        ends: ["end"],
        stateFields: ["counter"],
      });
      const result = await checkStateDataFlow(graph);
      expect(result.verified).toBe(true);
    });

    test("read at start node fails when field is NOT in stateFields", async () => {
      const graph = buildGraph({
        nodes: [
          { id: "start", type: "agent", reads: ["counter"] },
          { id: "end", type: "agent" },
        ],
        edges: [["start", "end"]],
        start: "start",
        ends: ["end"],
        stateFields: ["otherField"],
      });
      const result = await checkStateDataFlow(graph);
      expect(result.verified).toBe(false);
    });

    test("downstream read of globalState field passes without explicit write", async () => {
      const graph = buildGraph({
        nodes: [
          { id: "A", type: "agent" },
          { id: "B", type: "agent", reads: ["status"] },
        ],
        edges: [["A", "B"]],
        start: "A",
        ends: ["B"],
        stateFields: ["status"],
      });
      const result = await checkStateDataFlow(graph);
      expect(result.verified).toBe(true);
    });

    test("diamond graph — globalState field readable on all branches without writes", async () => {
      const graph = buildGraph({
        nodes: [
          { id: "start", type: "agent" },
          { id: "left", type: "agent", reads: ["counter"] },
          { id: "right", type: "agent", reads: ["counter"] },
          { id: "merge", type: "agent", reads: ["counter"] },
        ],
        edges: [
          ["start", "left"],
          ["start", "right"],
          ["left", "merge"],
          ["right", "merge"],
        ],
        start: "start",
        ends: ["merge"],
        stateFields: ["counter"],
      });
      const result = await checkStateDataFlow(graph);
      expect(result.verified).toBe(true);
    });

    test("empty stateFields does not produce fields at start (backward compat)", async () => {
      const graph = buildGraph({
        nodes: [
          { id: "start", type: "agent", reads: ["x"] },
          { id: "end", type: "agent" },
        ],
        edges: [["start", "end"]],
        start: "start",
        ends: ["end"],
      });
      const result = await checkStateDataFlow(graph);
      expect(result.verified).toBe(false);
    });
  });

  describe("loop back-edge handling", () => {
    test("read inside loop body — field written before loop with stateFields", async () => {
      // Simulates: init (writes counter) → loop_start → increment (reads counter) → loop_check → loop_start (back-edge)
      const graph = buildGraph({
        nodes: [
          { id: "init", type: "tool", outputs: ["counter"] },
          { id: "loop_start", type: "loop_start" },
          { id: "increment", type: "tool", reads: ["counter"], outputs: ["counter"] },
          { id: "loop_check", type: "loop_check" },
          { id: "loop_exit", type: "loop_exit" },
          { id: "end", type: "agent", reads: ["counter"] },
        ],
        edges: [
          ["init", "loop_start"],
          ["loop_start", "increment"],
          ["increment", "loop_check"],
          ["loop_check", "loop_start"],   // back-edge
          ["loop_check", "loop_exit"],
          ["loop_exit", "end"],
        ],
        start: "init",
        ends: ["end"],
        stateFields: ["counter"],
      });
      const result = await checkStateDataFlow(graph);
      expect(result.verified).toBe(true);
    });

    test("read inside loop body — field NOT written before loop, no stateFields", async () => {
      const graph = buildGraph({
        nodes: [
          { id: "start", type: "agent" },
          { id: "loop_start", type: "loop_start" },
          { id: "reader", type: "agent", reads: ["missing"] },
          { id: "loop_check", type: "loop_check" },
          { id: "loop_exit", type: "loop_exit" },
          { id: "end", type: "agent" },
        ],
        edges: [
          ["start", "loop_start"],
          ["loop_start", "reader"],
          ["reader", "loop_check"],
          ["loop_check", "loop_start"],   // back-edge
          ["loop_check", "loop_exit"],
          ["loop_exit", "end"],
        ],
        start: "start",
        ends: ["end"],
      });
      const result = await checkStateDataFlow(graph);
      expect(result.verified).toBe(false);
    });

    test("nested loops — field readable through both loop levels", async () => {
      const graph = buildGraph({
        nodes: [
          { id: "init", type: "tool", outputs: ["x"] },
          { id: "outer_start", type: "loop_start" },
          { id: "inner_start", type: "loop_start" },
          { id: "worker", type: "agent", reads: ["x"], outputs: ["x"] },
          { id: "inner_check", type: "loop_check" },
          { id: "inner_exit", type: "loop_exit" },
          { id: "outer_check", type: "loop_check" },
          { id: "outer_exit", type: "loop_exit" },
          { id: "end", type: "agent", reads: ["x"] },
        ],
        edges: [
          ["init", "outer_start"],
          ["outer_start", "inner_start"],
          ["inner_start", "worker"],
          ["worker", "inner_check"],
          ["inner_check", "inner_start"],   // inner back-edge
          ["inner_check", "inner_exit"],
          ["inner_exit", "outer_check"],
          ["outer_check", "outer_start"],   // outer back-edge
          ["outer_check", "outer_exit"],
          ["outer_exit", "end"],
        ],
        start: "init",
        ends: ["end"],
        stateFields: ["x"],
      });
      const result = await checkStateDataFlow(graph);
      expect(result.verified).toBe(true);
    });

    test("loop with break — field available after break exits loop", async () => {
      const graph = buildGraph({
        nodes: [
          { id: "init", type: "tool", outputs: ["result"] },
          { id: "loop_start", type: "loop_start" },
          { id: "work", type: "agent", reads: ["result"], outputs: ["result"] },
          { id: "break", type: "break" },
          { id: "loop_check", type: "loop_check" },
          { id: "loop_exit", type: "loop_exit" },
          { id: "finalize", type: "agent", reads: ["result"] },
        ],
        edges: [
          ["init", "loop_start"],
          ["loop_start", "work"],
          ["work", "break"],
          ["break", "loop_check"],
          ["break", "loop_exit"],
          ["loop_check", "loop_start"],   // back-edge
          ["loop_check", "loop_exit"],
          ["loop_exit", "finalize"],
        ],
        start: "init",
        ends: ["finalize"],
        stateFields: ["result"],
      });
      const result = await checkStateDataFlow(graph);
      expect(result.verified).toBe(true);
    });
  });
});
