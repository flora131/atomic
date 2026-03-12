import type { BusEvent } from "@/services/events/bus-events.ts";
import type { EventBus } from "@/services/events/event-bus.ts";
import type {
  EventHandler,
  ToolCompleteEventData,
  ToolStartEventData,
} from "@/services/agents/types.ts";
import { SubagentToolTracker } from "@/services/events/adapters/subagent-tool-tracker.ts";
import type { OpenCodeTaskToolMetadata } from "@/services/events/adapters/providers/opencode/tool-state.ts";

type OpenCodeToolEventHandlerDependencies = {
  bus: EventBus;
  sessionId: string;
  taskPlaceholderSignature: string;
  toolStartSignatureByToolId: Map<string, string>;
  taskToolMetadata: Map<string, OpenCodeTaskToolMetadata>;
  toolUseIdToSubagentId: Map<string, string>;
  trackedToolStartKeys: Set<string>;
  activeSubagentToolsById: Map<string, { parentAgentId: string; toolName: string }>;
  completedToolIds: Set<string>;
  getSubagentTracker: () => SubagentToolTracker | null;
  resolveParentToolCorrelationId: (data: Record<string, unknown>) => string | undefined;
  resolveParentAgentId: (
    eventSessionId: string,
    data: Record<string, unknown>,
  ) => string | undefined;
  asString: (value: unknown) => string | undefined;
  asRecord: (value: unknown) => Record<string, unknown> | undefined;
  resolveToolCorrelationId: (correlationId: string | undefined) => string | undefined;
  normalizeToolName: (value: unknown) => string;
  resolveToolStartId: (
    explicitToolId: string | undefined,
    runId: number,
    toolName: string,
  ) => string;
  resolveToolCompleteId: (
    explicitToolId: string | undefined,
    runId: number,
    toolName: string,
  ) => string;
  buildToolStartSignature: (
    toolName: string,
    toolInput: Record<string, unknown>,
    toolMetadata: Record<string, unknown> | undefined,
    parentAgentId: string | undefined,
  ) => string;
  hasTaskDispatchDetails: (toolInput: unknown) => boolean;
  isTaskTool: (toolName: string) => boolean;
  removeQueuedToolId: (toolName: string, toolId: string) => void;
  registerToolCorrelationAliases: (
    toolId: string,
    ...correlationIds: Array<string | undefined>
  ) => void;
  recordPendingTaskToolCorrelationId: (correlationId: string) => void;
  extractTaskToolMetadata: (
    toolInput: unknown,
    eventData?: Record<string, unknown>,
  ) => OpenCodeTaskToolMetadata;
  mergeTaskToolMetadata: (
    existing: OpenCodeTaskToolMetadata | undefined,
    incoming: OpenCodeTaskToolMetadata,
  ) => OpenCodeTaskToolMetadata;
  resolvePendingSubagentTaskCorrelation: (taskCorrelationId: string) => void;
  registerTaskSubagentSessionCorrelation: (
    taskCorrelationId: string,
    subagentSessionId: string | undefined,
  ) => void;
  maybeHydrateTaskChildSession: (
    runId: number,
    taskCorrelationId: string,
    childSessionId: string | undefined,
    parentAgentId: string | undefined,
  ) => void;
  recordActiveSubagentToolContext: (
    toolId: string,
    toolName: string,
    parentAgentId: string,
    ...correlationIds: Array<string | undefined>
  ) => void;
  buildTrackedToolStartKey: (parentAgentId: string, toolId: string) => string;
  queueEarlyToolEvent: (key: string, toolId: string, toolName: string) => void;
  removeActiveSubagentToolContext: (
    toolId: string,
    ...correlationIds: Array<string | undefined>
  ) => void;
  removeEarlyToolEvent: (key: string, toolId: string) => void;
  hydrateCompletedTaskDispatch: (
    runId: number,
    parentSessionId: string,
    taskCorrelationId: string,
    toolId: string,
    attributedParentAgentId: string | undefined,
  ) => Promise<void>;
};

export class OpenCodeToolEventHandlers {
  constructor(private readonly deps: OpenCodeToolEventHandlerDependencies) {}

  createToolStartHandler(runId: number): EventHandler<"tool.start"> {
    return (event) => {
      const data = event.data as ToolStartEventData;
      const dataRecord = data as Record<string, unknown>;
      const parentToolUseId = this.deps.resolveParentToolCorrelationId(dataRecord);
      const parentAgentId = this.deps.resolveParentAgentId(event.sessionId, dataRecord);
      if (event.sessionId !== this.deps.sessionId && !parentAgentId) {
        return;
      }

      const sdkToolUseId = this.deps.asString(data.toolUseId ?? data.toolUseID);
      const sdkToolCallId = this.deps.asString(data.toolCallId);
      const sdkCorrelationId = sdkToolUseId ?? sdkToolCallId;
      const resolvedSdkCorrelationId = this.deps.resolveToolCorrelationId(sdkCorrelationId);
      const toolName = this.deps.normalizeToolName(data.toolName);
      const taskCorrelationId = resolvedSdkCorrelationId ?? sdkCorrelationId;
      const toolId = this.deps.resolveToolStartId(
        resolvedSdkCorrelationId ?? sdkCorrelationId,
        runId,
        toolName,
      );
      const toolMetadata = this.deps.asRecord(dataRecord.toolMetadata);
      const toolInput = (data.toolInput ?? {}) as Record<string, unknown>;
      const toolStartSignature = this.deps.buildToolStartSignature(
        toolName,
        toolInput,
        toolMetadata,
        parentAgentId,
      );
      const previousStartSignature = this.deps.toolStartSignatureByToolId.get(toolId);
      if (previousStartSignature === toolStartSignature) {
        return;
      }

      const hasTaskDispatchDetails = this.deps.hasTaskDispatchDetails(data.toolInput);
      if (this.deps.isTaskTool(toolName) && !hasTaskDispatchDetails && !previousStartSignature) {
        this.deps.toolStartSignatureByToolId.set(toolId, this.deps.taskPlaceholderSignature);
        this.deps.removeQueuedToolId(toolName, toolId);
        this.deps.registerToolCorrelationAliases(toolId, sdkToolUseId, sdkToolCallId);
        if (taskCorrelationId) {
          this.deps.recordPendingTaskToolCorrelationId(taskCorrelationId);
        }
        return;
      }

      this.deps.toolStartSignatureByToolId.set(toolId, toolStartSignature);
      this.deps.registerToolCorrelationAliases(toolId, sdkToolUseId, sdkToolCallId);
      if (this.deps.isTaskTool(toolName) && taskCorrelationId) {
        const metadata = this.deps.extractTaskToolMetadata(data.toolInput, dataRecord);
        const existingMetadata = this.deps.taskToolMetadata.get(taskCorrelationId);
        const mergedMetadata = this.deps.mergeTaskToolMetadata(existingMetadata, metadata);
        this.deps.taskToolMetadata.set(taskCorrelationId, mergedMetadata);
        this.deps.recordPendingTaskToolCorrelationId(taskCorrelationId);
        this.deps.resolvePendingSubagentTaskCorrelation(taskCorrelationId);
        this.deps.registerTaskSubagentSessionCorrelation(
          taskCorrelationId,
          mergedMetadata.subagentSessionId,
        );
        this.deps.maybeHydrateTaskChildSession(
          runId,
          taskCorrelationId,
          mergedMetadata.subagentSessionId,
          parentAgentId,
        );
      }

      if (parentAgentId) {
        this.deps.recordActiveSubagentToolContext(
          toolId,
          toolName,
          parentAgentId,
          sdkToolUseId,
          sdkToolCallId,
          taskCorrelationId,
        );
        const trackerKey = this.deps.buildTrackedToolStartKey(parentAgentId, toolId);
        if (!this.deps.trackedToolStartKeys.has(trackerKey)) {
          if (this.deps.getSubagentTracker()?.hasAgent(parentAgentId)) {
            this.deps.trackedToolStartKeys.add(trackerKey);
            this.deps.getSubagentTracker()?.onToolStart(parentAgentId, toolName);
          } else {
            this.deps.queueEarlyToolEvent(parentAgentId, toolId, toolName);
            if (parentToolUseId) {
              this.deps.queueEarlyToolEvent(parentToolUseId, toolId, toolName);
            }
          }
        }
      } else if (parentToolUseId) {
        this.deps.queueEarlyToolEvent(parentToolUseId, toolId, toolName);
        const correlatedParentAgentId = this.deps.toolUseIdToSubagentId.get(parentToolUseId);
        if (correlatedParentAgentId) {
          this.deps.recordActiveSubagentToolContext(
            toolId,
            toolName,
            correlatedParentAgentId,
            sdkToolUseId,
            sdkToolCallId,
            parentToolUseId,
          );
        }
      }

      const attributedParentAgentId = parentAgentId
        ?? this.deps.activeSubagentToolsById.get(toolId)?.parentAgentId;
      if (event.sessionId === this.deps.sessionId && parentToolUseId && !attributedParentAgentId) {
        return;
      }

      const busEvent: BusEvent<"stream.tool.start"> = {
        type: "stream.tool.start",
        sessionId: this.deps.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          toolId,
          toolName,
          toolInput,
          sdkCorrelationId: sdkCorrelationId ?? toolId,
          ...(toolMetadata ? { toolMetadata } : {}),
          ...(attributedParentAgentId ? { parentAgentId: attributedParentAgentId } : {}),
        },
      };
      this.deps.bus.publish(busEvent);
    };
  }

  createToolCompleteHandler(runId: number): EventHandler<"tool.complete"> {
    return (event) => {
      const data = event.data as ToolCompleteEventData;
      const dataRecord = data as Record<string, unknown>;
      const parentToolUseId = this.deps.resolveParentToolCorrelationId(dataRecord);
      const parentAgentId = this.deps.resolveParentAgentId(event.sessionId, dataRecord);
      const sdkToolUseId = this.deps.asString(data.toolUseId ?? data.toolUseID);
      const sdkToolCallId = this.deps.asString(data.toolCallId);
      const sdkCorrelationId = this.deps.resolveToolCorrelationId(sdkToolUseId ?? sdkToolCallId);
      const knownParentAgentId = sdkCorrelationId
        ? this.deps.activeSubagentToolsById.get(sdkCorrelationId)?.parentAgentId
        : undefined;
      if (event.sessionId !== this.deps.sessionId && !parentAgentId && !knownParentAgentId) {
        return;
      }

      const toolName = this.deps.normalizeToolName(data.toolName);
      const taskCorrelationId = this.deps.isTaskTool(toolName) ? sdkCorrelationId : undefined;
      const toolId = this.deps.resolveToolCompleteId(sdkCorrelationId, runId, toolName);
      const startSignature = this.deps.toolStartSignatureByToolId.get(toolId);
      this.deps.toolStartSignatureByToolId.delete(toolId);
      if (this.deps.isTaskTool(toolName) && startSignature === this.deps.taskPlaceholderSignature) {
        return;
      }

      const toolInput = this.deps.asRecord((data as Record<string, unknown>).toolInput);
      const toolMetadata = this.deps.asRecord((data as Record<string, unknown>).toolMetadata);
      const taskMetadata = taskCorrelationId
        ? this.deps.taskToolMetadata.get(taskCorrelationId)
        : undefined;
      this.deps.registerToolCorrelationAliases(toolId, sdkToolUseId, sdkToolCallId);
      const activeToolContext = this.deps.activeSubagentToolsById.get(toolId);
      this.deps.removeActiveSubagentToolContext(toolId, sdkToolUseId, sdkToolCallId);
      const effectiveParentAgentId = parentAgentId
        ?? knownParentAgentId
        ?? activeToolContext?.parentAgentId;

      if (effectiveParentAgentId) {
        const trackerKey = this.deps.buildTrackedToolStartKey(effectiveParentAgentId, toolId);
        const wasTracked = this.deps.trackedToolStartKeys.delete(trackerKey);
        if (wasTracked) {
          this.deps.getSubagentTracker()?.onToolComplete(effectiveParentAgentId);
          this.deps.removeEarlyToolEvent(effectiveParentAgentId, toolId);
        }
      }
      if (parentToolUseId && this.deps.toolUseIdToSubagentId.has(parentToolUseId)) {
        this.deps.removeEarlyToolEvent(parentToolUseId, toolId);
      }

      const attributedParentAgentId = parentAgentId
        ?? knownParentAgentId
        ?? activeToolContext?.parentAgentId;
      if (event.sessionId === this.deps.sessionId && parentToolUseId && !attributedParentAgentId) {
        return;
      }

      const busEvent: BusEvent<"stream.tool.complete"> = {
        type: "stream.tool.complete",
        sessionId: this.deps.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          toolId,
          toolName,
          toolInput,
          toolResult: data.toolResult,
          success: data.success,
          error: data.error,
          sdkCorrelationId: sdkCorrelationId ?? toolId,
          ...(toolMetadata
            ? { toolMetadata }
            : taskMetadata?.subagentSessionId
              ? { toolMetadata: { sessionId: taskMetadata.subagentSessionId } }
              : {}),
          ...(attributedParentAgentId ? { parentAgentId: attributedParentAgentId } : {}),
        },
      };
      this.deps.bus.publish(busEvent);
      this.deps.completedToolIds.add(toolId);

      if (this.deps.isTaskTool(toolName) && data.success && taskCorrelationId) {
        void this.deps.hydrateCompletedTaskDispatch(
          runId,
          event.sessionId,
          taskCorrelationId,
          toolId,
          attributedParentAgentId,
        );
      }
    };
  }
}
