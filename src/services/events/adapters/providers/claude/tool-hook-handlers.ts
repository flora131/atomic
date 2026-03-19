import type { BusEvent } from "@/services/events/bus-events/index.ts";
import type { EventBus } from "@/services/events/event-bus.ts";
import type {
  AgentEvent,
  EventHandler,
  EventType,
  MessageCompleteEventData,
  ToolCompleteEventData,
  ToolStartEventData,
} from "@/services/agents/types.ts";
import { isSkillToolName } from "@/services/agents/clients/skill-invocation.ts";
import { SubagentToolTracker } from "@/services/events/adapters/subagent-tool-tracker.ts";
import type {
  ClaudeActiveSubagentToolContext,
  ClaudeEarlyToolStartEvent,
  ClaudeTaskToolMetadata,
} from "@/services/events/adapters/providers/claude/tool-state.ts";

type ClaudeToolHookHandlerDependencies = {
  bus: EventBus;
  sessionId: string;
  taskToolMetadata: Map<string, ClaudeTaskToolMetadata>;
  emittedToolStartCorrelationIds: Set<string>;
  toolUseIdToSubagentId: Map<string, string>;
  getSubagentTracker: () => SubagentToolTracker | null;
  isOwnedSession: (eventSessionId: string) => boolean;
  resolveEventSessionId: (event: AgentEvent<EventType>) => string;
  resolveToolCorrelationId: (correlationId: string | undefined) => string | undefined;
  asString: (value: unknown) => string | undefined;
  asRecord: (value: unknown) => Record<string, unknown> | undefined;
  resolveSubagentSessionParentAgentId: (eventSessionId: string) => string | undefined;
  resolveTaskDispatchParentAgentId: (toolUseId: string | undefined) => string | undefined;
  normalizeToolName: (value: unknown) => string;
  isTaskTool: (toolName: string) => boolean;
  extractTaskToolMetadata: (toolInput: unknown) => ClaudeTaskToolMetadata;
  recordPendingTaskToolCorrelationId: (correlationId: string) => void;
  resolveToolStartId: (
    explicitToolId: string | undefined,
    runId: number,
    toolName: string,
  ) => string;
  registerToolCorrelationAliases: (
    toolId: string,
    ...correlationIds: Array<string | undefined>
  ) => void;
  recordActiveSubagentToolContext: (
    toolId: string,
    toolName: string,
    parentAgentId: string,
    ...correlationIds: Array<string | undefined>
  ) => void;
  queueEarlyToolStart: (key: string, event: ClaudeEarlyToolStartEvent) => void;
  resolveToolCompleteId: (
    explicitToolId: string | undefined,
    runId: number,
    toolName: string,
  ) => string;
  resolveActiveSubagentToolContext: (
    ...correlationIds: Array<string | undefined>
  ) => ClaudeActiveSubagentToolContext | undefined;
  removeActiveSubagentToolContext: (
    toolId: string,
    ...correlationIds: Array<string | undefined>
  ) => void;
  resolveCanonicalAgentId: (value: string | undefined) => string | undefined;
  resolveTaskOutputParentAgentId: (
    toolName: string,
    toolInput: Record<string, unknown>,
  ) => string | undefined;
  setCurrentBackgroundAttributionAgentId: (value: string | null) => void;
  resolveSoleActiveSubagentId: () => string | undefined;
  resolveBackgroundAttributionFallbackAgentId: () => string | undefined;
  resolveSoleActiveSubagentToolParentAgentId: () => string | undefined;
  getSyntheticAgentIdForAttribution: () => string | undefined;
};

export class ClaudeToolHookHandlers {
  constructor(private readonly deps: ClaudeToolHookHandlerDependencies) {}

  createMessageCompleteHandler(runId: number): EventHandler<"message.complete"> {
    return (event) => {
      const data = event.data as MessageCompleteEventData;
      const eventSessionId = this.deps.resolveEventSessionId(event);
      const parentToolUseId = this.deps.resolveToolCorrelationId(this.deps.asString(
        data.parentToolCallId
          ?? (data as Record<string, unknown>).parentToolUseId
          ?? (data as Record<string, unknown>).parent_tool_use_id,
      ));
      const parentAgentId = this.deps.resolveSubagentSessionParentAgentId(eventSessionId)
        ?? this.deps.resolveTaskDispatchParentAgentId(parentToolUseId);
      const toolRequests = Array.isArray(data.toolRequests) ? data.toolRequests : [];
      if (toolRequests.length === 0) {
        return;
      }
      if (
        !this.deps.isOwnedSession(eventSessionId)
        && !parentAgentId
        && !parentToolUseId
        && eventSessionId !== this.deps.sessionId
      ) {
        return;
      }

      for (const request of toolRequests) {
        const requestRecord = request as Record<string, unknown>;
        const sdkCorrelationId = this.deps.resolveToolCorrelationId(this.deps.asString(request.toolCallId))
          ?? this.deps.asString(request.toolCallId);
        const toolName = this.deps.normalizeToolName(request.name);
        const toolInput = this.deps.asRecord(request.arguments) ?? {};
        if (isSkillToolName(toolName)) {
          continue;
        }

        if (this.deps.isTaskTool(toolName)) {
          if (sdkCorrelationId) {
            this.deps.taskToolMetadata.set(
              sdkCorrelationId,
              this.deps.extractTaskToolMetadata(toolInput),
            );
            this.deps.recordPendingTaskToolCorrelationId(sdkCorrelationId);
          }
          continue;
        }

        if (sdkCorrelationId && this.deps.emittedToolStartCorrelationIds.has(sdkCorrelationId)) {
          continue;
        }

        const toolId = this.deps.resolveToolStartId(sdkCorrelationId, runId, toolName);
        this.deps.registerToolCorrelationAliases(toolId, undefined, sdkCorrelationId);
        if (sdkCorrelationId) {
          this.deps.emittedToolStartCorrelationIds.add(sdkCorrelationId);
        }

        if (parentAgentId && this.deps.getSubagentTracker()?.hasAgent(parentAgentId)) {
          this.deps.recordActiveSubagentToolContext(
            toolId,
            toolName,
            parentAgentId,
            undefined,
            sdkCorrelationId,
            parentToolUseId,
            sdkCorrelationId,
          );
          this.deps.getSubagentTracker()?.onToolStart(parentAgentId, toolName);
        } else if (parentAgentId) {
          this.deps.recordActiveSubagentToolContext(
            toolId,
            toolName,
            parentAgentId,
            undefined,
            sdkCorrelationId,
            parentToolUseId,
            sdkCorrelationId,
          );
          this.deps.queueEarlyToolStart(parentAgentId, {
            phase: "start",
            toolId,
            toolName,
            toolInput,
            sdkCorrelationId: sdkCorrelationId ?? toolId,
          });
        }

        const busEvent: BusEvent<"stream.tool.start"> = {
          type: "stream.tool.start",
          sessionId: this.deps.sessionId,
          runId,
          timestamp: Date.now(),
          data: {
            toolId,
            toolName,
            toolInput: this.deps.asRecord(requestRecord.arguments) ?? {},
            sdkCorrelationId: sdkCorrelationId ?? toolId,
            ...(parentAgentId ? { parentAgentId } : {}),
          },
        };
        this.deps.bus.publish(busEvent);
      }
    };
  }

  createToolStartHandler(runId: number): EventHandler<"tool.start"> {
    return (event) => {
      const data = event.data as ToolStartEventData;
      const dataRecord = data as Record<string, unknown>;
      const eventSessionId = this.deps.resolveEventSessionId(event);
      const sdkToolUseId = this.deps.asString(data.toolUseId ?? data.toolUseID);
      const sdkToolCallId = this.deps.asString(data.toolCallId);
      const sdkCorrelationId = sdkToolUseId ?? sdkToolCallId;
      const normalizedSdkCorrelationId = this.deps.resolveToolCorrelationId(sdkCorrelationId) ?? sdkCorrelationId;
      const toolName = this.deps.normalizeToolName(data.toolName);
      if (isSkillToolName(toolName)) {
        return;
      }
      const toolId = this.deps.resolveToolStartId(normalizedSdkCorrelationId, runId, toolName);
      this.deps.registerToolCorrelationAliases(toolId, sdkToolUseId, sdkToolCallId);

      const directParentAgentId = this.deps.resolveCanonicalAgentId(this.deps.asString(
        dataRecord.parentAgentId ?? dataRecord.parentId,
      ));
      const parentToolUseId = this.deps.resolveToolCorrelationId(
        this.deps.asString(
          dataRecord.parentToolUseId
            ?? dataRecord.parent_tool_use_id
            ?? dataRecord.parentToolUseID
            ?? dataRecord.parentToolCallId
            ?? dataRecord.parent_tool_call_id
            ?? dataRecord.parentToolCallID,
        ),
      );
      const toolInput = (data.toolInput ?? {}) as Record<string, unknown>;
      const taskOutputParentAgentId = this.deps.resolveTaskOutputParentAgentId(toolName, toolInput);
      if (taskOutputParentAgentId) {
        this.deps.setCurrentBackgroundAttributionAgentId(taskOutputParentAgentId);
      }
      const sessionMappedParentAgentId = this.deps.resolveSubagentSessionParentAgentId(eventSessionId);
      const allowFallbackAttribution = this.deps.isOwnedSession(eventSessionId)
        || Boolean(directParentAgentId || parentToolUseId || sessionMappedParentAgentId);
      const fallbackParentAgentId = allowFallbackAttribution
        ? this.deps.resolveSoleActiveSubagentId()
        : undefined;
      const fallbackBackgroundParentAgentId = allowFallbackAttribution
        ? this.deps.resolveBackgroundAttributionFallbackAgentId()
        : undefined;
      const fallbackActiveToolParentAgentId = allowFallbackAttribution
        ? this.deps.resolveSoleActiveSubagentToolParentAgentId()
        : undefined;
      const syntheticParentAgentId = eventSessionId === this.deps.sessionId
        ? this.deps.getSyntheticAgentIdForAttribution()
        : undefined;
      const resolvedParentAgentId = directParentAgentId
        ?? this.deps.resolveTaskDispatchParentAgentId(parentToolUseId)
        ?? sessionMappedParentAgentId
        ?? taskOutputParentAgentId
        ?? fallbackParentAgentId;
      const attributedWithContextParentAgentId = resolvedParentAgentId
        ?? fallbackBackgroundParentAgentId
        ?? fallbackActiveToolParentAgentId;
      const finalAttributedParentAgentId = attributedWithContextParentAgentId ?? syntheticParentAgentId;
      if (
        !this.deps.isOwnedSession(eventSessionId)
        && !directParentAgentId
        && !parentToolUseId
        && !sessionMappedParentAgentId
      ) {
        return;
      }

      if (this.deps.isTaskTool(toolName) && sdkCorrelationId) {
        const metadata = this.deps.extractTaskToolMetadata(data.toolInput);
        this.deps.taskToolMetadata.set(sdkCorrelationId, metadata);
        this.deps.recordPendingTaskToolCorrelationId(sdkCorrelationId);
      }
      if (taskOutputParentAgentId && sdkCorrelationId) {
        this.deps.toolUseIdToSubagentId.set(sdkCorrelationId, taskOutputParentAgentId);
      }

      if (finalAttributedParentAgentId && this.deps.getSubagentTracker()?.hasAgent(finalAttributedParentAgentId)) {
        this.deps.recordActiveSubagentToolContext(
          toolId,
          toolName,
          finalAttributedParentAgentId,
          sdkToolUseId,
          sdkToolCallId,
          parentToolUseId,
          sdkCorrelationId,
        );
        this.deps.getSubagentTracker()?.onToolStart(finalAttributedParentAgentId, toolName);
      } else if (finalAttributedParentAgentId) {
        this.deps.recordActiveSubagentToolContext(
          toolId,
          toolName,
          finalAttributedParentAgentId,
          sdkToolUseId,
          sdkToolCallId,
          parentToolUseId,
          sdkCorrelationId,
        );
        this.deps.queueEarlyToolStart(finalAttributedParentAgentId, {
          phase: "start",
          toolId,
          toolName,
          toolInput,
          sdkCorrelationId: normalizedSdkCorrelationId ?? toolId,
        });
      } else if (parentToolUseId) {
        this.deps.queueEarlyToolStart(parentToolUseId, {
          phase: "start",
          toolId,
          toolName,
          toolInput,
          sdkCorrelationId: normalizedSdkCorrelationId ?? toolId,
        });
      }

      if (this.deps.isTaskTool(toolName)) {
        return;
      }
      if (normalizedSdkCorrelationId) {
        this.deps.emittedToolStartCorrelationIds.add(normalizedSdkCorrelationId);
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
          sdkCorrelationId: normalizedSdkCorrelationId ?? toolId,
          ...(finalAttributedParentAgentId ? { parentAgentId: finalAttributedParentAgentId } : {}),
        },
      };
      this.deps.bus.publish(busEvent);
    };
  }

  createToolCompleteHandler(runId: number): EventHandler<"tool.complete"> {
    return (event) => {
      const data = event.data as ToolCompleteEventData;
      const dataRecord = data as Record<string, unknown>;
      const eventSessionId = this.deps.resolveEventSessionId(event);
      const sdkToolUseId = this.deps.asString(data.toolUseId ?? data.toolUseID);
      const sdkToolCallId = this.deps.asString(data.toolCallId);
      const sdkCorrelationId = this.deps.resolveToolCorrelationId(sdkToolUseId ?? sdkToolCallId);
      const toolName = this.deps.normalizeToolName(data.toolName);
      if (isSkillToolName(toolName)) {
        return;
      }
      const toolId = this.deps.resolveToolCompleteId(sdkCorrelationId, runId, toolName);
      const toolInput = this.deps.asRecord((data as Record<string, unknown>).toolInput);
      this.deps.registerToolCorrelationAliases(toolId, sdkToolUseId, sdkToolCallId);
      const activeToolContext = this.deps.resolveActiveSubagentToolContext(
        toolId,
        sdkCorrelationId,
        sdkToolUseId,
        sdkToolCallId,
      );
      this.deps.removeActiveSubagentToolContext(toolId, sdkCorrelationId, sdkToolUseId, sdkToolCallId);

      const directParentAgentId = this.deps.resolveCanonicalAgentId(this.deps.asString(
        dataRecord.parentAgentId ?? dataRecord.parentId,
      ));
      const parentToolUseId = this.deps.resolveToolCorrelationId(
        this.deps.asString(
          dataRecord.parentToolUseId
            ?? dataRecord.parent_tool_use_id
            ?? dataRecord.parentToolUseID
            ?? dataRecord.parentToolCallId
            ?? dataRecord.parent_tool_call_id
            ?? dataRecord.parentToolCallID,
        ),
      );
      const taskOutputParentAgentId = this.deps.resolveTaskOutputParentAgentId(
        toolName,
        (toolInput ?? {}) as Record<string, unknown>,
      );
      if (taskOutputParentAgentId) {
        this.deps.setCurrentBackgroundAttributionAgentId(taskOutputParentAgentId);
      }
      const sessionMappedParentAgentId = this.deps.resolveSubagentSessionParentAgentId(eventSessionId);
      const allowFallbackAttribution = this.deps.isOwnedSession(eventSessionId)
        || Boolean(directParentAgentId || parentToolUseId || sessionMappedParentAgentId);
      const fallbackParentAgentId = allowFallbackAttribution
        ? this.deps.resolveSoleActiveSubagentId()
        : undefined;
      const fallbackBackgroundParentAgentId = allowFallbackAttribution
        ? this.deps.resolveBackgroundAttributionFallbackAgentId()
        : undefined;
      const fallbackActiveToolParentAgentId = activeToolContext?.parentAgentId
        ?? (allowFallbackAttribution
          ? this.deps.resolveSoleActiveSubagentToolParentAgentId()
          : undefined);
      const syntheticParentAgentId = eventSessionId === this.deps.sessionId
        ? this.deps.getSyntheticAgentIdForAttribution()
        : undefined;
      const resolvedParentAgentId = directParentAgentId
        ?? this.deps.resolveTaskDispatchParentAgentId(parentToolUseId)
        ?? sessionMappedParentAgentId
        ?? taskOutputParentAgentId
        ?? activeToolContext?.parentAgentId
        ?? fallbackParentAgentId;
      const attributedWithContextParentAgentId = resolvedParentAgentId
        ?? fallbackBackgroundParentAgentId
        ?? fallbackActiveToolParentAgentId;
      const attributedParentAgentId = attributedWithContextParentAgentId ?? syntheticParentAgentId;
      if (
        !this.deps.isOwnedSession(eventSessionId)
        && !directParentAgentId
        && !parentToolUseId
        && !sessionMappedParentAgentId
      ) {
        return;
      }

      if (attributedParentAgentId && this.deps.getSubagentTracker()?.hasAgent(attributedParentAgentId)) {
        this.deps.getSubagentTracker()?.onToolComplete(attributedParentAgentId);
      }
      if (this.deps.isTaskTool(toolName)) {
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
          ...(attributedParentAgentId ? { parentAgentId: attributedParentAgentId } : {}),
        },
      };
      this.deps.bus.publish(busEvent);
    };
  }
}
