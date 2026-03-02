import { describe, expect, test } from "bun:test";
import type { ParallelAgent } from "./components/parallel-agents-tree.tsx";
import type { AgentPart } from "./parts/index.ts";
import { mergeAgentTaskLabel, shouldGroupSubagentTrees } from "./chat.tsx";

function createCompletedAgent(): ParallelAgent {
  return {
    id: "agent-1",
    taskToolCallId: "task-1",
    name: "codebase-analyzer",
    task: "Analyze app structure",
    status: "completed",
    startedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("shouldGroupSubagentTrees", () => {
  test("groups active sub-agents on the last message", () => {
    const activeAgent: ParallelAgent = {
      ...createCompletedAgent(),
      status: "running",
    };

    expect(
      shouldGroupSubagentTrees(
        {
          parallelAgents: [activeAgent],
          toolCalls: [{ id: "task-1", toolName: "Task", input: {}, status: "running" }],
          parts: [],
        },
        true,
      ),
    ).toBe(true);
  });

  test("keeps grouped layout after all sub-agents complete", () => {
    const groupedPart: AgentPart = {
      id: "agent-part-grouped",
      type: "agent",
      agents: [createCompletedAgent()],
      parentToolPartId: undefined,
      createdAt: "2026-01-01T00:00:00.000Z",
    };

    expect(
      shouldGroupSubagentTrees(
        {
          parallelAgents: [createCompletedAgent()],
          toolCalls: [{ id: "task-1", toolName: "Task", input: {}, status: "completed" }],
          parts: [groupedPart],
        },
        true,
      ),
    ).toBe(true);
  });

  test("groups completed trees even without grouped history", () => {
    const splitPart: AgentPart = {
      id: "agent-part-split",
      type: "agent",
      agents: [createCompletedAgent()],
      parentToolPartId: "tool-part-1",
      createdAt: "2026-01-01T00:00:00.000Z",
    };

    expect(
      shouldGroupSubagentTrees(
        {
          parallelAgents: [createCompletedAgent()],
          toolCalls: [{ id: "task-1", toolName: "Task", input: {}, status: "completed" }],
          parts: [splitPart],
        },
        true,
      ),
    ).toBe(true);
  });

  test("groups sub-agents on non-last messages too", () => {
    const activeAgent: ParallelAgent = {
      ...createCompletedAgent(),
      status: "running",
    };

    expect(
      shouldGroupSubagentTrees(
        {
          parallelAgents: [activeAgent],
          toolCalls: [{ id: "task-1", toolName: "Task", input: {}, status: "running" }],
          parts: [],
        },
        false,
      ),
    ).toBe(true);
  });
});

describe("mergeAgentTaskLabel", () => {
  test("preserves descriptive task labels when incoming label is generic", () => {
    expect(mergeAgentTaskLabel("Debug stuck spinner", "Sub-agent task", "debugger")).toBe("Debug stuck spinner");
  });

  test("upgrades generic labels when a descriptive task arrives", () => {
    expect(mergeAgentTaskLabel("Sub-agent task", "Debug stuck spinner", "debugger")).toBe("Debug stuck spinner");
  });

  test("keeps canonical descriptive label when incoming task is empty", () => {
    expect(mergeAgentTaskLabel("Investigate flaky spinner", "   ", "debugger")).toBe("Investigate flaky spinner");
  });

  test("falls back to agent type when existing label is generic and task is missing", () => {
    expect(mergeAgentTaskLabel("subagent task", undefined, "codebase-analyzer")).toBe("codebase-analyzer");
  });
});
