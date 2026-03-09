import type { BusEvent } from "@/services/events/bus-events.ts";
import type { EventBus } from "@/services/events/event-bus.ts";
import type {
  EventHandler,
  HumanInputRequiredEventData,
  PermissionRequestedEventData,
  SessionCompactionEventData,
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

type OpenCodeAuxEventHandlerDependencies = {
  bus: EventBus;
  sessionId: string;
  isOwnedSession: (eventSessionId: string) => boolean;
  resolveParentAgentId: (
    eventSessionId: string,
    data: Record<string, unknown>,
  ) => string | undefined;
  resolveToolCorrelationId: (correlationId: string | undefined) => string | undefined;
  asString: (value: unknown) => string | undefined;
  activeSubagentToolsById: Map<string, { parentAgentId: string; toolName: string }>;
  getSubagentTracker: () => SubagentToolTracker | null;
  getLastSeenOutputTokens: () => number;
  setLastSeenOutputTokens: (value: number) => void;
  getAccumulatedOutputTokens: () => number;
  setAccumulatedOutputTokens: (value: number) => void;
  buildTurnStartData: (data: TurnStartEventData) => BusEvent<"stream.turn.start">["data"];
  buildTurnEndData: (data: TurnEndEventData) => BusEvent<"stream.turn.end">["data"];
};

export class OpenCodeAuxEventHandlers {
  constructor(private readonly deps: OpenCodeAuxEventHandlerDependencies) {}

  createSessionIdleHandler(_runId: number): EventHandler<"session.idle"> {
    return (event) => {
      if (!this.deps.isOwnedSession(event.sessionId)) {
        return;
      }
    };
  }

  createSessionErrorHandler(runId: number): EventHandler<"session.error"> {
    return (event) => {
      if (event.sessionId !== this.deps.sessionId) {
        return;
      }
      const error = typeof event.data.error === "string"
        ? event.data.error
        : (event.data.error as Error).message;
      this.deps.bus.publish({
        type: "stream.session.error",
        sessionId: this.deps.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          error,
          code: event.data.code,
        },
      });
    };
  }

  createUsageHandler(runId: number): EventHandler<"usage"> {
    return (event) => {
      if (event.sessionId !== this.deps.sessionId) {
        return;
      }
      const data = event.data as Record<string, number | string | undefined>;
      const inputTokens = (data.inputTokens as number) ?? (data.input_tokens as number) ?? 0;
      const outputTokens = (data.outputTokens as number) ?? (data.output_tokens as number) ?? 0;
      const model = data.model as string | undefined;
      if (outputTokens <= 0 && inputTokens <= 0) {
        return;
      }

      if (outputTokens < this.deps.getLastSeenOutputTokens()) {
        this.deps.setAccumulatedOutputTokens(
          this.deps.getAccumulatedOutputTokens() + this.deps.getLastSeenOutputTokens(),
        );
      }
      this.deps.setLastSeenOutputTokens(outputTokens);

      this.deps.bus.publish({
        type: "stream.usage",
        sessionId: this.deps.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          inputTokens,
          outputTokens: this.deps.getAccumulatedOutputTokens() + outputTokens,
          model,
        },
      });
    };
  }

  createPermissionRequestedHandler(runId: number): EventHandler<"permission.requested"> {
    return (event) => {
      if (!this.deps.isOwnedSession(event.sessionId)) {
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
      if (event.sessionId !== this.deps.sessionId) {
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
        },
      });
    };
  }

  createSkillInvokedHandler(runId: number): EventHandler<"skill.invoked"> {
    return (event) => {
      const data = event.data as SkillInvokedEventData;
      const parentAgentId = this.deps.resolveParentAgentId(
        event.sessionId,
        data as Record<string, unknown>,
      );
      if (event.sessionId !== this.deps.sessionId && !parentAgentId) {
        return;
      }
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
      const data = event.data as ToolPartialResultEventData;
      const toolCallId = this.deps.resolveToolCorrelationId(this.deps.asString(data.toolCallId))
        ?? this.deps.asString(data.toolCallId);
      const activeContext = toolCallId
        ? this.deps.activeSubagentToolsById.get(toolCallId)
        : undefined;
      const parentAgentId = activeContext?.parentAgentId
        ?? this.deps.resolveParentAgentId(event.sessionId, data as Record<string, unknown>);
      if (event.sessionId !== this.deps.sessionId && !parentAgentId) {
        return;
      }
      this.deps.bus.publish({
        type: "stream.tool.partial_result",
        sessionId: this.deps.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          toolCallId: data.toolCallId,
          partialOutput: data.partialOutput,
          ...(parentAgentId ? { parentAgentId } : {}),
        },
      });

      if (!toolCallId || !activeContext || !parentAgentId) {
        return;
      }
      if (this.deps.getSubagentTracker()?.hasAgent(parentAgentId)) {
        this.deps.getSubagentTracker()?.onToolProgress(parentAgentId, activeContext.toolName);
      }
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
}
