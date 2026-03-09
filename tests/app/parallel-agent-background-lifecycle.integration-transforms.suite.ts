import { describe, expect, test } from "bun:test";
import {
  applySubagentCompleteTransform,
  applyToolCompleteTransform,
  type ParallelAgent,
} from "./parallel-agent-background-lifecycle.test-support.ts";

describe("Background agent lifecycle integration", () => {
  test("subagent.complete only affects matching agent ID", () => {
    const agents: ParallelAgent[] = [
      {
        id: "agent_1",
        taskToolCallId: "agent_1",
        name: "task",
        task: "Task 1",
        status: "background",
        background: true,
        startedAt: new Date().toISOString(),
      },
      {
        id: "agent_2",
        taskToolCallId: "agent_2",
        name: "task",
        task: "Task 2",
        status: "background",
        background: true,
        startedAt: new Date().toISOString(),
      },
    ];

    const updated = agents.map((agent) =>
      applySubagentCompleteTransform(agent, "agent_1", true),
    );

    expect(updated[0]!.status).toBe("completed");
    expect(updated[1]!.status).toBe("background");
  });

  test("tool.complete preserves all fields except updated ones for background agents", () => {
    const backgroundAgent: ParallelAgent = {
      id: "preserve_test",
      taskToolCallId: "preserve_test",
      name: "task",
      task: "Preserve fields test",
      status: "background",
      background: true,
      startedAt: "2024-01-01T00:00:00.000Z",
      currentTool: "Custom tool message",
      model: "claude-opus-4.6",
      toolUses: 5,
      tokens: 1000,
    };

    const transformed = applyToolCompleteTransform(backgroundAgent, "Result");

    expect(transformed.id).toBe("preserve_test");
    expect(transformed.name).toBe("task");
    expect(transformed.task).toBe("Preserve fields test");
    expect(transformed.status).toBe("background");
    expect(transformed.background).toBe(true);
    expect(transformed.startedAt).toBe("2024-01-01T00:00:00.000Z");
    expect(transformed.currentTool).toBe("Custom tool message");
    expect(transformed.model).toBe("claude-opus-4.6");
    expect(transformed.toolUses).toBe(5);
    expect(transformed.tokens).toBe(1000);
    expect(transformed.durationMs).toBeUndefined();
    expect(transformed.result).toBe("Result");
  });

  test("tool.complete updates all completion fields for sync agents", () => {
    const runningAgent: ParallelAgent = {
      id: "sync_complete",
      taskToolCallId: "sync_complete",
      name: "task",
      task: "Sync completion test",
      status: "running",
      startedAt: new Date(Date.now() - 5000).toISOString(),
      currentTool: "Running tool",
      model: "claude-sonnet-4.5",
    };

    const transformed = applyToolCompleteTransform(runningAgent, "Sync result");

    expect(transformed.status).toBe("completed");
    expect(transformed.currentTool).toBeUndefined();
    expect(transformed.durationMs).toBeGreaterThan(4900);
    expect(transformed.durationMs).toBeLessThan(6000);
    expect(transformed.result).toBe("Sync result");
    expect(transformed.model).toBe("claude-sonnet-4.5");
  });

  test("isAsync fallback retroactively marks non-background agent as background", () => {
    const agent: ParallelAgent = {
      id: "agent_missed_bg",
      taskToolCallId: "tool_missed_bg",
      name: "task",
      task: "Missed background detection",
      status: "running",
      startedAt: new Date(Date.now() - 3000).toISOString(),
      currentTool: "Starting task…",
    };

    const retroAgent: ParallelAgent = !agent.background
      ? { ...agent, background: true, status: "background" as const }
      : agent;

    expect(retroAgent.background).toBe(true);
    expect(retroAgent.status).toBe("background");

    const afterToolComplete = applyToolCompleteTransform(retroAgent, "Async result");
    expect(afterToolComplete.status).toBe("background");
    expect(afterToolComplete.currentTool).toBe("Starting task…");
    expect(afterToolComplete.durationMs).toBeUndefined();
    expect(afterToolComplete.result).toBe("Async result");

    const afterSubagentComplete = applySubagentCompleteTransform(
      afterToolComplete,
      "agent_missed_bg",
      true,
      "Final result",
    );
    expect(afterSubagentComplete.status).toBe("completed");
    expect(afterSubagentComplete.durationMs).toBeGreaterThan(0);
  });
});
