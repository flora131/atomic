export type BackgroundAgentHintStatus =
  | "pending"
  | "running"
  | "completed"
  | "error"
  | "background"
  | "interrupted";

export interface BackgroundAgentHintAgent {
  background?: boolean;
  status: BackgroundAgentHintStatus;
}

function isBackgroundAgent(agent: BackgroundAgentHintAgent): boolean {
  return agent.background === true || agent.status === "background";
}

function isActiveBackgroundStatus(status: BackgroundAgentHintStatus): boolean {
  return status === "background" || status === "running" || status === "pending";
}

export function buildParallelAgentsHeaderHint(
  agents: readonly BackgroundAgentHintAgent[],
  showExpandHint: boolean,
): string {
  const backgroundAgents = agents.filter(isBackgroundAgent);

  if (backgroundAgents.some((agent) => isActiveBackgroundStatus(agent.status))) {
    return "background running · ctrl+f terminate";
  }

  if (showExpandHint && backgroundAgents.length > 0) {
    return "background complete · ctrl+o to expand";
  }

  if (showExpandHint) {
    return "ctrl+o to expand";
  }

  return "";
}
