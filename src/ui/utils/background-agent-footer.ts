import type { ParallelAgent } from "../components/parallel-agents-tree.tsx";

export interface BackgroundAgentFooterMessage {
  parallelAgents?: readonly ParallelAgent[];
}

function isBackgroundAgent(agent: ParallelAgent): boolean {
  return agent.background === true || agent.status === "background";
}

function isActiveBackgroundStatus(status: ParallelAgent["status"]): boolean {
  return status === "background" || status === "running" || status === "pending";
}

export function getActiveBackgroundAgents(
  agents: readonly ParallelAgent[],
): ParallelAgent[] {
  return agents.filter((agent) => {
    if (!isBackgroundAgent(agent)) return false;
    return isActiveBackgroundStatus(agent.status);
  });
}

export function resolveBackgroundAgentsForFooter(
  liveAgents: readonly ParallelAgent[],
  messages: readonly BackgroundAgentFooterMessage[],
): ParallelAgent[] {
  const activeLiveAgents = getActiveBackgroundAgents(liveAgents);
  if (activeLiveAgents.length > 0) {
    return activeLiveAgents;
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const snapshot = getActiveBackgroundAgents(
      messages[index]?.parallelAgents ?? [],
    );
    if (snapshot.length > 0) {
      return snapshot;
    }
  }

  return [];
}

export function formatBackgroundAgentFooterStatus(
  agents: readonly ParallelAgent[],
): string {
  const count = agents.length;
  if (count === 0) return "";
  if (count === 1) return "1 background agent running";
  return `${count} background agents running`;
}
