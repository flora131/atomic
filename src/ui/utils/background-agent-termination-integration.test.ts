/**
 * Integration tests for Ctrl+F double-press background agent termination flow.
 *
 * These tests verify the FULL Ctrl+F double-press lifecycle end-to-end by composing
 * the existing pure utility functions to simulate the state machine sequence that
 * happens in chat.tsx.
 *
 * Test coverage:
 * 1. Full Ctrl+F double-press lifecycle (press → warn → press → terminate → confirm)
 * 2. First press shows correct warning message
 * 3. Second press emits correct confirmation message
 * 4. Timeout reset between presses (press → timeout → press → warn again)
 * 5. No active agents → noop for any press count
 * 6. Mixed active/completed agents (only active get interrupted)
 * 7. Confirmation message content matches contract
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
import { getActiveBackgroundAgents } from "./background-agent-footer.ts";

// ============================================================================
// TEST HELPERS
// ============================================================================

function createAgent(overrides: Partial<ParallelAgent>): ParallelAgent {
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

/**
 * Simulates the state machine flow for Ctrl+F presses.
 * Returns the decision and whether termination was executed.
 */
interface CtrlFPressSimulation {
  pressCount: number;
  decision: ReturnType<typeof getBackgroundTerminationDecision>;
  agents: ParallelAgent[];
  interruptedIds: string[];
  terminationExecuted: boolean;
}

function simulateCtrlFPress(
  pressCount: number,
  agents: ParallelAgent[],
  nowMs: number = Date.now(),
): CtrlFPressSimulation {
  const activeCount = getActiveBackgroundAgents(agents).length;
  const decision = getBackgroundTerminationDecision(pressCount, activeCount);

  if (decision.action === "terminate") {
    const result = interruptActiveBackgroundAgents(agents, nowMs);
    return {
      pressCount: pressCount + 1,
      decision,
      agents: result.agents,
      interruptedIds: result.interruptedIds,
      terminationExecuted: true,
    };
  }

  return {
    pressCount: decision.action === "warn" ? pressCount + 1 : pressCount,
    decision,
    agents,
    interruptedIds: [],
    terminationExecuted: false,
  };
}

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe("Ctrl+F double-press lifecycle integration", () => {
  test("full double-press flow: press 1 → warn → press 2 → terminate → confirm", () => {
    const now = Date.now();
    const agents: ParallelAgent[] = [
      createAgent({
        id: "bg-1",
        status: "background",
        background: true,
        startedAt: new Date(now - 5000).toISOString(),
        currentTool: "Running in background...",
      }),
      createAgent({
        id: "bg-2",
        status: "running",
        background: true,
        startedAt: new Date(now - 3000).toISOString(),
        currentTool: "Processing...",
      }),
    ];

    // Press 1: Should warn
    const press1 = simulateCtrlFPress(0, agents, now);
    expect(press1.decision.action).toBe("warn");
    expect(press1.decision).toHaveProperty("message");
    if (press1.decision.action === "warn") {
      expect(press1.decision.message).toBe("Press Ctrl-F again to terminate background agents");
    }
    expect(press1.terminationExecuted).toBe(false);
    expect(press1.pressCount).toBe(1);
    expect(press1.agents).toEqual(agents); // No changes yet

    // Press 2 (within timeout): Should terminate
    const press2 = simulateCtrlFPress(press1.pressCount, press1.agents, now);
    expect(press2.decision.action).toBe("terminate");
    expect(press2.decision).toHaveProperty("message");
    if (press2.decision.action === "terminate") {
      expect(press2.decision.message).toBe("All background agents killed");
    }
    expect(press2.terminationExecuted).toBe(true);
    expect(press2.interruptedIds).toEqual(["bg-1", "bg-2"]);

    // Verify all agents are interrupted
    expect(press2.agents.every((agent) => agent.status === "interrupted")).toBe(true);
    expect(press2.agents.every((agent) => agent.currentTool === undefined)).toBe(true);
    expect(press2.agents[0]?.durationMs).toBeGreaterThanOrEqual(5000);
    expect(press2.agents[1]?.durationMs).toBeGreaterThanOrEqual(3000);
  });

  test("first press shows correct warning message", () => {
    const agents: ParallelAgent[] = [
      createAgent({
        id: "bg-active",
        status: "background",
        background: true,
      }),
    ];

    const press = simulateCtrlFPress(0, agents);
    expect(press.decision.action).toBe("warn");
    if (press.decision.action === "warn") {
      expect(press.decision.message).toBe("Press Ctrl-F again to terminate background agents");
    }
  });

  test("second press emits correct confirmation message", () => {
    const agents: ParallelAgent[] = [
      createAgent({
        id: "bg-active",
        status: "background",
        background: true,
      }),
    ];

    // Simulate press count = 1 (second press)
    const press = simulateCtrlFPress(1, agents);
    expect(press.decision.action).toBe("terminate");
    if (press.decision.action === "terminate") {
      expect(press.decision.message).toBe("All background agents killed");
    }
  });

  test("timeout reset between presses: press → wait → press → warn again", () => {
    const agents: ParallelAgent[] = [
      createAgent({
        id: "bg-1",
        status: "background",
        background: true,
      }),
    ];

    // First press: warn
    const press1 = simulateCtrlFPress(0, agents);
    expect(press1.decision.action).toBe("warn");
    expect(press1.pressCount).toBe(1);

    // Simulate timeout: press count resets to 0
    const pressCountAfterTimeout = 0;

    // Next press after timeout: should warn again, not terminate
    const press2 = simulateCtrlFPress(pressCountAfterTimeout, agents);
    expect(press2.decision.action).toBe("warn");
    if (press2.decision.action === "warn") {
      expect(press2.decision.message).toBe("Press Ctrl-F again to terminate background agents");
    }
    expect(press2.terminationExecuted).toBe(false);
  });

  test("no active agents → noop for any press count", () => {
    const agents: ParallelAgent[] = [
      createAgent({
        id: "completed",
        status: "completed",
        background: true,
        durationMs: 1000,
      }),
      createAgent({
        id: "interrupted",
        status: "interrupted",
        background: true,
        durationMs: 500,
      }),
    ];

    // Press count 0 (first press)
    const press0 = simulateCtrlFPress(0, agents);
    expect(press0.decision.action).toBe("none");
    expect(press0.terminationExecuted).toBe(false);

    // Press count 1 (second press)
    const press1 = simulateCtrlFPress(1, agents);
    expect(press1.decision.action).toBe("none");
    expect(press1.terminationExecuted).toBe(false);

    // Press count 5 (multiple presses)
    const press5 = simulateCtrlFPress(5, agents);
    expect(press5.decision.action).toBe("none");
    expect(press5.terminationExecuted).toBe(false);
  });

  test("mixed active/completed agents: only active get interrupted", () => {
    const now = Date.now();
    const agents: ParallelAgent[] = [
      createAgent({
        id: "bg-active-1",
        status: "background",
        background: true,
        startedAt: new Date(now - 2000).toISOString(),
        currentTool: "Running...",
      }),
      createAgent({
        id: "bg-completed",
        status: "completed",
        background: true,
        startedAt: new Date(now - 5000).toISOString(),
        durationMs: 3000,
      }),
      createAgent({
        id: "bg-active-2",
        status: "pending",
        background: true,
        startedAt: new Date(now - 1000).toISOString(),
      }),
      createAgent({
        id: "fg-running",
        status: "running",
        background: false,
        currentTool: "Foreground task",
      }),
    ];

    // First press: warn
    const press1 = simulateCtrlFPress(0, agents, now);
    expect(press1.decision.action).toBe("warn");

    // Second press: terminate
    const press2 = simulateCtrlFPress(press1.pressCount, press1.agents, now);
    expect(press2.decision.action).toBe("terminate");
    expect(press2.terminationExecuted).toBe(true);

    // Only active background agents should be interrupted
    expect(press2.interruptedIds).toEqual(["bg-active-1", "bg-active-2"]);

    // Verify agent states
    const bgActive1 = press2.agents.find((a) => a.id === "bg-active-1");
    expect(bgActive1?.status).toBe("interrupted");
    expect(bgActive1?.currentTool).toBeUndefined();

    const bgCompleted = press2.agents.find((a) => a.id === "bg-completed");
    expect(bgCompleted?.status).toBe("completed");
    expect(bgCompleted?.durationMs).toBe(3000); // Preserved

    const bgActive2 = press2.agents.find((a) => a.id === "bg-active-2");
    expect(bgActive2?.status).toBe("interrupted");

    const fgRunning = press2.agents.find((a) => a.id === "fg-running");
    expect(fgRunning?.status).toBe("running"); // Unaffected
    expect(fgRunning?.currentTool).toBe("Foreground task");
  });

  test("confirmation message content matches contract expectations", () => {
    const agents: ParallelAgent[] = [
      createAgent({
        id: "bg-1",
        status: "background",
        background: true,
      }),
    ];

    // First press warning message
    const press1 = simulateCtrlFPress(0, agents);
    expect(press1.decision.action).toBe("warn");
    if (press1.decision.action === "warn") {
      // Message should mention Ctrl-F and termination
      expect(press1.decision.message).toContain("Ctrl-F");
      expect(press1.decision.message).toContain("terminate");
      expect(press1.decision.message).toContain("background agents");
    }

    // Second press confirmation message
    const press2 = simulateCtrlFPress(press1.pressCount, press1.agents);
    expect(press2.decision.action).toBe("terminate");
    if (press2.decision.action === "terminate") {
      // Message should mention killing/termination
      expect(press2.decision.message).toContain("background agents");
      expect(press2.decision.message).toContain("killed");
    }
  });

  test("confirmation messages are consistent with footer and tree hint contracts", () => {
    const agents: ParallelAgent[] = [
      createAgent({
        id: "bg-1",
        status: "background",
        background: true,
      }),
    ];

    // Verify footer contract includes terminate hint
    expect(BACKGROUND_FOOTER_CONTRACT.includeTerminateHint).toBe(true);
    expect(BACKGROUND_FOOTER_CONTRACT.terminateHintText).toBe("ctrl+f terminate");

    // Verify tree hint contract includes termination hint for running agents
    expect(BACKGROUND_TREE_HINT_CONTRACT.whenRunning).toContain("ctrl+f");
    expect(BACKGROUND_TREE_HINT_CONTRACT.whenRunning).toContain("terminate");

    // Verify decision messages reference the same key combination
    const press1 = simulateCtrlFPress(0, agents);
    if (press1.decision.action === "warn") {
      expect(press1.decision.message.toLowerCase()).toContain("ctrl");
      expect(press1.decision.message.toLowerCase()).toContain("f");
    }

    const press2 = simulateCtrlFPress(press1.pressCount, press1.agents);
    if (press2.decision.action === "terminate") {
      // Confirmation message should be clear about what happened
      expect(press2.decision.message).toBeTruthy();
      expect(press2.decision.message.length).toBeGreaterThan(0);
    }
  });
});

describe("Ctrl+F keybinding detection", () => {
  test("detects Ctrl+F correctly", () => {
    expect(isBackgroundTerminationKey({ ctrl: true, name: "f" })).toBe(true);
  });

  test("rejects Ctrl+F with additional modifiers", () => {
    expect(isBackgroundTerminationKey({ ctrl: true, shift: true, name: "f" })).toBe(false);
    expect(isBackgroundTerminationKey({ ctrl: true, meta: true, name: "f" })).toBe(false);
  });

  test("rejects other Ctrl combinations", () => {
    expect(isBackgroundTerminationKey({ ctrl: true, name: "c" })).toBe(false);
    expect(isBackgroundTerminationKey({ ctrl: true, name: "o" })).toBe(false);
  });
});

describe("Edge cases and error handling", () => {
  test("handles empty agent list", () => {
    const press = simulateCtrlFPress(0, []);
    expect(press.decision.action).toBe("none");
    expect(press.terminationExecuted).toBe(false);
  });

  test("handles agents with invalid startedAt timestamps", () => {
    const agents: ParallelAgent[] = [
      createAgent({
        id: "invalid-time",
        status: "background",
        background: true,
        startedAt: "not-a-valid-date",
        durationMs: 999,
      }),
    ];

    const press1 = simulateCtrlFPress(0, agents);
    expect(press1.decision.action).toBe("warn");

    const press2 = simulateCtrlFPress(press1.pressCount, press1.agents);
    expect(press2.decision.action).toBe("terminate");
    expect(press2.terminationExecuted).toBe(true);

    // Should preserve existing durationMs when startedAt is invalid
    const interrupted = press2.agents[0];
    expect(interrupted?.status).toBe("interrupted");
    expect(interrupted?.durationMs).toBe(999);
  });

  test("handles rapid triple press (third press after termination)", () => {
    const agents: ParallelAgent[] = [
      createAgent({
        id: "bg-1",
        status: "background",
        background: true,
      }),
    ];

    // Press 1: warn
    const press1 = simulateCtrlFPress(0, agents);
    expect(press1.decision.action).toBe("warn");

    // Press 2: terminate
    const press2 = simulateCtrlFPress(press1.pressCount, press1.agents);
    expect(press2.decision.action).toBe("terminate");
    expect(press2.terminationExecuted).toBe(true);

    // Press 3: should be noop since all agents are now interrupted
    const press3 = simulateCtrlFPress(0, press2.agents);
    expect(press3.decision.action).toBe("none");
    expect(press3.terminationExecuted).toBe(false);
  });

  test("multiple active background agents all get terminated", () => {
    const now = Date.now();
    const agents: ParallelAgent[] = Array.from({ length: 5 }, (_, i) =>
      createAgent({
        id: `bg-${i}`,
        status: "background",
        background: true,
        startedAt: new Date(now - (i + 1) * 1000).toISOString(),
      })
    );

    const press1 = simulateCtrlFPress(0, agents, now);
    expect(press1.decision.action).toBe("warn");

    const press2 = simulateCtrlFPress(press1.pressCount, press1.agents, now);
    expect(press2.decision.action).toBe("terminate");
    expect(press2.interruptedIds.length).toBe(5);
    expect(press2.agents.every((a) => a.status === "interrupted")).toBe(true);
  });
});
