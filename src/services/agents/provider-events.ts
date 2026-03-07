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
  AgentEvent,
  AgentMessage,
  PermissionOption,
  SessionConfig,
} from "@/services/agents/types.ts";

export type ProviderName = "claude" | "opencode" | "copilot";

export interface SyntheticProviderNativeEvent<
  TType extends string = ProviderStreamEventType,
  TData = unknown,
> {
  type: TType;
  synthetic: true;
  data: TData;
}

export function createSyntheticProviderNativeEvent<
  TType extends ProviderStreamEventType,
>(
  type: TType,
  data: ProviderStreamEventDataMap[TType],
): SyntheticProviderNativeEvent<TType, ProviderStreamEventDataMap[TType]> {
  return {
    type,
    synthetic: true,
    data,
  };
}

export type ClaudeHookBridgeEventType =
  | "tool.start"
  | "tool.complete"
  | "tool.partial_result"
  | "subagent.start"
  | "subagent.complete"
  | "subagent.update"
  | "permission.requested"
  | "human_input_required"
  | "skill.invoked"
  | "session.error"
  | "session.idle"
  | "session.compaction"
  | "usage";

export type ClaudeHookBridgeEvent = AgentEvent<ClaudeHookBridgeEventType>;
export type ProviderSyntheticEvent = SyntheticProviderNativeEvent<
  ProviderStreamEventType,
  ProviderStreamEventDataMap[ProviderStreamEventType]
>;
export type ClaudeNativeEvent = ClaudeSdkMessage | ClaudeHookBridgeEvent | ProviderSyntheticEvent;
export type OpenCodeEventType = OpenCodeNativeEvent["type"];
export type CopilotEventType = CopilotSessionEventType;

export type ProviderStreamEventType =
  | "session.start"
  | "session.idle"
  | "session.error"
  | "session.retry"
  | "session.info"
  | "session.warning"
  | "session.title_changed"
  | "session.truncation"
  | "session.compaction"
  | "message.delta"
  | "message.complete"
  | "reasoning.delta"
  | "reasoning.complete"
  | "turn.start"
  | "turn.end"
  | "tool.start"
  | "tool.complete"
  | "tool.partial_result"
  | "skill.invoked"
  | "subagent.start"
  | "subagent.complete"
  | "subagent.update"
  | "permission.requested"
  | "human_input_required"
  | "usage";

export interface ProviderEventEnvelope<
  TProvider extends ProviderName,
  TType extends ProviderStreamEventType,
  TData,
  TNativeType extends string,
  TNative,
> {
  provider: TProvider;
  type: TType;
  sessionId: string;
  timestamp: number;
  nativeType: TNativeType;
  native: TNative;
  nativeEventId?: string;
  nativeSessionId?: string;
  nativeParentEventId?: string;
  nativeSubtype?: string;
  nativeMeta?: Readonly<Record<string, string | number | boolean | null | undefined>>;
  data: TData;
}

export interface ProviderSessionStartData {
  config?: SessionConfig;
  sessionParentId?: string;
  source?: "start" | "resume";
  resumeTime?: string;
  resumeEventCount?: number;
}

export interface ProviderSessionIdleData {
  reason?: string;
}

export interface ProviderSessionErrorData {
  error: string;
  code?: string;
  errorType?: string;
  statusCode?: number;
  providerCallId?: string;
  stack?: string;
}

export interface ProviderSessionRetryData {
  attempt: number;
  delay: number;
  message: string;
  nextRetryAt: number;
}

export interface ProviderSessionInfoData {
  infoType: string;
  message: string;
}

export interface ProviderSessionWarningData {
  warningType: string;
  message: string;
}

export interface ProviderSessionTitleChangedData {
  title: string;
}

export interface ProviderSessionTruncationData {
  tokenLimit: number;
  tokensRemoved: number;
  messagesRemoved: number;
}

export interface ProviderSessionCompactionData {
  phase: "start" | "complete";
  success?: boolean;
  error?: string;
}

export interface ProviderMessageDeltaData {
  delta: string;
  contentType: "text" | "thinking";
  messageId?: string;
  nativeMessageId?: string;
  nativePartId?: string;
  thinkingSourceKey?: string;
  parentToolCallId?: string;
}

export interface ProviderMessageCompleteData {
  message: AgentMessage;
  nativeMessageId?: string;
  parentToolCallId?: string;
  interactionId?: string;
  phase?: string;
  reasoningText?: string;
  reasoningOpaque?: string;
  toolRequests?: Array<{
    toolCallId: string;
    name: string;
    arguments: unknown;
    type?: "function" | "custom";
  }>;
}

export interface ProviderReasoningDeltaData {
  delta: string;
  reasoningId: string;
  nativeMessageId?: string;
  parentToolCallId?: string;
}

export interface ProviderReasoningCompleteData {
  reasoningId: string;
  content?: string;
  durationMs?: number;
  nativeMessageId?: string;
  parentToolCallId?: string;
}

export interface ProviderTurnStartData {
  turnId: string;
}

export interface ProviderTurnEndData {
  turnId: string;
  finishReason?: string;
  rawFinishReason?: string;
}

export interface ProviderToolStartData {
  toolName: string;
  toolInput: unknown;
  toolUseId?: string;
  toolCallId?: string;
  parentToolCallId?: string;
  parentAgentId?: string;
  nativeMessageId?: string;
  mcpServerName?: string;
  mcpToolName?: string;
  interactionId?: string;
  toolMetadata?: Record<string, unknown>;
}

export interface ProviderToolCompleteData {
  toolName: string;
  toolInput?: unknown;
  toolResult: unknown;
  success: boolean;
  error?: string;
  toolUseId?: string;
  toolCallId?: string;
  parentToolCallId?: string;
  parentAgentId?: string;
  nativeMessageId?: string;
  interactionId?: string;
  structuredToolResult?: unknown;
  toolTelemetry?: Record<string, unknown>;
  toolMetadata?: Record<string, unknown>;
}

export interface ProviderToolPartialResultData {
  toolCallId: string;
  partialOutput: string;
  toolName?: string;
  parentToolCallId?: string;
  parentAgentId?: string;
}

export interface ProviderSkillInvokedData {
  skillName: string;
  skillPath?: string;
  parentToolCallId?: string;
}

export interface ProviderSubagentStartData {
  subagentId: string;
  subagentType?: string;
  task?: string;
  toolUseId?: string;
  toolCallId?: string;
  parentToolCallId?: string;
  subagentSessionId?: string;
  isBackground?: boolean;
  toolInput?: unknown;
}

export interface ProviderSubagentUpdateData {
  subagentId: string;
  currentTool?: string;
  toolUses?: number;
}

export interface ProviderSubagentCompleteData {
  subagentId: string;
  success: boolean;
  result?: unknown;
  error?: string;
  toolUseId?: string;
  toolCallId?: string;
}

export interface ProviderPermissionRequestedData {
  requestId: string;
  toolName: string;
  toolInput?: unknown;
  question: string;
  header?: string;
  options: PermissionOption[];
  multiSelect?: boolean;
  respond?: (answer: string | string[]) => void;
  toolCallId?: string;
  toolUseId?: string;
}

export interface ProviderHumanInputOption {
  label: string;
  description?: string;
}

export interface ProviderHumanInputRequiredData {
  requestId: string;
  question: string;
  header?: string;
  options?: ProviderHumanInputOption[];
  nodeId: string;
  respond?: (answer: string | string[]) => void;
}

export interface ProviderUsageData {
  inputTokens: number;
  outputTokens: number;
  model?: string;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  costUsd?: number;
  parentToolCallId?: string;
}

export type ProviderStreamEventDataMap = {
  "session.start": ProviderSessionStartData;
  "session.idle": ProviderSessionIdleData;
  "session.error": ProviderSessionErrorData;
  "session.retry": ProviderSessionRetryData;
  "session.info": ProviderSessionInfoData;
  "session.warning": ProviderSessionWarningData;
  "session.title_changed": ProviderSessionTitleChangedData;
  "session.truncation": ProviderSessionTruncationData;
  "session.compaction": ProviderSessionCompactionData;
  "message.delta": ProviderMessageDeltaData;
  "message.complete": ProviderMessageCompleteData;
  "reasoning.delta": ProviderReasoningDeltaData;
  "reasoning.complete": ProviderReasoningCompleteData;
  "turn.start": ProviderTurnStartData;
  "turn.end": ProviderTurnEndData;
  "tool.start": ProviderToolStartData;
  "tool.complete": ProviderToolCompleteData;
  "tool.partial_result": ProviderToolPartialResultData;
  "skill.invoked": ProviderSkillInvokedData;
  "subagent.start": ProviderSubagentStartData;
  "subagent.complete": ProviderSubagentCompleteData;
  "subagent.update": ProviderSubagentUpdateData;
  "permission.requested": ProviderPermissionRequestedData;
  "human_input_required": ProviderHumanInputRequiredData;
  usage: ProviderUsageData;
};

export type ProviderStreamEvent<
  TProvider extends ProviderName,
  TType extends ProviderStreamEventType = ProviderStreamEventType,
  TNativeType extends string = string,
  TNative = unknown,
> = ProviderEventEnvelope<TProvider, TType, ProviderStreamEventDataMap[TType], TNativeType, TNative>;

export type SyntheticProviderEventFor<TType extends ProviderStreamEventType> =
  SyntheticProviderNativeEvent<TType, ProviderStreamEventDataMap[TType]>;

type ClaudeBridgeNativeEvent<TType extends ClaudeHookBridgeEventType> = AgentEvent<TType>;

type ClaudeNativeByProviderEvent = {
  "session.start": SyntheticProviderEventFor<"session.start">;
  "session.idle": ClaudeResultMessage | ClaudeBridgeNativeEvent<"session.idle"> | SyntheticProviderEventFor<"session.idle">;
  "session.error": ClaudeResultMessage | ClaudeBridgeNativeEvent<"session.error"> | SyntheticProviderEventFor<"session.error">;
  "session.retry": SyntheticProviderEventFor<"session.retry">;
  "session.info": ClaudeHookStartedMessage | ClaudeHookProgressMessage | ClaudeHookResponseMessage | SyntheticProviderEventFor<"session.info">;
  "session.warning": ClaudeAuthStatusMessage | ClaudeRateLimitEvent | SyntheticProviderEventFor<"session.warning">;
  "session.title_changed": SyntheticProviderEventFor<"session.title_changed">;
  "session.truncation": SyntheticProviderEventFor<"session.truncation">;
  "session.compaction": ClaudeStatusMessage | ClaudeSystemMessage | ClaudeBridgeNativeEvent<"session.compaction"> | SyntheticProviderEventFor<"session.compaction">;
  "message.delta": ClaudePartialAssistantMessage | SyntheticProviderEventFor<"message.delta">;
  "message.complete": ClaudeAssistantMessage | SyntheticProviderEventFor<"message.complete">;
  "reasoning.delta": ClaudePartialAssistantMessage | SyntheticProviderEventFor<"reasoning.delta">;
  "reasoning.complete": ClaudePartialAssistantMessage | SyntheticProviderEventFor<"reasoning.complete">;
  "turn.start": SyntheticProviderEventFor<"turn.start">;
  "turn.end": SyntheticProviderEventFor<"turn.end">;
  "tool.start": ClaudeBridgeNativeEvent<"tool.start"> | SyntheticProviderEventFor<"tool.start">;
  "tool.complete": ClaudeBridgeNativeEvent<"tool.complete"> | SyntheticProviderEventFor<"tool.complete">;
  "tool.partial_result": ClaudeBridgeNativeEvent<"tool.partial_result"> | SyntheticProviderEventFor<"tool.partial_result">;
  "skill.invoked": ClaudeBridgeNativeEvent<"skill.invoked"> | SyntheticProviderEventFor<"skill.invoked">;
  "subagent.start": ClaudeTaskStartedMessage | ClaudeBridgeNativeEvent<"subagent.start"> | SyntheticProviderEventFor<"subagent.start">;
  "subagent.complete": ClaudeTaskNotificationMessage | ClaudeBridgeNativeEvent<"subagent.complete"> | SyntheticProviderEventFor<"subagent.complete">;
  "subagent.update": ClaudeTaskProgressMessage | ClaudeBridgeNativeEvent<"subagent.update"> | SyntheticProviderEventFor<"subagent.update">;
  "permission.requested": ClaudeBridgeNativeEvent<"permission.requested"> | SyntheticProviderEventFor<"permission.requested">;
  "human_input_required": ClaudeBridgeNativeEvent<"human_input_required"> | SyntheticProviderEventFor<"human_input_required">;
  usage: ClaudeResultMessage | ClaudeBridgeNativeEvent<"usage"> | SyntheticProviderEventFor<"usage">;
};

type OpenCodeNativeByProviderEvent = {
  "session.start": OpenCodeSessionCreatedEvent | SyntheticProviderEventFor<"session.start">;
  "session.idle": OpenCodeSessionStatusEvent | OpenCodeSessionIdleEvent | SyntheticProviderEventFor<"session.idle">;
  "session.error": OpenCodeSessionErrorEvent | SyntheticProviderEventFor<"session.error">;
  "session.retry": OpenCodeSessionStatusEvent | SyntheticProviderEventFor<"session.retry">;
  "session.info": SyntheticProviderEventFor<"session.info">;
  "session.warning": SyntheticProviderEventFor<"session.warning">;
  "session.title_changed": OpenCodeSessionUpdatedEvent | SyntheticProviderEventFor<"session.title_changed">;
  "session.truncation": SyntheticProviderEventFor<"session.truncation">;
  "session.compaction": OpenCodeSessionCompactedEvent | SyntheticProviderEventFor<"session.compaction">;
  "message.delta": OpenCodeMessagePartDeltaEvent | SyntheticProviderEventFor<"message.delta">;
  "message.complete": OpenCodeMessageUpdatedEvent | SyntheticProviderEventFor<"message.complete">;
  "reasoning.delta": OpenCodeMessagePartDeltaEvent | SyntheticProviderEventFor<"reasoning.delta">;
  "reasoning.complete": SyntheticProviderEventFor<"reasoning.complete">;
  "turn.start": SyntheticProviderEventFor<"turn.start">;
  "turn.end": SyntheticProviderEventFor<"turn.end">;
  "tool.start": OpenCodeMessagePartUpdatedEvent | SyntheticProviderEventFor<"tool.start">;
  "tool.complete": OpenCodeMessagePartUpdatedEvent | SyntheticProviderEventFor<"tool.complete">;
  "tool.partial_result": SyntheticProviderEventFor<"tool.partial_result">;
  "skill.invoked": SyntheticProviderEventFor<"skill.invoked">;
  "subagent.start": OpenCodeMessagePartUpdatedEvent | SyntheticProviderEventFor<"subagent.start">;
  "subagent.complete": OpenCodeMessagePartUpdatedEvent | SyntheticProviderEventFor<"subagent.complete">;
  "subagent.update": OpenCodeMessagePartUpdatedEvent | SyntheticProviderEventFor<"subagent.update">;
  "permission.requested": OpenCodePermissionAskedEvent | SyntheticProviderEventFor<"permission.requested">;
  "human_input_required": OpenCodeQuestionAskedEvent | SyntheticProviderEventFor<"human_input_required">;
  usage: OpenCodeMessageUpdatedEvent | SyntheticProviderEventFor<"usage">;
};

type CopilotNativeByProviderEvent = {
  "session.start": CopilotSessionEventPayload<"session.start"> | CopilotSessionEventPayload<"session.resume"> | SyntheticProviderEventFor<"session.start">;
  "session.idle": CopilotSessionEventPayload<"session.idle"> | SyntheticProviderEventFor<"session.idle">;
  "session.error": CopilotSessionEventPayload<"session.error"> | SyntheticProviderEventFor<"session.error">;
  "session.retry": SyntheticProviderEventFor<"session.retry">;
  "session.info": CopilotSessionEventPayload<"session.info"> | SyntheticProviderEventFor<"session.info">;
  "session.warning": CopilotSessionEventPayload<"session.warning"> | SyntheticProviderEventFor<"session.warning">;
  "session.title_changed": CopilotSessionEventPayload<"session.title_changed"> | SyntheticProviderEventFor<"session.title_changed">;
  "session.truncation": CopilotSessionEventPayload<"session.truncation"> | SyntheticProviderEventFor<"session.truncation">;
  "session.compaction": CopilotSessionEventPayload<"session.compaction_start"> | CopilotSessionEventPayload<"session.compaction_complete"> | SyntheticProviderEventFor<"session.compaction">;
  "message.delta": CopilotSessionEventPayload<"assistant.message_delta"> | SyntheticProviderEventFor<"message.delta">;
  "message.complete": CopilotSessionEventPayload<"assistant.message"> | SyntheticProviderEventFor<"message.complete">;
  "reasoning.delta": CopilotSessionEventPayload<"assistant.reasoning_delta"> | SyntheticProviderEventFor<"reasoning.delta">;
  "reasoning.complete": CopilotSessionEventPayload<"assistant.reasoning"> | SyntheticProviderEventFor<"reasoning.complete">;
  "turn.start": CopilotSessionEventPayload<"assistant.turn_start"> | SyntheticProviderEventFor<"turn.start">;
  "turn.end": CopilotSessionEventPayload<"assistant.turn_end"> | SyntheticProviderEventFor<"turn.end">;
  "tool.start": CopilotSessionEventPayload<"tool.execution_start"> | SyntheticProviderEventFor<"tool.start">;
  "tool.complete": CopilotSessionEventPayload<"tool.execution_complete"> | SyntheticProviderEventFor<"tool.complete">;
  "tool.partial_result": CopilotSessionEventPayload<"tool.execution_partial_result"> | CopilotSessionEventPayload<"tool.execution_progress"> | SyntheticProviderEventFor<"tool.partial_result">;
  "skill.invoked": CopilotSessionEventPayload<"skill.invoked"> | SyntheticProviderEventFor<"skill.invoked">;
  "subagent.start": CopilotSessionEventPayload<"subagent.started"> | SyntheticProviderEventFor<"subagent.start">;
  "subagent.complete": CopilotSessionEventPayload<"subagent.completed"> | SyntheticProviderEventFor<"subagent.complete">;
  "subagent.update": SyntheticProviderEventFor<"subagent.update">;
  "permission.requested": SyntheticProviderEventFor<"permission.requested">;
  "human_input_required": SyntheticProviderEventFor<"human_input_required">;
  usage: CopilotSessionEventPayload<"assistant.usage"> | SyntheticProviderEventFor<"usage">;
};

export type ProviderStreamEventUnion<
  TProvider extends ProviderName,
  TNativeMap extends Record<ProviderStreamEventType, { type: string }>,
> = {
  [K in ProviderStreamEventType]: ProviderStreamEvent<TProvider, K, TNativeMap[K]["type"], TNativeMap[K]>;
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

export interface ProviderEventSource<TEvent> {
  onProviderEvent(handler: (event: TEvent) => void): () => void;
}

export interface ClaudeProviderEventSource extends ProviderEventSource<ClaudeProviderEvent> {}
export interface OpenCodeProviderEventSource extends ProviderEventSource<OpenCodeProviderEvent> {}
export interface CopilotProviderEventSource extends ProviderEventSource<CopilotProviderEvent> {}
