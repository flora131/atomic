import type { ParallelAgent } from "@/types/parallel-agents.ts";

export type { ParallelAgent };

export function createAgent(
  runInBackground: boolean,
  agentType: string,
  taskDesc: string,
  toolId: string,
): ParallelAgent {
  const isBackground = runInBackground === true;
  return {
    id: toolId,
    taskToolCallId: toolId,
    name: agentType,
    task: taskDesc,
    status: isBackground ? "background" : "running",
    background: isBackground || undefined,
    startedAt: new Date().toISOString(),
    currentTool: isBackground
      ? `Running ${agentType} in background…`
      : `Starting ${agentType}…`,
  };
}

export function applyToolCompleteTransform(
  agent: ParallelAgent,
  resultStr: string,
): ParallelAgent {
  return agent.background
    ? {
        ...agent,
        result: resultStr,
      }
    : {
        ...agent,
        result: resultStr,
        status:
          agent.status === "running" || agent.status === "pending"
            ? ("completed" as const)
            : agent.status,
        currentTool:
          agent.status === "running" || agent.status === "pending"
            ? undefined
            : agent.currentTool,
        durationMs:
          agent.durationMs ?? Date.now() - new Date(agent.startedAt).getTime(),
      };
}

export function applySubagentCompleteTransform(
  agent: ParallelAgent,
  subagentId: string,
  success: boolean,
  result?: unknown,
): ParallelAgent {
  if (agent.id !== subagentId) {
    return agent;
  }

  const status = success !== false ? "completed" : "error";
  return {
    ...agent,
    status,
    currentTool: undefined,
    result: result ? String(result) : undefined,
    durationMs: Date.now() - new Date(agent.startedAt).getTime(),
  };
}

export function applyStreamFinalizationTransform(
  agent: ParallelAgent,
): ParallelAgent {
  if (agent.background) {
    return agent;
  }

  return agent.status === "running" || agent.status === "pending"
    ? {
        ...agent,
        status: "completed" as const,
        currentTool: undefined,
        durationMs: Date.now() - new Date(agent.startedAt).getTime(),
      }
    : agent;
}

export function hasActiveAgents(agents: ParallelAgent[]): boolean {
  return agents.some(
    (agent) =>
      agent.status === "running" ||
      agent.status === "pending" ||
      agent.status === "background",
  );
}

export function applyInterruptTransform(agent: ParallelAgent): ParallelAgent {
  return {
    ...agent,
    status: "interrupted",
    currentTool: undefined,
  };
}
