import type { ParallelAgent } from "@/components/parallel-agents-tree.tsx";
import type { StreamPartEvent } from "@/state/parts/index.ts";
import { normalizeMarkdownNewlines } from "@/lib/ui/format.ts";

const RUNTIME_ENVELOPE_PART_TYPES = new Set<StreamPartEvent["type"]>([
  "task-list-update",
  "workflow-step-start",
  "workflow-step-complete",
  "task-result-upsert",
]);

export function isRuntimeEnvelopePartEvent(
  part: StreamPartEvent,
): part is Extract<
  StreamPartEvent,
  { type: "task-list-update" | "workflow-step-start" | "workflow-step-complete" | "task-result-upsert" }
> {
  return RUNTIME_ENVELOPE_PART_TYPES.has(part.type);
}

export function toWorkflowStepCompletionMessage(
  part: Extract<StreamPartEvent, { type: "workflow-step-complete" }>,
): string {
  const stepLabel = part.nodeName?.trim() || part.nodeId;
  switch (part.status) {
    case "success":
      return `Workflow step "${stepLabel}" completed.`;
    case "skipped":
      return `Workflow step "${stepLabel}" skipped.`;
    case "error":
      return `Workflow step "${stepLabel}" failed.`;
  }
}

export function shouldProcessStreamLifecycleEvent(
  activeRunId: number | null,
  eventRunId: number,
): boolean {
  return activeRunId !== null && activeRunId === eventRunId;
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

export function buildAgentContinuationPayload(args: {
  agents: readonly ParallelAgent[];
  fallbackText?: string;
}): string | null {
  const agentSections = args.agents
    .filter((agent) => !agent.background)
    .map((agent) => {
      const rawResult = typeof agent.result === "string" && agent.result.trim().length > 0
        ? agent.result
        : agent.error?.trim();
      if (!rawResult) {
        return null;
      }
      const normalizedResult = normalizeMarkdownNewlines(rawResult).trim();
      if (!normalizedResult) {
        return null;
      }
      return `Sub-agent "${agent.name}" result:\n\n${normalizedResult}`;
    })
    .filter((section): section is string => section !== null);

  if (agentSections.length > 0) {
    return `[Sub-agent results]\n\n${agentSections.join("\n\n")}`;
  }

  const fallback = normalizeMarkdownNewlines(args.fallbackText ?? "").trim();
  if (fallback.length > 0) {
    return `[Sub-agent result]\n\n${fallback}`;
  }

  return null;
}

export function getAgentContinuationContractViolation(args: {
  isAgentOnlyStream: boolean;
  continuationPayload: string | null;
}): string | null {
  if (!args.isAgentOnlyStream || args.continuationPayload) {
    return null;
  }
  return "Contract violation (INV-OUTPUT-001): missing @agent continuation input; turn terminated.";
}

export type ContractFailureTerminationReason =
  | "agent_lifecycle_violation"
  | "missing_agent_continuation"
  | "compaction_terminal_error";
