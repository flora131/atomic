import { describe, expect, test } from "bun:test";
import type { ParallelAgent } from "./components/parallel-agents-tree.tsx";
import type { AgentPart } from "./parts/index.ts";
import { shouldGroupSubagentTrees } from "./chat.tsx";

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

  test("does not force grouping for completed trees without grouped history", () => {
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
    ).toBe(false);
  });
});
