export type AgentLifecycleViolationCode =
  | "MISSING_START"
  | "OUT_OF_ORDER_EVENT"
  | "INVALID_TERMINAL_TRANSITION";

export interface AgentLifecycleLedgerEntry {
  started: boolean;
  completed: boolean;
  sequence: number;
}

export type AgentLifecycleLedger = Map<string, AgentLifecycleLedgerEntry>;

export type AgentLifecycleTransitionResult =
  | { ok: true; entry: AgentLifecycleLedgerEntry }
  | { ok: false; code: AgentLifecycleViolationCode };

export function createAgentLifecycleLedger(): AgentLifecycleLedger {
  return new Map<string, AgentLifecycleLedgerEntry>();
}

export function registerAgentLifecycleStart(
  ledger: AgentLifecycleLedger,
  agentId: string,
): AgentLifecycleTransitionResult {
  const existing = ledger.get(agentId);
  if (existing?.completed) {
    return { ok: false, code: "INVALID_TERMINAL_TRANSITION" };
  }
  const entry: AgentLifecycleLedgerEntry = {
    started: true,
    completed: false,
    sequence: (existing?.sequence ?? 0) + 1,
  };
  ledger.set(agentId, entry);
  return { ok: true, entry };
}

export function registerAgentLifecycleUpdate(
  ledger: AgentLifecycleLedger,
  agentId: string,
): AgentLifecycleTransitionResult {
  const existing = ledger.get(agentId);
  if (!existing || !existing.started) {
    return { ok: false, code: "MISSING_START" };
  }
  if (existing.completed) {
    return { ok: false, code: "OUT_OF_ORDER_EVENT" };
  }
  const entry: AgentLifecycleLedgerEntry = {
    ...existing,
    sequence: existing.sequence + 1,
  };
  ledger.set(agentId, entry);
  return { ok: true, entry };
}

export function registerAgentLifecycleComplete(
  ledger: AgentLifecycleLedger,
  agentId: string,
): AgentLifecycleTransitionResult {
  const existing = ledger.get(agentId);
  if (!existing || !existing.started) {
    return { ok: false, code: "MISSING_START" };
  }
  if (existing.completed) {
    return { ok: false, code: "INVALID_TERMINAL_TRANSITION" };
  }
  const entry: AgentLifecycleLedgerEntry = {
    ...existing,
    completed: true,
    sequence: existing.sequence + 1,
  };
  ledger.set(agentId, entry);
  return { ok: true, entry };
}

export function formatAgentLifecycleViolation(args: {
  code: AgentLifecycleViolationCode;
  eventType: "stream.agent.start" | "stream.agent.update" | "stream.agent.complete";
  agentId: string;
}): string {
  return `[stream.agent.contract_violation] ${args.code}: received ${args.eventType} for agent "${args.agentId}" without a valid lifecycle transition.`;
}
