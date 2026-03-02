/**
 * Agent Lifecycle Guards
 *
 * Guards for preventing premature finalization of background agents.
 * Applied at all finalization paths (tool.complete, stream finalization,
 * handleComplete, agent-only finalization).
 */

import type { ParallelAgent } from "../components/parallel-agents-tree.tsx";
import { isShadowForegroundAgent } from "../utils/background-agent-footer.ts";

/**
 * Determines whether an agent should be finalized when a tool completes.
 * Background agents must NOT be finalized on tool.complete — they continue
 * running until their own subagent.complete event fires.
 *
 * @param agent - The parallel agent to check
 * @returns true if the agent should be finalized, false if it should be skipped
 */
export function shouldFinalizeOnToolComplete(agent: ParallelAgent): boolean {
  if (agent.background) return false;
  if (agent.status === "background") return false;
  return true;
}

/**
 * Returns true when at least one foreground sub-agent is still in-flight.
 * Background agents are intentionally excluded from this gate.
 */
export function hasActiveForegroundAgents(agents: readonly ParallelAgent[]): boolean {
  return agents.some(
    (agent) =>
      (agent.status === "running" || agent.status === "pending")
      && shouldFinalizeOnToolComplete(agent)
      && !isShadowForegroundAgent(agent, agents),
  );
}

/**
 * Stream completion can proceed only when no blocking sub-agents or tools remain.
 */
export function shouldFinalizeDeferredStream(
  agents: readonly ParallelAgent[],
  hasRunningTool: boolean,
): boolean {
  return !hasRunningTool && !hasActiveForegroundAgents(agents);
}
