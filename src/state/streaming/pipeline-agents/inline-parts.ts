import type { ParallelAgent } from "@/types/parallel-agents.ts";
import {
  isClaudeSyntheticForegroundAgentId,
} from "@/state/chat/exports.ts";
import type { AgentPart, Part } from "@/state/parts/types.ts";

function findAgentIndexByIdOrCorrelation(
  agents: ParallelAgent[],
  agentId: string,
): number {
  const directIdx = agents.findIndex((agent) => agent.id === agentId);
  if (directIdx >= 0) {
    return directIdx;
  }

  const correlatedIdx = agents.findIndex(
    (agent) => agent.taskToolCallId === agentId,
  );
  if (correlatedIdx >= 0) {
    return correlatedIdx;
  }

  if (isClaudeSyntheticForegroundAgentId(agentId)) {
    const promotedIdx = agents.findIndex(
      (agent) =>
        !isClaudeSyntheticForegroundAgentId(agent.id) &&
        !agent.background &&
        (agent.status === "running" || agent.status === "pending"),
    );
    if (promotedIdx >= 0) {
      return promotedIdx;
    }
  }

  return -1;
}

export function routeToAgentInlineParts(
  parts: Part[],
  agentId: string,
  applyFn: (inlineParts: Part[]) => Part[],
): Part[] | null {
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    if (part?.type !== "agent") {
      continue;
    }

    const agentPart = part as AgentPart;
    const agentIdx = findAgentIndexByIdOrCorrelation(agentPart.agents, agentId);
    if (agentIdx < 0) {
      continue;
    }

    const agent = agentPart.agents[agentIdx]!;
    const updatedAgents = [...agentPart.agents];
    updatedAgents[agentIdx] = {
      ...agent,
      inlineParts: applyFn(agent.inlineParts ?? []),
    };
    const updatedParts = [...parts];
    updatedParts[index] = { ...agentPart, agents: updatedAgents };
    return updatedParts;
  }

  return null;
}
