export type AgentOrderingEventType =
  | "agent_complete_received"
  | "agent_done_projected"
  | "agent_done_rendered"
  | "post_complete_delta_rendered";

export type AgentOrderingEventSource =
  | "typed-bus"
  | "wildcard-batch"
  | "ui-effect"
  | "sync-bridge";

export interface AgentOrderingEvent {
  sessionId: string;
  agentId: string;
  messageId: string;
  type: AgentOrderingEventType;
  sequence: number;
  timestampMs: number;
  source: AgentOrderingEventSource;
}

export interface DoneStateProjection {
  sessionId: string;
  messageId: string;
  agentId: string;
  fromStatus: "running" | "pending";
  toStatus: "completed";
  projectionMode: "effect" | "sync-bridge";
  idempotencyKey: string;
}

export interface OrderingContractConfig {
  enableOrderingDiagnostics: boolean;
}

export interface AgentOrderingState {
  lastCompletionSequenceByAgent: Map<string, number>;
  doneProjectedByAgent: Map<string, boolean>;
  firstPostCompleteDeltaSequenceByAgent: Map<string, number>;
  projectionSourceByAgent: Map<string, DoneStateProjection["projectionMode"]>;
}

export function createAgentOrderingState(): AgentOrderingState {
  return {
    lastCompletionSequenceByAgent: new Map<string, number>(),
    doneProjectedByAgent: new Map<string, boolean>(),
    firstPostCompleteDeltaSequenceByAgent: new Map<string, number>(),
    projectionSourceByAgent: new Map<string, DoneStateProjection["projectionMode"]>(),
  };
}

export function clearAgentOrderingState(state: AgentOrderingState): void {
  state.lastCompletionSequenceByAgent.clear();
  state.doneProjectedByAgent.clear();
  state.firstPostCompleteDeltaSequenceByAgent.clear();
  state.projectionSourceByAgent.clear();
}

export function resetAgentOrderingForAgent(state: AgentOrderingState, agentId: string): void {
  state.lastCompletionSequenceByAgent.delete(agentId);
  state.doneProjectedByAgent.delete(agentId);
  state.firstPostCompleteDeltaSequenceByAgent.delete(agentId);
  state.projectionSourceByAgent.delete(agentId);
}

export function pruneAgentOrderingState(
  state: AgentOrderingState,
  activeAgentIds: ReadonlySet<string>,
): void {
  const knownAgentIds = new Set<string>();
  for (const agentId of state.lastCompletionSequenceByAgent.keys()) knownAgentIds.add(agentId);
  for (const agentId of state.doneProjectedByAgent.keys()) knownAgentIds.add(agentId);
  for (const agentId of state.firstPostCompleteDeltaSequenceByAgent.keys()) knownAgentIds.add(agentId);
  for (const agentId of state.projectionSourceByAgent.keys()) knownAgentIds.add(agentId);

  for (const agentId of knownAgentIds) {
    if (!activeAgentIds.has(agentId)) {
      resetAgentOrderingForAgent(state, agentId);
    }
  }
}

export function registerAgentCompletionSequence(
  state: AgentOrderingState,
  agentId: string,
  sequence: number,
): void {
  const previousSequence = state.lastCompletionSequenceByAgent.get(agentId) ?? sequence;
  state.lastCompletionSequenceByAgent.set(agentId, Math.max(previousSequence, sequence));
  state.doneProjectedByAgent.set(agentId, false);
  state.firstPostCompleteDeltaSequenceByAgent.delete(agentId);
  state.projectionSourceByAgent.delete(agentId);
}

export function registerDoneStateProjection(
  state: AgentOrderingState,
  args: {
    agentId: string;
    sequence: number;
    projectionMode: DoneStateProjection["projectionMode"];
  },
): boolean {
  const wasProjected = state.doneProjectedByAgent.get(args.agentId) === true;
  if (wasProjected) {
    return false;
  }
  const previousCompletionSequence = state.lastCompletionSequenceByAgent.get(args.agentId) ?? args.sequence;
  state.lastCompletionSequenceByAgent.set(args.agentId, Math.max(previousCompletionSequence, args.sequence));
  state.doneProjectedByAgent.set(args.agentId, true);
  state.projectionSourceByAgent.set(args.agentId, args.projectionMode);
  return true;
}

export function registerFirstPostCompleteDeltaSequence(
  state: AgentOrderingState,
  agentId: string,
  sequence: number,
): boolean {
  if (!state.lastCompletionSequenceByAgent.has(agentId)) {
    return false;
  }
  if (state.firstPostCompleteDeltaSequenceByAgent.has(agentId)) {
    return false;
  }
  state.firstPostCompleteDeltaSequenceByAgent.set(agentId, sequence);
  return true;
}

export function hasDoneStateProjection(state: AgentOrderingState, agentId: string): boolean {
  return state.doneProjectedByAgent.get(agentId) === true;
}
