import type {
  AgentEvent,
  EventHandler,
  EventType,
} from "@/services/agents/types.ts";
import type { OpenCodeProviderEventSource } from "@/services/agents/provider-events.ts";
import type { OpenCodeAuxEventHandlers } from "@/services/events/adapters/providers/opencode/aux-event-handlers.ts";
import type { OpenCodeStreamChunkProcessor } from "@/services/events/adapters/providers/opencode/stream-chunk-processor.ts";
import type { OpenCodeSubagentEventHandlers } from "@/services/events/adapters/providers/opencode/subagent-event-handlers.ts";
import type { OpenCodeToolEventHandlers } from "@/services/events/adapters/providers/opencode/tool-event-handlers.ts";

interface OpenCodeProviderEventPayload<T extends EventType> {
  data: unknown;
  sessionId: string;
  timestamp: number;
  type: T;
}

export interface OpenCodeProviderEventHandlers {
  humanInputRequiredHandler: EventHandler<"human_input_required">;
  messageCompleteHandler: EventHandler<"message.complete">;
  messageDeltaHandler: EventHandler<"message.delta">;
  permissionRequestedHandler: EventHandler<"permission.requested">;
  reasoningCompleteHandler: EventHandler<"reasoning.complete">;
  reasoningDeltaHandler: EventHandler<"reasoning.delta">;
  sessionCompactionHandler: EventHandler<"session.compaction">;
  sessionErrorHandler: EventHandler<"session.error">;
  sessionIdleHandler: EventHandler<"session.idle">;
  sessionInfoHandler: EventHandler<"session.info">;
  sessionTitleChangedHandler: EventHandler<"session.title_changed">;
  sessionTruncationHandler: EventHandler<"session.truncation">;
  sessionWarningHandler: EventHandler<"session.warning">;
  skillInvokedHandler: EventHandler<"skill.invoked">;
  subagentCompleteHandler: EventHandler<"subagent.complete">;
  subagentStartHandler: EventHandler<"subagent.start">;
  subagentUpdateHandler: EventHandler<"subagent.update">;
  toolCompleteHandler: EventHandler<"tool.complete">;
  toolPartialResultHandler: EventHandler<"tool.partial_result">;
  toolStartHandler: EventHandler<"tool.start">;
  turnEndHandler: EventHandler<"turn.end">;
  turnStartHandler: EventHandler<"turn.start">;
  usageHandler: EventHandler<"usage">;
}

export function createOpenCodeProviderEventHandlers(args: {
  auxEventHandlers: OpenCodeAuxEventHandlers;
  messageId: string;
  publishThinkingCompleteForScope: (
    runId: number,
    eventSessionId?: string,
    agentId?: string,
  ) => void;
  runId: number;
  streamChunkProcessor: OpenCodeStreamChunkProcessor;
  subagentEventHandlers: OpenCodeSubagentEventHandlers;
  toolEventHandlers: OpenCodeToolEventHandlers;
}): OpenCodeProviderEventHandlers {
  const {
    auxEventHandlers,
    messageId,
    publishThinkingCompleteForScope,
    runId,
    streamChunkProcessor,
    subagentEventHandlers,
    toolEventHandlers,
  } = args;

  return {
    humanInputRequiredHandler: auxEventHandlers.createHumanInputRequiredHandler(runId),
    messageCompleteHandler: streamChunkProcessor.createMessageCompleteHandler(
      runId,
      messageId,
      publishThinkingCompleteForScope,
    ),
    messageDeltaHandler: streamChunkProcessor.createMessageDeltaHandler(runId, messageId),
    permissionRequestedHandler: auxEventHandlers.createPermissionRequestedHandler(runId),
    reasoningCompleteHandler: streamChunkProcessor.createReasoningCompleteHandler(runId),
    reasoningDeltaHandler: streamChunkProcessor.createReasoningDeltaHandler(runId, messageId),
    sessionCompactionHandler: auxEventHandlers.createSessionCompactionHandler(runId),
    sessionErrorHandler: auxEventHandlers.createSessionErrorHandler(runId),
    sessionIdleHandler: auxEventHandlers.createSessionIdleHandler(runId),
    sessionInfoHandler: auxEventHandlers.createSessionInfoHandler(runId),
    sessionTitleChangedHandler: auxEventHandlers.createSessionTitleChangedHandler(runId),
    sessionTruncationHandler: auxEventHandlers.createSessionTruncationHandler(runId),
    sessionWarningHandler: auxEventHandlers.createSessionWarningHandler(runId),
    skillInvokedHandler: auxEventHandlers.createSkillInvokedHandler(runId),
    subagentCompleteHandler: subagentEventHandlers.createSubagentCompleteHandler(runId),
    subagentStartHandler: subagentEventHandlers.createSubagentStartHandler(runId),
    subagentUpdateHandler: subagentEventHandlers.createSubagentUpdateHandler(runId),
    toolCompleteHandler: toolEventHandlers.createToolCompleteHandler(runId),
    toolPartialResultHandler: auxEventHandlers.createToolPartialResultHandler(runId),
    toolStartHandler: toolEventHandlers.createToolStartHandler(runId),
    turnEndHandler: auxEventHandlers.createTurnEndHandler(runId),
    turnStartHandler: auxEventHandlers.createTurnStartHandler(runId),
    usageHandler: auxEventHandlers.createUsageHandler(runId),
  };
}

export function toOpenCodeAgentEvent<T extends EventType>(
  event: OpenCodeProviderEventPayload<T>,
): AgentEvent<T> {
  return {
    type: event.type,
    sessionId: event.sessionId,
    timestamp: new Date(event.timestamp).toISOString(),
    data: event.data as AgentEvent<T>["data"],
  } as AgentEvent<T>;
}

export function subscribeOpenCodeProviderEvents(args: {
  handlers: OpenCodeProviderEventHandlers;
  providerClient: OpenCodeProviderEventSource;
}): () => void {
  const { handlers, providerClient } = args;

  return providerClient.onProviderEvent((event) => {
    switch (event.type) {
      case "message.delta":
        handlers.messageDeltaHandler(toOpenCodeAgentEvent(event));
        break;
      case "message.complete":
        handlers.messageCompleteHandler(toOpenCodeAgentEvent(event));
        break;
      case "reasoning.delta":
        handlers.reasoningDeltaHandler(toOpenCodeAgentEvent(event));
        break;
      case "reasoning.complete":
        handlers.reasoningCompleteHandler(toOpenCodeAgentEvent(event));
        break;
      case "tool.start":
        handlers.toolStartHandler(toOpenCodeAgentEvent(event));
        break;
      case "tool.complete":
        handlers.toolCompleteHandler(toOpenCodeAgentEvent(event));
        break;
      case "tool.partial_result":
        handlers.toolPartialResultHandler(toOpenCodeAgentEvent(event));
        break;
      case "subagent.start":
        handlers.subagentStartHandler(toOpenCodeAgentEvent(event));
        break;
      case "subagent.complete":
        handlers.subagentCompleteHandler(toOpenCodeAgentEvent(event));
        break;
      case "subagent.update":
        handlers.subagentUpdateHandler(toOpenCodeAgentEvent(event));
        break;
      case "session.idle":
        handlers.sessionIdleHandler(toOpenCodeAgentEvent(event));
        break;
      case "session.error":
        handlers.sessionErrorHandler(toOpenCodeAgentEvent(event));
        break;
      case "usage":
        handlers.usageHandler(toOpenCodeAgentEvent(event));
        break;
      case "permission.requested":
        handlers.permissionRequestedHandler(toOpenCodeAgentEvent(event));
        break;
      case "human_input_required":
        handlers.humanInputRequiredHandler(toOpenCodeAgentEvent(event));
        break;
      case "skill.invoked":
        handlers.skillInvokedHandler(toOpenCodeAgentEvent(event));
        break;
      case "session.compaction":
        handlers.sessionCompactionHandler(toOpenCodeAgentEvent(event));
        break;
      case "session.truncation":
        handlers.sessionTruncationHandler(toOpenCodeAgentEvent(event));
        break;
      case "turn.start":
        handlers.turnStartHandler(toOpenCodeAgentEvent(event));
        break;
      case "turn.end":
        handlers.turnEndHandler(toOpenCodeAgentEvent(event));
        break;
      case "session.info":
        handlers.sessionInfoHandler(toOpenCodeAgentEvent(event));
        break;
      case "session.warning":
        handlers.sessionWarningHandler(toOpenCodeAgentEvent(event));
        break;
      case "session.title_changed":
        handlers.sessionTitleChangedHandler(toOpenCodeAgentEvent(event));
        break;
      default:
        break;
    }
  });
}
