import type {
  SessionEventPayload as CopilotSessionEventPayload,
  SessionEventType as CopilotSessionEventType,
} from "@github/copilot-sdk";
import type {
  Event as OpenCodeNativeEvent,
  EventMessagePartDelta as OpenCodeMessagePartDeltaEvent,
  EventMessagePartUpdated as OpenCodeMessagePartUpdatedEvent,
  EventMessageUpdated as OpenCodeMessageUpdatedEvent,
  EventPermissionAsked as OpenCodePermissionAskedEvent,
  EventQuestionAsked as OpenCodeQuestionAskedEvent,
  EventSessionCompacted as OpenCodeSessionCompactedEvent,
  EventSessionCreated as OpenCodeSessionCreatedEvent,
  EventSessionError as OpenCodeSessionErrorEvent,
  EventSessionIdle as OpenCodeSessionIdleEvent,
  EventSessionStatus as OpenCodeSessionStatusEvent,
  EventSessionUpdated as OpenCodeSessionUpdatedEvent,
} from "@opencode-ai/sdk/v2/client";
import type {
  SDKAssistantMessage as ClaudeAssistantMessage,
  SDKAuthStatusMessage as ClaudeAuthStatusMessage,
  SDKHookProgressMessage as ClaudeHookProgressMessage,
  SDKHookResponseMessage as ClaudeHookResponseMessage,
  SDKHookStartedMessage as ClaudeHookStartedMessage,
  SDKMessage as ClaudeSdkMessage,
  SDKPartialAssistantMessage as ClaudePartialAssistantMessage,
  SDKRateLimitEvent as ClaudeRateLimitEvent,
  SDKResultMessage as ClaudeResultMessage,
  SDKStatusMessage as ClaudeStatusMessage,
  SDKSystemMessage as ClaudeSystemMessage,
  SDKTaskNotificationMessage as ClaudeTaskNotificationMessage,
  SDKTaskProgressMessage as ClaudeTaskProgressMessage,
  SDKTaskStartedMessage as ClaudeTaskStartedMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  ClaudeHookBridgeEvent,
  ClaudeHookBridgeEventType,
  ProviderEventSource,
  ProviderName,
  ProviderStreamEvent,
  ProviderStreamEventDataMap,
  ProviderStreamEventType,
  SyntheticProviderEventFor,
  SyntheticProviderNativeEvent,
} from "@/services/agents/provider-events/contracts.ts";

export type ProviderSyntheticEvent = SyntheticProviderNativeEvent<
  ProviderStreamEventType,
  ProviderStreamEventDataMap[ProviderStreamEventType]
>;
export type ClaudeNativeEvent =
  | ClaudeSdkMessage
  | ClaudeHookBridgeEvent
  | ProviderSyntheticEvent;
export type OpenCodeEventType = OpenCodeNativeEvent["type"];
export type CopilotEventType = CopilotSessionEventType;

type ClaudeBridgeNativeEvent<TType extends ClaudeHookBridgeEventType> =
  ClaudeHookBridgeEvent & { type: TType };

type ClaudeNativeByProviderEvent = {
  "session.start": SyntheticProviderEventFor<"session.start">;
  "session.idle":
    | ClaudeResultMessage
    | ClaudeBridgeNativeEvent<"session.idle">
    | SyntheticProviderEventFor<"session.idle">;
  "session.error":
    | ClaudeResultMessage
    | ClaudeBridgeNativeEvent<"session.error">
    | SyntheticProviderEventFor<"session.error">;
  "session.retry": SyntheticProviderEventFor<"session.retry">;
  "session.info":
    | ClaudeHookStartedMessage
    | ClaudeHookProgressMessage
    | ClaudeHookResponseMessage
    | SyntheticProviderEventFor<"session.info">;
  "session.warning":
    | ClaudeAuthStatusMessage
    | ClaudeRateLimitEvent
    | SyntheticProviderEventFor<"session.warning">;
  "session.title_changed": SyntheticProviderEventFor<"session.title_changed">;
  "session.truncation": SyntheticProviderEventFor<"session.truncation">;
  "session.compaction":
    | ClaudeStatusMessage
    | ClaudeSystemMessage
    | ClaudeBridgeNativeEvent<"session.compaction">
    | SyntheticProviderEventFor<"session.compaction">;
  "message.delta":
    | ClaudePartialAssistantMessage
    | SyntheticProviderEventFor<"message.delta">;
  "message.complete":
    | ClaudeAssistantMessage
    | SyntheticProviderEventFor<"message.complete">;
  "reasoning.delta":
    | ClaudePartialAssistantMessage
    | SyntheticProviderEventFor<"reasoning.delta">;
  "reasoning.complete":
    | ClaudePartialAssistantMessage
    | SyntheticProviderEventFor<"reasoning.complete">;
  "turn.start": SyntheticProviderEventFor<"turn.start">;
  "turn.end": SyntheticProviderEventFor<"turn.end">;
  "tool.start":
    | ClaudeBridgeNativeEvent<"tool.start">
    | SyntheticProviderEventFor<"tool.start">;
  "tool.complete":
    | ClaudeBridgeNativeEvent<"tool.complete">
    | SyntheticProviderEventFor<"tool.complete">;
  "tool.partial_result":
    | ClaudeBridgeNativeEvent<"tool.partial_result">
    | SyntheticProviderEventFor<"tool.partial_result">;
  "skill.invoked":
    | ClaudeBridgeNativeEvent<"skill.invoked">
    | SyntheticProviderEventFor<"skill.invoked">;
  "subagent.start":
    | ClaudeTaskStartedMessage
    | ClaudeBridgeNativeEvent<"subagent.start">
    | SyntheticProviderEventFor<"subagent.start">;
  "subagent.complete":
    | ClaudeTaskNotificationMessage
    | ClaudeBridgeNativeEvent<"subagent.complete">
    | SyntheticProviderEventFor<"subagent.complete">;
  "subagent.update":
    | ClaudeTaskProgressMessage
    | ClaudeBridgeNativeEvent<"subagent.update">
    | SyntheticProviderEventFor<"subagent.update">;
  "permission.requested":
    | ClaudeBridgeNativeEvent<"permission.requested">
    | SyntheticProviderEventFor<"permission.requested">;
  "human_input_required":
    | ClaudeBridgeNativeEvent<"human_input_required">
    | SyntheticProviderEventFor<"human_input_required">;
  usage:
    | ClaudeResultMessage
    | ClaudeBridgeNativeEvent<"usage">
    | SyntheticProviderEventFor<"usage">;
};

type OpenCodeNativeByProviderEvent = {
  "session.start":
    | OpenCodeSessionCreatedEvent
    | SyntheticProviderEventFor<"session.start">;
  "session.idle":
    | OpenCodeSessionStatusEvent
    | OpenCodeSessionIdleEvent
    | SyntheticProviderEventFor<"session.idle">;
  "session.error":
    | OpenCodeSessionErrorEvent
    | SyntheticProviderEventFor<"session.error">;
  "session.retry":
    | OpenCodeSessionStatusEvent
    | SyntheticProviderEventFor<"session.retry">;
  "session.info": SyntheticProviderEventFor<"session.info">;
  "session.warning": SyntheticProviderEventFor<"session.warning">;
  "session.title_changed":
    | OpenCodeSessionUpdatedEvent
    | SyntheticProviderEventFor<"session.title_changed">;
  "session.truncation": SyntheticProviderEventFor<"session.truncation">;
  "session.compaction":
    | OpenCodeSessionCompactedEvent
    | SyntheticProviderEventFor<"session.compaction">;
  "message.delta":
    | OpenCodeMessagePartDeltaEvent
    | SyntheticProviderEventFor<"message.delta">;
  "message.complete":
    | OpenCodeMessageUpdatedEvent
    | SyntheticProviderEventFor<"message.complete">;
  "reasoning.delta":
    | OpenCodeMessagePartDeltaEvent
    | SyntheticProviderEventFor<"reasoning.delta">;
  "reasoning.complete": SyntheticProviderEventFor<"reasoning.complete">;
  "turn.start": SyntheticProviderEventFor<"turn.start">;
  "turn.end": SyntheticProviderEventFor<"turn.end">;
  "tool.start":
    | OpenCodeMessagePartUpdatedEvent
    | SyntheticProviderEventFor<"tool.start">;
  "tool.complete":
    | OpenCodeMessagePartUpdatedEvent
    | SyntheticProviderEventFor<"tool.complete">;
  "tool.partial_result": SyntheticProviderEventFor<"tool.partial_result">;
  "skill.invoked": SyntheticProviderEventFor<"skill.invoked">;
  "subagent.start":
    | OpenCodeMessagePartUpdatedEvent
    | SyntheticProviderEventFor<"subagent.start">;
  "subagent.complete":
    | OpenCodeMessagePartUpdatedEvent
    | SyntheticProviderEventFor<"subagent.complete">;
  "subagent.update":
    | OpenCodeMessagePartUpdatedEvent
    | SyntheticProviderEventFor<"subagent.update">;
  "permission.requested":
    | OpenCodePermissionAskedEvent
    | SyntheticProviderEventFor<"permission.requested">;
  "human_input_required":
    | OpenCodeQuestionAskedEvent
    | SyntheticProviderEventFor<"human_input_required">;
  usage: OpenCodeMessageUpdatedEvent | SyntheticProviderEventFor<"usage">;
};

type CopilotNativeByProviderEvent = {
  "session.start":
    | CopilotSessionEventPayload<"session.start">
    | CopilotSessionEventPayload<"session.resume">
    | SyntheticProviderEventFor<"session.start">;
  "session.idle":
    | CopilotSessionEventPayload<"session.idle">
    | SyntheticProviderEventFor<"session.idle">;
  "session.error":
    | CopilotSessionEventPayload<"session.error">
    | SyntheticProviderEventFor<"session.error">;
  "session.retry": SyntheticProviderEventFor<"session.retry">;
  "session.info":
    | CopilotSessionEventPayload<"session.info">
    | SyntheticProviderEventFor<"session.info">;
  "session.warning":
    | CopilotSessionEventPayload<"session.warning">
    | SyntheticProviderEventFor<"session.warning">;
  "session.title_changed":
    | CopilotSessionEventPayload<"session.title_changed">
    | SyntheticProviderEventFor<"session.title_changed">;
  "session.truncation":
    | CopilotSessionEventPayload<"session.truncation">
    | SyntheticProviderEventFor<"session.truncation">;
  "session.compaction":
    | CopilotSessionEventPayload<"session.compaction_start">
    | CopilotSessionEventPayload<"session.compaction_complete">
    | SyntheticProviderEventFor<"session.compaction">;
  "message.delta":
    | CopilotSessionEventPayload<"assistant.message_delta">
    | SyntheticProviderEventFor<"message.delta">;
  "message.complete":
    | CopilotSessionEventPayload<"assistant.message">
    | SyntheticProviderEventFor<"message.complete">;
  "reasoning.delta":
    | CopilotSessionEventPayload<"assistant.reasoning_delta">
    | SyntheticProviderEventFor<"reasoning.delta">;
  "reasoning.complete":
    | CopilotSessionEventPayload<"assistant.reasoning">
    | SyntheticProviderEventFor<"reasoning.complete">;
  "turn.start":
    | CopilotSessionEventPayload<"assistant.turn_start">
    | SyntheticProviderEventFor<"turn.start">;
  "turn.end":
    | CopilotSessionEventPayload<"assistant.turn_end">
    | SyntheticProviderEventFor<"turn.end">;
  "tool.start":
    | CopilotSessionEventPayload<"tool.execution_start">
    | SyntheticProviderEventFor<"tool.start">;
  "tool.complete":
    | CopilotSessionEventPayload<"tool.execution_complete">
    | SyntheticProviderEventFor<"tool.complete">;
  "tool.partial_result":
    | CopilotSessionEventPayload<"tool.execution_partial_result">
    | CopilotSessionEventPayload<"tool.execution_progress">
    | SyntheticProviderEventFor<"tool.partial_result">;
  "skill.invoked":
    | CopilotSessionEventPayload<"skill.invoked">
    | SyntheticProviderEventFor<"skill.invoked">;
  "subagent.start":
    | CopilotSessionEventPayload<"subagent.started">
    | SyntheticProviderEventFor<"subagent.start">;
  "subagent.complete":
    | CopilotSessionEventPayload<"subagent.completed">
    | SyntheticProviderEventFor<"subagent.complete">;
  "subagent.update": SyntheticProviderEventFor<"subagent.update">;
  "permission.requested": SyntheticProviderEventFor<"permission.requested">;
  "human_input_required": SyntheticProviderEventFor<"human_input_required">;
  usage:
    | CopilotSessionEventPayload<"assistant.usage">
    | SyntheticProviderEventFor<"usage">;
};

export type ProviderStreamEventUnion<
  TProvider extends ProviderName,
  TNativeMap extends Record<ProviderStreamEventType, { type: string }>,
> = {
  [K in ProviderStreamEventType]: ProviderStreamEvent<
    TProvider,
    K,
    TNativeMap[K]["type"],
    TNativeMap[K]
  >;
}[ProviderStreamEventType];

export type ClaudeProviderEvent = ProviderStreamEventUnion<
  "claude",
  ClaudeNativeByProviderEvent
>;
export type OpenCodeProviderEvent = ProviderStreamEventUnion<
  "opencode",
  OpenCodeNativeByProviderEvent
>;
export type CopilotProviderEvent = ProviderStreamEventUnion<
  "copilot",
  CopilotNativeByProviderEvent
>;

export type ClaudeProviderEventHandler = (event: ClaudeProviderEvent) => void;
export type OpenCodeProviderEventHandler = (event: OpenCodeProviderEvent) => void;
export type CopilotProviderEventHandler = (event: CopilotProviderEvent) => void;

export interface ClaudeProviderEventSource
  extends ProviderEventSource<ClaudeProviderEvent> {}
export interface OpenCodeProviderEventSource
  extends ProviderEventSource<OpenCodeProviderEvent> {}
export interface CopilotProviderEventSource
  extends ProviderEventSource<CopilotProviderEvent> {}
