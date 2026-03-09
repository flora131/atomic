import type {
  AgentEvent,
  AgentMessage,
  PermissionOption,
  SessionConfig,
} from "@/services/agents/types.ts";

export type ProviderName = "claude" | "opencode" | "copilot";

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
> = ProviderEventEnvelope<
  TProvider,
  TType,
  ProviderStreamEventDataMap[TType],
  TNativeType,
  TNative
>;

export type SyntheticProviderEventFor<TType extends ProviderStreamEventType> =
  SyntheticProviderNativeEvent<TType, ProviderStreamEventDataMap[TType]>;

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

export interface ProviderEventSource<TEvent> {
  onProviderEvent(handler: (event: TEvent) => void): () => void;
}
