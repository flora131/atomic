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
    // Only promote to a real agent when exactly one qualifies.
    // With multiple parallel agents, routing all synthetic events to the
    // first one would misattribute tool calls across agents.
    const qualifying = agents.reduce<number[]>((acc, agent, idx) => {
      if (
        !isClaudeSyntheticForegroundAgentId(agent.id) &&
        !agent.background &&
        (agent.status === "running" || agent.status === "pending")
      ) {
        acc.push(idx);
      }
      return acc;
    }, []);
    if (qualifying.length === 1) {
      return qualifying[0]!;
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
