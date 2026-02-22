import { describe, expect, test } from "bun:test";
import type { ParallelAgent } from "../components/parallel-agents-tree.tsx";
import {
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
      shouldWarn: false,
      shouldTerminate: false,
      nextPressCount: 0,
    });

    expect(getBackgroundTerminationDecision(0, 2)).toEqual({
      shouldWarn: true,
      shouldTerminate: false,
      nextPressCount: 1,
    });

    expect(getBackgroundTerminationDecision(1, 2)).toEqual({
      shouldWarn: false,
      shouldTerminate: true,
      nextPressCount: 0,
    });
  });

  test("resets stale press counters when no active background agents remain", () => {
    expect(getBackgroundTerminationDecision(5, 0)).toEqual({
      shouldWarn: false,
      shouldTerminate: false,
      nextPressCount: 0,
    });
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
});
