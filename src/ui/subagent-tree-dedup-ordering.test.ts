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
  correlationAliases: Map<string, string>;
  pendingTaskCorrelations: string[];
  pendingSubagentCorrelations: string[];
  subagentCorrelationById: Map<string, string>;
}

function isGenericSubagentTask(task: string | undefined): boolean {
  const normalized = (task ?? "").trim().toLowerCase();
  return normalized === "" || normalized === "sub-agent task" || normalized === "subagent task";
}

function resolveCorrelationAlias(
  state: CorrelationState,
  correlationId: string | undefined,
): string | undefined {
  if (!correlationId) {
    return undefined;
  }

  let resolved = correlationId;
  const seen = new Set<string>();
  while (!seen.has(resolved)) {
    seen.add(resolved);
    const next = state.correlationAliases.get(resolved);
    if (!next || next === resolved) {
      break;
    }
    resolved = next;
  }

  for (const alias of seen) {
    state.correlationAliases.set(alias, resolved);
  }
  return resolved;
}

function registerAlias(
  state: CorrelationState,
  preferredCorrelationId: string,
  ...aliases: Array<string | undefined>
): void {
  state.correlationAliases.set(preferredCorrelationId, preferredCorrelationId);
  for (const alias of aliases) {
    if (!alias) {
      continue;
    }
    const canonicalAlias = resolveCorrelationAlias(state, alias) ?? alias;
    state.correlationAliases.set(alias, preferredCorrelationId);
    state.correlationAliases.set(canonicalAlias, preferredCorrelationId);
  }
}

function enqueueUnique(queue: string[], value: string): void {
  if (!queue.includes(value)) {
    queue.push(value);
  }
}

function removeFromQueue(queue: string[], value: string): void {
  const index = queue.indexOf(value);
  if (index >= 0) {
    queue.splice(index, 1);
  }
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
  let resolvedCorrelationId = resolveCorrelationAlias(state, event.sdkCorrelationId);

  if (!resolvedCorrelationId) {
    resolvedCorrelationId = resolveCorrelationAlias(
      state,
      state.subagentCorrelationById.get(event.subagentId),
    );
  }

  if (resolvedCorrelationId) {
    const sdkMappedAgentId = state.toolCallToAgentMap.get(resolvedCorrelationId);
    if (!sdkMappedAgentId && state.pendingTaskCorrelations.length > 0) {
      const inferredTaskCorrelationId = state.pendingTaskCorrelations[0]!;
      registerAlias(state, inferredTaskCorrelationId, resolvedCorrelationId);
      resolvedCorrelationId = inferredTaskCorrelationId;
    }
  }

  const sdkMappedAgentId = resolvedCorrelationId
    ? state.toolCallToAgentMap.get(resolvedCorrelationId)
    : undefined;

  if (sdkMappedAgentId && state.parallelAgents.some((a) => a.id === sdkMappedAgentId)) {
    state.parallelAgents = state.parallelAgents.map((a) =>
      a.id === sdkMappedAgentId
        ? {
            ...a,
            id: event.subagentId,
            taskToolCallId: resolvedCorrelationId ?? a.taskToolCallId,
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
            taskToolCallId: resolvedCorrelationId ?? a.taskToolCallId,
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
        taskToolCallId: resolvedCorrelationId,
        name: event.subagentType,
        task,
        status: "running",
        startedAt: "2026-01-01T00:00:00.000Z",
        currentTool: `Running ${event.subagentType}...`,
      },
    ];
  }

  if (resolvedCorrelationId) {
    state.toolCallToAgentMap.set(resolvedCorrelationId, event.subagentId);
    state.subagentCorrelationById.set(event.subagentId, resolvedCorrelationId);
    removeFromQueue(state.pendingTaskCorrelations, resolvedCorrelationId);
    removeFromQueue(state.pendingSubagentCorrelations, resolvedCorrelationId);
    enqueueUnique(state.pendingSubagentCorrelations, resolvedCorrelationId);
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
  let resolvedSdkCorrelationId = resolveCorrelationAlias(state, event.sdkCorrelationId);
  let sdkMappedAgentId = resolvedSdkCorrelationId
    ? state.toolCallToAgentMap.get(resolvedSdkCorrelationId)
    : undefined;

  if (!sdkMappedAgentId && resolvedSdkCorrelationId && state.pendingSubagentCorrelations.length > 0) {
    const pendingSubagentCorrelationId = state.pendingSubagentCorrelations[0]!;
    const pendingMappedAgentId = state.toolCallToAgentMap.get(
      resolveCorrelationAlias(state, pendingSubagentCorrelationId) ?? pendingSubagentCorrelationId,
    );
    if (pendingMappedAgentId) {
      registerAlias(state, resolvedSdkCorrelationId, pendingSubagentCorrelationId);
      sdkMappedAgentId = pendingMappedAgentId;
      removeFromQueue(state.pendingSubagentCorrelations, pendingSubagentCorrelationId);
    }
  }

  const existingSdkMappedAgent = sdkMappedAgentId
    ? state.parallelAgents.find((a) => a.id === sdkMappedAgentId)
    : undefined;

  if (existingSdkMappedAgent && sdkMappedAgentId) {
    state.parallelAgents = state.parallelAgents.map((a) =>
      a.id === sdkMappedAgentId
        ? {
            ...a,
            taskToolCallId: event.toolId,
            name: event.agentType,
            task: isGenericSubagentTask(a.task) ? event.task : a.task,
            currentTool: `Running ${event.agentType}...`,
          }
        : a,
    );
    state.toolCallToAgentMap.set(event.toolId, sdkMappedAgentId);
    if (resolvedSdkCorrelationId) {
      state.toolCallToAgentMap.set(resolvedSdkCorrelationId, sdkMappedAgentId);
      state.subagentCorrelationById.set(sdkMappedAgentId, resolvedSdkCorrelationId);
      removeFromQueue(state.pendingTaskCorrelations, resolvedSdkCorrelationId);
    }
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
  resolvedSdkCorrelationId = resolvedSdkCorrelationId ?? event.sdkCorrelationId;
  if (resolvedSdkCorrelationId) {
    state.toolCallToAgentMap.set(resolvedSdkCorrelationId, event.toolId);
    enqueueUnique(state.pendingTaskCorrelations, resolvedSdkCorrelationId);
  }
  return state;
}

function createState(): CorrelationState {
  return {
    parallelAgents: [],
    toolCallToAgentMap: new Map<string, string>(),
    correlationAliases: new Map<string, string>(),
    pendingTaskCorrelations: [],
    pendingSubagentCorrelations: [],
    subagentCorrelationById: new Map<string, string>(),
  };
}

describe("subagent tree dedup ordering", () => {
  test("subagent.start before Task tool.start keeps a single row", () => {
    const state = createState();

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
    const state = createState();

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

  test("callId-first subagent with replayed missing-correlation start keeps one rendered branch", () => {
    const state = createState();

    applySubagentStart(state, {
      subagentId: "agent-3",
      subagentType: "debugger",
      task: "Sub-agent task",
      sdkCorrelationId: "call-3",
    });

    applyTaskToolStart(state, {
      toolId: "tool-use-3",
      sdkCorrelationId: "tool-use-3",
      agentType: "debugger",
      task: "Debug stuck spinner",
    });

    // Replayed subagent.start without callId/toolUseId should hydrate using prior linkage.
    applySubagentStart(state, {
      subagentId: "agent-3",
      subagentType: "debugger",
      task: "Debug stuck spinner",
    });

    expect(state.parallelAgents).toHaveLength(1);
    expect(state.parallelAgents[0]?.id).toBe("agent-3");
    expect(state.parallelAgents[0]?.taskToolCallId).toBe("tool-use-3");
    expect(state.parallelAgents[0]?.task).toBe("Debug stuck spinner");
  });
});
