import { describe, expect, test } from "bun:test";
import type { ParallelAgent } from "./components/parallel-agents-tree.tsx";
import type { AgentPart } from "./parts/index.ts";
import {
  finalizeCorrelatedSubagentDispatchForToolComplete,
  finalizeSyntheticTaskAgentForToolComplete,
  isSyntheticTaskAgentId,
  mergeAgentTaskLabel,
  resolveSubagentStartCorrelationId,
  resolveAgentCurrentToolForUpdate,
  shouldGroupSubagentTrees,
  upsertSyntheticTaskAgentForToolStart,
} from "./chat.tsx";

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

describe("resolveSubagentStartCorrelationId", () => {
  test("prefers sdkCorrelationId when available", () => {
    expect(
      resolveSubagentStartCorrelationId({
        sdkCorrelationId: "sdk-1",
        toolCallId: "tool-1",
      })
    ).toBe("sdk-1");
  });

  test("falls back to toolCallId when sdkCorrelationId is missing", () => {
    expect(
      resolveSubagentStartCorrelationId({
        toolCallId: "tool-2",
      })
    ).toBe("tool-2");
  });
});

describe("finalizeCorrelatedSubagentDispatchForToolComplete", () => {
  test("marks correlated running agents interrupted on dispatch abort without agent.complete", () => {
    const agents: ParallelAgent[] = [
      {
        id: "agent-1",
        taskToolCallId: "tool-1",
        name: "codebase-analyzer",
        task: "Analyze rendering",
        status: "running",
        startedAt: "2026-03-02T08:17:49.941Z",
        currentTool: "rg",
      },
      {
        id: "agent-2",
        taskToolCallId: "tool-2",
        name: "debugger",
        task: "Inspect logs",
        status: "running",
        startedAt: "2026-03-02T08:17:49.941Z",
      },
    ];

    const result = finalizeCorrelatedSubagentDispatchForToolComplete({
      agents,
      toolName: "Agent",
      toolId: "tool-1",
      success: false,
      error: "Tool execution aborted",
      completedAtMs: new Date("2026-03-02T08:18:59.188Z").getTime(),
    });

    expect(result[0]!.status).toBe("interrupted");
    expect(result[0]!.currentTool).toBeUndefined();
    expect(result[0]!.durationMs).toBeGreaterThan(0);
    expect(result[1]!.status).toBe("running");
  });
});

describe("resolveAgentCurrentToolForUpdate", () => {
  test("keeps incoming tool name when present", () => {
    expect(resolveAgentCurrentToolForUpdate({
      incomingCurrentTool: "rg",
      existingCurrentTool: "Running codebase-locator...",
      agentName: "codebase-locator",
    })).toBe("rg");
  });

  test("drops bootstrap running label when update has no current tool", () => {
    expect(resolveAgentCurrentToolForUpdate({
      existingCurrentTool: "Running codebase-locator...",
      agentName: "codebase-locator",
    })).toBeUndefined();
  });

  test("preserves last concrete tool when update omits current tool", () => {
    expect(resolveAgentCurrentToolForUpdate({
      existingCurrentTool: "glob",
      agentName: "codebase-locator",
    })).toBe("glob");
  });
});

describe("OpenCode synthetic task agent fallback", () => {
  test("creates a running synthetic agent from Task tool.start with execution details", () => {
    const agents = upsertSyntheticTaskAgentForToolStart({
      agents: [],
      provider: "opencode",
      toolName: "task",
      toolId: "tool-1",
      input: {
        description: "Research TUI UX practices",
        subagent_type: "codebase-online-researcher",
      },
      startedAt: "2026-03-02T06:18:36.000Z",
    });

    expect(agents).toHaveLength(1);
    expect(isSyntheticTaskAgentId(agents[0]!.id)).toBe(true);
    expect(agents[0]!.taskToolCallId).toBe("tool-1");
    expect(agents[0]!.name).toBe("codebase-online-researcher");
    expect(agents[0]!.task).toBe("Research TUI UX practices");
    expect(agents[0]!.status).toBe("running");
    expect(agents[0]!.toolUses).toBe(0);
    expect(agents[0]!.currentTool).toBeUndefined();
  });

  test("updates the same synthetic agent when duplicate Task tool.start fills input", () => {
    const first = upsertSyntheticTaskAgentForToolStart({
      agents: [],
      provider: "opencode",
      toolName: "task",
      toolId: "tool-1",
      input: {},
      startedAt: "2026-03-02T06:18:36.000Z",
    });

    const second = upsertSyntheticTaskAgentForToolStart({
      agents: first,
      provider: "opencode",
      toolName: "task",
      toolId: "tool-1",
      input: {
        description: "Research TUI UX practices",
        subagent_type: "codebase-online-researcher",
      },
      startedAt: "2026-03-02T06:18:43.000Z",
    });

    expect(second).toHaveLength(1);
    expect(second[0]!.name).toBe("codebase-online-researcher");
    expect(second[0]!.task).toBe("Research TUI UX practices");
    expect(second[0]!.status).toBe("running");
    expect(second[0]!.toolUses).toBe(0);
    expect(second[0]!.currentTool).toBeUndefined();
  });

  test("skips visible synthetic placeholder rows for empty task starts", () => {
    const agents = upsertSyntheticTaskAgentForToolStart({
      agents: [],
      provider: "opencode",
      toolName: "task",
      toolId: "tool-1",
      input: {},
      startedAt: "2026-03-02T06:18:36.000Z",
    });

    expect(agents).toHaveLength(0);
  });

  test("does not create synthetic task agents for non-OpenCode providers", () => {
    const agents = upsertSyntheticTaskAgentForToolStart({
      agents: [],
      provider: "claude",
      toolName: "task",
      toolId: "tool-1",
      input: {
        description: "Research TUI UX practices",
        subagent_type: "codebase-online-researcher",
      },
      startedAt: "2026-03-02T06:18:36.000Z",
    });

    expect(agents).toHaveLength(0);
  });

  test("marks synthetic agent interrupted when Task tool completes with aborted error", () => {
    const started = upsertSyntheticTaskAgentForToolStart({
      agents: [],
      provider: "opencode",
      toolName: "task",
      toolId: "tool-1",
      input: {
        description: "Research TUI UX practices",
        subagent_type: "codebase-online-researcher",
      },
      startedAt: "2026-03-02T06:18:36.000Z",
    });

    const finalized = finalizeSyntheticTaskAgentForToolComplete({
      agents: started,
      provider: "opencode",
      toolName: "task",
      toolId: "tool-1",
      success: false,
      output: null,
      error: "Tool execution aborted",
      completedAtMs: new Date("2026-03-02T06:19:18.000Z").getTime(),
    });

    expect(finalized).toHaveLength(1);
    expect(finalized[0]!.status).toBe("interrupted");
    expect(finalized[0]!.currentTool).toBeUndefined();
    expect(finalized[0]!.durationMs).toBeGreaterThan(0);
  });
});
