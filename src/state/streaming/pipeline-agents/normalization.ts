import type { ParallelAgent } from "@/components/parallel-agents-tree.tsx";
import { normalizeMarkdownNewlines } from "@/lib/ui/format.ts";
import type { AgentPart, Part } from "@/state/parts/types.ts";

export function normalizeParallelAgentResult(
  result: string | undefined,
): string | undefined {
  if (typeof result !== "string") {
    return undefined;
  }

  const normalized = normalizeMarkdownNewlines(result);
  return normalized.length > 0 ? normalized : undefined;
}

export function normalizeParallelAgents(
  agents: ParallelAgent[],
): ParallelAgent[] {
  let changed = false;
  const normalizedAgents = agents.map((agent) => {
    if (typeof agent.result !== "string") {
      return agent;
    }
    const normalizedResult = normalizeParallelAgentResult(agent.result);
    if (normalizedResult === agent.result) {
      return agent;
    }

    changed = true;
    if (normalizedResult) {
      return { ...agent, result: normalizedResult };
    }

    const { result: _result, ...rest } = agent;
    return rest;
  });

  return changed ? normalizedAgents : agents;
}

export function hasCompletedAgentInParts(
  parts: Part[] | undefined,
  agentId: string,
): boolean {
  if (!parts) {
    return false;
  }

  return parts.some(
    (part) =>
      part.type === "agent" &&
      (part as AgentPart).agents.some(
        (agent) => agent.id === agentId && agent.status === "completed",
      ),
  );
}
