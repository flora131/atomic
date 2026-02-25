import type { ParallelAgent } from "../components/parallel-agents-tree.tsx";

export interface BackgroundAgentFooterMessage {
  parallelAgents?: readonly ParallelAgent[];
}

export function isBackgroundAgent(agent: ParallelAgent): boolean {
  return agent.background === true || agent.status === "background";
}

const BACKGROUND_SHADOW_MAX_START_DELTA_MS = 2 * 60 * 1000;

function toEpochMs(iso: string): number | null {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Detects foreground "shadow" agents that are duplicate render artifacts
 * for an already-tracked background agent.
 *
 * Shadow agents are treated as non-blocking and hidden from foreground trees.
 */
export function isShadowForegroundAgent(
  agent: ParallelAgent,
  allAgents: readonly ParallelAgent[],
): boolean {
  if (isBackgroundAgent(agent)) return false;
  if (agent.status !== "running" && agent.status !== "pending") return false;

  const activeBackgroundAgents = allAgents.filter((candidate) => {
    if (!isBackgroundAgent(candidate)) return false;
    return isActiveBackgroundStatus(candidate.status);
  });
  if (activeBackgroundAgents.length === 0) return false;

  // Strong signal: explicit Task-tool correlation to a background entry.
  if (agent.taskToolCallId) {
    return activeBackgroundAgents.some(
      (backgroundAgent) =>
        backgroundAgent.id === agent.taskToolCallId
        || backgroundAgent.taskToolCallId === agent.taskToolCallId,
    );
  }

  const eagerBackgroundAgents = activeBackgroundAgents.filter(
    (backgroundAgent) =>
      typeof backgroundAgent.taskToolCallId === "string"
      && backgroundAgent.taskToolCallId.length > 0
      && backgroundAgent.id === backgroundAgent.taskToolCallId,
  );

  // Fallback for missing correlation IDs (provider parity edge case):
  // same agent type/name launched within a short window, but only against
  // eager Task placeholders (id === taskToolCallId).
  if (eagerBackgroundAgents.length === 0) return false;

  const normalizedName = agent.name.trim().toLowerCase();
  if (normalizedName.length === 0) return false;
  const foregroundStartMs = toEpochMs(agent.startedAt);
  if (foregroundStartMs === null) return false;

  return eagerBackgroundAgents.some((backgroundAgent) => {
    if (backgroundAgent.name.trim().toLowerCase() !== normalizedName) return false;
    const backgroundStartMs = toEpochMs(backgroundAgent.startedAt);
    if (backgroundStartMs === null) return false;
    return Math.abs(foregroundStartMs - backgroundStartMs) <= BACKGROUND_SHADOW_MAX_START_DELTA_MS;
  });
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
  if (count === 1) return "1 local agent";
  return `${count} local agents`;
}
