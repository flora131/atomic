import { describe, expect, test } from "bun:test";
import type { ParallelAgent } from "../components/parallel-agents-tree.tsx";
import {
  evaluateBackgroundTerminationPress,
  executeBackgroundTermination,
  getBackgroundTerminationDecision,
  interruptActiveBackgroundAgents,
  isBackgroundTerminationKey,
} from "./background-agent-termination.ts";

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

describe("background-agent termination keybinding", () => {
  test("detects Ctrl+F and ignores other modifiers", () => {
    expect(isBackgroundTerminationKey({ ctrl: true, name: "f" })).toBe(true);
    expect(isBackgroundTerminationKey({ ctrl: true, shift: true, name: "f" })).toBe(false);
    expect(isBackgroundTerminationKey({ ctrl: true, meta: true, name: "f" })).toBe(false);
    expect(isBackgroundTerminationKey({ ctrl: true, name: "c" })).toBe(false);
  });

  test("requires two presses only when active background agents exist", () => {
    expect(getBackgroundTerminationDecision(0, 0)).toEqual({
      action: "none",
    });

    expect(getBackgroundTerminationDecision(0, 2)).toEqual({
      action: "warn",
      message: "Press Ctrl-F again to terminate background agents",
    });

    expect(getBackgroundTerminationDecision(1, 2)).toEqual({
      action: "terminate",
      message: "All background agents killed",
    });
  });

  test("resets stale press counters when no active background agents remain", () => {
    expect(getBackgroundTerminationDecision(5, 0)).toEqual({
      action: "none",
    });
  });

  test("handles two rapid Ctrl+F presses without waiting for React state flush", () => {
    const pressCountRef = { current: 0 };

    const firstPress = evaluateBackgroundTerminationPress(pressCountRef, 2);
    expect(firstPress.decision.action).toBe("warn");
    expect(firstPress.pressCount).toBe(0);
    expect(firstPress.nextPressCount).toBe(1);

    // Simulate a second key event in the same input frame.
    // The synchronous ref mutation should make this a terminate action.
    const secondPress = evaluateBackgroundTerminationPress(pressCountRef, 2);
    expect(secondPress.decision.action).toBe("terminate");
    expect(secondPress.pressCount).toBe(1);
    expect(secondPress.nextPressCount).toBe(0);
    expect(pressCountRef.current).toBe(0);
  });
});

describe("background-agent termination flow", () => {
  test("interrupts only active background agents and returns interrupted IDs", () => {
    const now = Date.now();
    const agents: ParallelAgent[] = [
      createAgent({
        id: "bg-active",
        status: "background",
        background: true,
        startedAt: new Date(now - 2000).toISOString(),
        currentTool: "Running in background...",
      }),
      createAgent({
        id: "bg-completed",
        status: "completed",
        background: true,
        startedAt: new Date(now - 4000).toISOString(),
      }),
      createAgent({
        id: "fg-running",
        status: "running",
        background: false,
        currentTool: "Running foreground task",
      }),
    ];

    const result = interruptActiveBackgroundAgents(agents, now);
    expect(result.interruptedIds).toEqual(["bg-active"]);

    const interrupted = result.agents.find((agent) => agent.id === "bg-active");
    expect(interrupted?.status).toBe("interrupted");
    expect(interrupted?.currentTool).toBeUndefined();
    expect(interrupted?.durationMs).toBeGreaterThanOrEqual(2000);

    const completedBackground = result.agents.find((agent) => agent.id === "bg-completed");
    expect(completedBackground?.status).toBe("completed");

    const foreground = result.agents.find((agent) => agent.id === "fg-running");
    expect(foreground?.status).toBe("running");
    expect(foreground?.currentTool).toBe("Running foreground task");
  });

  test("interrupts pending/running background agents in one confirmation pass", () => {
    const agents: ParallelAgent[] = [
      createAgent({ id: "pending", status: "pending", background: true }),
      createAgent({ id: "running", status: "running", background: true }),
      createAgent({ id: "done", status: "completed", background: true }),
    ];

    const result = interruptActiveBackgroundAgents(agents);
    expect(result.interruptedIds).toEqual(["pending", "running"]);
    expect(result.agents.find((agent) => agent.id === "pending")?.status).toBe("interrupted");
    expect(result.agents.find((agent) => agent.id === "running")?.status).toBe("interrupted");
    expect(result.agents.find((agent) => agent.id === "done")?.status).toBe("completed");
  });

  test("preserves prior duration when startedAt is invalid", () => {
    const agents: ParallelAgent[] = [
      createAgent({
        id: "invalid-start",
        status: "background",
        background: true,
        startedAt: "not-a-date",
        durationMs: 777,
      }),
    ];

    const result = interruptActiveBackgroundAgents(agents, Date.now());
    const interrupted = result.agents[0];
    expect(interrupted?.status).toBe("interrupted");
    expect(interrupted?.durationMs).toBe(777);
  });

  test("is a safe no-op when no active background agents exist", () => {
    const agents: ParallelAgent[] = [
      createAgent({ id: "fg", status: "running", background: false }),
      createAgent({ id: "done", status: "completed", background: true }),
    ];

    const result = interruptActiveBackgroundAgents(agents);
    expect(result.interruptedIds).toEqual([]);
    expect(result.agents).toEqual(agents);
  });

  test("waits for parent abort callback before applying local interruption", async () => {
    const agents: ParallelAgent[] = [
      createAgent({ id: "bg-active", status: "background", background: true }),
      createAgent({ id: "fg-running", status: "running", background: false }),
    ];
    const callbackOrder: string[] = [];

    const result = await executeBackgroundTermination({
      getAgents: () => agents,
      onTerminateBackgroundAgents: async () => {
        callbackOrder.push("callback");
      },
    });

    callbackOrder.push("after");
    expect(callbackOrder).toEqual(["callback", "after"]);
    expect(result.status).toBe("terminated");
    expect(result.interruptedIds).toEqual(["bg-active"]);
    expect(result.agents.find((agent) => agent.id === "bg-active")?.status).toBe("interrupted");
    expect(result.agents.find((agent) => agent.id === "fg-running")?.status).toBe("running");
  });

  test("returns failed result and preserves live agents when abort callback rejects", async () => {
    const agents: ParallelAgent[] = [
      createAgent({ id: "bg-active", status: "background", background: true }),
    ];

    const result = await executeBackgroundTermination({
      getAgents: () => agents,
      onTerminateBackgroundAgents: async () => {
        throw new Error("abort failed");
      },
    });

    expect(result.status).toBe("failed");
    expect(result.interruptedIds).toEqual([]);
    expect(result.agents).toEqual(agents);
    if (result.status === "failed") {
      expect(result.error).toBeInstanceOf(Error);
      expect((result.error as Error).message).toBe("abort failed");
    }
  });

  test("does not invoke parent callback when no active background agents exist", async () => {
    const callbackInvoked = { current: false };
    const agents: ParallelAgent[] = [
      createAgent({ id: "done", status: "completed", background: true }),
      createAgent({ id: "fg", status: "running", background: false }),
    ];

    const result = await executeBackgroundTermination({
      getAgents: () => agents,
      onTerminateBackgroundAgents: async () => {
        callbackInvoked.current = true;
      },
    });

    expect(result.status).toBe("noop");
    expect(result.interruptedIds).toEqual([]);
    expect(callbackInvoked.current).toBe(false);
  });

  test("re-evaluates live agents after callback to avoid stale snapshots", async () => {
    const activeAgents: ParallelAgent[] = [
      createAgent({ id: "bg-active", status: "background", background: true }),
    ];
    const completedAgents: ParallelAgent[] = [
      createAgent({ id: "bg-active", status: "completed", background: true }),
    ];
    let snapshot = activeAgents;

    const result = await executeBackgroundTermination({
      getAgents: () => snapshot,
      onTerminateBackgroundAgents: async () => {
        snapshot = completedAgents;
      },
    });

    expect(result.status).toBe("terminated");
    expect(result.interruptedIds).toEqual([]);
    expect(result.agents).toEqual(completedAgents);
  });
});
