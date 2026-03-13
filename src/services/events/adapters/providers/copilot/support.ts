import type { BusEvent } from "@/services/events/bus-events.ts";
import type { SubagentToolTracker } from "@/services/events/adapters/subagent-tool-tracker.ts";
import {
  asRecord,
  asString,
  normalizeToolName,
} from "@/services/events/adapters/provider-shared.ts";
import {
  DEFAULT_WORKFLOW_RUNTIME_FEATURE_FLAGS,
  resolveWorkflowRuntimeFeatureFlags,
  type WorkflowRuntimeFeatureFlagOverrides,
  type WorkflowRuntimeFeatureFlags,
} from "@/services/workflows/runtime-contracts.ts";
import type {
  CopilotActiveSubagentToolContext,
  CopilotTaskToolMetadata,
  CopilotSyntheticForegroundAgent,
  CopilotThinkingStreamState,
} from "@/services/events/adapters/providers/copilot/types.ts";

export function normalizeCopilotToolInput(
  value: unknown,
): Record<string, unknown> {
  const record = asRecord(value);
  if (record) {
    return record;
  }

  if (value === undefined || value === null) {
    return {};
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return {};
    }
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const parsedRecord = asRecord(parsed);
      if (parsedRecord) {
        return parsedRecord;
      }
    } catch {
      // Keep the raw string payload when it's not valid JSON.
    }
    return { value };
  }

  return { value };
}

export function resolveCopilotToolStartId(
  toolNameById: Map<string, string>,
  toolCallId: string,
  toolName: string,
): string {
  toolNameById.set(toolCallId, toolName);
  return toolCallId;
}

export function resolveCopilotToolCompleteId(
  toolNameById: Map<string, string>,
  toolCallId: string,
): string {
  toolNameById.delete(toolCallId);
  return toolCallId;
}

export function extractCopilotTaskToolMetadata(
  toolInput: unknown,
): CopilotTaskToolMetadata {
  const record = asRecord(toolInput) ?? {};
  return {
    description:
      asString(record.description) ??
      asString(record.prompt) ??
      asString(record.task) ??
      "",
    isBackground:
      record.run_in_background === true ||
      asString(record.mode)?.toLowerCase() === "background",
    agentType:
      asString(record.subagent_type) ??
      asString(record.subagentType) ??
      asString(record.agent_type) ??
      asString(record.agentType) ??
      asString(record.agent),
  };
}

export function mergeCopilotTaskToolMetadata(
  existing: CopilotTaskToolMetadata | undefined,
  incoming: CopilotTaskToolMetadata,
): CopilotTaskToolMetadata {
  if (!existing) {
    return incoming;
  }
  return {
    description: incoming.description || existing.description,
    isBackground: incoming.isBackground || existing.isBackground,
    agentType: incoming.agentType ?? existing.agentType,
  };
}

export function storeCopilotTaskToolMetadata(
  taskToolMetadata: Map<string, CopilotTaskToolMetadata>,
  toolCallId: string,
  toolInput: unknown,
): void {
  taskToolMetadata.set(
    toolCallId,
    mergeCopilotTaskToolMetadata(
      taskToolMetadata.get(toolCallId),
      extractCopilotTaskToolMetadata(toolInput),
    ),
  );
}

export function resolveCopilotTaskToolCallIdForSubagent(
  toolNameById: Map<string, string>,
  toolCallIdToSubagentId: Map<string, string>,
  subagentId: string,
): string | undefined {
  if (toolNameById.has(subagentId)) {
    return subagentId;
  }

  for (const [toolCallId, agentId] of toolCallIdToSubagentId) {
    if (agentId === subagentId && toolNameById.has(toolCallId)) {
      return toolCallId;
    }
  }

  return undefined;
}

export function resolveCopilotParentAgentId(args: {
  rawParentToolCallId: string | undefined;
  subagentTracker: SubagentToolTracker | null;
  toolCallIdToSubagentId: Map<string, string>;
}): string | undefined {
  if (args.rawParentToolCallId) {
    if (args.subagentTracker?.hasAgent(args.rawParentToolCallId)) {
      return args.rawParentToolCallId;
    }
    const mappedParentAgentId = args.toolCallIdToSubagentId.get(
      args.rawParentToolCallId,
    );
    if (mappedParentAgentId) {
      return mappedParentAgentId;
    }
  }

  return undefined;
}

export function buildCopilotThinkingStreamKey(
  sourceKey: string,
  agentId: string | undefined,
): string {
  return `${agentId ?? "__root__"}::${sourceKey}`;
}

export function getCopilotThinkingStreamKey(
  thinkingStreams: Map<string, CopilotThinkingStreamState>,
  sourceKey: string,
  agentId: string | undefined,
): string | undefined {
  const key = buildCopilotThinkingStreamKey(sourceKey, agentId);
  return thinkingStreams.has(key) ? key : undefined;
}

export function ensureCopilotThinkingStream(
  thinkingStreams: Map<string, CopilotThinkingStreamState>,
  sourceKey: string,
  agentId: string | undefined,
): void {
  const key = buildCopilotThinkingStreamKey(sourceKey, agentId);
  if (!thinkingStreams.has(key)) {
    thinkingStreams.set(key, {
      startTime: Date.now(),
      sourceKey,
      ...(agentId ? { agentId } : {}),
    });
  }
}

export function recordCopilotActiveSubagentToolContext(
  activeSubagentToolsById: Map<string, CopilotActiveSubagentToolContext>,
  toolId: string,
  toolName: string,
  parentAgentId: string,
  ...correlationIds: Array<string | undefined>
): void {
  const context = { parentAgentId, toolName };
  const ids = [toolId, ...correlationIds].filter((id): id is string =>
    Boolean(id)
  );
  for (const id of ids) {
    activeSubagentToolsById.set(id, context);
  }
}

export function removeCopilotActiveSubagentToolContext(
  activeSubagentToolsById: Map<string, CopilotActiveSubagentToolContext>,
  toolId: string,
  ...correlationIds: Array<string | undefined>
): void {
  const ids = [toolId, ...correlationIds].filter((id): id is string =>
    Boolean(id)
  );
  for (const id of ids) {
    activeSubagentToolsById.delete(id);
  }
}

export function publishCopilotSyntheticTaskToolComplete(args: {
  toolCallId: string;
  toolNameById: Map<string, string>;
  activeSubagentToolsById: Map<string, CopilotActiveSubagentToolContext>;
  emittedToolStartIds: Set<string>;
  subagentTracker: SubagentToolTracker | null;
  publishEvent: (event: BusEvent) => void;
  sessionId: string;
  runId: number;
  completion: { success: boolean; result?: unknown; error?: string };
}): void {
  const toolName = args.toolNameById.get(args.toolCallId);
  if (!toolName) {
    return;
  }

  const toolId = resolveCopilotToolCompleteId(
    args.toolNameById,
    args.toolCallId,
  );
  const activeToolContext = args.activeSubagentToolsById.get(args.toolCallId);
  removeCopilotActiveSubagentToolContext(
    args.activeSubagentToolsById,
    toolId,
    args.toolCallId,
  );
  args.emittedToolStartIds.delete(args.toolCallId);
  if (
    activeToolContext?.parentAgentId &&
    args.subagentTracker?.hasAgent(activeToolContext.parentAgentId)
  ) {
    args.subagentTracker.onToolComplete(activeToolContext.parentAgentId);
  }

  args.publishEvent({
    type: "stream.tool.complete",
    sessionId: args.sessionId,
    runId: args.runId,
    timestamp: Date.now(),
    data: {
      toolId,
      toolName,
      toolResult: args.completion.result,
      success: args.completion.success,
      error: args.completion.error,
      sdkCorrelationId: args.toolCallId,
      ...(activeToolContext?.parentAgentId
        ? { parentAgentId: activeToolContext.parentAgentId }
        : {}),
    },
  });
}

export function resolveCopilotRuntimeFeatureFlags(
  overrides: WorkflowRuntimeFeatureFlagOverrides | undefined,
): WorkflowRuntimeFeatureFlags {
  return resolveWorkflowRuntimeFeatureFlags(overrides);
}

export function resetCopilotRuntimeFeatureFlags(): WorkflowRuntimeFeatureFlags {
  return { ...DEFAULT_WORKFLOW_RUNTIME_FEATURE_FLAGS };
}

export function getSyntheticForegroundAgentIdForAttribution(
  syntheticForegroundAgent: CopilotSyntheticForegroundAgent | null,
): string | undefined {
  if (!syntheticForegroundAgent) {
    return undefined;
  }
  if (
    syntheticForegroundAgent.completed ||
    syntheticForegroundAgent.sawNativeSubagentStart
  ) {
    return undefined;
  }
  return syntheticForegroundAgent.id;
}

export function publishSyntheticForegroundAgentStart(args: {
  syntheticForegroundAgent: CopilotSyntheticForegroundAgent | null;
  subagentTracker: SubagentToolTracker | null;
  publishEvent: (event: BusEvent) => void;
  sessionId: string;
  runId: number;
}): void {
  const syntheticAgent = args.syntheticForegroundAgent;
  if (
    !syntheticAgent ||
    syntheticAgent.started ||
    syntheticAgent.sawNativeSubagentStart
  ) {
    return;
  }
  syntheticAgent.started = true;
  args.subagentTracker?.registerAgent(syntheticAgent.id, { isBackground: false });
  args.publishEvent({
    type: "stream.agent.start",
    sessionId: args.sessionId,
    runId: args.runId,
    timestamp: Date.now(),
    data: {
      agentId: syntheticAgent.id,
      toolCallId: syntheticAgent.id,
      agentType: syntheticAgent.name,
      task: syntheticAgent.task,
      isBackground: false,
      sdkCorrelationId: syntheticAgent.id,
    },
  });
}

export function publishSyntheticForegroundAgentComplete(args: {
  syntheticForegroundAgent: CopilotSyntheticForegroundAgent | null;
  subagentTracker: SubagentToolTracker | null;
  publishEvent: (event: BusEvent) => void;
  sessionId: string;
  runId: number;
  accumulatedText: string;
  success: boolean;
  error?: string;
}): void {
  const syntheticAgent = args.syntheticForegroundAgent;
  if (!syntheticAgent || !syntheticAgent.started || syntheticAgent.completed) {
    return;
  }
  syntheticAgent.completed = true;
  args.subagentTracker?.removeAgent(syntheticAgent.id);
  args.publishEvent({
    type: "stream.agent.complete",
    sessionId: args.sessionId,
    runId: args.runId,
    timestamp: Date.now(),
    data: {
      agentId: syntheticAgent.id,
      success: args.success,
      result: args.success ? args.accumulatedText : undefined,
      ...(args.error ? { error: args.error } : {}),
    },
  });
}

export function promoteSyntheticForegroundAgentIdentity(args: {
  syntheticForegroundAgent: CopilotSyntheticForegroundAgent | null;
  subagentTracker: SubagentToolTracker | null;
  activeSubagentToolsById: Map<string, CopilotActiveSubagentToolContext>;
  earlyToolEvents: Map<string, unknown[]>;
  realAgentId: string;
}): void {
  const syntheticAgent = args.syntheticForegroundAgent;
  if (
    !syntheticAgent ||
    !syntheticAgent.started ||
    syntheticAgent.id === args.realAgentId
  ) {
    return;
  }

  syntheticAgent.sawNativeSubagentStart = true;
  args.subagentTracker?.transferAgent(syntheticAgent.id, args.realAgentId);

  for (const [contextKey, context] of args.activeSubagentToolsById.entries()) {
    if (context.parentAgentId === syntheticAgent.id) {
      args.activeSubagentToolsById.set(contextKey, {
        ...context,
        parentAgentId: args.realAgentId,
      });
    }
  }

  const syntheticQueue = args.earlyToolEvents.get(syntheticAgent.id);
  if (syntheticQueue) {
    const existingQueue = args.earlyToolEvents.get(args.realAgentId) ?? [];
    args.earlyToolEvents.set(args.realAgentId, [
      ...existingQueue,
      ...syntheticQueue,
    ]);
    args.earlyToolEvents.delete(syntheticAgent.id);
  }
}

export { asRecord, asString, normalizeToolName };
