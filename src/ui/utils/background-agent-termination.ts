import type { ParallelAgent } from "../components/parallel-agents-tree.tsx";
import { getActiveBackgroundAgents } from "./background-agent-footer.ts";

export interface BackgroundTerminationKeyEvent {
  name?: string | null;
  ctrl?: boolean;
  shift?: boolean;
  meta?: boolean;
}

export interface BackgroundTerminationDecision {
  shouldWarn: boolean;
  shouldTerminate: boolean;
  nextPressCount: number;
}

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
    return {
      shouldWarn: false,
      shouldTerminate: false,
      nextPressCount: 0,
    };
  }

  const nextPressCount = currentPressCount + 1;
  if (nextPressCount >= 2) {
    return {
      shouldWarn: false,
      shouldTerminate: true,
      nextPressCount: 0,
    };
  }

  return {
    shouldWarn: true,
    shouldTerminate: false,
    nextPressCount,
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
