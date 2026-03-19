import { describe, expect, test } from "bun:test";
import type { ParallelAgent } from "@/types/parallel-agents.ts";
import { hasActiveBackgroundAgentsForSpinner } from "@/state/parts/guards.ts";

/**
 * Tests for the deferred completion trigger logic added in use-agent-subscriptions.ts.
 *
 * The stream.agent.complete handler checks after a background agent completes:
 *   1. Whether any active background agents remain
 *   2. Whether a pending deferred completion callback exists
 * If both conditions are met, it invokes and clears the callback.
 *
 * These tests exercise the state conditions that drive the trigger decision.
 */

function createBackgroundAgent(
  id: string,
  status: ParallelAgent["status"],
): ParallelAgent {
  return {
    id,
    taskToolCallId: id,
    name: "task",
    task: `Background task ${id}`,
    status,
    background: true,
    startedAt: new Date(Date.now() - 1000).toISOString(),
    currentTool: status === "background" ? "Running task in background…" : undefined,
  };
}

function createForegroundAgent(
  id: string,
  status: ParallelAgent["status"],
): ParallelAgent {
  return {
    id,
    taskToolCallId: id,
    name: "task",
    task: `Foreground task ${id}`,
    status,
    startedAt: new Date(Date.now() - 1000).toISOString(),
    currentTool: status === "running" ? "Starting task…" : undefined,
  };
}

describe("Deferred completion trigger on last background agent completion", () => {
  describe("hasActiveBackgroundAgentsForSpinner guard", () => {
    test("returns false when no agents exist", () => {
      expect(hasActiveBackgroundAgentsForSpinner([])).toBe(false);
    });

    test("returns false when all background agents are completed", () => {
      const agents: ParallelAgent[] = [
        createBackgroundAgent("bg_1", "completed"),
        createBackgroundAgent("bg_2", "completed"),
      ];
      expect(hasActiveBackgroundAgentsForSpinner(agents)).toBe(false);
    });

    test("returns false when all background agents are errored", () => {
      const agents: ParallelAgent[] = [
        createBackgroundAgent("bg_1", "error"),
        createBackgroundAgent("bg_2", "error"),
      ];
      expect(hasActiveBackgroundAgentsForSpinner(agents)).toBe(false);
    });

    test("returns true when one background agent is still running", () => {
      const agents: ParallelAgent[] = [
        createBackgroundAgent("bg_1", "completed"),
        createBackgroundAgent("bg_2", "background"),
      ];
      expect(hasActiveBackgroundAgentsForSpinner(agents)).toBe(true);
    });

    test("returns true when one background agent is pending", () => {
      const agents: ParallelAgent[] = [
        createBackgroundAgent("bg_1", "completed"),
        createBackgroundAgent("bg_2", "pending"),
      ];
      expect(hasActiveBackgroundAgentsForSpinner(agents)).toBe(true);
    });

    test("ignores foreground agents when checking background status", () => {
      const agents: ParallelAgent[] = [
        createForegroundAgent("fg_1", "running"),
        createBackgroundAgent("bg_1", "completed"),
      ];
      // No active *background* agents — foreground running agent is not counted
      expect(hasActiveBackgroundAgentsForSpinner(agents)).toBe(false);
    });
  });

  describe("Trigger decision simulation", () => {
    /**
     * Simulates the trigger decision logic from use-agent-subscriptions.ts:
     *
     *   if (!hasActiveBackgroundAgentsForSpinner(agents) && pendingCompleteRef.current) {
     *     // clear timeout, invoke, and null pendingCompleteRef
     *   }
     */
    function simulateTriggerDecision(
      agents: readonly ParallelAgent[],
      pendingComplete: (() => void) | null,
      deferredTimeout: ReturnType<typeof setTimeout> | null,
    ): { triggered: boolean; timeoutCleared: boolean } {
      let triggered = false;
      let timeoutCleared = false;

      if (!hasActiveBackgroundAgentsForSpinner(agents) && pendingComplete) {
        if (deferredTimeout !== null) {
          clearTimeout(deferredTimeout);
          timeoutCleared = true;
        }
        triggered = true;
        pendingComplete();
      }

      return { triggered, timeoutCleared };
    }

    test("triggers deferred completion when last background agent completes", () => {
      const agents: ParallelAgent[] = [
        createBackgroundAgent("bg_1", "completed"),
      ];
      let callbackInvoked = false;
      const pendingComplete = () => {
        callbackInvoked = true;
      };

      const result = simulateTriggerDecision(agents, pendingComplete, null);
      expect(result.triggered).toBe(true);
      expect(callbackInvoked).toBe(true);
      expect(result.timeoutCleared).toBe(false);
    });

    test("does not trigger when active background agents remain", () => {
      const agents: ParallelAgent[] = [
        createBackgroundAgent("bg_1", "completed"),
        createBackgroundAgent("bg_2", "background"),
      ];
      let callbackInvoked = false;
      const pendingComplete = () => {
        callbackInvoked = true;
      };

      const result = simulateTriggerDecision(agents, pendingComplete, null);
      expect(result.triggered).toBe(false);
      expect(callbackInvoked).toBe(false);
    });

    test("does not trigger when no pending completion callback exists", () => {
      const agents: ParallelAgent[] = [
        createBackgroundAgent("bg_1", "completed"),
      ];

      const result = simulateTriggerDecision(agents, null, null);
      expect(result.triggered).toBe(false);
    });

    test("clears existing deferred timeout when triggering", () => {
      const agents: ParallelAgent[] = [
        createBackgroundAgent("bg_1", "completed"),
      ];
      const deferredTimeout = setTimeout(() => {}, 10_000);

      const result = simulateTriggerDecision(agents, () => {}, deferredTimeout);
      expect(result.triggered).toBe(true);
      expect(result.timeoutCleared).toBe(true);
    });

    test("triggers after multiple background agents all complete", () => {
      const agents: ParallelAgent[] = [
        createBackgroundAgent("bg_1", "completed"),
        createBackgroundAgent("bg_2", "error"),
        createBackgroundAgent("bg_3", "completed"),
      ];
      let callbackInvoked = false;
      const pendingComplete = () => {
        callbackInvoked = true;
      };

      const result = simulateTriggerDecision(agents, pendingComplete, null);
      expect(result.triggered).toBe(true);
      expect(callbackInvoked).toBe(true);
    });

    test("does not trigger for mix of completed bg + active bg agents", () => {
      const agents: ParallelAgent[] = [
        createBackgroundAgent("bg_1", "completed"),
        createBackgroundAgent("bg_2", "error"),
        createBackgroundAgent("bg_3", "running"),
      ];
      let callbackInvoked = false;
      const pendingComplete = () => {
        callbackInvoked = true;
      };

      const result = simulateTriggerDecision(agents, pendingComplete, null);
      expect(result.triggered).toBe(false);
      expect(callbackInvoked).toBe(false);
    });

    test("triggers even when foreground agents are still running", () => {
      const agents: ParallelAgent[] = [
        createForegroundAgent("fg_1", "running"),
        createBackgroundAgent("bg_1", "completed"),
      ];
      let callbackInvoked = false;
      const pendingComplete = () => {
        callbackInvoked = true;
      };

      const result = simulateTriggerDecision(agents, pendingComplete, null);
      expect(result.triggered).toBe(true);
      expect(callbackInvoked).toBe(true);
    });

    test("does not trigger when agent list is empty and no pending callback", () => {
      const result = simulateTriggerDecision([], null, null);
      expect(result.triggered).toBe(false);
    });

    test("triggers when agent list is empty and pending callback exists (edge case)", () => {
      let callbackInvoked = false;
      const pendingComplete = () => {
        callbackInvoked = true;
      };

      const result = simulateTriggerDecision([], pendingComplete, null);
      expect(result.triggered).toBe(true);
      expect(callbackInvoked).toBe(true);
    });
  });
});
