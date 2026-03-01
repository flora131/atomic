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

export interface BackgroundTerminationPressEvaluation {
  pressCount: number;
  nextPressCount: number;
  decision: BackgroundTerminationDecision;
}

export interface ExecuteBackgroundTerminationOptions {
  getAgents: () => readonly ParallelAgent[];
  onTerminateBackgroundAgents?: () => void | Promise<void>;
  nowMs?: number;
}

export type ExecuteBackgroundTerminationResult =
  | {
    status: "noop";
    agents: ParallelAgent[];
    interruptedIds: [];
  }
  | {
    status: "terminated";
    agents: ParallelAgent[];
    interruptedIds: string[];
  }
  | {
    status: "failed";
    agents: ParallelAgent[];
    interruptedIds: [];
    error: unknown;
  };

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

/**
 * Evaluate a Ctrl+F keypress using a synchronous mutable press counter.
 *
 * This intentionally mutates `pressCountRef.current` immediately so rapid
 * key events in the same input frame do not read stale React state.
 */
export function evaluateBackgroundTerminationPress(
  pressCountRef: { current: number },
  activeBackgroundAgentCount: number,
): BackgroundTerminationPressEvaluation {
  const pressCount = pressCountRef.current;
  const decision = getBackgroundTerminationDecision(pressCount, activeBackgroundAgentCount);
  const nextPressCount = decision.action === "warn" ? pressCount + 1 : 0;
  pressCountRef.current = nextPressCount;
  return {
    pressCount,
    nextPressCount,
    decision,
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

/**
 * Execute confirmed background termination in two phases:
 * 1) verify there is active work to terminate,
 * 2) await runtime abort callback,
 * 3) apply local interruption state against the latest agent snapshot.
 */
export async function executeBackgroundTermination(
  options: ExecuteBackgroundTerminationOptions,
): Promise<ExecuteBackgroundTerminationResult> {
  const initialAgents = options.getAgents();
  const hasActiveBackgroundAgents = getActiveBackgroundAgents(initialAgents).length > 0;
  if (!hasActiveBackgroundAgents) {
    return {
      status: "noop",
      agents: [...initialAgents],
      interruptedIds: [],
    };
  }

  try {
    await Promise.resolve(options.onTerminateBackgroundAgents?.());
  } catch (error) {
    return {
      status: "failed",
      agents: [...options.getAgents()],
      interruptedIds: [],
      error,
    };
  }

  const result = interruptActiveBackgroundAgents(
    options.getAgents(),
    options.nowMs ?? Date.now(),
  );
  return {
    status: "terminated",
    agents: result.agents,
    interruptedIds: result.interruptedIds,
  };
}
