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

interface CorrelationState {
  parallelAgents: ParallelAgent[];
  toolCallToAgentMap: Map<string, string>;
}

function isGenericSubagentTask(task: string | undefined): boolean {
  const normalized = (task ?? "").trim().toLowerCase();
  return normalized === "" || normalized === "sub-agent task" || normalized === "subagent task";
}

function applySubagentStart(
  state: CorrelationState,
  event: {
    subagentId: string;
    subagentType: string;
    task?: string;
    sdkCorrelationId?: string;
  },
): CorrelationState {
  const task = event.task ?? "Sub-agent task";
  const sdkMappedAgentId = event.sdkCorrelationId
    ? state.toolCallToAgentMap.get(event.sdkCorrelationId)
    : undefined;

  if (sdkMappedAgentId && state.parallelAgents.some((a) => a.id === sdkMappedAgentId)) {
    state.parallelAgents = state.parallelAgents.map((a) =>
      a.id === sdkMappedAgentId
        ? {
            ...a,
            id: event.subagentId,
            name: event.subagentType,
            task: isGenericSubagentTask(a.task) ? task : a.task,
            currentTool: `Running ${event.subagentType}...`,
          }
        : a,
    );
  } else if (state.parallelAgents.some((a) => a.id === event.subagentId)) {
    state.parallelAgents = state.parallelAgents.map((a) =>
      a.id === event.subagentId
        ? {
            ...a,
            name: event.subagentType,
            task: isGenericSubagentTask(a.task) ? task : a.task,
            currentTool: `Running ${event.subagentType}...`,
          }
        : a,
    );
  } else {
    state.parallelAgents = [
      ...state.parallelAgents,
      {
        id: event.subagentId,
        name: event.subagentType,
        task,
        status: "running",
        startedAt: "2026-01-01T00:00:00.000Z",
        currentTool: `Running ${event.subagentType}...`,
      },
    ];
  }

  if (event.sdkCorrelationId) {
    state.toolCallToAgentMap.set(event.sdkCorrelationId, event.subagentId);
  }

  return state;
}

function applyTaskToolStart(
  state: CorrelationState,
  event: {
    toolId: string;
    sdkCorrelationId?: string;
    agentType: string;
    task: string;
  },
): CorrelationState {
  const sdkMappedAgentId = event.sdkCorrelationId
    ? state.toolCallToAgentMap.get(event.sdkCorrelationId)
    : undefined;
  const existingSdkMappedAgent = sdkMappedAgentId
    ? state.parallelAgents.find((a) => a.id === sdkMappedAgentId)
    : undefined;

  if (existingSdkMappedAgent && sdkMappedAgentId) {
    state.parallelAgents = state.parallelAgents.map((a) =>
      a.id === sdkMappedAgentId
        ? {
            ...a,
            taskToolCallId: a.taskToolCallId ?? event.toolId,
            name: event.agentType,
            task: isGenericSubagentTask(a.task) ? event.task : a.task,
            currentTool: `Running ${event.agentType}...`,
          }
        : a,
    );
    state.toolCallToAgentMap.set(event.toolId, sdkMappedAgentId);
    return state;
  }

  state.parallelAgents = [
    ...state.parallelAgents,
    {
      id: event.toolId,
      taskToolCallId: event.toolId,
      name: event.agentType,
      task: event.task,
      status: "running",
      startedAt: "2026-01-01T00:00:00.000Z",
      currentTool: `Starting ${event.agentType}...`,
    },
  ];
  state.toolCallToAgentMap.set(event.toolId, event.toolId);
  return state;
}

describe("subagent tree dedup ordering", () => {
  test("subagent.start before Task tool.start keeps a single row", () => {
    const state: CorrelationState = {
      parallelAgents: [],
      toolCallToAgentMap: new Map<string, string>(),
    };

    applySubagentStart(state, {
      subagentId: "subagent-1",
      subagentType: "debugger",
      task: "Debug stuck spinner",
      sdkCorrelationId: "call-1",
    });

    applyTaskToolStart(state, {
      toolId: "tool_call-1",
      sdkCorrelationId: "call-1",
      agentType: "debugger",
      task: "Sub-agent task",
    });

    expect(state.parallelAgents).toHaveLength(1);
    expect(state.parallelAgents[0]?.id).toBe("subagent-1");
    expect(state.parallelAgents[0]?.taskToolCallId).toBe("tool_call-1");
    expect(state.parallelAgents[0]?.task).toBe("Debug stuck spinner");
  });

  test("duplicate subagent.start with same SDK correlation updates existing row", () => {
    const state: CorrelationState = {
      parallelAgents: [],
      toolCallToAgentMap: new Map<string, string>(),
    };

    applySubagentStart(state, {
      subagentId: "agent-part-1",
      subagentType: "debugger",
      task: "Sub-agent task",
      sdkCorrelationId: "call-2",
    });

    applySubagentStart(state, {
      subagentId: "subtask-part-1",
      subagentType: "debugger",
      task: "Debug stuck spinner",
      sdkCorrelationId: "call-2",
    });

    expect(state.parallelAgents).toHaveLength(1);
    expect(state.parallelAgents[0]?.id).toBe("subtask-part-1");
    expect(state.parallelAgents[0]?.task).toBe("Debug stuck spinner");
  });
});
