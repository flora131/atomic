import { describe, expect, test } from "bun:test";
import {
  applyInterruptTransform,
  applySubagentCompleteTransform,
  applyToolCompleteTransform,
  createAgent,
  type ParallelAgent,
} from "./parallel-agent-background-lifecycle.test-support.ts";

describe("Background agent state transitions", () => {
  test("creates background agent with correct status and flag for run_in_background=true", () => {
    const agent = createAgent(true, "task", "Test task", "tool_1");

    expect(agent.status).toBe("background");
    expect(agent.background).toBe(true);
    expect(agent.currentTool).toBe("Running task in background…");
    expect(agent.durationMs).toBeUndefined();
  });

  test("creates sync agent with status=running and no background flag for run_in_background=false", () => {
    const syncAgent = createAgent(false, "task", "Sync task", "tool_3");

    expect(syncAgent.status).toBe("running");
    expect(syncAgent.background).toBeUndefined();
    expect(syncAgent.currentTool).toBe("Starting task…");
  });

  test("tool.complete skips finalization for background agents", () => {
    const backgroundAgent: ParallelAgent = {
      id: "agent_1",
      taskToolCallId: "tool_1",
      name: "task",
      task: "Background task",
      status: "background",
      background: true,
      startedAt: new Date(Date.now() - 5000).toISOString(),
      currentTool: "Running task in background…",
    };

    const transformed = applyToolCompleteTransform(backgroundAgent, "Task result text");

    expect(transformed.status).toBe("background");
    expect(transformed.currentTool).toBe("Running task in background…");
    expect(transformed.durationMs).toBeUndefined();
    expect(transformed.result).toBe("Task result text");
  });

  test("tool.complete transitions sync agents to completed", () => {
    const runningAgent: ParallelAgent = {
      id: "agent_2",
      taskToolCallId: "tool_2",
      name: "task",
      task: "Sync task",
      status: "running",
      startedAt: new Date(Date.now() - 3000).toISOString(),
      currentTool: "Starting task…",
    };

    const transformed = applyToolCompleteTransform(runningAgent, "Sync result text");

    expect(transformed.status).toBe("completed");
    expect(transformed.currentTool).toBeUndefined();
    expect(transformed.durationMs).toBeGreaterThan(2900);
    expect(transformed.durationMs).toBeLessThan(4000);
    expect(transformed.result).toBe("Sync result text");
  });

  test("subagent.complete transitions background agent to completed", () => {
    const backgroundAgent: ParallelAgent = {
      id: "agent_bg_1",
      taskToolCallId: "tool_bg_1",
      name: "task",
      task: "Background task",
      status: "background",
      background: true,
      startedAt: new Date(Date.now() - 10000).toISOString(),
      currentTool: "Running task in background…",
    };

    const transformed = applySubagentCompleteTransform(
      backgroundAgent,
      "agent_bg_1",
      true,
      "Background task completed",
    );

    expect(transformed.status).toBe("completed");
    expect(transformed.currentTool).toBeUndefined();
    expect(transformed.durationMs).toBeGreaterThan(9900);
    expect(transformed.durationMs).toBeLessThan(11000);
    expect(transformed.result).toBe("Background task completed");
  });

  test("subagent.complete transitions background agent to error", () => {
    const backgroundAgent: ParallelAgent = {
      id: "agent_bg_2",
      taskToolCallId: "tool_bg_2",
      name: "task",
      task: "Background task that fails",
      status: "background",
      background: true,
      startedAt: new Date(Date.now() - 5000).toISOString(),
      currentTool: "Running task in background…",
    };

    const transformed = applySubagentCompleteTransform(
      backgroundAgent,
      "agent_bg_2",
      false,
      "Error: Task failed",
    );

    expect(transformed.status).toBe("error");
    expect(transformed.currentTool).toBeUndefined();
    expect(transformed.durationMs).toBeGreaterThan(4900);
    expect(transformed.durationMs).toBeLessThan(6000);
    expect(transformed.result).toBe("Error: Task failed");
  });

  test("interrupt sets background agent to interrupted", () => {
    const backgroundAgent: ParallelAgent = {
      id: "agent_bg_3",
      taskToolCallId: "tool_bg_3",
      name: "task",
      task: "Background task to interrupt",
      status: "background",
      background: true,
      startedAt: new Date().toISOString(),
      currentTool: "Running task in background…",
    };

    const interrupted = applyInterruptTransform(backgroundAgent);

    expect(interrupted.status).toBe("interrupted");
    expect(interrupted.currentTool).toBeUndefined();
  });
});
