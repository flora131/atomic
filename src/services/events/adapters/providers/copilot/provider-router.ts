import type {
  AgentEvent,
  CodingAgentClient,
  EventType,
} from "@/services/agents/types.ts";
import type { CopilotProviderEventSource } from "@/services/agents/provider-events.ts";
import type { BusEvent } from "@/services/events/bus-events/index.ts";
import { drainUnsubscribers } from "@/services/events/adapters/provider-shared.ts";
import { publishCopilotBufferedEvent } from "@/services/events/adapters/providers/copilot/buffer.ts";
import {
  handleCopilotMessageComplete,
  handleCopilotMessageDelta,
  handleCopilotToolComplete,
  handleCopilotToolStart,
} from "@/services/events/adapters/providers/copilot/message-tool-handlers.ts";
import {
  handleCopilotHumanInputRequired,
  handleCopilotPermissionRequested,
  handleCopilotReasoningComplete,
  handleCopilotReasoningDelta,
  handleCopilotSessionCompaction,
  handleCopilotSessionError,
  handleCopilotSessionIdle,
  handleCopilotSessionInfo,
  handleCopilotSessionTitleChanged,
  handleCopilotSessionTruncation,
  handleCopilotSessionWarning,
  handleCopilotSkillInvoked,
  handleCopilotToolPartialResult,
  handleCopilotTurnEnd,
  handleCopilotTurnStart,
  handleCopilotUsage,
} from "@/services/events/adapters/providers/copilot/session-handlers.ts";
import {
  handleCopilotSubagentComplete,
  handleCopilotSubagentStart,
  handleCopilotSubagentUpdate,
} from "@/services/events/adapters/providers/copilot/subagent-handlers.ts";
import {
  getSyntheticForegroundAgentIdForAttribution,
  publishCopilotSyntheticTaskToolComplete,
  resolveCopilotParentAgentId,
} from "@/services/events/adapters/providers/copilot/support.ts";
import type {
  CopilotProviderEventEnvelope,
  CopilotSessionHandlerContext,
  CopilotStreamAdapterDeps,
  CopilotStreamAdapterState,
} from "@/services/events/adapters/providers/copilot/types.ts";

const FOREGROUND_ONLY_EVENT_TYPES: ReadonlySet<string> = new Set([
  "message.delta",
  "message.complete",
  "reasoning.delta",
  "reasoning.complete",
]);

export function subscribeToCopilotEvents(
  deps: CopilotStreamAdapterDeps,
  state: CopilotStreamAdapterState,
): void {
  const providerClient =
    deps.client as CodingAgentClient & CopilotProviderEventSource;
  if (typeof providerClient.onProviderEvent !== "function") {
    throw new Error("Copilot stream adapter requires provider event support.");
  }

  const unsubProvider = providerClient.onProviderEvent((event) => {
    if (event.sessionId !== state.sessionId) {
      return;
    }
    if (!state.isActive && !state.isBackgroundOnly) {
      return;
    }
    if (state.isBackgroundOnly && FOREGROUND_ONLY_EVENT_TYPES.has(event.type)) {
      return;
    }
    routeCopilotProviderEvent(deps, state, event);
  });
  state.unsubscribers.push(unsubProvider);
}

export function cleanupCopilotSubscriptions(state: CopilotStreamAdapterState): void {
  state.unsubscribers = drainUnsubscribers(state.unsubscribers);
}

function routeCopilotProviderEvent(
  deps: CopilotStreamAdapterDeps,
  state: CopilotStreamAdapterState,
  event: CopilotProviderEventEnvelope,
): void {
  const handlerDeps = createProviderHandlerDeps(deps, state);
  const sessionContext = createSessionHandlerContext(deps, state);

  switch (event.type) {
    case "message.delta":
      handleCopilotMessageDelta(
        state,
        handlerDeps,
        toCopilotAgentEvent<"message.delta">(
          event as CopilotProviderEventEnvelope<"message.delta">,
        ),
      );
      break;
    case "message.complete":
      handleCopilotMessageComplete(
        state,
        handlerDeps,
        toCopilotAgentEvent<"message.complete">(
          event as CopilotProviderEventEnvelope<"message.complete">,
        ),
      );
      break;
    case "tool.start":
      handleCopilotToolStart(
        state,
        handlerDeps,
        toCopilotAgentEvent<"tool.start">(
          event as CopilotProviderEventEnvelope<"tool.start">,
        ),
      );
      break;
    case "tool.complete":
      handleCopilotToolComplete(
        state,
        handlerDeps,
        toCopilotAgentEvent<"tool.complete">(
          event as CopilotProviderEventEnvelope<"tool.complete">,
        ),
      );
      break;
    case "session.idle":
      handleCopilotSessionIdle(
        sessionContext,
        toCopilotAgentEvent<"session.idle">(
          event as CopilotProviderEventEnvelope<"session.idle">,
        ),
      );
      break;
    case "session.error":
      handleCopilotSessionError(
        sessionContext,
        toCopilotAgentEvent<"session.error">(
          event as CopilotProviderEventEnvelope<"session.error">,
        ),
      );
      break;
    case "usage":
      handleCopilotUsage(
        sessionContext,
        toCopilotAgentEvent<"usage">(
          event as CopilotProviderEventEnvelope<"usage">,
        ),
      );
      break;
    case "permission.requested":
      handleCopilotPermissionRequested(
        sessionContext,
        toCopilotAgentEvent<"permission.requested">(
          event as CopilotProviderEventEnvelope<"permission.requested">,
        ),
      );
      break;
    case "human_input_required":
      handleCopilotHumanInputRequired(
        sessionContext,
        toCopilotAgentEvent<"human_input_required">(
          event as CopilotProviderEventEnvelope<"human_input_required">,
        ),
      );
      break;
    case "skill.invoked":
      handleCopilotSkillInvoked(
        sessionContext,
        toCopilotAgentEvent<"skill.invoked">(
          event as CopilotProviderEventEnvelope<"skill.invoked">,
        ),
      );
      break;
    case "reasoning.delta":
      handleCopilotReasoningDelta(
        sessionContext,
        toCopilotAgentEvent<"reasoning.delta">(
          event as CopilotProviderEventEnvelope<"reasoning.delta">,
        ),
      );
      break;
    case "reasoning.complete":
      handleCopilotReasoningComplete(
        sessionContext,
        toCopilotAgentEvent<"reasoning.complete">(
          event as CopilotProviderEventEnvelope<"reasoning.complete">,
        ),
      );
      break;
    case "subagent.start":
      handleCopilotSubagentStart(
        state,
        handlerDeps,
        toCopilotAgentEvent<"subagent.start">(
          event as CopilotProviderEventEnvelope<"subagent.start">,
        ),
      );
      break;
    case "subagent.complete":
      handleCopilotSubagentComplete(
        state,
        handlerDeps,
        toCopilotAgentEvent<"subagent.complete">(
          event as CopilotProviderEventEnvelope<"subagent.complete">,
        ),
      );
      break;
    case "subagent.update":
      handleCopilotSubagentUpdate(
        state,
        handlerDeps,
        toCopilotAgentEvent<"subagent.update">(
          event as CopilotProviderEventEnvelope<"subagent.update">,
        ),
      );
      break;
    case "turn.start":
      handleCopilotTurnStart(
        sessionContext,
        toCopilotAgentEvent<"turn.start">(
          event as CopilotProviderEventEnvelope<"turn.start">,
        ),
      );
      break;
    case "turn.end":
      handleCopilotTurnEnd(
        sessionContext,
        toCopilotAgentEvent<"turn.end">(
          event as CopilotProviderEventEnvelope<"turn.end">,
        ),
      );
      break;
    case "tool.partial_result":
      handleCopilotToolPartialResult(
        sessionContext,
        toCopilotAgentEvent<"tool.partial_result">(
          event as CopilotProviderEventEnvelope<"tool.partial_result">,
        ),
      );
      break;
    case "session.info":
      handleCopilotSessionInfo(
        sessionContext,
        toCopilotAgentEvent<"session.info">(
          event as CopilotProviderEventEnvelope<"session.info">,
        ),
      );
      break;
    case "session.warning":
      handleCopilotSessionWarning(
        sessionContext,
        toCopilotAgentEvent<"session.warning">(
          event as CopilotProviderEventEnvelope<"session.warning">,
        ),
      );
      break;
    case "session.title_changed":
      handleCopilotSessionTitleChanged(
        sessionContext,
        toCopilotAgentEvent<"session.title_changed">(
          event as CopilotProviderEventEnvelope<"session.title_changed">,
        ),
      );
      break;
    case "session.truncation":
      handleCopilotSessionTruncation(
        sessionContext,
        toCopilotAgentEvent<"session.truncation">(
          event as CopilotProviderEventEnvelope<"session.truncation">,
        ),
      );
      break;
    case "session.compaction":
      handleCopilotSessionCompaction(
        sessionContext,
        toCopilotAgentEvent<"session.compaction">(
          event as CopilotProviderEventEnvelope<"session.compaction">,
        ),
      );
      break;
    // Intentionally unhandled SDK events:
    //
    // - session.start: The adapter publishes stream.session.start directly in
    //   the runtime startup path (runtime.ts) before event subscription begins,
    //   so this SDK event is never observed here. See event-coverage-policy.ts (no_op).
    //
    // - session.retry: Emitted by the streaming runtime retry loop (runtime.ts)
    //   directly to the bus, bypassing the provider event handler path entirely.
    default:
      break;
  }
}

function createProviderHandlerDeps(
  deps: CopilotStreamAdapterDeps,
  state: CopilotStreamAdapterState,
) {
  return {
    publishEvent: (event: BusEvent) =>
      publishCopilotBufferedEvent(state, deps.bus, event),
    resolveParentAgentId: (rawParentToolCallId: string | undefined) =>
      resolveCopilotParentAgentId({
        rawParentToolCallId,
        subagentTracker: state.subagentTracker,
        toolCallIdToSubagentId: state.toolCallIdToSubagentId,
      }),
    getSyntheticForegroundAgentIdForAttribution: () =>
      getSyntheticForegroundAgentIdForAttribution(state.syntheticForegroundAgent),
    publishSyntheticTaskToolComplete: (
      toolCallId: string,
      completion: { error?: string; result?: unknown; success: boolean },
    ) =>
      publishCopilotSyntheticTaskToolComplete({
        toolCallId,
        toolNameById: state.toolNameById,
        activeSubagentToolsById: state.activeSubagentToolsById,
        emittedToolStartIds: state.emittedToolStartIds,
        subagentTracker: state.subagentTracker,
        publishEvent: (event) => publishCopilotBufferedEvent(state, deps.bus, event),
        sessionId: state.sessionId,
        runId: state.runId,
        completion,
      }),
  };
}

function createSessionHandlerContext(
  deps: CopilotStreamAdapterDeps,
  state: CopilotStreamAdapterState,
): CopilotSessionHandlerContext {
  return {
    sessionId: state.sessionId,
    runId: state.runId,
    messageId: state.messageId,
    accumulatedText: state.accumulatedText,
    accumulatedOutputTokens: state.accumulatedOutputTokens,
    thinkingStreams: state.thinkingStreams,
    activeSubagentToolsById: state.activeSubagentToolsById,
    subagentTracker: state.subagentTracker,
    syntheticForegroundAgent: state.syntheticForegroundAgent,
    turnMetadataState: state.turnMetadataState,
    publishEvent: (event) => publishCopilotBufferedEvent(state, deps.bus, event),
    resolveParentAgentId: (rawParentToolCallId: string | undefined) =>
      resolveCopilotParentAgentId({
        rawParentToolCallId,
        subagentTracker: state.subagentTracker,
        toolCallIdToSubagentId: state.toolCallIdToSubagentId,
      }),
    updateAccumulatedOutputTokens: (value: number) => {
      state.accumulatedOutputTokens = value;
    },
    updatePendingIdleReason: (reason: string | null) => {
      state.pendingIdleReason = reason;
    },
  };
}

function toCopilotAgentEvent<T extends EventType>(
  event: {
    data: unknown;
    nativeParentEventId?: unknown;
    sessionId: string;
    timestamp: number;
    type: T;
  },
): AgentEvent<T> {
  const nativeParentEventId = event.nativeParentEventId;
  const eventData = (
    typeof event.data === "object" && event.data !== null && !Array.isArray(event.data)
  )
    ? {
        ...(event.data as Record<string, unknown>),
        ...(typeof nativeParentEventId === "string"
          ? {
              nativeParentEventId,
              parentId:
                (event.data as Record<string, unknown>).parentId ??
                nativeParentEventId,
            }
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
