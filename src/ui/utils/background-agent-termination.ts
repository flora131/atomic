import type { ParallelAgent } from "../components/parallel-agents-tree.tsx";
import { getActiveBackgroundAgents } from "./background-agent-footer.ts";
import type { BackgroundTerminationDecision } from "./background-agent-contracts.ts";

export interface BackgroundTerminationKeyEvent {
  name?: string | null;
  ctrl?: boolean;
  shift?: boolean;
  meta?: boolean;
}

// Re-export the canonical BackgroundTerminationDecision type
export type { BackgroundTerminationDecision };

export interface InterruptBackgroundAgentsResult {
  agents: ParallelAgent[];
  interruptedIds: string[];
}

export function isBackgroundTerminationKey(event: BackgroundTerminationKeyEvent): boolean {
  return event.ctrl === true
    && event.shift !== true
    && event.meta !== true
    && event.name === "f";
}

export function getBackgroundTerminationDecision(
  currentPressCount: number,
  activeBackgroundAgentCount: number,
): BackgroundTerminationDecision {
  if (activeBackgroundAgentCount <= 0) {
    return { action: "none" };
  }

  if (currentPressCount >= 1) {
    return {
      action: "terminate",
      message: "All background agents killed",
    };
  }

  return {
    action: "warn",
    message: "Press Ctrl-F again to terminate background agents",
  };
}

export function interruptActiveBackgroundAgents(
  agents: readonly ParallelAgent[],
  nowMs: number = Date.now(),
): InterruptBackgroundAgentsResult {
  const activeBackgroundAgents = getActiveBackgroundAgents(agents);
  const interruptedIds = activeBackgroundAgents.map((agent) => agent.id);
  if (interruptedIds.length === 0) {
    return {
      agents: [...agents],
      interruptedIds,
    };
  }

  const interruptedIdSet = new Set(interruptedIds);
  const nextAgents = agents.map((agent) => {
    if (!interruptedIdSet.has(agent.id)) {
      return agent;
    }

    const startedAtMs = new Date(agent.startedAt).getTime();
    const durationMs = Number.isFinite(startedAtMs)
      ? Math.max(0, nowMs - startedAtMs)
      : agent.durationMs;

    return {
      ...agent,
      status: "interrupted" as const,
      currentTool: undefined,
      durationMs,
    };
  });

  return {
    agents: nextAgents,
    interruptedIds,
  };
}
