import type { ParallelAgent } from "@/types/parallel-agents.ts";
import { getActiveBackgroundAgents } from "@/state/chat/shared/helpers/background-agent-footer.ts";

export interface InterruptBackgroundAgentsResult {
  agents: ParallelAgent[];
  interruptedIds: string[];
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
