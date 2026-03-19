import type { BusEvent } from "@/services/events/bus-events/index.ts";
import type { EventBus } from "@/services/events/event-bus.ts";
import type {
  AgentEvent,
  EventHandler,
  EventType,
  HumanInputRequiredEventData,
  PermissionRequestedEventData,
  ReasoningCompleteEventData,
  ReasoningDeltaEventData,
  SessionCompactionEventData,
  SessionErrorEventData,
  SessionInfoEventData,
  SessionTitleChangedEventData,
  SessionTruncationEventData,
  SessionWarningEventData,
  SkillInvokedEventData,
  ToolPartialResultEventData,
  TurnEndEventData,
  TurnStartEventData,
} from "@/services/agents/types.ts";
import { SubagentToolTracker } from "@/services/events/adapters/subagent-tool-tracker.ts";

type ClaudeAuxEventHandlerDependencies = {
  bus: EventBus;
  sessionId: string;
  resolveEventSessionId: (event: AgentEvent<EventType>) => string;
  resolveSubagentSessionParentAgentId: (eventSessionId: string) => string | undefined;
  resolveTaskDispatchParentAgentId: (toolUseId: string | undefined) => string | undefined;
  resolveToolCorrelationId: (correlationId: string | undefined) => string | undefined;
  asString: (value: unknown) => string | undefined;
  isOwnedSession: (eventSessionId: string) => boolean;
  getSyntheticAgentIdForAttribution: () => string | undefined;
  thinkingStartTimes: Map<string, number>;
  buildTurnStartData: (data: TurnStartEventData) => BusEvent<"stream.turn.start">["data"];
  buildTurnEndData: (data: TurnEndEventData) => BusEvent<"stream.turn.end">["data"];
  activeSubagentToolsById: Map<string, { parentAgentId: string; toolName: string }>;
  getSubagentTracker: () => SubagentToolTracker | null;
};

export class ClaudeAuxEventHandlers {
  constructor(private readonly deps: ClaudeAuxEventHandlerDependencies) {}

  createPermissionRequestedHandler(runId: number): EventHandler<"permission.requested"> {
    return (event) => {
      const eventSessionId = this.deps.resolveEventSessionId(event);
      if (!this.deps.isOwnedSession(eventSessionId)
        && !this.deps.resolveSubagentSessionParentAgentId(eventSessionId)) {
        return;
      }
      const data = event.data as PermissionRequestedEventData;
      this.deps.bus.publish({
        type: "stream.permission.requested",
        sessionId: this.deps.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          requestId: data.requestId,
          toolName: data.toolName,
          toolInput: data.toolInput as Record<string, unknown> | undefined,
          question: data.question,
          header: data.header,
          options: data.options,
          multiSelect: data.multiSelect,
          respond: data.respond as
            | ((...args: unknown[]) => unknown)
            | undefined,
          toolCallId: data.toolCallId,
        },
      });
    };
  }

  createHumanInputRequiredHandler(runId: number): EventHandler<"human_input_required"> {
    return (event) => {
      const eventSessionId = this.deps.resolveEventSessionId(event);
      if (!this.deps.isOwnedSession(eventSessionId)
        && !this.deps.resolveSubagentSessionParentAgentId(eventSessionId)) {
        return;
      }
      const data = event.data as HumanInputRequiredEventData;
      this.deps.bus.publish({
        type: "stream.human_input_required",
        sessionId: this.deps.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          requestId: data.requestId,
          question: data.question,
          header: data.header,
          options: data.options,
          nodeId: data.nodeId,
          respond: data.respond as
            | ((...args: unknown[]) => unknown)
            | undefined,
          toolCallId: data.toolCallId,
        },
      });
    };
  }

  createSkillInvokedHandler(runId: number): EventHandler<"skill.invoked"> {
    return (event) => {
      const data = event.data as SkillInvokedEventData;
      const dataRecord = data as Record<string, unknown>;
      const eventSessionId = this.deps.resolveEventSessionId(event);
      const sessionMappedParentAgentId = this.deps.resolveSubagentSessionParentAgentId(eventSessionId);
      const parentToolUseId = this.deps.resolveToolCorrelationId(this.deps.asString(
        data.parentToolCallId
          ?? dataRecord.parentToolUseId
          ?? dataRecord.parent_tool_use_id
          ?? dataRecord.parentToolUseID
          ?? dataRecord.parent_tool_call_id,
      ));
      const parentAgentId = sessionMappedParentAgentId
        ?? this.deps.resolveTaskDispatchParentAgentId(parentToolUseId);
      if (!this.deps.isOwnedSession(eventSessionId) && !parentAgentId) return;
      this.deps.bus.publish({
        type: "stream.skill.invoked",
        sessionId: this.deps.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          skillName: data.skillName,
          skillPath: data.skillPath,
          ...(parentAgentId ? { agentId: parentAgentId } : {}),
        },
      });
    };
  }

  createMessageDeltaHandler(
    runId: number,
    messageId: string,
  ): EventHandler<"message.delta"> {
    return (event) => {
      const eventSessionId = this.deps.resolveEventSessionId(event);
      if (eventSessionId === this.deps.sessionId) {
        return;
      }
      const dataRecord = event.data as Record<string, unknown>;
      const parentToolUseId = this.deps.resolveToolCorrelationId(this.deps.asString(
        dataRecord.parentToolCallId
          ?? dataRecord.parentToolUseId
          ?? dataRecord.parent_tool_use_id
          ?? dataRecord.parentToolUseID
          ?? dataRecord.parent_tool_call_id,
      ));
      const parentAgentId = this.deps.resolveSubagentSessionParentAgentId(eventSessionId)
        ?? this.deps.resolveTaskDispatchParentAgentId(parentToolUseId);
      const delta = this.deps.asString(dataRecord.delta);
      if (!parentAgentId || !delta) {
        return;
      }
      this.deps.bus.publish({
        type: "stream.text.delta",
        sessionId: this.deps.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          delta,
          messageId,
          agentId: parentAgentId,
        },
      });
    };
  }

  createReasoningDeltaHandler(
    runId: number,
    messageId: string,
  ): EventHandler<"reasoning.delta"> {
    return (event) => {
      const data = event.data as ReasoningDeltaEventData;
      const dataRecord = data as Record<string, unknown>;
      const eventSessionId = this.deps.resolveEventSessionId(event);
      const sessionMappedParentAgentId = this.deps.resolveSubagentSessionParentAgentId(eventSessionId);
      const parentToolUseId = this.deps.resolveToolCorrelationId(this.deps.asString(
        data.parentToolCallId
          ?? dataRecord.parentToolUseId
          ?? dataRecord.parent_tool_use_id
          ?? dataRecord.parentToolUseID
          ?? dataRecord.parent_tool_call_id,
      ));
      const parentAgentId = sessionMappedParentAgentId
        ?? this.deps.resolveTaskDispatchParentAgentId(parentToolUseId)
        ?? (eventSessionId === this.deps.sessionId ? this.deps.getSyntheticAgentIdForAttribution() : undefined);
      if (!this.deps.isOwnedSession(eventSessionId) && !parentAgentId) return;
      if (!data.delta || data.delta.length === 0) return;
      const sourceKey = data.reasoningId || "reasoning";
      if (!this.deps.thinkingStartTimes.has(sourceKey)) {
        this.deps.thinkingStartTimes.set(sourceKey, Date.now());
      }
      this.deps.bus.publish({
        type: "stream.thinking.delta",
        sessionId: this.deps.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          delta: data.delta,
          sourceKey,
          messageId,
          ...(parentAgentId ? { agentId: parentAgentId } : {}),
        },
      });
    };
  }

  createReasoningCompleteHandler(runId: number): EventHandler<"reasoning.complete"> {
    return (event) => {
      const data = event.data as ReasoningCompleteEventData;
      const dataRecord = data as Record<string, unknown>;
      const eventSessionId = this.deps.resolveEventSessionId(event);
      const sessionMappedParentAgentId = this.deps.resolveSubagentSessionParentAgentId(eventSessionId);
      const parentToolUseId = this.deps.resolveToolCorrelationId(this.deps.asString(
        data.parentToolCallId
          ?? dataRecord.parentToolUseId
          ?? dataRecord.parent_tool_use_id
          ?? dataRecord.parentToolUseID
          ?? dataRecord.parent_tool_call_id,
      ));
      const parentAgentId = sessionMappedParentAgentId
        ?? this.deps.resolveTaskDispatchParentAgentId(parentToolUseId)
        ?? (eventSessionId === this.deps.sessionId ? this.deps.getSyntheticAgentIdForAttribution() : undefined);
      if (!this.deps.isOwnedSession(eventSessionId) && !parentAgentId) return;
      const sourceKey = data.reasoningId || "reasoning";
      const start = this.deps.thinkingStartTimes.get(sourceKey);
      const durationMs = start ? Date.now() - start : 0;
      this.deps.thinkingStartTimes.delete(sourceKey);
      this.deps.bus.publish({
        type: "stream.thinking.complete",
        sessionId: this.deps.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          sourceKey,
          durationMs,
          ...(parentAgentId ? { agentId: parentAgentId } : {}),
        },
      });
    };
  }

  createTurnStartHandler(runId: number): EventHandler<"turn.start"> {
    return (event) => {
      if (event.sessionId !== this.deps.sessionId) return;
      const data = event.data as TurnStartEventData;
      this.deps.bus.publish({
        type: "stream.turn.start",
        sessionId: this.deps.sessionId,
        runId,
        timestamp: Date.now(),
        data: this.deps.buildTurnStartData(data),
      });
    };
  }

  createTurnEndHandler(runId: number): EventHandler<"turn.end"> {
    return (event) => {
      if (event.sessionId !== this.deps.sessionId) return;
      const data = event.data as TurnEndEventData;
      this.deps.bus.publish({
        type: "stream.turn.end",
        sessionId: this.deps.sessionId,
        runId,
        timestamp: Date.now(),
        data: this.deps.buildTurnEndData(data),
      });
    };
  }

  createToolPartialResultHandler(runId: number): EventHandler<"tool.partial_result"> {
    return (event) => {
      const eventSessionId = this.deps.resolveEventSessionId(event);
      const sessionMappedParentAgentId = this.deps.resolveSubagentSessionParentAgentId(eventSessionId);
      if (!this.deps.isOwnedSession(eventSessionId) && !sessionMappedParentAgentId) {
        return;
      }
      const data = event.data as ToolPartialResultEventData;
      const toolCallId = this.deps.resolveToolCorrelationId(this.deps.asString(data.toolCallId))
        ?? this.deps.asString(data.toolCallId);
      const context = toolCallId
        ? this.deps.activeSubagentToolsById.get(toolCallId)
        : undefined;
      const parentAgentId = context?.parentAgentId ?? sessionMappedParentAgentId;
      this.deps.bus.publish({
        type: "stream.tool.partial_result",
        sessionId: this.deps.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          toolCallId: toolCallId ?? data.toolCallId,
          partialOutput: data.partialOutput,
          ...(parentAgentId ? { parentAgentId } : {}),
        },
      });
      if (parentAgentId && this.deps.getSubagentTracker()?.hasAgent(parentAgentId)) {
        this.deps.getSubagentTracker()?.onToolProgress(parentAgentId, context?.toolName);
      }
    };
  }

  createSessionErrorHandler(runId: number): EventHandler<"session.error"> {
    return (event) => {
      if (event.sessionId !== this.deps.sessionId) return;
      const data = event.data as SessionErrorEventData;
      const rawError = data.error;
      const normalizedError = rawError instanceof Error
        ? rawError.message.trim()
        : typeof rawError === "string"
          ? rawError.trim()
          : "";
      if (normalizedError.length === 0 && !data.code) {
        return;
      }
      this.deps.bus.publish({
        type: "stream.session.error",
        sessionId: this.deps.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          error: normalizedError.length > 0 ? normalizedError : "Unknown session error",
          code: data.code,
        },
      });
    };
  }

  createSessionInfoHandler(runId: number): EventHandler<"session.info"> {
    return (event) => {
      if (event.sessionId !== this.deps.sessionId) return;
      const data = event.data as SessionInfoEventData;
      this.deps.bus.publish({
        type: "stream.session.info",
        sessionId: this.deps.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          infoType: data.infoType ?? "general",
          message: data.message ?? "",
        },
      });
    };
  }

  createSessionWarningHandler(runId: number): EventHandler<"session.warning"> {
    return (event) => {
      if (event.sessionId !== this.deps.sessionId) return;
      const data = event.data as SessionWarningEventData;
      this.deps.bus.publish({
        type: "stream.session.warning",
        sessionId: this.deps.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          warningType: data.warningType ?? "general",
          message: data.message ?? "",
        },
      });
    };
  }

  createSessionTitleChangedHandler(runId: number): EventHandler<"session.title_changed"> {
    return (event) => {
      if (event.sessionId !== this.deps.sessionId) return;
      const data = event.data as SessionTitleChangedEventData;
      this.deps.bus.publish({
        type: "stream.session.title_changed",
        sessionId: this.deps.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          title: data.title ?? "",
        },
      });
    };
  }

  createSessionTruncationHandler(runId: number): EventHandler<"session.truncation"> {
    return (event) => {
      if (event.sessionId !== this.deps.sessionId) return;
      const data = event.data as SessionTruncationEventData;
      this.deps.bus.publish({
        type: "stream.session.truncation",
        sessionId: this.deps.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          tokenLimit: data.tokenLimit ?? 0,
          tokensRemoved: data.tokensRemoved ?? 0,
          messagesRemoved: data.messagesRemoved ?? 0,
        },
      });
    };
  }

  createSessionCompactionHandler(runId: number): EventHandler<"session.compaction"> {
    return (event) => {
      if (event.sessionId !== this.deps.sessionId) return;
      const data = event.data as SessionCompactionEventData;
      this.deps.bus.publish({
        type: "stream.session.compaction",
        sessionId: this.deps.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          phase: data.phase,
          success: data.success,
          error: data.error,
        },
      });
    };
  }
}
