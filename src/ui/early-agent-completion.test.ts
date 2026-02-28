/**
 * Tests for early agent completion detection in stream.agent.complete handler
 *
 * Validates the eager deferred-completion resolution that fires inside the
 * setParallelAgents updater when the last foreground agent completes.
 * This avoids the slower React re-render → useEffect round-trip.
 *
 * The pattern under test (chat.tsx):
 *   setParallelAgents((current) => {
 *     const updated = current.map(…); // mark completing agent
 *     if (pendingComplete && shouldFinalizeDeferredStream(updated, hasRunningTool)) {
 *       queueMicrotask(() => pendingComplete());
 *     }
 *     return updated;
 *   });
 */

import { describe, expect, test } from "bun:test";
import type { ParallelAgent } from "./components/parallel-agents-tree.tsx";
import {
  hasActiveForegroundAgents,
  shouldFinalizeDeferredStream,
} from "./parts/guards.ts";

// ---------------------------------------------------------------------------
// Helpers — mirror the agent-update logic from the stream.agent.complete handler
// ---------------------------------------------------------------------------

function createAgent(overrides: Partial<ParallelAgent>): ParallelAgent {
  return {
    id: "agent-1",
    name: "Test Agent",
    task: "Test task",
    status: "running",
    startedAt: new Date(Date.now() - 2000).toISOString(),
    background: false,
    ...overrides,
  };
}

/** Mirrors the map() inside setParallelAgents for stream.agent.complete */
function applyAgentComplete(
  agents: ParallelAgent[],
  agentId: string,
  success: boolean,
): ParallelAgent[] {
  return agents.map((agent) => {
    if (agent.id !== agentId) return agent;
    const startedAtMs = new Date(agent.startedAt).getTime();
    return {
      ...agent,
      status: success ? ("completed" as const) : ("error" as const),
      currentTool: undefined,
      durationMs: Number.isFinite(startedAtMs)
        ? Math.max(0, Date.now() - startedAtMs)
        : agent.durationMs,
    };
  });
}

/**
 * Simulates the early completion check inside the setParallelAgents updater.
 * Returns true when deferred completion should be eagerly resolved.
 */
function shouldEagerlyResolve(
  agents: ParallelAgent[],
  completingAgentId: string,
  success: boolean,
  hasPendingComplete: boolean,
  hasRunningTool: boolean,
): boolean {
  const updated = applyAgentComplete(agents, completingAgentId, success);
  return hasPendingComplete && shouldFinalizeDeferredStream(updated, hasRunningTool);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Early agent completion detection", () => {
  test("eagerly resolves when last foreground agent completes successfully", () => {
    const agents = [createAgent({ id: "a1", status: "running" })];
    expect(shouldEagerlyResolve(agents, "a1", true, true, false)).toBe(true);
  });

  test("eagerly resolves when last foreground agent errors", () => {
    const agents = [createAgent({ id: "a1", status: "running" })];
    expect(shouldEagerlyResolve(agents, "a1", false, true, false)).toBe(true);
  });

  test("does NOT resolve when another foreground agent is still running", () => {
    const agents = [
      createAgent({ id: "a1", status: "running" }),
      createAgent({ id: "a2", status: "running" }),
    ];
    // Only a1 completes — a2 is still running
    expect(shouldEagerlyResolve(agents, "a1", true, true, false)).toBe(false);
  });

  test("does NOT resolve when another foreground agent is pending", () => {
    const agents = [
      createAgent({ id: "a1", status: "running" }),
      createAgent({ id: "a2", status: "pending" }),
    ];
    expect(shouldEagerlyResolve(agents, "a1", true, true, false)).toBe(false);
  });

  test("does NOT resolve when there is no pending completion", () => {
    const agents = [createAgent({ id: "a1", status: "running" })];
    expect(shouldEagerlyResolve(agents, "a1", true, false, false)).toBe(false);
  });

  test("does NOT resolve when tools are still running", () => {
    const agents = [createAgent({ id: "a1", status: "running" })];
    expect(shouldEagerlyResolve(agents, "a1", true, true, true)).toBe(false);
  });

  test("resolves when only background agents remain after last foreground completes", () => {
    const agents = [
      createAgent({ id: "fg1", status: "running", background: false }),
      createAgent({ id: "bg1", status: "background", background: true }),
    ];
    expect(shouldEagerlyResolve(agents, "fg1", true, true, false)).toBe(true);
  });

  test("resolves when all other foreground agents are already terminal", () => {
    const agents = [
      createAgent({ id: "a1", status: "running" }),
      createAgent({ id: "a2", status: "completed" }),
      createAgent({ id: "a3", status: "error" }),
    ];
    expect(shouldEagerlyResolve(agents, "a1", true, true, false)).toBe(true);
  });

  test("resolves for mixed terminal + background agents", () => {
    const agents = [
      createAgent({ id: "fg1", status: "running", background: false }),
      createAgent({ id: "fg2", status: "completed", background: false }),
      createAgent({ id: "bg1", status: "background", background: true }),
      createAgent({ id: "bg2", status: "running", background: true }),
    ];
    expect(shouldEagerlyResolve(agents, "fg1", true, true, false)).toBe(true);
  });

  test("does NOT resolve for non-existent agent id (no-op update)", () => {
    const agents = [createAgent({ id: "a1", status: "running" })];
    // "a2" doesn't exist — a1 stays running
    expect(shouldEagerlyResolve(agents, "a2", true, true, false)).toBe(false);
  });

  test("resolves with empty agent list when pending completion exists", () => {
    // Edge case: no agents at all, pending completion should resolve
    expect(shouldEagerlyResolve([], "a1", true, true, false)).toBe(true);
  });
});

describe("hasActiveForegroundAgents after agent completion update", () => {
  test("returns false after sole foreground agent is marked completed", () => {
    const agents = [createAgent({ id: "a1", status: "running" })];
    const updated = applyAgentComplete(agents, "a1", true);
    expect(hasActiveForegroundAgents(updated)).toBe(false);
  });

  test("returns true when one of two foreground agents completes", () => {
    const agents = [
      createAgent({ id: "a1", status: "running" }),
      createAgent({ id: "a2", status: "running" }),
    ];
    const updated = applyAgentComplete(agents, "a1", true);
    expect(hasActiveForegroundAgents(updated)).toBe(true);
  });

  test("returns false when background agents are the only remaining active ones", () => {
    const agents = [
      createAgent({ id: "fg1", status: "running", background: false }),
      createAgent({ id: "bg1", status: "background", background: true }),
    ];
    const updated = applyAgentComplete(agents, "fg1", true);
    expect(hasActiveForegroundAgents(updated)).toBe(false);
  });

  test("error status is treated as terminal", () => {
    const agents = [createAgent({ id: "a1", status: "running" })];
    const updated = applyAgentComplete(agents, "a1", false);
    expect(updated[0]!.status).toBe("error");
    expect(hasActiveForegroundAgents(updated)).toBe(false);
  });
});
