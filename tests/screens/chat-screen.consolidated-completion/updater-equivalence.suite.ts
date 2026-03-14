import { describe, expect, test } from "bun:test";
import { getActiveBackgroundAgents } from "@/state/chat/shared/helpers/background-agent-footer.ts";
import { computeFinalizedAgents, createAgent } from "./support.ts";

describe("Consolidated completion state updates (Fix 5C)", () => {
  describe("Consolidated updater equivalence", () => {
    test("single-pass updater produces same agent filtering as nested approach", () => {
      const messageAgents = [createAgent({ id: "a1" }), createAgent({ id: "a2" })];
      const currentAgents = [
        createAgent({ id: "a1", status: "running" }),
        createAgent({ id: "a2", status: "pending" }),
        createAgent({ id: "orphan", status: "running" }),
      ];

      const existingIdsNested = new Set<string>();
      for (const agent of messageAgents) {
        existingIdsNested.add(agent.id);
      }
      const filteredNested = currentAgents.filter((a) =>
        existingIdsNested.has(a.id),
      );

      const result = computeFinalizedAgents(messageAgents, currentAgents);

      expect(result!.map((a) => a.id)).toEqual(filteredNested.map((a) => a.id));
    });

    test("remaining background agents are computed from currentAgents (ref), not stale state", () => {
      const currentAgents = [
        createAgent({ id: "fg1", status: "completed", background: false }),
        createAgent({ id: "bg1", status: "running", background: true }),
      ];

      const remaining = getActiveBackgroundAgents(currentAgents);

      expect(remaining.length > 0).toBe(true);
      expect(remaining.length).toBe(1);
      expect(remaining[0]!.id).toBe("bg1");
    });

    test("hasRemainingBg is false when no background agents remain", () => {
      const remaining = getActiveBackgroundAgents([
        createAgent({ id: "fg1", status: "completed", background: false }),
        createAgent({ id: "fg2", status: "running", background: false }),
      ]);

      expect(remaining.length > 0).toBe(false);
    });
  });
});
