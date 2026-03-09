import { describe, expect, test } from "bun:test";
import {
  BACKGROUND_FOOTER_CONTRACT,
  BACKGROUND_TREE_HINT_CONTRACT,
  buildParallelAgentsHeaderHint,
  createAgent,
  formatBackgroundAgentFooterStatus,
  getActiveBackgroundAgents,
  getBackgroundTerminationDecision,
  interruptActiveBackgroundAgents,
  isBackgroundTerminationKey,
  resolveBackgroundAgentsForFooter,
  type BackgroundAgentFooterMessage,
  type BackgroundTerminationDecision,
  type ParallelAgent,
} from "./background-agent-runtime-parity.test-support.ts";

describe("Background agent runtime parity (dev/prod invariance)", () => {
  describe("contract constant determinism", () => {
    test("BACKGROUND_FOOTER_CONTRACT has expected frozen values", () => {
      const contract = BACKGROUND_FOOTER_CONTRACT;

      expect(contract.showWhenAgentCountAtLeast).toBe(1);
      expect(contract.includeTerminateHint).toBe(true);
      expect(contract.terminateHintText).toBe("ctrl+f to kill all background tasks");
      expect(contract.countFormat).toBe("agents");

      expect(BACKGROUND_FOOTER_CONTRACT).toBe(contract);
      expect(typeof contract).toBe("object");
      expect(contract).not.toBeNull();
    });

    test("BACKGROUND_TREE_HINT_CONTRACT has expected frozen values", () => {
      const contract = BACKGROUND_TREE_HINT_CONTRACT;

      expect(contract.whenRunning).toBe("background running · ctrl+f to kill all background tasks");
      expect(contract.whenComplete).toBe("background complete · ctrl+o to expand");
      expect(contract.defaultHint).toBe("ctrl+o to expand");

      expect(BACKGROUND_TREE_HINT_CONTRACT).toBe(contract);
      expect(typeof contract).toBe("object");
      expect(contract).not.toBeNull();
    });

    test("contract constants are not mutated by runtime", () => {
      const footerSnapshot = JSON.stringify(BACKGROUND_FOOTER_CONTRACT);
      const treeSnapshot = JSON.stringify(BACKGROUND_TREE_HINT_CONTRACT);

      getBackgroundTerminationDecision(0, 1);
      formatBackgroundAgentFooterStatus([createAgent()]);
      buildParallelAgentsHeaderHint([createAgent()], true);

      expect(JSON.stringify(BACKGROUND_FOOTER_CONTRACT)).toBe(footerSnapshot);
      expect(JSON.stringify(BACKGROUND_TREE_HINT_CONTRACT)).toBe(treeSnapshot);
    });
  });

  describe("pure function determinism", () => {
    test("getBackgroundTerminationDecision produces identical outputs for identical inputs", () => {
      const testCases: Array<[number, number, BackgroundTerminationDecision]> = [
        [0, 0, { action: "none" } as const],
        [0, 1, { action: "warn", message: "Press Ctrl-F again to terminate background agents" } as const],
        [0, 3, { action: "warn", message: "Press Ctrl-F again to terminate background agents" } as const],
        [1, 2, { action: "terminate", message: "All background agents killed" } as const],
        [2, 5, { action: "terminate", message: "All background agents killed" } as const],
        [5, 0, { action: "none" } as const],
      ];

      for (const [pressCount, activeCount, expected] of testCases) {
        const result1 = getBackgroundTerminationDecision(pressCount, activeCount);
        const result2 = getBackgroundTerminationDecision(pressCount, activeCount);
        const result3 = getBackgroundTerminationDecision(pressCount, activeCount);

        expect(result1).toEqual(expected);
        expect(result2).toEqual(expected);
        expect(result3).toEqual(expected);
        expect(result1).toEqual(result2);
        expect(result2).toEqual(result3);
      }
    });

    test("isBackgroundTerminationKey produces identical outputs for identical inputs", () => {
      const testCases = [
        [{ ctrl: true, name: "f" }, true],
        [{ ctrl: true, shift: true, name: "f" }, false],
        [{ ctrl: true, meta: true, name: "f" }, false],
        [{ ctrl: true, name: "c" }, false],
        [{ ctrl: false, name: "f" }, false],
        [{ name: "f" }, false],
      ] as const;

      for (const [event, expected] of testCases) {
        const result1 = isBackgroundTerminationKey(event);
        const result2 = isBackgroundTerminationKey(event);
        const result3 = isBackgroundTerminationKey(event);

        expect(result1).toBe(expected);
        expect(result2).toBe(expected);
        expect(result3).toBe(expected);
      }
    });

    test("interruptActiveBackgroundAgents produces identical outputs for identical inputs", () => {
      const fixedNowMs = 1000000005000;
      const agents: ParallelAgent[] = [
        createAgent({
          id: "bg-1",
          status: "background",
          startedAt: new Date(1000000000000).toISOString(),
        }),
        createAgent({
          id: "bg-2",
          status: "running",
          background: true,
          startedAt: new Date(1000000002000).toISOString(),
        }),
      ];

      const result1 = interruptActiveBackgroundAgents(agents, fixedNowMs);
      const result2 = interruptActiveBackgroundAgents(agents, fixedNowMs);
      const result3 = interruptActiveBackgroundAgents(agents, fixedNowMs);

      expect(result1).toEqual(result2);
      expect(result2).toEqual(result3);
      expect(result1.interruptedIds).toEqual(["bg-1", "bg-2"]);
      expect(result1.agents[0]!.status).toBe("interrupted");
      expect(result1.agents[0]!.durationMs).toBe(5000);
      expect(result1.agents[1]!.status).toBe("interrupted");
      expect(result1.agents[1]!.durationMs).toBe(3000);
    });

    test("getActiveBackgroundAgents produces identical outputs for identical inputs", () => {
      const agents: ParallelAgent[] = [
        createAgent({ id: "bg-1", status: "background" }),
        createAgent({ id: "fg-1", status: "running", background: false }),
        createAgent({ id: "bg-2", status: "running", background: true }),
        createAgent({ id: "bg-3", status: "completed", background: true }),
      ];

      const result1 = getActiveBackgroundAgents(agents);
      const result2 = getActiveBackgroundAgents(agents);
      const result3 = getActiveBackgroundAgents(agents);

      expect(result1).toEqual(result2);
      expect(result2).toEqual(result3);
      expect(result1.length).toBe(2);
      expect(result1.map((agent) => agent.id).sort()).toEqual(["bg-1", "bg-2"]);
    });

    test("formatBackgroundAgentFooterStatus produces identical outputs for identical inputs", () => {
      const testCases = [
        [[], ""],
        [[createAgent()], "1 local agent"],
        [[createAgent({ id: "1" }), createAgent({ id: "2" })], "2 local agents"],
        [
          [createAgent({ id: "1" }), createAgent({ id: "2" }), createAgent({ id: "3" })],
          "3 local agents",
        ],
      ] as const;

      for (const [agents, expected] of testCases) {
        const result1 = formatBackgroundAgentFooterStatus(agents);
        const result2 = formatBackgroundAgentFooterStatus(agents);
        const result3 = formatBackgroundAgentFooterStatus(agents);

        expect(result1).toBe(expected);
        expect(result2).toBe(expected);
        expect(result3).toBe(expected);
      }
    });

    test("buildParallelAgentsHeaderHint produces identical outputs for identical inputs", () => {
      const testCases = [
        [[createAgent({ status: "background" })], true, "background running · ctrl+f to kill all background tasks"],
        [[createAgent({ status: "completed", background: true })], true, "background complete · ctrl+o to expand"],
        [[], true, "ctrl+o to expand"],
        [[], false, ""],
      ] as const;

      for (const [agents, showHint, expected] of testCases) {
        const result1 = buildParallelAgentsHeaderHint(agents, showHint);
        const result2 = buildParallelAgentsHeaderHint(agents, showHint);
        const result3 = buildParallelAgentsHeaderHint(agents, showHint);

        expect(result1).toBe(expected);
        expect(result2).toBe(expected);
        expect(result3).toBe(expected);
      }
    });

    test("resolveBackgroundAgentsForFooter produces identical outputs for identical inputs", () => {
      const liveAgents: ParallelAgent[] = [createAgent({ id: "live-1", status: "background" })];
      const messages: BackgroundAgentFooterMessage[] = [
        { parallelAgents: [createAgent({ id: "msg-1", status: "background" })] },
      ];

      const result1 = resolveBackgroundAgentsForFooter(liveAgents, messages);
      const result2 = resolveBackgroundAgentsForFooter(liveAgents, messages);
      const result3 = resolveBackgroundAgentsForFooter(liveAgents, messages);

      expect(result1).toEqual(result2);
      expect(result2).toEqual(result3);
      expect(result1.length).toBe(1);
      expect(result1[0]!.id).toBe("live-1");
    });
  });
});
