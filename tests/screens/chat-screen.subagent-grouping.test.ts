import { describe, expect, test } from "bun:test";
import type { ParallelAgent } from "@/components/parallel-agents-tree.tsx";
import {
  finalizeCorrelatedSubagentDispatchForToolComplete,
  finalizeSyntheticTaskAgentForToolComplete,
  mergeAgentTaskLabel,
  resolveSubagentStartCorrelationId,
  resolveAgentCurrentToolForUpdate,
  upsertSyntheticTaskAgentForToolStart,
} from "@/state/chat/exports.ts";

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

  test("upgrades agent-type fallback to explicit task description", () => {
    expect(
      mergeAgentTaskLabel(
        "debugger",
        "Investigate why tool counts are not updating",
        "debugger",
      )
    ).toBe("Investigate why tool counts are not updating");
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
  test("marks correlated running agents completed on successful dispatch completion without agent.complete", () => {
    const agents: ParallelAgent[] = [
      {
        id: "agent-1",
        taskToolCallId: "tool-1",
        name: "codebase-online-researcher",
        task: "Research BM25 explanation",
        status: "running",
        startedAt: "2026-03-02T08:17:49.941Z",
        currentTool: "Read",
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
      toolName: "Task",
      toolId: "tool-1",
      success: true,
      completedAtMs: new Date("2026-03-02T08:18:59.188Z").getTime(),
    });

    expect(result[0]!.status).toBe("completed");
    expect(result[0]!.currentTool).toBeUndefined();
    expect(result[0]!.durationMs).toBeGreaterThan(0);
    expect(result[1]!.status).toBe("running");
  });

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

  test("skips finalization for copilot provider to prevent premature completion", () => {
    const agents: ParallelAgent[] = [
      {
        id: "agent-1",
        taskToolCallId: "tool-1",
        name: "codebase-analyzer",
        task: "Analyze rendering",
        status: "running",
        startedAt: "2026-03-02T08:17:49.941Z",
        currentTool: "Read",
      },
    ];

    const result = finalizeCorrelatedSubagentDispatchForToolComplete({
      agents,
      provider: "copilot",
      toolName: "Task",
      toolId: "tool-1",
      success: true,
      completedAtMs: new Date("2026-03-02T08:18:59.188Z").getTime(),
    });

    expect(result).toBe(agents);
    expect(result[0]!.status).toBe("running");
  });

  test("still finalizes correlated agents for opencode provider", () => {
    const agents: ParallelAgent[] = [
      {
        id: "agent-1",
        taskToolCallId: "tool-1",
        name: "codebase-analyzer",
        task: "Analyze rendering",
        status: "running",
        startedAt: "2026-03-02T08:17:49.941Z",
        currentTool: "Read",
      },
    ];

    const result = finalizeCorrelatedSubagentDispatchForToolComplete({
      agents,
      provider: "opencode",
      toolName: "Task",
      toolId: "tool-1",
      success: true,
      completedAtMs: new Date("2026-03-02T08:18:59.188Z").getTime(),
    });

    expect(result[0]!.status).toBe("completed");
  });

  test("still finalizes correlated agents for claude provider", () => {
    const agents: ParallelAgent[] = [
      {
        id: "agent-1",
        taskToolCallId: "tool-1",
        name: "codebase-analyzer",
        task: "Analyze rendering",
        status: "running",
        startedAt: "2026-03-02T08:17:49.941Z",
        currentTool: "Read",
      },
    ];

    const result = finalizeCorrelatedSubagentDispatchForToolComplete({
      agents,
      provider: "claude",
      toolName: "Task",
      toolId: "tool-1",
      success: true,
      completedAtMs: new Date("2026-03-02T08:18:59.188Z").getTime(),
    });

    expect(result[0]!.status).toBe("completed");
  });

  test("still finalizes correlated agents when provider is undefined", () => {
    const agents: ParallelAgent[] = [
      {
        id: "agent-1",
        taskToolCallId: "tool-1",
        name: "codebase-analyzer",
        task: "Analyze rendering",
        status: "running",
        startedAt: "2026-03-02T08:17:49.941Z",
        currentTool: "Read",
      },
    ];

    const result = finalizeCorrelatedSubagentDispatchForToolComplete({
      agents,
      toolName: "Task",
      toolId: "tool-1",
      success: true,
      completedAtMs: new Date("2026-03-02T08:18:59.188Z").getTime(),
    });

    expect(result[0]!.status).toBe("completed");
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

describe("OpenCode task-dispatch placeholders", () => {
  test("creates a running task-correlated placeholder from Task tool.start with execution details", () => {
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
    expect(agents[0]!.id).toBe("tool-1");
    expect(agents[0]!.taskToolCallId).toBe("tool-1");
    expect(agents[0]!.name).toBe("codebase-online-researcher");
    expect(agents[0]!.task).toBe("Research TUI UX practices");
    expect(agents[0]!.status).toBe("running");
    expect(agents[0]!.toolUses).toBe(0);
    expect(agents[0]!.currentTool).toBeUndefined();
  });

  test("updates the same task-correlated placeholder when duplicate Task tool.start fills input", () => {
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

  test("creates a Claude placeholder row keyed by the task tool id", () => {
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

    expect(agents).toHaveLength(1);
    expect(agents[0]!.id).toBe("tool-1");
    expect(agents[0]!.taskToolCallId).toBe("tool-1");
    expect(agents[0]!.name).toBe("codebase-online-researcher");
    expect(agents[0]!.task).toBe("Research TUI UX practices");
  });

  test("does not create synthetic task agents for unsupported providers", () => {
    const agents = upsertSyntheticTaskAgentForToolStart({
      agents: [],
      provider: "copilot",
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

  test("marks the task-correlated placeholder interrupted when Task tool completes with aborted error", () => {
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
