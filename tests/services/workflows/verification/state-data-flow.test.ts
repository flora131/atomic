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
});
