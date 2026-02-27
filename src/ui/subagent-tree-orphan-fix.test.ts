/**
 * Test for sub-agent tree orphan fix
 * 
 * Verifies that agents with terminal status (completed, error, interrupted)
 * are properly replaced when a new stream.agent.start event arrives for the
 * same agent ID, rather than preserving the old terminal status.
 */

import { describe, expect, test } from "bun:test";

type AgentStatus = "pending" | "running" | "completed" | "error" | "background" | "interrupted";

interface ParallelAgent {
  id: string;
  taskToolCallId?: string;
  name: string;
  task: string;
  status: AgentStatus;
  startedAt: string;
  background?: boolean;
  currentTool?: string;
}

/**
 * Simulates the stream.agent.start handler logic with the fix applied.
 * When an agent with a terminal status exists, it should be replaced, not updated.
 */
function applyAgentStart(
  current: ParallelAgent[],
  event: {
    agentId: string;
    agentType: string;
    task: string;
    sdkCorrelationId?: string;
    isBackground?: boolean;
  }
): ParallelAgent[] {
  const startedAt = new Date().toISOString();
  const status: AgentStatus = event.isBackground ? "background" : "running";

  const existingIndex = current.findIndex((agent) => agent.id === event.agentId);
  if (existingIndex >= 0) {
    const existing = current[existingIndex];
    // If agent already has a terminal status (completed, error, interrupted),
    // it's from a previous stream. Filter it out instead of preserving it.
    if (existing && (existing.status === "completed" || existing.status === "error" || existing.status === "interrupted")) {
      // Remove the old agent and add the new one
      return [
        ...current.filter((agent) => agent.id !== event.agentId),
        {
          id: event.agentId,
          taskToolCallId: event.sdkCorrelationId,
          name: event.agentType,
          task: event.task,
          status,
          startedAt,
          background: event.isBackground,
          currentTool: event.agentType ? `Running ${event.agentType}...` : undefined,
        },
      ];
    }
    // Update existing agent that's still active
    return current.map((agent) =>
      agent.id === event.agentId
        ? {
          ...agent,
          name: event.agentType || agent.name,
          task: event.task || agent.task,
          status,
          background: event.isBackground || agent.background,
          taskToolCallId: event.sdkCorrelationId ?? agent.taskToolCallId,
          currentTool: event.agentType ? `Running ${event.agentType}...` : agent.currentTool,
        }
        : agent
    );
  }
  return [
    ...current,
    {
      id: event.agentId,
      taskToolCallId: event.sdkCorrelationId,
      name: event.agentType,
      task: event.task,
      status,
      startedAt,
      background: event.isBackground,
      currentTool: event.agentType ? `Running ${event.agentType}...` : undefined,
    },
  ];
}

describe("sub-agent tree orphan fix", () => {
  test("completed agent is replaced when new start event arrives", () => {
    const current: ParallelAgent[] = [
      {
        id: "agent-1",
        name: "debugger",
        task: "Old task",
        status: "completed",
        startedAt: "2024-01-01T00:00:00.000Z",
      },
    ];

    const result = applyAgentStart(current, {
      agentId: "agent-1",
      agentType: "debugger",
      task: "New task",
      sdkCorrelationId: "call-1",
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.status).toBe("running");
    expect(result[0]?.task).toBe("New task");
    expect(result[0]?.startedAt).not.toBe("2024-01-01T00:00:00.000Z");
  });

  test("error agent is replaced when new start event arrives", () => {
    const current: ParallelAgent[] = [
      {
        id: "agent-2",
        name: "codebase-analyzer",
        task: "Old failed task",
        status: "error",
        startedAt: "2024-01-01T00:00:00.000Z",
      },
    ];

    const result = applyAgentStart(current, {
      agentId: "agent-2",
      agentType: "codebase-analyzer",
      task: "Retry task",
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.status).toBe("running");
    expect(result[0]?.task).toBe("Retry task");
  });

  test("interrupted agent is replaced when new start event arrives", () => {
    const current: ParallelAgent[] = [
      {
        id: "agent-3",
        name: "explore",
        task: "Old interrupted task",
        status: "interrupted",
        startedAt: "2024-01-01T00:00:00.000Z",
      },
    ];

    const result = applyAgentStart(current, {
      agentId: "agent-3",
      agentType: "explore",
      task: "New task after interrupt",
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.status).toBe("running");
    expect(result[0]?.task).toBe("New task after interrupt");
  });

  test("running agent is updated, not replaced", () => {
    const originalStartTime = "2024-01-01T00:00:00.000Z";
    const current: ParallelAgent[] = [
      {
        id: "agent-4",
        name: "debugger",
        task: "Running task",
        status: "running",
        startedAt: originalStartTime,
      },
    ];

    const result = applyAgentStart(current, {
      agentId: "agent-4",
      agentType: "debugger",
      task: "Updated task",
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.status).toBe("running");
    expect(result[0]?.task).toBe("Updated task");
    // Should preserve original start time for active agents
    expect(result[0]?.startedAt).toBe(originalStartTime);
  });

  test("multiple completed agents are filtered out on new start", () => {
    const current: ParallelAgent[] = [
      {
        id: "agent-1",
        name: "debugger",
        task: "Completed 1",
        status: "completed",
        startedAt: "2024-01-01T00:00:00.000Z",
      },
      {
        id: "agent-2",
        name: "explore",
        task: "Completed 2",
        status: "completed",
        startedAt: "2024-01-01T00:01:00.000Z",
      },
    ];

    const result = applyAgentStart(current, {
      agentId: "agent-1",
      agentType: "debugger",
      task: "New task",
    });

    expect(result).toHaveLength(2);
    const agent1 = result.find((a) => a.id === "agent-1");
    const agent2 = result.find((a) => a.id === "agent-2");
    
    expect(agent1?.status).toBe("running");
    expect(agent1?.task).toBe("New task");
    expect(agent2?.status).toBe("completed");
    expect(agent2?.task).toBe("Completed 2");
  });

  test("new agent is added when id doesn't exist", () => {
    const current: ParallelAgent[] = [
      {
        id: "agent-1",
        name: "debugger",
        task: "Existing task",
        status: "running",
        startedAt: "2024-01-01T00:00:00.000Z",
      },
    ];

    const result = applyAgentStart(current, {
      agentId: "agent-2",
      agentType: "explore",
      task: "New agent task",
    });

    expect(result).toHaveLength(2);
    const newAgent = result.find((a) => a.id === "agent-2");
    expect(newAgent).toBeDefined();
    expect(newAgent?.status).toBe("running");
    expect(newAgent?.task).toBe("New agent task");
  });
});
