/**
 * E2E Provider Parity Matrix Test (Issue #258 Task #19)
 *
 * This test verifies that background agent UX contracts produce identical behavior
 * across all three providers: Claude Code, OpenCode, and GitHub Copilot CLI.
 *
 * The background agent utilities are provider-agnostic — they do NOT take an
 * `agentType` parameter. This test documents and enforces that guarantee.
 */

import { describe, expect, test } from "bun:test";
import type { ParallelAgent } from "../components/parallel-agents-tree.tsx";
import {
  getBackgroundTerminationDecision,
  interruptActiveBackgroundAgents,
  isBackgroundTerminationKey,
} from "./background-agent-termination.ts";
import {
  BACKGROUND_FOOTER_CONTRACT,
  BACKGROUND_TREE_HINT_CONTRACT,
} from "./background-agent-contracts.ts";
import {
  getActiveBackgroundAgents,
  resolveBackgroundAgentsForFooter,
  formatBackgroundAgentFooterStatus,
  type BackgroundAgentFooterMessage,
} from "./background-agent-footer.ts";
import { buildParallelAgentsHeaderHint } from "./background-agent-tree-hints.ts";

// Provider types (AGENT_KEYS is not exported from config.ts, so we define inline)
const PROVIDERS = ["claude", "opencode", "copilot"] as const;
type ProviderKey = (typeof PROVIDERS)[number];

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
    startedAt: overrides.startedAt ?? new Date().toISOString(),
    currentTool: overrides.currentTool,
    durationMs: overrides.durationMs,
    result: overrides.result,
  };
}

// ---------------------------------------------------------------------------
// Provider Parity Test Matrix
// ---------------------------------------------------------------------------

describe("Background agent provider parity matrix", () => {
  // Convert to mutable array for test.each
  const providers: ProviderKey[] = [...PROVIDERS];

  // ---------------------------------------------------------------------------
  // 1. Termination Decision Parity
  // ---------------------------------------------------------------------------

  describe("termination decision parity", () => {
    test.each(providers)(
      "provider %s: identical decision outputs for all press counts",
      (provider) => {
        // Document that provider is not used — contracts are provider-agnostic
        const _providerContext = provider;

        // Test matrix: (pressCount, activeCount) → decision
        expect(getBackgroundTerminationDecision(0, 0)).toEqual({ action: "none" });
        expect(getBackgroundTerminationDecision(0, 2)).toEqual({
          action: "warn",
          message: "Press Ctrl-F again to terminate background agents",
        });
        expect(getBackgroundTerminationDecision(1, 2)).toEqual({
          action: "terminate",
          message: "All background agents killed",
        });
        expect(getBackgroundTerminationDecision(5, 0)).toEqual({ action: "none" });
        expect(getBackgroundTerminationDecision(2, 3)).toEqual({
          action: "terminate",
          message: "All background agents killed",
        });
      },
    );

    test.each(providers)(
      "provider %s: keybinding detection is identical",
      (provider) => {
        const _providerContext = provider;

        // Ctrl+F detection
        expect(isBackgroundTerminationKey({ ctrl: true, name: "f" })).toBe(true);

        // Rejection cases
        expect(isBackgroundTerminationKey({ ctrl: true, shift: true, name: "f" })).toBe(false);
        expect(isBackgroundTerminationKey({ ctrl: true, meta: true, name: "f" })).toBe(false);
        expect(isBackgroundTerminationKey({ ctrl: true, name: "c" })).toBe(false);
        expect(isBackgroundTerminationKey({ ctrl: true, name: "o" })).toBe(false);
      },
    );
  });

  // ---------------------------------------------------------------------------
  // 2. Footer Contract Parity
  // ---------------------------------------------------------------------------

  describe("footer contract parity", () => {
    test.each(providers)(
      "provider %s: BACKGROUND_FOOTER_CONTRACT is identical",
      (provider) => {
        const _providerContext = provider;

        // All providers see the same contract instance
        expect(BACKGROUND_FOOTER_CONTRACT).toEqual({
          showWhenAgentCountAtLeast: 1,
          includeTerminateHint: true,
          terminateHintText: "ctrl+f to kill agents",
          countFormat: "agents",
        });
      },
    );

    test.each(providers)(
      "provider %s: footer status formatting is identical",
      (provider) => {
        const _providerContext = provider;

        const agents: ParallelAgent[] = [
          createAgent({ id: "bg-1", status: "background" }),
          createAgent({ id: "bg-2", status: "running", background: true }),
        ];

        expect(formatBackgroundAgentFooterStatus([])).toBe("");
        expect(formatBackgroundAgentFooterStatus([agents[0]!])).toBe("1 local agent");
        expect(formatBackgroundAgentFooterStatus(agents)).toBe("2 local agents");
      },
    );

    test.each(providers)(
      "provider %s: footer resolver precedence is identical",
      (provider) => {
        const _providerContext = provider;

        const liveAgents: ParallelAgent[] = [
          createAgent({ id: "live-1", status: "background" }),
        ];

        const messages: BackgroundAgentFooterMessage[] = [
          { parallelAgents: [createAgent({ id: "msg-1", status: "background" })] },
        ];

        // Live agents take precedence
        const result = resolveBackgroundAgentsForFooter(liveAgents, messages);
        expect(result.length).toBe(1);
        expect(result[0]!.id).toBe("live-1");

        // Snapshot fallback when live is empty
        const fallback = resolveBackgroundAgentsForFooter([], messages);
        expect(fallback.length).toBe(1);
        expect(fallback[0]!.id).toBe("msg-1");
      },
    );
  });

  // ---------------------------------------------------------------------------
  // 3. Tree Hint Contract Parity
  // ---------------------------------------------------------------------------

  describe("tree hint contract parity", () => {
    test.each(providers)(
      "provider %s: BACKGROUND_TREE_HINT_CONTRACT is identical",
      (provider) => {
        const _providerContext = provider;

        // All providers see the same contract instance
        expect(BACKGROUND_TREE_HINT_CONTRACT).toEqual({
          whenRunning: "background running · ctrl+f to kill agents",
          whenComplete: "background complete · ctrl+o to expand",
          defaultHint: "ctrl+o to expand",
        });
      },
    );

    test.each(providers)(
      "provider %s: tree hint builder produces identical hints",
      (provider) => {
        const _providerContext = provider;

        const runningAgents = [
          createAgent({ id: "bg-1", status: "background" }),
        ];

        const completedAgents = [
          createAgent({ id: "bg-1", status: "completed", background: true }),
        ];

        // When running
        expect(buildParallelAgentsHeaderHint(runningAgents, true)).toBe(
          "background running · ctrl+f to kill agents",
        );

        // When complete
        expect(buildParallelAgentsHeaderHint(completedAgents, true)).toBe(
          "background complete · ctrl+o to expand",
        );

        // Default hint
        expect(buildParallelAgentsHeaderHint([], true)).toBe("ctrl+o to expand");

        // No hint when showExpandHint is false
        expect(buildParallelAgentsHeaderHint([], false)).toBe("");
      },
    );
  });

  // ---------------------------------------------------------------------------
  // 4. Interrupt Behavior Parity
  // ---------------------------------------------------------------------------

  describe("interrupt behavior parity", () => {
    test.each(providers)(
      "provider %s: interruptActiveBackgroundAgents produces identical results",
      (provider) => {
        const _providerContext = provider;

        const now = Date.now();
        const agents: ParallelAgent[] = [
          createAgent({
            id: "bg-active",
            status: "background",
            startedAt: new Date(now - 5000).toISOString(),
          }),
          createAgent({
            id: "fg-running",
            status: "running",
            background: false,
          }),
          createAgent({
            id: "bg-completed",
            status: "completed",
            background: true,
          }),
        ];

        const result = interruptActiveBackgroundAgents(agents, now);

        // Only bg-active should be interrupted
        expect(result.interruptedIds).toEqual(["bg-active"]);

        const interruptedAgent = result.agents.find((a) => a.id === "bg-active");
        expect(interruptedAgent?.status).toBe("interrupted");
        expect(interruptedAgent?.durationMs).toBeGreaterThanOrEqual(5000);

        // Foreground and completed agents remain unchanged
        expect(result.agents.find((a) => a.id === "fg-running")?.status).toBe("running");
        expect(result.agents.find((a) => a.id === "bg-completed")?.status).toBe("completed");
      },
    );

    test.each(providers)(
      "provider %s: empty interruptedIds when no active agents",
      (provider) => {
        const _providerContext = provider;

        const agents: ParallelAgent[] = [
          createAgent({ id: "bg-1", status: "completed", background: true }),
        ];

        const result = interruptActiveBackgroundAgents(agents);
        expect(result.interruptedIds).toEqual([]);
        expect(result.agents[0]!.status).toBe("completed");
      },
    );
  });

  // ---------------------------------------------------------------------------
  // 5. Full Contract Integration Parity
  // ---------------------------------------------------------------------------

  describe("full contract integration parity", () => {
    test.each(providers)(
      "provider %s: complete termination flow produces identical behavior",
      (provider) => {
        const _providerContext = provider;

        const now = Date.now();
        let pressCount = 0;
        let agents: ParallelAgent[] = [
          createAgent({
            id: "bg-1",
            status: "background",
            startedAt: new Date(now - 3000).toISOString(),
          }),
          createAgent({
            id: "bg-2",
            status: "running",
            background: true,
            startedAt: new Date(now - 2000).toISOString(),
          }),
        ];

        // First press: warn
        const activeCount1 = getActiveBackgroundAgents(agents).length;
        expect(activeCount1).toBe(2);

        const decision1 = getBackgroundTerminationDecision(pressCount, activeCount1);
        expect(decision1).toEqual({
          action: "warn",
          message: "Press Ctrl-F again to terminate background agents",
        });

        pressCount += 1;

        // Second press: terminate
        const activeCount2 = getActiveBackgroundAgents(agents).length;
        const decision2 = getBackgroundTerminationDecision(pressCount, activeCount2);
        expect(decision2).toEqual({
          action: "terminate",
          message: "All background agents killed",
        });

        // Execute termination
        const result = interruptActiveBackgroundAgents(agents, now);
        agents = result.agents;

        expect(result.interruptedIds).toEqual(["bg-1", "bg-2"]);
        expect(agents.every((a) => a.status === "interrupted")).toBe(true);

        // After termination: no more active agents
        const activeCount3 = getActiveBackgroundAgents(agents).length;
        expect(activeCount3).toBe(0);

        const decision3 = getBackgroundTerminationDecision(pressCount, activeCount3);
        expect(decision3).toEqual({ action: "none" });
      },
    );

    test.each(providers)(
      "provider %s: footer and tree hint contracts remain consistent",
      (provider) => {
        const _providerContext = provider;

        // Verify cross-contract consistency
        const footerHint = BACKGROUND_FOOTER_CONTRACT.terminateHintText;
        const treeHintRunning = BACKGROUND_TREE_HINT_CONTRACT.whenRunning;

        // Both should reference Ctrl+F
        expect(footerHint).toContain("ctrl+f");
        expect(treeHintRunning).toContain("ctrl+f");

        // Both should reference termination
        expect(footerHint).toContain("kill");
        expect(treeHintRunning).toContain("kill");

        // Tree hint complete should reference Ctrl+O
        expect(BACKGROUND_TREE_HINT_CONTRACT.whenComplete).toContain("ctrl+o");
        expect(BACKGROUND_TREE_HINT_CONTRACT.defaultHint).toContain("ctrl+o");
      },
    );
  });

  // ---------------------------------------------------------------------------
  // 6. Edge Case Parity
  // ---------------------------------------------------------------------------

  describe("edge case parity", () => {
    test.each(providers)(
      "provider %s: handles empty agent arrays identically",
      (provider) => {
        const _providerContext = provider;

        expect(getActiveBackgroundAgents([])).toEqual([]);
        expect(formatBackgroundAgentFooterStatus([])).toBe("");
        expect(buildParallelAgentsHeaderHint([], true)).toBe("ctrl+o to expand");
        expect(interruptActiveBackgroundAgents([])).toEqual({
          agents: [],
          interruptedIds: [],
        });
      },
    );

    test.each(providers)(
      "provider %s: handles mixed background/foreground agents identically",
      (provider) => {
        const _providerContext = provider;

        const agents: ParallelAgent[] = [
          createAgent({ id: "bg-1", status: "background" }),
          createAgent({ id: "fg-1", status: "running", background: false }),
          createAgent({ id: "bg-2", status: "running", background: true }),
        ];

        const activeBackground = getActiveBackgroundAgents(agents);
        expect(activeBackground.length).toBe(2);
        expect(activeBackground.map((a) => a.id).sort()).toEqual(["bg-1", "bg-2"]);

        const hint = buildParallelAgentsHeaderHint(agents, true);
        expect(hint).toBe("background running · ctrl+f to kill agents");

        const result = interruptActiveBackgroundAgents(agents);
        expect(result.interruptedIds.length).toBe(2);
        expect(result.agents.find((a) => a.id === "fg-1")?.status).toBe("running");
      },
    );

    test.each(providers)(
      "provider %s: handles invalid timestamps identically",
      (provider) => {
        const _providerContext = provider;

        const agents: ParallelAgent[] = [
          createAgent({
            id: "invalid-timestamp",
            status: "background",
            startedAt: "invalid-date",
            durationMs: 12345,
          }),
        ];

        const result = interruptActiveBackgroundAgents(agents, Date.now());

        const interrupted = result.agents.find((a) => a.id === "invalid-timestamp");
        expect(interrupted?.status).toBe("interrupted");
        // Should preserve existing durationMs when timestamp is invalid
        expect(interrupted?.durationMs).toBe(12345);
      },
    );
  });
});
