import type { BusEvent } from "@/services/events/bus-events.ts";
import type {
  AgentEvent,
  EventHandler,
  EventType,
} from "@/services/agents/types.ts";
import type { ProviderStreamEventType } from "@/services/agents/provider-events.ts";
import type { ClaudeAuxEventHandlers } from "@/services/events/adapters/providers/claude/aux-event-handlers.ts";
import type { ClaudeSubagentEventHandlers } from "@/services/events/adapters/providers/claude/subagent-event-handlers.ts";
import type { ClaudeToolHookHandlers } from "@/services/events/adapters/providers/claude/tool-hook-handlers.ts";

interface ClaudeProviderEventPayload<T extends EventType> {
  data: unknown;
  nativeSessionId?: unknown;
  sessionId: string;
  timestamp: number;
  type: T;
}

function createClaudeUsageHandler(args: {
  busPublish: (event: BusEvent<"stream.usage">) => void;
  getAccumulatedOutputTokens: () => number;
  runId: number;
  sessionId: string;
  setAccumulatedOutputTokens: (value: number) => void;
}): EventHandler<"usage"> {
  const {
    busPublish,
    getAccumulatedOutputTokens,
    runId,
    sessionId,
    setAccumulatedOutputTokens,
  } = args;

  return (event) => {
    if (event.sessionId !== sessionId) {
      return;
    }

    const data = event.data as Record<string, unknown>;
    const inputTokens = (data.inputTokens as number) || 0;
    const outputTokens = (data.outputTokens as number) || 0;
    const model = data.model as string | undefined;
    if (outputTokens <= 0 && inputTokens <= 0) {
      return;
    }

    const accumulatedOutputTokens = getAccumulatedOutputTokens() + outputTokens;
    setAccumulatedOutputTokens(accumulatedOutputTokens);
    busPublish({
      type: "stream.usage",
      sessionId,
      runId,
      timestamp: Date.now(),
      data: {
        inputTokens,
        model,
        outputTokens: accumulatedOutputTokens,
      },
    });
  };
}

export function toClaudeAgentEvent<T extends EventType>(
  event: ClaudeProviderEventPayload<T>,
): AgentEvent<T> {
  const eventData = (
    typeof event.data === "object" && event.data !== null && !Array.isArray(event.data)
  )
    ? {
        ...(event.data as Record<string, unknown>),
        ...(typeof event.nativeSessionId === "string"
          ? { nativeSessionId: event.nativeSessionId }
          : {}),
      }
    : event.data as AgentEvent<T>["data"];

  return {
    type: event.type,
    sessionId: event.sessionId,
    timestamp: new Date(event.timestamp).toISOString(),
    data: eventData as AgentEvent<T>["data"],
  } as AgentEvent<T>;
}

export function createClaudeProviderEventHandlerFactory(args: {
  auxEventHandlers: ClaudeAuxEventHandlers;
  busPublish: (event: BusEvent<"stream.usage">) => void;
  getAccumulatedOutputTokens: () => number;
  sessionId: string;
  setAccumulatedOutputTokens: (value: number) => void;
  subagentEventHandlers: ClaudeSubagentEventHandlers;
  toolHookHandlers: ClaudeToolHookHandlers;
}): <T extends ProviderStreamEventType>(
  type: T,
  runId: number,
  messageId: string,
) => EventHandler<T> {
  const {
    auxEventHandlers,
    busPublish,
    getAccumulatedOutputTokens,
    sessionId,
    setAccumulatedOutputTokens,
    subagentEventHandlers,
    toolHookHandlers,
  } = args;

  return <T extends ProviderStreamEventType>(
    type: T,
    runId: number,
    messageId: string,
  ): EventHandler<T> => {
    switch (type) {
      case "tool.start":
        return toolHookHandlers.createToolStartHandler(runId) as EventHandler<T>;
      case "tool.complete":
        return toolHookHandlers.createToolCompleteHandler(runId) as EventHandler<T>;
      case "subagent.start":
        return subagentEventHandlers.createSubagentStartHandler(runId) as EventHandler<T>;
      case "subagent.complete":
        return subagentEventHandlers.createSubagentCompleteHandler(runId) as EventHandler<T>;
      case "subagent.update":
        return subagentEventHandlers.createSubagentUpdateHandler(runId) as EventHandler<T>;
      case "session.error":
        return auxEventHandlers.createSessionErrorHandler(runId) as EventHandler<T>;
      case "usage":
        return createClaudeUsageHandler({
          busPublish,
          getAccumulatedOutputTokens,
          runId,
          sessionId,
          setAccumulatedOutputTokens: (value) => setAccumulatedOutputTokens(value),
        }) as EventHandler<T>;
      case "permission.requested":
        return auxEventHandlers.createPermissionRequestedHandler(runId) as EventHandler<T>;
      case "human_input_required":
        return auxEventHandlers.createHumanInputRequiredHandler(runId) as EventHandler<T>;
      case "skill.invoked":
        return auxEventHandlers.createSkillInvokedHandler(runId) as EventHandler<T>;
      case "message.delta":
        return auxEventHandlers.createMessageDeltaHandler(runId, messageId) as EventHandler<T>;
      case "reasoning.delta":
        return auxEventHandlers.createReasoningDeltaHandler(runId, messageId) as EventHandler<T>;
      case "reasoning.complete":
        return auxEventHandlers.createReasoningCompleteHandler(runId) as EventHandler<T>;
      case "message.complete":
        return toolHookHandlers.createMessageCompleteHandler(runId) as EventHandler<T>;
      case "turn.start":
        return auxEventHandlers.createTurnStartHandler(runId) as EventHandler<T>;
      case "turn.end":
        return auxEventHandlers.createTurnEndHandler(runId) as EventHandler<T>;
      case "tool.partial_result":
        return auxEventHandlers.createToolPartialResultHandler(runId) as EventHandler<T>;
      case "session.info":
        return auxEventHandlers.createSessionInfoHandler(runId) as EventHandler<T>;
      case "session.warning":
        return auxEventHandlers.createSessionWarningHandler(runId) as EventHandler<T>;
      case "session.title_changed":
        return auxEventHandlers.createSessionTitleChangedHandler(runId) as EventHandler<T>;
      case "session.truncation":
        return auxEventHandlers.createSessionTruncationHandler(runId) as EventHandler<T>;
      case "session.compaction":
        return auxEventHandlers.createSessionCompactionHandler(runId) as EventHandler<T>;
    }

    throw new Error(`Unhandled Claude provider event type: ${String(type)}`);
  };
}
