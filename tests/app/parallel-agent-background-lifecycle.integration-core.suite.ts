import { describe, expect, test } from "bun:test";
import {
  applyStreamFinalizationTransform,
  applySubagentCompleteTransform,
  applyToolCompleteTransform,
  createAgent,
  hasActiveAgents,
  type ParallelAgent,
} from "./parallel-agent-background-lifecycle.test-support.ts";

describe("Background agent lifecycle integration", () => {
  test("full background lifecycle: spawn → grey → tool.complete stays grey → subagent.complete → green", () => {
    let agent = createAgent(true, "task", "Full lifecycle test", "tool_full");
    agent = { ...agent, startedAt: new Date(Date.now() - 1000).toISOString() };
    expect(agent.status).toBe("background");
    expect(agent.background).toBe(true);
    expect(agent.currentTool).toBe("Running task in background…");

    agent = applyToolCompleteTransform(agent, "Tool result");
    expect(agent.status).toBe("background");
    expect(agent.currentTool).toBe("Running task in background…");
    expect(agent.durationMs).toBeUndefined();
    expect(agent.result).toBe("Tool result");

    agent = applySubagentCompleteTransform(agent, "tool_full", true);
    expect(agent.status).toBe("completed");
    expect(agent.currentTool).toBeUndefined();
    expect(agent.durationMs).toBeGreaterThan(0);
  });

  test("mixed sync+background agents finalize correctly", () => {
    const syncAgent: ParallelAgent = {
      id: "sync_1",
      taskToolCallId: "sync_1",
      name: "task",
      task: "Sync agent",
      status: "running",
      startedAt: new Date(Date.now() - 2000).toISOString(),
      currentTool: "Starting task…",
    };
    const backgroundAgent: ParallelAgent = {
      id: "bg_1",
      taskToolCallId: "bg_1",
      name: "task",
      task: "Background agent",
      status: "background",
      background: true,
      startedAt: new Date(Date.now() - 2000).toISOString(),
      currentTool: "Running task in background…",
    };

    const syncTransformed = applyToolCompleteTransform(syncAgent, "Sync result");
    const bgTransformed = applyToolCompleteTransform(backgroundAgent, "BG result");

    expect(syncTransformed.status).toBe("completed");
    expect(syncTransformed.currentTool).toBeUndefined();
    expect(syncTransformed.durationMs).toBeGreaterThan(0);

    expect(bgTransformed.status).toBe("background");
    expect(bgTransformed.currentTool).toBe("Running task in background…");
    expect(bgTransformed.durationMs).toBeUndefined();
  });

  test("stream finalization hasActive check includes background agents", () => {
    const agents: ParallelAgent[] = [
      {
        id: "completed_1",
        taskToolCallId: "completed_1",
        name: "task",
        task: "Completed task",
        status: "completed",
        startedAt: new Date().toISOString(),
        durationMs: 1000,
      },
      {
        id: "bg_running",
        taskToolCallId: "bg_running",
        name: "task",
        task: "Background task still running",
        status: "background",
        background: true,
        startedAt: new Date().toISOString(),
        currentTool: "Running task in background…",
      },
    ];

    expect(hasActiveAgents(agents)).toBe(true);
    expect(hasActiveAgents(agents.filter((agent) => agent.status === "completed"))).toBe(false);
  });

  test("stream finalization map skips background agents", () => {
    const agents: ParallelAgent[] = [
      {
        id: "running_1",
        taskToolCallId: "running_1",
        name: "task",
        task: "Running sync task",
        status: "running",
        startedAt: new Date(Date.now() - 3000).toISOString(),
        currentTool: "Starting task…",
      },
      {
        id: "bg_1",
        taskToolCallId: "bg_1",
        name: "task",
        task: "Background task",
        status: "background",
        background: true,
        startedAt: new Date(Date.now() - 3000).toISOString(),
        currentTool: "Running task in background…",
      },
      {
        id: "completed_1",
        taskToolCallId: "completed_1",
        name: "task",
        task: "Already completed task",
        status: "completed",
        startedAt: new Date(Date.now() - 5000).toISOString(),
        durationMs: 2000,
      },
    ];

    const finalized = agents.map(applyStreamFinalizationTransform);

    expect(finalized[0]!.status).toBe("completed");
    expect(finalized[0]!.currentTool).toBeUndefined();
    expect(finalized[0]!.durationMs).toBeGreaterThan(2900);
    expect(finalized[1]!.status).toBe("background");
    expect(finalized[1]!.currentTool).toBe("Running task in background…");
    expect(finalized[1]!.durationMs).toBeUndefined();
    expect(finalized[2]!.status).toBe("completed");
    expect(finalized[2]!.durationMs).toBe(2000);
  });

  test("hasActiveAgents returns true for running agents", () => {
    expect(
      hasActiveAgents([
        {
          id: "running_1",
          taskToolCallId: "running_1",
          name: "task",
          task: "Running task",
          status: "running",
          startedAt: new Date().toISOString(),
        },
      ]),
    ).toBe(true);
  });

  test("hasActiveAgents returns true for pending agents", () => {
    expect(
      hasActiveAgents([
        {
          id: "pending_1",
          taskToolCallId: "pending_1",
          name: "task",
          task: "Pending task",
          status: "pending",
          startedAt: new Date().toISOString(),
        },
      ]),
    ).toBe(true);
  });

  test("hasActiveAgents returns false for completed/error/interrupted agents only", () => {
    expect(
      hasActiveAgents([
        {
          id: "completed_1",
          taskToolCallId: "completed_1",
          name: "task",
          task: "Completed task",
          status: "completed",
          startedAt: new Date().toISOString(),
          durationMs: 1000,
        },
        {
          id: "error_1",
          taskToolCallId: "error_1",
          name: "task",
          task: "Error task",
          status: "error",
          startedAt: new Date().toISOString(),
          durationMs: 500,
          error: "Task failed",
        },
        {
          id: "interrupted_1",
          taskToolCallId: "interrupted_1",
          name: "task",
          task: "Interrupted task",
          status: "interrupted",
          startedAt: new Date().toISOString(),
        },
      ]),
    ).toBe(false);
  });

  test("hasActiveAgents returns false for empty array", () => {
    expect(hasActiveAgents([])).toBe(false);
  });
});
