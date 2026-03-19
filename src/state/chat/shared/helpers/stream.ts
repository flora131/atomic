import type { StreamPartEvent } from "@/state/parts/index.ts";

const RUNTIME_ENVELOPE_PART_TYPES = new Set<StreamPartEvent["type"]>([
  "task-list-update",
  "task-result-upsert",
]);

export function isRuntimeEnvelopePartEvent(
  part: StreamPartEvent,
): part is Extract<
  StreamPartEvent,
  { type: "task-list-update" | "task-result-upsert" }
> {
  return RUNTIME_ENVELOPE_PART_TYPES.has(part.type);
}

export function shouldProcessStreamLifecycleEvent(
  activeRunId: number | null,
  eventRunId: number,
): boolean {
  return activeRunId !== null && activeRunId === eventRunId;
}

export function shouldBindStreamSessionRun(args: {
  activeRunId: number | null;
  eventRunId: number;
  isStreaming: boolean;
  nextRunIdFloor: number | null;
}): boolean {
  if (!args.isStreaming) {
    return false;
  }

  if (typeof args.nextRunIdFloor === "number" && args.eventRunId < args.nextRunIdFloor) {
    return false;
  }

  if (args.activeRunId === null) {
    return true;
  }

  return args.activeRunId === args.eventRunId;
}

export function shouldProcessStreamPartEvent(args: {
  activeRunId: number | null;
  partRunId: number | undefined;
  isStreaming: boolean;
}): boolean {
  if (typeof args.partRunId !== "number") {
    return true;
  }

  if (args.activeRunId === null) {
    return !args.isStreaming;
  }

  return args.partRunId === args.activeRunId;
}

export function shouldFinalizeAgentOnlyStream(args: {
  hasStreamingMessage: boolean;
  isStreaming: boolean;
  isAgentOnlyStream: boolean;
  liveAgentCount: number;
  messageAgentCount: number;
}): boolean {
  return args.hasStreamingMessage
    && args.isStreaming
    && args.isAgentOnlyStream
    && (args.liveAgentCount > 0 || args.messageAgentCount > 0);
}

export function shouldDeferPostCompleteDeltaUntilDoneProjection(args: {
  completionSequence: number | undefined;
  doneProjected: boolean;
}): boolean {
  return typeof args.completionSequence === "number" && !args.doneProjected;
}

export function queueAgentTerminalBeforeDeferredDeltas(args: {
  messageId: string;
  terminal: Extract<StreamPartEvent, { type: "agent-terminal" }>;
  queueMessagePartUpdate: (messageId: string, update: StreamPartEvent) => void;
  flushDeferredPostCompleteDeltas: (agentId: string) => void;
}): void {
  args.queueMessagePartUpdate(args.messageId, {
    type: "agent-terminal",
    runId: args.terminal.runId,
    agentId: args.terminal.agentId,
    status: args.terminal.status,
    ...(args.terminal.result !== undefined ? { result: args.terminal.result } : {}),
    ...(args.terminal.error !== undefined ? { error: args.terminal.error } : {}),
    ...(args.terminal.completedAt !== undefined ? { completedAt: args.terminal.completedAt } : {}),
  });

  if (args.terminal.status === "completed") {
    args.flushDeferredPostCompleteDeltas(args.terminal.agentId);
  }
}

export type ContractFailureTerminationReason =
  | "agent_lifecycle_violation"
  | "compaction_terminal_error";
