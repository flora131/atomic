import { describe, expect, test } from "bun:test";
import { getActiveBackgroundAgents } from "@/state/chat/shared/helpers/background-agent-footer.ts";
import {
  computeFinalizedAgents,
  createAgent,
} from "./support.ts";

describe("Consolidated completion state updates (Fix 5C)", () => {
  describe("Agent filtering by message ownership", () => {
    test("filters out orphaned agents not present on the message", () => {
      const messageAgents = [createAgent({ id: "a1" }), createAgent({ id: "a2" })];
      const currentAgents = [
        createAgent({ id: "a1", status: "running" }),
        createAgent({ id: "a2", status: "running" }),
        createAgent({ id: "orphan", status: "running" }),
      ];

      const result = computeFinalizedAgents(messageAgents, currentAgents);

      expect(result).toBeDefined();
      expect(result!.length).toBe(2);
      expect(result!.map((a) => a.id)).toEqual(["a1", "a2"]);
      expect(result!.find((a) => a.id === "orphan")).toBeUndefined();
    });

    test("returns all agents when all are on the message", () => {
      const agents = [
        createAgent({ id: "a1", status: "running" }),
        createAgent({ id: "a2", status: "completed" }),
      ];
      const result = computeFinalizedAgents(
        [createAgent({ id: "a1" }), createAgent({ id: "a2" })],
        agents,
      );

      expect(result).toBeDefined();
      expect(result!.length).toBe(2);
    });

    test("returns undefined when currentAgents is empty", () => {
      expect(
        computeFinalizedAgents([createAgent({ id: "a1" })], []),
      ).toBeUndefined();
    });

    test("returns empty array when no agents match message IDs", () => {
      const result = computeFinalizedAgents(
        [createAgent({ id: "a1" })],
        [createAgent({ id: "orphan", status: "running" })],
      );

      expect(result).toBeDefined();
      expect(result!.length).toBe(0);
    });

    test("handles undefined message agents", () => {
      const result = computeFinalizedAgents(
        undefined,
        [createAgent({ id: "a1", status: "running" })],
      );

      expect(result).toBeDefined();
      expect(result!.length).toBe(0);
    });
  });

  describe("Agent finalization", () => {
    test("finalizes running foreground agents to completed", () => {
      const agents = [createAgent({ id: "a1", status: "running" })];
      const result = computeFinalizedAgents(agents, agents);

      expect(result).toBeDefined();
      expect(result![0]!.status).toBe("completed");
      expect(result![0]!.currentTool).toBeUndefined();
      expect(result![0]!.durationMs).toBeGreaterThan(0);
    });

    test("finalizes pending foreground agents to completed", () => {
      const agents = [createAgent({ id: "a1", status: "pending" })];
      expect(computeFinalizedAgents(agents, agents)?.[0]!.status).toBe("completed");
    });

    test("preserves already-completed and error agents", () => {
      const completed = [createAgent({ id: "a1", status: "completed", durationMs: 1234 })];
      const errors = [createAgent({ id: "a1", status: "error" })];

      expect(computeFinalizedAgents(completed, completed)?.[0]!.durationMs).toBe(1234);
      expect(computeFinalizedAgents(errors, errors)?.[0]!.status).toBe("error");
    });

    test("does not finalize background agents and preserves mixed agent sets", () => {
      const agents = [
        createAgent({ id: "fg1", status: "running", background: false }),
        createAgent({ id: "bg1", status: "running", background: true }),
      ];
      const result = computeFinalizedAgents(agents, agents);

      expect(result).toBeDefined();
      expect(result!.find((a) => a.id === "fg1")!.status).toBe("completed");
      expect(result!.find((a) => a.id === "bg1")!.status).toBe("running");
    });
  });

  describe("Background agent remaining computation", () => {
    test("returns only active background agents", () => {
      const remaining = getActiveBackgroundAgents([
        createAgent({ id: "fg1", status: "completed", background: false }),
        createAgent({ id: "bg1", status: "running", background: true }),
        createAgent({ id: "bg2", status: "completed", background: true }),
      ]);

      expect(remaining.length).toBe(1);
      expect(remaining[0]!.id).toBe("bg1");
    });

    test("returns empty when no active background agents exist", () => {
      expect(
        getActiveBackgroundAgents([
          createAgent({ id: "fg1", status: "completed", background: false }),
        ]),
      ).toHaveLength(0);

      expect(
        getActiveBackgroundAgents([
          createAgent({ id: "bg1", status: "completed", background: true }),
          createAgent({ id: "bg2", status: "error", background: true }),
        ]),
      ).toHaveLength(0);
    });
  });
});
