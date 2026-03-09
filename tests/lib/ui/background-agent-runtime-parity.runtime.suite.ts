import { describe, expect, test } from "bun:test";
import {
  BACKGROUND_FOOTER_CONTRACT,
  BACKGROUND_TREE_HINT_CONTRACT,
  buildParallelAgentsHeaderHint,
  createAgent,
  formatBackgroundAgentFooterStatus,
  getBackgroundTerminationDecision,
  interruptActiveBackgroundAgents,
  type ParallelAgent,
} from "./background-agent-runtime-parity.test-support.ts";

describe("Background agent runtime parity (dev/prod invariance)", () => {
  describe("dev/prod runtime invariance", () => {
    test("decision logic produces deterministic results regardless of runtime", () => {
      const scenarios = [
        { pressCount: 0, activeCount: 0, expectedAction: "none" },
        { pressCount: 0, activeCount: 2, expectedAction: "warn" },
        { pressCount: 1, activeCount: 2, expectedAction: "terminate" },
      ] as const;

      for (const scenario of scenarios) {
        const result = getBackgroundTerminationDecision(
          scenario.pressCount,
          scenario.activeCount,
        );
        expect(result.action).toBe(scenario.expectedAction);
      }
    });

    test("footer status formatting is invariant across runtimes", () => {
      const testCases = [
        { count: 0, expected: "" },
        { count: 1, expected: "1 local agent" },
        { count: 5, expected: "5 local agents" },
      ];

      for (const { count, expected } of testCases) {
        const agents = Array.from({ length: count }, (_, index) =>
          createAgent({ id: `agent-${index}`, status: "background" }),
        );
        expect(formatBackgroundAgentFooterStatus(agents)).toBe(expected);
      }
    });

    test("tree hint precedence is invariant across runtimes", () => {
      const runningAgents = [createAgent({ status: "background" })];
      const completedAgents = [createAgent({ status: "completed", background: true })];
      const noAgents: ParallelAgent[] = [];

      expect(buildParallelAgentsHeaderHint(runningAgents, true)).toBe(
        "background running · ctrl+f to kill all background tasks",
      );
      expect(buildParallelAgentsHeaderHint(completedAgents, true)).toBe(
        "background complete · ctrl+o to expand",
      );
      expect(buildParallelAgentsHeaderHint(noAgents, true)).toBe("ctrl+o to expand");
      expect(buildParallelAgentsHeaderHint(noAgents, false)).toBe("");
    });

    test("interruption behavior is deterministic across runtimes", () => {
      const result = interruptActiveBackgroundAgents(
        [
          createAgent({
            id: "bg-1",
            status: "background",
            startedAt: new Date(1000000000000).toISOString(),
          }),
        ],
        1000000005000,
      );

      expect(result.interruptedIds).toEqual(["bg-1"]);
      expect(result.agents[0]!.status).toBe("interrupted");
      expect(result.agents[0]!.durationMs).toBe(5000);
    });

    test("contract constants are identical across runtimes", () => {
      const footerContract = JSON.parse(JSON.stringify(BACKGROUND_FOOTER_CONTRACT));
      const treeContract = JSON.parse(JSON.stringify(BACKGROUND_TREE_HINT_CONTRACT));

      expect(footerContract).toEqual({
        showWhenAgentCountAtLeast: 1,
        includeTerminateHint: true,
        terminateHintText: "ctrl+f to kill all background tasks",
        countFormat: "agents",
      });

      expect(treeContract).toEqual({
        whenRunning: "background running · ctrl+f to kill all background tasks",
        whenComplete: "background complete · ctrl+o to expand",
        defaultHint: "ctrl+o to expand",
      });
    });
  });
});
