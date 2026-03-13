import { describe, expect, test, mock } from "bun:test";
import type { ParallelAgent } from "@/components/parallel-agents-tree.tsx";
import {
  getActiveBackgroundAgents,
  isActiveBackgroundStatus,
  isBackgroundAgent,
} from "@/lib/ui/background-agent-footer.ts";

// ---------------------------------------------------------------------------
// Extracted handler logic mirroring the real stream.agent.start handler's
// activeBackgroundAgentCount sync (use-agent-subscriptions.ts lines 201-209)
// ---------------------------------------------------------------------------

interface AgentStartSyncState {
  parallelAgentsRef: { current: readonly ParallelAgent[] };
  activeBackgroundAgentCountRef: { current: number };
  setActiveBackgroundAgentCount: (count: number) => void;
  setParallelAgents: (updater: (current: readonly ParallelAgent[]) => readonly ParallelAgent[]) => void;
}

/**
 * Mirrors the setParallelAgents updater + count sync from stream.agent.start.
 * Simplified to focus on the count-sync logic under test.
 */
function applyAgentStartWithCountSync(
  state: AgentStartSyncState,
  incoming: { agentId: string; agentType: string; task: string; isBackground: boolean },
): void {
  const startedAt = new Date().toISOString();
  const status: ParallelAgent["status"] = incoming.isBackground ? "background" : "running";

  state.setParallelAgents((current) => {
    const updated: readonly ParallelAgent[] = [
      ...current,
      {
        id: incoming.agentId,
        name: incoming.agentType,
        task: incoming.task,
        status,
        startedAt,
        background: incoming.isBackground,
        currentTool: undefined,
      },
    ];

    state.parallelAgentsRef.current = updated;

    if (incoming.isBackground) {
      const newActiveCount = getActiveBackgroundAgents(updated).length;
      if (state.activeBackgroundAgentCountRef.current !== newActiveCount) {
        state.activeBackgroundAgentCountRef.current = newActiveCount;
        state.setActiveBackgroundAgentCount(newActiveCount);
      }
    }

    return updated;
  });
}

// ---------------------------------------------------------------------------
// Extracted handler logic mirroring the real stream.session.partial-idle
// handler's parallelAgents sync (use-session-subscriptions.ts lines 321-347)
// ---------------------------------------------------------------------------

interface PartialIdleSyncState {
  parallelAgentsRef: { current: readonly ParallelAgent[] };
  activeBackgroundAgentCountRef: { current: number };
  setActiveBackgroundAgentCount: (count: number) => void;
  setParallelAgents: (agents: readonly ParallelAgent[]) => void;
}

function applyPartialIdleSync(
  state: PartialIdleSyncState,
  providerActiveCount: number,
): void {
  const count = typeof providerActiveCount === "number" ? providerActiveCount : 0;
  state.activeBackgroundAgentCountRef.current = count;
  state.setActiveBackgroundAgentCount(count);

  const currentAgents = state.parallelAgentsRef.current;
  const localActiveBackground = getActiveBackgroundAgents(currentAgents);
  if (localActiveBackground.length > count) {
    let excess = localActiveBackground.length - count;
    const now = Date.now();
    const updatedAgents = currentAgents.map((agent) => {
      if (excess > 0 && isBackgroundAgent(agent) && isActiveBackgroundStatus(agent.status)) {
        excess--;
        const startedAtMs = new Date(agent.startedAt).getTime();
        return {
          ...agent,
          status: "completed" as const,
          currentTool: undefined,
          durationMs: Number.isFinite(startedAtMs)
            ? Math.max(0, now - startedAtMs)
            : agent.durationMs,
        };
      }
      return agent;
    });
    state.parallelAgentsRef.current = updatedAgents;
    state.setParallelAgents(updatedAgents);
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

function createAgentStartState(
  agents: readonly ParallelAgent[],
  initialCount = 0,
): AgentStartSyncState {
  const setParallelAgentsMock = mock((updater: (current: readonly ParallelAgent[]) => readonly ParallelAgent[]) => {
    // Execute the updater to trigger the count sync side-effect
    updater(state.parallelAgentsRef.current);
  });
  const state: AgentStartSyncState = {
    parallelAgentsRef: { current: agents },
    activeBackgroundAgentCountRef: { current: initialCount },
    setActiveBackgroundAgentCount: mock(),
    setParallelAgents: setParallelAgentsMock,
  };
  return state;
}

function createPartialIdleState(
  agents: readonly ParallelAgent[],
  initialCount = 0,
): PartialIdleSyncState {
  return {
    parallelAgentsRef: { current: agents },
    activeBackgroundAgentCountRef: { current: initialCount },
    setActiveBackgroundAgentCount: mock(),
    setParallelAgents: mock(),
  };
}

// ---------------------------------------------------------------------------
// Tests: activeBackgroundAgentCount sync on stream.agent.start
// ---------------------------------------------------------------------------

describe("stream.agent.start: activeBackgroundAgentCount sync", () => {
  test("increments count when a background agent starts from zero", () => {
    const state = createAgentStartState([], 0);

    applyAgentStartWithCountSync(state, {
      agentId: "bg-1",
      agentType: "explore",
      task: "Research docs",
      isBackground: true,
    });

    expect(state.activeBackgroundAgentCountRef.current).toBe(1);
    expect(state.setActiveBackgroundAgentCount).toHaveBeenCalledWith(1);
  });

  test("increments count when second background agent starts", () => {
    const existingBg = createAgent({
      id: "bg-existing",
      status: "background",
      background: true,
    });
    const state = createAgentStartState([existingBg], 1);

    applyAgentStartWithCountSync(state, {
      agentId: "bg-2",
      agentType: "task",
      task: "Run tests",
      isBackground: true,
    });

    expect(state.activeBackgroundAgentCountRef.current).toBe(2);
    expect(state.setActiveBackgroundAgentCount).toHaveBeenCalledWith(2);
  });

  test("does not call setActiveBackgroundAgentCount for foreground agents", () => {
    const state = createAgentStartState([], 0);

    applyAgentStartWithCountSync(state, {
      agentId: "fg-1",
      agentType: "explore",
      task: "Quick lookup",
      isBackground: false,
    });

    expect(state.activeBackgroundAgentCountRef.current).toBe(0);
    expect(state.setActiveBackgroundAgentCount).not.toHaveBeenCalled();
  });

  test("does not call setter when count already matches", () => {
    // Pre-seed the ref to 1 which is what the count will be after adding
    const state = createAgentStartState([], 1);

    applyAgentStartWithCountSync(state, {
      agentId: "bg-1",
      agentType: "explore",
      task: "Research",
      isBackground: true,
    });

    // Count is already 1, new count is also 1, so setter should not be called
    expect(state.setActiveBackgroundAgentCount).not.toHaveBeenCalled();
  });

  test("ignores completed background agents when computing count", () => {
    const completedBg = createAgent({
      id: "bg-done",
      status: "completed",
      background: true,
    });
    const state = createAgentStartState([completedBg], 0);

    applyAgentStartWithCountSync(state, {
      agentId: "bg-new",
      agentType: "explore",
      task: "New research",
      isBackground: true,
    });

    // Only the new agent is active; the completed one is excluded
    expect(state.activeBackgroundAgentCountRef.current).toBe(1);
    expect(state.setActiveBackgroundAgentCount).toHaveBeenCalledWith(1);
  });
});

// ---------------------------------------------------------------------------
// Tests: parallelAgents sync on stream.session.partial-idle
// ---------------------------------------------------------------------------

describe("stream.session.partial-idle: parallelAgents sync", () => {
  test("marks excess background agents as completed when provider count < local count", () => {
    const agents = [
      createAgent({ id: "bg-1", status: "background", background: true }),
      createAgent({ id: "bg-2", status: "background", background: true }),
    ];
    const state = createPartialIdleState(agents, 2);

    applyPartialIdleSync(state, 0);

    const updated = state.parallelAgentsRef.current;
    expect(updated).toHaveLength(2);
    expect(updated[0]!.status).toBe("completed");
    expect(updated[1]!.status).toBe("completed");
    expect(state.setParallelAgents).toHaveBeenCalledTimes(1);
  });

  test("marks only excess agents, preserving agents matching provider count", () => {
    const agents = [
      createAgent({ id: "bg-1", status: "background", background: true }),
      createAgent({ id: "bg-2", status: "running", background: true }),
      createAgent({ id: "bg-3", status: "background", background: true }),
    ];
    const state = createPartialIdleState(agents, 1);

    applyPartialIdleSync(state, 1);

    const updated = state.parallelAgentsRef.current;
    const activeAfter = getActiveBackgroundAgents(updated);
    // Provider says 1 active, so 2 should be marked completed, 1 remains
    expect(activeAfter).toHaveLength(1);
    expect(updated.filter((a) => a.status === "completed")).toHaveLength(2);
  });

  test("does not modify parallelAgents when counts match", () => {
    const agents = [
      createAgent({ id: "bg-1", status: "background", background: true }),
    ];
    const state = createPartialIdleState(agents, 1);

    applyPartialIdleSync(state, 1);

    expect(state.setParallelAgents).not.toHaveBeenCalled();
    expect(state.parallelAgentsRef.current[0]!.status).toBe("background");
  });

  test("does not modify foreground agents", () => {
    const agents = [
      createAgent({ id: "fg-1", status: "running", background: false }),
      createAgent({ id: "bg-1", status: "background", background: true }),
    ];
    const state = createPartialIdleState(agents, 1);

    applyPartialIdleSync(state, 0);

    const updated = state.parallelAgentsRef.current;
    // Foreground agent should remain running
    expect(updated.find((a) => a.id === "fg-1")!.status).toBe("running");
    // Background agent should be completed
    expect(updated.find((a) => a.id === "bg-1")!.status).toBe("completed");
  });

  test("preserves already-completed background agents", () => {
    const agents = [
      createAgent({ id: "bg-done", status: "completed", background: true }),
      createAgent({ id: "bg-active", status: "background", background: true }),
    ];
    const state = createPartialIdleState(agents, 1);

    applyPartialIdleSync(state, 0);

    const updated = state.parallelAgentsRef.current;
    // Both should be completed now
    expect(updated.every((a) => a.status === "completed")).toBe(true);
    expect(state.setParallelAgents).toHaveBeenCalledTimes(1);
  });

  test("clears currentTool on completed agents", () => {
    const agents = [
      createAgent({
        id: "bg-1",
        status: "running",
        background: true,
        currentTool: "file_search",
      }),
    ];
    const state = createPartialIdleState(agents, 1);

    applyPartialIdleSync(state, 0);

    const updated = state.parallelAgentsRef.current;
    expect(updated[0]!.currentTool).toBeUndefined();
  });

  test("computes durationMs for completed agents from startedAt", () => {
    const fiveSecondsAgo = new Date(Date.now() - 5_000).toISOString();
    const agents = [
      createAgent({
        id: "bg-1",
        status: "background",
        background: true,
        startedAt: fiveSecondsAgo,
      }),
    ];
    const state = createPartialIdleState(agents, 1);

    applyPartialIdleSync(state, 0);

    const updated = state.parallelAgentsRef.current;
    // Duration should be approximately 5000ms (allow ±500ms for test execution time)
    expect(updated[0]!.durationMs).toBeGreaterThanOrEqual(4500);
    expect(updated[0]!.durationMs).toBeLessThanOrEqual(6000);
  });

  test("always syncs activeBackgroundAgentCount from provider", () => {
    const agents: ParallelAgent[] = [];
    const state = createPartialIdleState(agents, 5);

    applyPartialIdleSync(state, 2);

    expect(state.activeBackgroundAgentCountRef.current).toBe(2);
    expect(state.setActiveBackgroundAgentCount).toHaveBeenCalledWith(2);
  });
});

// ---------------------------------------------------------------------------
// Tests: full lifecycle integration (start → partial-idle → decrement)
// ---------------------------------------------------------------------------

describe("background agent count: full lifecycle", () => {
  test("count increments on start and decrements on partial-idle reporting 0", () => {
    // Phase 1: background agent starts
    const startState = createAgentStartState([], 0);
    applyAgentStartWithCountSync(startState, {
      agentId: "bg-lifecycle",
      agentType: "task",
      task: "Run build",
      isBackground: true,
    });
    expect(startState.activeBackgroundAgentCountRef.current).toBe(1);
    const agentsAfterStart = startState.parallelAgentsRef.current;
    expect(getActiveBackgroundAgents(agentsAfterStart)).toHaveLength(1);

    // Phase 2: partial-idle fires with provider reporting 0 active agents
    const idleState = createPartialIdleState(
      agentsAfterStart as ParallelAgent[],
      startState.activeBackgroundAgentCountRef.current,
    );
    applyPartialIdleSync(idleState, 0);

    expect(idleState.activeBackgroundAgentCountRef.current).toBe(0);
    expect(getActiveBackgroundAgents(idleState.parallelAgentsRef.current as ParallelAgent[])).toHaveLength(0);
    expect(idleState.parallelAgentsRef.current[0]!.status).toBe("completed");
  });
});
