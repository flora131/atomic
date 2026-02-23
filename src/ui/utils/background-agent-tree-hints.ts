import { BACKGROUND_TREE_HINT_CONTRACT } from "./background-agent-contracts.ts";

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
    return BACKGROUND_TREE_HINT_CONTRACT.whenRunning;
  }

  if (showExpandHint && backgroundAgents.length > 0) {
    return BACKGROUND_TREE_HINT_CONTRACT.whenComplete;
  }

  if (showExpandHint) {
    return BACKGROUND_TREE_HINT_CONTRACT.defaultHint;
  }

  return "";
}
