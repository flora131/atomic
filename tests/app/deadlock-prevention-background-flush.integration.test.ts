/**
 * Integration test: Deadlock prevention — background flush without user input.
 *
 * Validates the end-to-end interaction between two mechanisms:
 *
 *   1. `shouldStartBackgroundUpdateFlush` — the isAgentOnlyStream bypass
 *      allows flush to proceed even when isStreaming is true (Task 17).
 *
 *   2. Deferred completion trigger — when the last background agent completes,
 *      the pending completion callback fires immediately (Task 13).
 *
 * Without both mechanisms, the following deadlock occurs:
 *
 *   Main stream completes → isStreaming stays true (background agents active)
 *   → shouldStartBackgroundUpdateFlush blocks (isStreaming && !isAgentOnlyStream)
 *   → background agent updates can never be flushed
 *   → agents never receive results → stream never finalizes
 *
 * The fix: isAgentOnlyStream bypasses the streaming block so flushes proceed,
 * and deferred completion triggers when all background agents reach terminal state.
 */

import { describe, expect, mock, test } from "bun:test";
import type { ParallelAgent } from "@/components/parallel-agents-tree.tsx";
import {
  shouldScheduleBackgroundUpdateFollowUpFlush,
  shouldStartBackgroundUpdateFlush,
} from "@/lib/ui/background-update-flush.ts";
import { hasActiveBackgroundAgentsForSpinner } from "@/state/parts/guards.ts";
import {
  applySubagentCompleteTransform,
  createAgent,
  hasActiveAgents,
} from "./parallel-agent-background-lifecycle.test-support.ts";

// ---------------------------------------------------------------------------
// Simulation helpers — mirror the real dispatch and completion logic
// ---------------------------------------------------------------------------

/**
 * Simulates the background dispatch flush cycle from use-background-dispatch.ts.
 *
 * The real hook calls shouldStartBackgroundUpdateFlush to gate flush,
 * then shouldScheduleBackgroundUpdateFollowUpFlush after a successful send
 * to determine whether to chain another flush.
 */
interface FlushCycleState {
  isStreaming: boolean;
  isAgentOnlyStream: boolean;
  hasFlushInFlight: boolean;
  pendingUpdates: string[];
  flushedUpdates: string[];
}

function attemptFlush(state: FlushCycleState): boolean {
  const canFlush = shouldStartBackgroundUpdateFlush({
    hasFlushInFlight: state.hasFlushInFlight,
    isAgentOnlyStream: state.isAgentOnlyStream,
    isStreaming: state.isStreaming,
    pendingUpdateCount: state.pendingUpdates.length,
  });

  if (!canFlush) return false;

  state.hasFlushInFlight = true;
  const update = state.pendingUpdates.shift()!;
  state.flushedUpdates.push(update);
  state.hasFlushInFlight = false;

  return true;
}

function shouldChainFlush(state: FlushCycleState): boolean {
  return shouldScheduleBackgroundUpdateFollowUpFlush({
    isAgentOnlyStream: state.isAgentOnlyStream,
    sendSucceeded: true,
    isStreaming: state.isStreaming,
    pendingUpdateCount: state.pendingUpdates.length,
  });
}

/**
 * Drains all pending updates by repeatedly flushing until the predicates
 * say to stop. Returns the number of flush cycles executed.
 */
function drainFlushQueue(state: FlushCycleState): number {
  let cycles = 0;
  const maxCycles = 100; // safety guard

  if (!attemptFlush(state)) return 0;
  cycles++;

  while (shouldChainFlush(state) && cycles < maxCycles) {
    if (!attemptFlush(state)) break;
    cycles++;
  }

  return cycles;
}

/**
 * Simulates the deferred completion trigger from use-agent-subscriptions.ts.
 *
 * After a background agent completes, the handler checks:
 *   - hasActiveBackgroundAgentsForSpinner returns false (all bg agents done)
 *   - pendingCompleteCallback is non-null
 * If both hold, it clears the timeout and invokes the callback.
 */
function simulateDeferredCompletionTrigger(
  agents: readonly ParallelAgent[],
  pendingCallback: (() => void) | null,
  deferredTimeout: ReturnType<typeof setTimeout> | null,
): { triggered: boolean; timeoutCleared: boolean } {
  let triggered = false;
  let timeoutCleared = false;

  if (!hasActiveBackgroundAgentsForSpinner(agents) && pendingCallback) {
    if (deferredTimeout !== null) {
      clearTimeout(deferredTimeout);
      timeoutCleared = true;
    }
    triggered = true;
    pendingCallback();
  }

  return { triggered, timeoutCleared };
}

// ---------------------------------------------------------------------------
// Integration tests
// ---------------------------------------------------------------------------

describe("Deadlock prevention: background flush without user input", () => {
  describe("Full lifecycle: main stream completes → bg agents flush → deferred completion", () => {
    test("isAgentOnlyStream bypass allows flush while streaming with background agents", () => {
      const state: FlushCycleState = {
        isStreaming: true,
        isAgentOnlyStream: false,
        hasFlushInFlight: false,
        pendingUpdates: ["bg-update-1", "bg-update-2"],
        flushedUpdates: [],
      };

      // Phase 1: streaming active, no bypass → flush is blocked (deadlock condition)
      expect(drainFlushQueue(state)).toBe(0);
      expect(state.pendingUpdates).toHaveLength(2);
      expect(state.flushedUpdates).toHaveLength(0);

      // Phase 2: main stream completes, isAgentOnlyStream activates → flush unblocked
      state.isAgentOnlyStream = true;

      const cycles = drainFlushQueue(state);
      expect(cycles).toBe(2);
      expect(state.pendingUpdates).toHaveLength(0);
      expect(state.flushedUpdates).toEqual(["bg-update-1", "bg-update-2"]);
    });

    test("end-to-end: spawn bg agents → main completes → flush updates → bg completes → deferred fires", () => {
      // --- Setup: two background agents spawned during streaming ---
      const agents: ParallelAgent[] = [
        createAgent(true, "task", "Research task", "bg_research"),
        createAgent(true, "task", "Analysis task", "bg_analysis"),
      ];

      const flushState: FlushCycleState = {
        isStreaming: true,
        isAgentOnlyStream: false,
        hasFlushInFlight: false,
        pendingUpdates: [],
        flushedUpdates: [],
      };

      const completionCallback = mock(() => {});
      const deferredTimeout = setTimeout(() => {}, 30_000);

      // --- Phase 1: Main stream active, bg agents running ---
      expect(hasActiveAgents(agents)).toBe(true);
      expect(hasActiveBackgroundAgentsForSpinner(agents)).toBe(true);

      // Background updates queue up
      flushState.pendingUpdates.push("update-from-research", "update-from-analysis");

      // Flush is blocked — isStreaming && !isAgentOnlyStream
      expect(drainFlushQueue(flushState)).toBe(0);
      expect(flushState.flushedUpdates).toHaveLength(0);

      // --- Phase 2: Main stream completes, enters isAgentOnlyStream mode ---
      flushState.isAgentOnlyStream = true;

      // Bypass unblocks flush
      const flushed = drainFlushQueue(flushState);
      expect(flushed).toBe(2);
      expect(flushState.flushedUpdates).toEqual([
        "update-from-research",
        "update-from-analysis",
      ]);

      // --- Phase 3: First background agent completes ---
      agents[0] = applySubagentCompleteTransform(agents[0]!, "bg_research", true);

      expect(agents[0]!.status).toBe("completed");
      expect(hasActiveBackgroundAgentsForSpinner(agents)).toBe(true);

      // Deferred completion does NOT trigger — bg_analysis still active
      let triggerResult = simulateDeferredCompletionTrigger(
        agents,
        completionCallback,
        deferredTimeout,
      );
      expect(triggerResult.triggered).toBe(false);
      expect(completionCallback).not.toHaveBeenCalled();

      // More updates arrive from the remaining agent
      flushState.pendingUpdates.push("final-update-from-analysis");
      expect(drainFlushQueue(flushState)).toBe(1);
      expect(flushState.flushedUpdates).toContain("final-update-from-analysis");

      // --- Phase 4: Last background agent completes → deferred completion fires ---
      agents[1] = applySubagentCompleteTransform(agents[1]!, "bg_analysis", true);

      expect(agents[1]!.status).toBe("completed");
      expect(hasActiveBackgroundAgentsForSpinner(agents)).toBe(false);

      triggerResult = simulateDeferredCompletionTrigger(
        agents,
        completionCallback,
        deferredTimeout,
      );
      expect(triggerResult.triggered).toBe(true);
      expect(triggerResult.timeoutCleared).toBe(true);
      expect(completionCallback).toHaveBeenCalledTimes(1);
    });
  });

  describe("Deadlock condition verification", () => {
    test("without isAgentOnlyStream bypass, flush is permanently blocked during streaming", () => {
      const state: FlushCycleState = {
        isStreaming: true,
        isAgentOnlyStream: false,
        hasFlushInFlight: false,
        pendingUpdates: ["stuck-update-1", "stuck-update-2", "stuck-update-3"],
        flushedUpdates: [],
      };

      // Multiple attempts all fail — this is the deadlock
      for (let attempt = 0; attempt < 5; attempt++) {
        expect(attemptFlush(state)).toBe(false);
      }

      expect(state.pendingUpdates).toHaveLength(3);
      expect(state.flushedUpdates).toHaveLength(0);
    });

    test("isAgentOnlyStream bypass resolves the deadlock", () => {
      const state: FlushCycleState = {
        isStreaming: true,
        isAgentOnlyStream: false,
        hasFlushInFlight: false,
        pendingUpdates: ["stuck-update-1", "stuck-update-2"],
        flushedUpdates: [],
      };

      // Blocked initially
      expect(attemptFlush(state)).toBe(false);

      // Activating the bypass resolves the deadlock
      state.isAgentOnlyStream = true;
      expect(attemptFlush(state)).toBe(true);
      expect(state.flushedUpdates).toEqual(["stuck-update-1"]);

      // Chaining continues to drain
      expect(shouldChainFlush(state)).toBe(true);
      expect(attemptFlush(state)).toBe(true);
      expect(state.flushedUpdates).toEqual(["stuck-update-1", "stuck-update-2"]);
    });

    test("flush-in-flight still blocks even with isAgentOnlyStream bypass", () => {
      const state: FlushCycleState = {
        isStreaming: true,
        isAgentOnlyStream: true,
        hasFlushInFlight: true,
        pendingUpdates: ["pending-update"],
        flushedUpdates: [],
      };

      expect(attemptFlush(state)).toBe(false);
      expect(state.pendingUpdates).toHaveLength(1);
    });
  });

  describe("Deferred completion interplay with flush lifecycle", () => {
    test("completion does not trigger while updates are still being flushed and agents active", () => {
      const agents: ParallelAgent[] = [
        createAgent(true, "task", "Long-running task", "bg_long"),
      ];

      const flushState: FlushCycleState = {
        isStreaming: true,
        isAgentOnlyStream: true,
        hasFlushInFlight: false,
        pendingUpdates: ["in-flight-update"],
        flushedUpdates: [],
      };

      const completionCallback = mock(() => {});

      // Updates can flush (bypass active)
      expect(drainFlushQueue(flushState)).toBe(1);

      // But completion doesn't trigger — agent still active
      const result = simulateDeferredCompletionTrigger(agents, completionCallback, null);
      expect(result.triggered).toBe(false);
      expect(completionCallback).not.toHaveBeenCalled();
    });

    test("completion triggers immediately once last agent completes, even without pending updates", () => {
      const agents: ParallelAgent[] = [
        createAgent(true, "task", "Quick task", "bg_quick"),
      ];

      const flushState: FlushCycleState = {
        isStreaming: true,
        isAgentOnlyStream: true,
        hasFlushInFlight: false,
        pendingUpdates: [],
        flushedUpdates: [],
      };

      const completionCallback = mock(() => {});

      // No updates to flush
      expect(drainFlushQueue(flushState)).toBe(0);

      // Agent completes
      agents[0] = applySubagentCompleteTransform(agents[0]!, "bg_quick", true);
      expect(hasActiveBackgroundAgentsForSpinner(agents)).toBe(false);

      // Completion fires
      const result = simulateDeferredCompletionTrigger(agents, completionCallback, null);
      expect(result.triggered).toBe(true);
      expect(completionCallback).toHaveBeenCalledTimes(1);
    });

    test("errored background agent is treated as terminal for completion", () => {
      const agents: ParallelAgent[] = [
        createAgent(true, "task", "Failing task", "bg_fail"),
        createAgent(true, "task", "Succeeding task", "bg_ok"),
      ];

      const completionCallback = mock(() => {});

      // First agent errors out
      agents[0] = applySubagentCompleteTransform(agents[0]!, "bg_fail", false);
      expect(agents[0]!.status).toBe("error");
      expect(hasActiveBackgroundAgentsForSpinner(agents)).toBe(true);

      // Completion does not trigger — bg_ok still active
      let result = simulateDeferredCompletionTrigger(agents, completionCallback, null);
      expect(result.triggered).toBe(false);

      // Second agent completes successfully
      agents[1] = applySubagentCompleteTransform(agents[1]!, "bg_ok", true);
      expect(hasActiveBackgroundAgentsForSpinner(agents)).toBe(false);

      // Now completion triggers
      result = simulateDeferredCompletionTrigger(agents, completionCallback, null);
      expect(result.triggered).toBe(true);
      expect(completionCallback).toHaveBeenCalledTimes(1);
    });
  });

  describe("Follow-up flush chaining in isAgentOnlyStream mode", () => {
    test("chains follow-up flushes until queue is drained", () => {
      const state: FlushCycleState = {
        isStreaming: true,
        isAgentOnlyStream: true,
        hasFlushInFlight: false,
        pendingUpdates: ["u1", "u2", "u3", "u4", "u5"],
        flushedUpdates: [],
      };

      const cycles = drainFlushQueue(state);

      expect(cycles).toBe(5);
      expect(state.pendingUpdates).toHaveLength(0);
      expect(state.flushedUpdates).toEqual(["u1", "u2", "u3", "u4", "u5"]);
    });

    test("does not chain when not in isAgentOnlyStream mode and streaming", () => {
      const state: FlushCycleState = {
        isStreaming: true,
        isAgentOnlyStream: false,
        hasFlushInFlight: false,
        pendingUpdates: ["u1", "u2"],
        flushedUpdates: [],
      };

      // Initial flush blocked
      expect(drainFlushQueue(state)).toBe(0);
      expect(state.flushedUpdates).toHaveLength(0);
    });

    test("chains follow-up flushes when not streaming (normal idle case)", () => {
      const state: FlushCycleState = {
        isStreaming: false,
        isAgentOnlyStream: false,
        hasFlushInFlight: false,
        pendingUpdates: ["idle-u1", "idle-u2", "idle-u3"],
        flushedUpdates: [],
      };

      const cycles = drainFlushQueue(state);

      expect(cycles).toBe(3);
      expect(state.pendingUpdates).toHaveLength(0);
      expect(state.flushedUpdates).toEqual(["idle-u1", "idle-u2", "idle-u3"]);
    });
  });

  describe("Mixed foreground/background agent scenarios", () => {
    test("foreground agents do not affect background flush or deferred completion", () => {
      const agents: ParallelAgent[] = [
        {
          id: "fg_1",
          taskToolCallId: "fg_1",
          name: "task",
          task: "Foreground task",
          status: "running",
          startedAt: new Date().toISOString(),
          currentTool: "Starting task…",
        },
        createAgent(true, "task", "Background task", "bg_1"),
      ];

      const flushState: FlushCycleState = {
        isStreaming: true,
        isAgentOnlyStream: true,
        hasFlushInFlight: false,
        pendingUpdates: ["bg-update"],
        flushedUpdates: [],
      };

      const completionCallback = mock(() => {});

      // Flush proceeds (isAgentOnlyStream bypass)
      expect(drainFlushQueue(flushState)).toBe(1);

      // Background agent completes
      agents[1] = applySubagentCompleteTransform(agents[1]!, "bg_1", true);

      // hasActiveBackgroundAgentsForSpinner ignores foreground agents
      expect(hasActiveBackgroundAgentsForSpinner(agents)).toBe(false);

      // Deferred completion triggers even though foreground agent is still running
      const result = simulateDeferredCompletionTrigger(agents, completionCallback, null);
      expect(result.triggered).toBe(true);
      expect(completionCallback).toHaveBeenCalledTimes(1);
    });
  });
});
