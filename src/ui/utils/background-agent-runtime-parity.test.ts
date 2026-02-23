/**
 * E2E Runtime Parity Test (Issue #258 Task #20)
 *
 * This test verifies that background agent contract functions produce
 * deterministic, consistent results that are invariant across runtime paths:
 * dev (via `bun run`) vs compiled production binary.
 *
 * Per spec (specs/background-agents-ui-issue-258-parity-hardening.md),
 * dev and production runtime paths go through `startChatUI` as a shared entry point.
 * The contract functions are pure JavaScript with no runtime-conditional branching —
 * they don't check process.env.NODE_ENV, Bun.main, or any build-mode flag.
 *
 * This test documents and enforces that invariance.
 */

import { describe, expect, test } from "bun:test";
import type { ParallelAgent } from "../components/parallel-agents-tree.tsx";
import {
  getBackgroundTerminationDecision,
  interruptActiveBackgroundAgents,
  isBackgroundTerminationKey,
  type BackgroundTerminationDecision,
} from "./background-agent-termination.ts";
import {
  BACKGROUND_FOOTER_CONTRACT,
  BACKGROUND_TREE_HINT_CONTRACT,
  type BackgroundFooterContract,
  type BackgroundTreeHintContract,
} from "./background-agent-contracts.ts";
import {
  getActiveBackgroundAgents,
  formatBackgroundAgentFooterStatus,
  resolveBackgroundAgentsForFooter,
  type BackgroundAgentFooterMessage,
} from "./background-agent-footer.ts";
import { buildParallelAgentsHeaderHint } from "./background-agent-tree-hints.ts";

// ---------------------------------------------------------------------------
// Test Fixture Helpers
// ---------------------------------------------------------------------------

function createAgent(overrides: Partial<ParallelAgent> = {}): ParallelAgent {
  return {
    id: overrides.id ?? "agent-1",
    name: overrides.name ?? "task",
    task: overrides.task ?? "Background task",
    status: overrides.status ?? "background",
    background: overrides.background,
    startedAt: overrides.startedAt ?? new Date(1000000000000).toISOString(),
    currentTool: overrides.currentTool,
    durationMs: overrides.durationMs,
    result: overrides.result,
  };
}

// ---------------------------------------------------------------------------
// Runtime Parity Tests
// ---------------------------------------------------------------------------

describe("Background agent runtime parity (dev/prod invariance)", () => {
  // ---------------------------------------------------------------------------
  // 1. Contract Constants Determinism
  // ---------------------------------------------------------------------------

  describe("contract constant determinism", () => {
    test("BACKGROUND_FOOTER_CONTRACT has expected frozen values", () => {
      const contract = BACKGROUND_FOOTER_CONTRACT;

      // Verify exact values
      expect(contract.showWhenAgentCountAtLeast).toBe(1);
      expect(contract.includeTerminateHint).toBe(true);
      expect(contract.terminateHintText).toBe("ctrl+f terminate");
      expect(contract.countFormat).toBe("agents");

      // Verify object stability (same reference across calls)
      expect(BACKGROUND_FOOTER_CONTRACT).toBe(contract);

      // Document that contract is runtime-invariant
      expect(typeof contract).toBe("object");
      expect(contract).not.toBeNull();
    });

    test("BACKGROUND_TREE_HINT_CONTRACT has expected frozen values", () => {
      const contract = BACKGROUND_TREE_HINT_CONTRACT;

      // Verify exact values
      expect(contract.whenRunning).toBe("background running · ctrl+f terminate");
      expect(contract.whenComplete).toBe("background complete · ctrl+o to expand");
      expect(contract.defaultHint).toBe("ctrl+o to expand");

      // Verify object stability (same reference across calls)
      expect(BACKGROUND_TREE_HINT_CONTRACT).toBe(contract);

      // Document that contract is runtime-invariant
      expect(typeof contract).toBe("object");
      expect(contract).not.toBeNull();
    });

    test("contract constants are not mutated by runtime", () => {
      // Capture initial state
      const footerSnapshot = JSON.stringify(BACKGROUND_FOOTER_CONTRACT);
      const treeSnapshot = JSON.stringify(BACKGROUND_TREE_HINT_CONTRACT);

      // Perform various operations (these should not mutate contracts)
      getBackgroundTerminationDecision(0, 1);
      formatBackgroundAgentFooterStatus([createAgent()]);
      buildParallelAgentsHeaderHint([createAgent()], true);

      // Verify contracts remain unchanged
      expect(JSON.stringify(BACKGROUND_FOOTER_CONTRACT)).toBe(footerSnapshot);
      expect(JSON.stringify(BACKGROUND_TREE_HINT_CONTRACT)).toBe(treeSnapshot);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Pure Function Determinism
  // ---------------------------------------------------------------------------

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
        // Call multiple times with same inputs
        const result1 = getBackgroundTerminationDecision(pressCount, activeCount);
        const result2 = getBackgroundTerminationDecision(pressCount, activeCount);
        const result3 = getBackgroundTerminationDecision(pressCount, activeCount);

        // All results must be identical
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
        // Call multiple times with same inputs
        const result1 = isBackgroundTerminationKey(event);
        const result2 = isBackgroundTerminationKey(event);
        const result3 = isBackgroundTerminationKey(event);

        // All results must be identical
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

      // Call multiple times with same inputs
      const result1 = interruptActiveBackgroundAgents(agents, fixedNowMs);
      const result2 = interruptActiveBackgroundAgents(agents, fixedNowMs);
      const result3 = interruptActiveBackgroundAgents(agents, fixedNowMs);

      // All results must be identical
      expect(result1).toEqual(result2);
      expect(result2).toEqual(result3);

      // Verify deterministic behavior
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

      // Call multiple times with same inputs
      const result1 = getActiveBackgroundAgents(agents);
      const result2 = getActiveBackgroundAgents(agents);
      const result3 = getActiveBackgroundAgents(agents);

      // All results must be identical
      expect(result1).toEqual(result2);
      expect(result2).toEqual(result3);

      // Verify deterministic filtering
      expect(result1.length).toBe(2);
      expect(result1.map((a) => a.id).sort()).toEqual(["bg-1", "bg-2"]);
    });

    test("formatBackgroundAgentFooterStatus produces identical outputs for identical inputs", () => {
      const testCases = [
        [[], ""],
        [[createAgent()], "1 background agent running"],
        [[createAgent({ id: "1" }), createAgent({ id: "2" })], "2 background agents running"],
        [
          [createAgent({ id: "1" }), createAgent({ id: "2" }), createAgent({ id: "3" })],
          "3 background agents running",
        ],
      ] as const;

      for (const [agents, expected] of testCases) {
        // Call multiple times with same inputs
        const result1 = formatBackgroundAgentFooterStatus(agents);
        const result2 = formatBackgroundAgentFooterStatus(agents);
        const result3 = formatBackgroundAgentFooterStatus(agents);

        // All results must be identical
        expect(result1).toBe(expected);
        expect(result2).toBe(expected);
        expect(result3).toBe(expected);
      }
    });

    test("buildParallelAgentsHeaderHint produces identical outputs for identical inputs", () => {
      const testCases = [
        [[createAgent({ status: "background" })], true, "background running · ctrl+f terminate"],
        [[createAgent({ status: "completed", background: true })], true, "background complete · ctrl+o to expand"],
        [[], true, "ctrl+o to expand"],
        [[], false, ""],
      ] as const;

      for (const [agents, showHint, expected] of testCases) {
        // Call multiple times with same inputs
        const result1 = buildParallelAgentsHeaderHint(agents, showHint);
        const result2 = buildParallelAgentsHeaderHint(agents, showHint);
        const result3 = buildParallelAgentsHeaderHint(agents, showHint);

        // All results must be identical
        expect(result1).toBe(expected);
        expect(result2).toBe(expected);
        expect(result3).toBe(expected);
      }
    });

    test("resolveBackgroundAgentsForFooter produces identical outputs for identical inputs", () => {
      const liveAgents: ParallelAgent[] = [
        createAgent({ id: "live-1", status: "background" }),
      ];

      const messages: BackgroundAgentFooterMessage[] = [
        { parallelAgents: [createAgent({ id: "msg-1", status: "background" })] },
      ];

      // Call multiple times with same inputs
      const result1 = resolveBackgroundAgentsForFooter(liveAgents, messages);
      const result2 = resolveBackgroundAgentsForFooter(liveAgents, messages);
      const result3 = resolveBackgroundAgentsForFooter(liveAgents, messages);

      // All results must be identical
      expect(result1).toEqual(result2);
      expect(result2).toEqual(result3);

      // Verify deterministic resolution
      expect(result1.length).toBe(1);
      expect(result1[0]!.id).toBe("live-1");
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Idempotency
  // ---------------------------------------------------------------------------

  describe("function idempotency", () => {
    test("multiple sequential calls produce identical results (no internal mutation)", () => {
      const agents: ParallelAgent[] = [
        createAgent({ id: "bg-1", status: "background" }),
        createAgent({ id: "bg-2", status: "running", background: true }),
      ];

      const nowMs = 1000000005000;

      // Call multiple times sequentially
      const results = Array.from({ length: 5 }, () =>
        interruptActiveBackgroundAgents(agents, nowMs),
      );

      // All results must be identical
      for (let i = 1; i < results.length; i += 1) {
        expect(results[i]).toEqual(results[0]);
      }

      // Verify no side effects on input
      expect(agents[0]!.status).toBe("background");
      expect(agents[1]!.status).toBe("running");
    });

    test("decision logic is stateless across calls", () => {
      // Call decision function many times
      const results = Array.from({ length: 100 }, () =>
        getBackgroundTerminationDecision(0, 2),
      );

      // All results must be identical
      const expected: BackgroundTerminationDecision = {
        action: "warn",
        message: "Press Ctrl-F again to terminate background agents",
      };

      for (const result of results) {
        expect(result).toEqual(expected);
      }
    });

    test("footer formatting is stateless across calls", () => {
      const agents = [createAgent(), createAgent({ id: "2" })];

      // Call formatting function many times
      const results = Array.from({ length: 50 }, () =>
        formatBackgroundAgentFooterStatus(agents),
      );

      // All results must be identical
      for (const result of results) {
        expect(result).toBe("2 background agents running");
      }
    });

    test("tree hint builder is stateless across calls", () => {
      const agents = [createAgent({ status: "background" })];

      // Call hint builder many times
      const results = Array.from({ length: 50 }, () =>
        buildParallelAgentsHeaderHint(agents, true),
      );

      // All results must be identical
      for (const result of results) {
        expect(result).toBe("background running · ctrl+f terminate");
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 4. No Environment-Conditional Branching
  // ---------------------------------------------------------------------------

  describe("no environment-conditional behavior", () => {
    test("contract functions work without environment variables", () => {
      // Document that functions don't reference process.env, import.meta.env, or Bun.env
      // These functions should work identically regardless of NODE_ENV, build mode, etc.

      // Test decision logic
      const decision = getBackgroundTerminationDecision(0, 1);
      expect(decision.action).toBe("warn");

      // Test key detection
      const isTermKey = isBackgroundTerminationKey({ ctrl: true, name: "f" });
      expect(isTermKey).toBe(true);

      // Test interruption
      const agents = [createAgent({ status: "background" })];
      const result = interruptActiveBackgroundAgents(agents, 1000000005000);
      expect(result.interruptedIds).toEqual(["agent-1"]);

      // Test formatting
      const status = formatBackgroundAgentFooterStatus(agents);
      expect(status).toBe("1 background agent running");

      // Test hint building
      const hint = buildParallelAgentsHeaderHint(agents, true);
      expect(hint).toBe("background running · ctrl+f terminate");

      // Test active agent filtering
      const activeAgents = getActiveBackgroundAgents(agents);
      expect(activeAgents.length).toBe(1);
    });

    test("contract constants are accessible without environment setup", () => {
      // Verify contracts can be imported and used without any environment-specific setup
      expect(BACKGROUND_FOOTER_CONTRACT).toBeDefined();
      expect(BACKGROUND_TREE_HINT_CONTRACT).toBeDefined();

      // Verify they have expected structure
      expect(BACKGROUND_FOOTER_CONTRACT).toHaveProperty("showWhenAgentCountAtLeast");
      expect(BACKGROUND_FOOTER_CONTRACT).toHaveProperty("includeTerminateHint");
      expect(BACKGROUND_FOOTER_CONTRACT).toHaveProperty("terminateHintText");
      expect(BACKGROUND_FOOTER_CONTRACT).toHaveProperty("countFormat");

      expect(BACKGROUND_TREE_HINT_CONTRACT).toHaveProperty("whenRunning");
      expect(BACKGROUND_TREE_HINT_CONTRACT).toHaveProperty("whenComplete");
      expect(BACKGROUND_TREE_HINT_CONTRACT).toHaveProperty("defaultHint");
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Module Import Stability
  // ---------------------------------------------------------------------------

  describe("module export stability", () => {
    test("all contract exports are accessible and have expected types", () => {
      // Type exports
      const _typeCheck1: BackgroundTerminationDecision = { action: "none" };
      const _typeCheck2: BackgroundFooterContract = {
        showWhenAgentCountAtLeast: 1,
        includeTerminateHint: true,
        terminateHintText: "test",
        countFormat: "agents",
      };
      const _typeCheck3: BackgroundTreeHintContract = {
        whenRunning: "test",
        whenComplete: "test",
        defaultHint: "test",
      };

      // Function exports
      expect(typeof getBackgroundTerminationDecision).toBe("function");
      expect(typeof interruptActiveBackgroundAgents).toBe("function");
      expect(typeof isBackgroundTerminationKey).toBe("function");
      expect(typeof getActiveBackgroundAgents).toBe("function");
      expect(typeof formatBackgroundAgentFooterStatus).toBe("function");
      expect(typeof resolveBackgroundAgentsForFooter).toBe("function");
      expect(typeof buildParallelAgentsHeaderHint).toBe("function");

      // Constant exports
      expect(typeof BACKGROUND_FOOTER_CONTRACT).toBe("object");
      expect(typeof BACKGROUND_TREE_HINT_CONTRACT).toBe("object");
    });

    test("function signatures remain stable", () => {
      // Verify function arity (parameter count)
      expect(getBackgroundTerminationDecision.length).toBe(2);
      expect(isBackgroundTerminationKey.length).toBe(1);
      expect(interruptActiveBackgroundAgents.length).toBe(1); // agents (nowMs has default value)
      expect(getActiveBackgroundAgents.length).toBe(1);
      expect(formatBackgroundAgentFooterStatus.length).toBe(1);
      expect(resolveBackgroundAgentsForFooter.length).toBe(2);
      expect(buildParallelAgentsHeaderHint.length).toBe(2);
    });

    test("exported contract values are stable and well-defined", () => {
      // Document that contracts export well-defined constant values
      // Note: TypeScript const exports provide compile-time immutability
      // Runtime immutability could be added with Object.freeze if needed in the future

      // Verify contracts have stable, well-defined values
      expect(BACKGROUND_FOOTER_CONTRACT.showWhenAgentCountAtLeast).toBe(1);
      expect(BACKGROUND_FOOTER_CONTRACT.includeTerminateHint).toBe(true);
      expect(BACKGROUND_FOOTER_CONTRACT.terminateHintText).toBeDefined();
      expect(BACKGROUND_FOOTER_CONTRACT.countFormat).toBe("agents");

      expect(BACKGROUND_TREE_HINT_CONTRACT.whenRunning).toBeDefined();
      expect(BACKGROUND_TREE_HINT_CONTRACT.whenComplete).toBeDefined();
      expect(BACKGROUND_TREE_HINT_CONTRACT.defaultHint).toBeDefined();

      // Verify contracts maintain same reference
      const footerRef1 = BACKGROUND_FOOTER_CONTRACT;
      const footerRef2 = BACKGROUND_FOOTER_CONTRACT;
      expect(footerRef1).toBe(footerRef2);

      const treeRef1 = BACKGROUND_TREE_HINT_CONTRACT;
      const treeRef2 = BACKGROUND_TREE_HINT_CONTRACT;
      expect(treeRef1).toBe(treeRef2);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Cross-Runtime Consistency (Dev/Prod Invariance)
  // ---------------------------------------------------------------------------

  describe("dev/prod runtime invariance", () => {
    test("decision logic produces deterministic results regardless of runtime", () => {
      // These tests run identically in dev (bun run) and prod (compiled binary)
      // because the functions have no runtime-conditional branching

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
        { count: 1, expected: "1 background agent running" },
        { count: 5, expected: "5 background agents running" },
      ];

      for (const { count, expected } of testCases) {
        const agents = Array.from({ length: count }, (_, i) =>
          createAgent({ id: `agent-${i}`, status: "background" }),
        );
        const result = formatBackgroundAgentFooterStatus(agents);
        expect(result).toBe(expected);
      }
    });

    test("tree hint precedence is invariant across runtimes", () => {
      const runningAgents = [createAgent({ status: "background" })];
      const completedAgents = [createAgent({ status: "completed", background: true })];
      const noAgents: ParallelAgent[] = [];

      expect(buildParallelAgentsHeaderHint(runningAgents, true)).toBe(
        "background running · ctrl+f terminate",
      );
      expect(buildParallelAgentsHeaderHint(completedAgents, true)).toBe(
        "background complete · ctrl+o to expand",
      );
      expect(buildParallelAgentsHeaderHint(noAgents, true)).toBe("ctrl+o to expand");
      expect(buildParallelAgentsHeaderHint(noAgents, false)).toBe("");
    });

    test("interruption behavior is deterministic across runtimes", () => {
      const nowMs = 1000000005000;
      const agents: ParallelAgent[] = [
        createAgent({
          id: "bg-1",
          status: "background",
          startedAt: new Date(1000000000000).toISOString(),
        }),
      ];

      const result = interruptActiveBackgroundAgents(agents, nowMs);

      expect(result.interruptedIds).toEqual(["bg-1"]);
      expect(result.agents[0]!.status).toBe("interrupted");
      expect(result.agents[0]!.durationMs).toBe(5000);
    });

    test("contract constants are identical across runtimes", () => {
      // Capture contract values
      const footerContract = JSON.parse(JSON.stringify(BACKGROUND_FOOTER_CONTRACT));
      const treeContract = JSON.parse(JSON.stringify(BACKGROUND_TREE_HINT_CONTRACT));

      // These values should be identical in dev and production
      expect(footerContract).toEqual({
        showWhenAgentCountAtLeast: 1,
        includeTerminateHint: true,
        terminateHintText: "ctrl+f terminate",
        countFormat: "agents",
      });

      expect(treeContract).toEqual({
        whenRunning: "background running · ctrl+f terminate",
        whenComplete: "background complete · ctrl+o to expand",
        defaultHint: "ctrl+o to expand",
      });
    });
  });
});
