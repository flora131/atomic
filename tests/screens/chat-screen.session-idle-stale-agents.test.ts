/**
 * Tests for stale agent cleanup in the stream.session.idle handler.
 *
 * When the session goes idle (reason: "idle"), any foreground agents that
 * are still marked as "running" or "pending" are stale — the SDK has
 * definitively declared that no more events will be produced. Without
 * cleanup, these phantom agents cause `hasActiveForegroundAgents` to
 * return true, blocking `handleStreamComplete` indefinitely.
 *
 * This validates the fix where stale agents are transitioned to "completed"
 * before the `shouldContinueParentSessionLoop` continuation check.
 */

import { describe, expect, test, mock, beforeEach } from "bun:test";
import { shouldContinueParentSessionLoop } from "@/lib/ui/stream-continuation.ts";
import { hasActiveForegroundAgents } from "@/state/parts/guards.ts";
import type { ParallelAgent } from "@/components/parallel-agents-tree.tsx";

// ---------------------------------------------------------------------------
// Extracted handler logic mirroring the real stream.session.idle handler
// (non-aborted path) from use-session-subscriptions.ts
// ---------------------------------------------------------------------------

interface SessionIdleStaleAgentState {
  isStreamingRef: { current: boolean };
  hasRunningToolRef: { current: boolean };
  lastTurnFinishReasonRef: { current: string | null };
  parallelAgentsRef: { current: readonly ParallelAgent[] };
  batchDispatcher: { flush: () => void };
  handleStreamComplete: () => void;
  hasPendingTaskResultContract: () => boolean;
  setParallelAgents: (agents: readonly ParallelAgent[]) => void;
}

/**
 * Mirrors the non-aborted path of stream.session.idle in
 * use-session-subscriptions.ts, including the stale agent cleanup fix.
 */
function handleSessionIdleWithCleanup(state: SessionIdleStaleAgentState): void {
  if (!state.isStreamingRef.current) {
    return;
  }

  state.batchDispatcher.flush();

  // Stale agent cleanup (the fix under test)
  const currentAgents = state.parallelAgentsRef.current;
  const hasStaleActiveAgents = currentAgents.some(
    (agent) =>
      agent.status === "running"
      || agent.status === "pending"
      || agent.status === "background",
  );
  if (hasStaleActiveAgents) {
    const now = Date.now();
    const cleanedAgents = currentAgents.map((agent) => {
      if (
        agent.status !== "running"
        && agent.status !== "pending"
        && agent.status !== "background"
      ) {
        return agent;
      }
      const startedAtMs = new Date(agent.startedAt).getTime();
      return {
        ...agent,
        status: "completed" as const,
        currentTool: undefined,
        durationMs: Number.isFinite(startedAtMs)
          ? Math.max(0, now - startedAtMs)
          : agent.durationMs,
      };
    });
    state.parallelAgentsRef.current = cleanedAgents;
    state.setParallelAgents(cleanedAgents);
  }

  const continuationSignal = shouldContinueParentSessionLoop({
    finishReason: (state.lastTurnFinishReasonRef.current ?? undefined) as
      | "tool-calls" | "stop" | "max-tokens" | "max-turns" | "error" | "unknown"
      | undefined,
    hasActiveForegroundAgents: hasActiveForegroundAgents(
      state.parallelAgentsRef.current as ParallelAgent[],
    ),
    hasRunningBlockingTool: state.hasRunningToolRef.current,
    hasPendingTaskContract: state.hasPendingTaskResultContract(),
  });

  if (!continuationSignal.shouldContinue) {
    state.handleStreamComplete();
  }
}

/**
 * The broken version (pre-fix) without stale agent cleanup — the
 * continuation check sees stale "running" agents and blocks forever.
 */
function handleSessionIdleWithoutCleanup(state: SessionIdleStaleAgentState): void {
  if (!state.isStreamingRef.current) {
    return;
  }

  state.batchDispatcher.flush();

  const continuationSignal = shouldContinueParentSessionLoop({
    finishReason: (state.lastTurnFinishReasonRef.current ?? undefined) as
      | "tool-calls" | "stop" | "max-tokens" | "max-turns" | "error" | "unknown"
      | undefined,
    hasActiveForegroundAgents: hasActiveForegroundAgents(
      state.parallelAgentsRef.current as ParallelAgent[],
    ),
    hasRunningBlockingTool: state.hasRunningToolRef.current,
    hasPendingTaskContract: state.hasPendingTaskResultContract(),
  });

  if (!continuationSignal.shouldContinue) {
    state.handleStreamComplete();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createAgent(overrides: Partial<ParallelAgent> = {}): ParallelAgent {
  return {
    id: "agent-1",
    name: "codebase-locator",
    task: "Find files",
    status: "running",
    startedAt: new Date(Date.now() - 60_000).toISOString(),
    background: false,
    ...overrides,
  };
}

function createState(
  agents: ParallelAgent[],
  overrides: Partial<SessionIdleStaleAgentState> = {},
): SessionIdleStaleAgentState {
  return {
    isStreamingRef: { current: true },
    hasRunningToolRef: { current: false },
    lastTurnFinishReasonRef: { current: null },
    parallelAgentsRef: { current: agents },
    batchDispatcher: { flush: mock() },
    handleStreamComplete: mock(),
    hasPendingTaskResultContract: () => false,
    setParallelAgents: mock((updated: readonly ParallelAgent[]) => {}),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("stream.session.idle stale agent cleanup", () => {
  describe("foreground agent without stream.agent.complete", () => {
    test("fixed: cleans up stale running foreground agent, allowing stream completion", () => {
      const staleForegroundAgent = createAgent({ status: "running", background: false });
      const state = createState([staleForegroundAgent]);

      handleSessionIdleWithCleanup(state);

      expect(state.handleStreamComplete).toHaveBeenCalledTimes(1);
    });

    test("broken: stale running foreground agent blocks stream completion indefinitely", () => {
      const staleForegroundAgent = createAgent({ status: "running", background: false });
      const state = createState([staleForegroundAgent]);

      handleSessionIdleWithoutCleanup(state);

      expect(state.handleStreamComplete).toHaveBeenCalledTimes(0);
    });
  });

  describe("agent state transitions", () => {
    test("transitions stale running agents to completed", () => {
      const agent = createAgent({ status: "running" });
      const state = createState([agent]);

      handleSessionIdleWithCleanup(state);

      const cleaned = state.parallelAgentsRef.current;
      expect(cleaned).toHaveLength(1);
      expect(cleaned[0]!.status).toBe("completed");
    });

    test("transitions stale pending agents to completed", () => {
      const agent = createAgent({ status: "pending" });
      const state = createState([agent]);

      handleSessionIdleWithCleanup(state);

      const cleaned = state.parallelAgentsRef.current;
      expect(cleaned[0]!.status).toBe("completed");
    });

    test("transitions stale background-status agents to completed", () => {
      const agent = createAgent({ status: "background", background: true });
      const state = createState([agent]);

      handleSessionIdleWithCleanup(state);

      const cleaned = state.parallelAgentsRef.current;
      expect(cleaned[0]!.status).toBe("completed");
    });

    test("clears currentTool on transitioned agents", () => {
      const agent = createAgent({ status: "running", currentTool: "bash" });
      const state = createState([agent]);

      handleSessionIdleWithCleanup(state);

      const cleaned = state.parallelAgentsRef.current;
      expect(cleaned[0]!.currentTool).toBeUndefined();
    });

    test("computes durationMs for transitioned agents", () => {
      const agent = createAgent({
        status: "running",
        startedAt: new Date(Date.now() - 5000).toISOString(),
      });
      const state = createState([agent]);

      handleSessionIdleWithCleanup(state);

      const cleaned = state.parallelAgentsRef.current;
      expect(cleaned[0]!.durationMs).toBeGreaterThanOrEqual(4900);
      expect(cleaned[0]!.durationMs).toBeLessThan(10000);
    });

    test("preserves already-terminal agents unchanged", () => {
      const completedAgent = createAgent({ id: "done", status: "completed", background: false });
      const errorAgent = createAgent({ id: "err", status: "error", background: false });
      const staleAgent = createAgent({ id: "stale", status: "running", background: false });
      const state = createState([completedAgent, errorAgent, staleAgent]);

      handleSessionIdleWithCleanup(state);

      const cleaned = state.parallelAgentsRef.current;
      expect(cleaned).toHaveLength(3);
      expect(cleaned[0]!.status).toBe("completed");
      expect(cleaned[1]!.status).toBe("error");
      expect(cleaned[2]!.status).toBe("completed");
    });

    test("calls setParallelAgents with cleaned agents", () => {
      const agent = createAgent({ status: "running" });
      const state = createState([agent]);

      handleSessionIdleWithCleanup(state);

      expect(state.setParallelAgents).toHaveBeenCalledTimes(1);
      const setCall = (state.setParallelAgents as ReturnType<typeof mock>).mock.calls[0]!;
      expect(setCall[0][0].status).toBe("completed");
    });
  });

  describe("no-op cases", () => {
    test("does nothing when not streaming", () => {
      const agent = createAgent({ status: "running" });
      const state = createState([agent], {
        isStreamingRef: { current: false },
      });

      handleSessionIdleWithCleanup(state);

      expect(state.handleStreamComplete).toHaveBeenCalledTimes(0);
      expect(state.setParallelAgents).toHaveBeenCalledTimes(0);
    });

    test("skips cleanup when no stale agents exist", () => {
      const agent = createAgent({ status: "completed" });
      const state = createState([agent]);

      handleSessionIdleWithCleanup(state);

      expect(state.setParallelAgents).toHaveBeenCalledTimes(0);
      expect(state.handleStreamComplete).toHaveBeenCalledTimes(1);
    });

    test("skips cleanup when agents list is empty", () => {
      const state = createState([]);

      handleSessionIdleWithCleanup(state);

      expect(state.setParallelAgents).toHaveBeenCalledTimes(0);
      expect(state.handleStreamComplete).toHaveBeenCalledTimes(1);
    });
  });

  describe("mixed agent scenarios", () => {
    test("cleans up multiple stale agents of different types", () => {
      const agents = [
        createAgent({ id: "fg-1", status: "running", background: false }),
        createAgent({ id: "bg-1", status: "background", background: true }),
        createAgent({ id: "fg-2", status: "pending", background: false }),
      ];
      const state = createState(agents);

      handleSessionIdleWithCleanup(state);

      const cleaned = state.parallelAgentsRef.current;
      expect(cleaned).toHaveLength(3);
      expect(cleaned.every((a) => a.status === "completed")).toBe(true);
      expect(state.handleStreamComplete).toHaveBeenCalledTimes(1);
    });

    test("handles mix of stale and terminal agents correctly", () => {
      const agents = [
        createAgent({ id: "done-1", status: "completed", background: false }),
        createAgent({ id: "stale-1", status: "running", background: false }),
        createAgent({ id: "err-1", status: "error", background: false }),
        createAgent({ id: "stale-2", status: "pending", background: false }),
      ];
      const state = createState(agents);

      handleSessionIdleWithCleanup(state);

      const cleaned = state.parallelAgentsRef.current;
      expect(cleaned[0]!.status).toBe("completed");
      expect(cleaned[1]!.status).toBe("completed");
      expect(cleaned[2]!.status).toBe("error");
      expect(cleaned[3]!.status).toBe("completed");
      expect(state.handleStreamComplete).toHaveBeenCalledTimes(1);
    });
  });
});
