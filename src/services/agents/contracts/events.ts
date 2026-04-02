import type { AgentMessage, MessageContentType, SessionConfig } from "@/services/agents/contracts/session.ts";

export type EventType =
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

export interface BaseEventData {
  /** SDK events may carry additional provider-specific fields at runtime. */
  [key: string]: unknown;
}

export interface SessionStartEventData extends BaseEventData {
  config?: SessionConfig;
  source?: "start" | "resume";
  resumeTime?: string;
  resumeEventCount?: number;
}

export interface SessionIdleEventData extends BaseEventData {
  reason?: string;
}

export interface SessionErrorEventData extends BaseEventData {
  error: Error | string;
  code?: string;
  errorType?: string;
  statusCode?: number;
  providerCallId?: string;
  stack?: string;
}

export interface SessionRetryEventData extends BaseEventData {
  attempt: number;
  delay: number;
  message: string;
  nextRetryAt: number;
}

export interface MessageDeltaEventData extends BaseEventData {
  delta: string;
  contentType?: MessageContentType;
  thinkingSourceKey?: string;
  parentToolCallId?: string;
  messageId?: string;
}

export interface MessageCompleteEventData extends BaseEventData {
  message: AgentMessage;
  toolRequests?: Array<{
    toolCallId: string;
    name: string;
    arguments: unknown;
    type?: "function" | "custom";
  }>;
  parentToolCallId?: string;
  nativeMessageId?: string;
  interactionId?: string;
  phase?: string;
  reasoningText?: string;
  reasoningOpaque?: string;
}

export interface ToolStartEventData extends BaseEventData {
  toolName: string;
  toolInput?: unknown;
  toolUseId?: string;
  toolUseID?: string;
  toolCallId?: string;
  parentToolCallId?: string;
  parentId?: string;
}

export interface ToolCompleteEventData extends BaseEventData {
  toolName: string;
  toolResult?: unknown;
  success: boolean;
  error?: string;
  toolUseId?: string;
  toolUseID?: string;
  toolCallId?: string;
  parentToolCallId?: string;
  toolInput?: unknown;
  parentId?: string;
}

export interface SkillInvokedEventData extends BaseEventData {
  skillName: string;
  skillPath?: string;
  parentToolCallId?: string;
  parentAgentId?: string;
}

export interface ReasoningDeltaEventData extends BaseEventData {
  delta: string;
  reasoningId: string;
  parentToolCallId?: string;
}

export interface ReasoningCompleteEventData extends BaseEventData {
  reasoningId: string;
  content: string;
  parentToolCallId?: string;
}

export interface TurnStartEventData extends BaseEventData {
  turnId: string;
}

export interface TurnEndEventData extends BaseEventData {
  turnId: string;
  finishReason?: string;
  rawFinishReason?: string;
}

export interface ToolPartialResultEventData extends BaseEventData {
  toolCallId: string;
  partialOutput: string;
}

export interface SessionInfoEventData extends BaseEventData {
  infoType: string;
  message: string;
}

export interface SessionWarningEventData extends BaseEventData {
  warningType: string;
  message: string;
}

export interface SessionTitleChangedEventData extends BaseEventData {
  title: string;
}

export interface SessionTruncationEventData extends BaseEventData {
  tokenLimit: number;
  tokensRemoved: number;
  messagesRemoved: number;
}

export interface SessionCompactionEventData extends BaseEventData {
  phase: "start" | "complete";
  success?: boolean;
  error?: string;
}

export interface SubagentStartEventData extends BaseEventData {
  subagentId: string;
  subagentType?: string;
  task?: string;
  toolUseId?: string;
  toolUseID?: string;
  toolCallId?: string;
  subagentSessionId?: string;
  isBackground?: boolean;
  parentToolCallId?: string;
}

export interface SubagentUpdateEventData extends BaseEventData {
  subagentId: string;
  currentTool?: string;
  toolUses?: number;
}

export interface SubagentCompleteEventData extends BaseEventData {
  subagentId: string;
  result?: unknown;
  success: boolean;
  error?: string;
}

export interface PermissionOption {
  label: string;
  value: string;
  description?: string;
}

export interface PermissionRequestedEventData extends BaseEventData {
  requestId: string;
  toolName: string;
  toolInput?: unknown;
  question: string;
  header?: string;
  options: PermissionOption[];
  multiSelect?: boolean;
  respond?: (answer: string | string[]) => void;
  toolCallId?: string;
}

export interface HumanInputOption {
  label: string;
  description?: string;
}

export interface HumanInputRequiredEventData extends BaseEventData {
  requestId: string;
  question: string;
  header?: string;
  options?: HumanInputOption[];
  nodeId: string;
  respond?: (answer: string | string[]) => void;
  toolCallId?: string;
}

export interface UsageEventData extends BaseEventData {
  inputTokens?: number;
  outputTokens?: number;
  model?: string;
  agentId?: string;
}

export interface EventDataMap {
  "session.start": SessionStartEventData;
  "session.idle": SessionIdleEventData;
  "session.error": SessionErrorEventData;
  "session.retry": SessionRetryEventData;
  "session.info": SessionInfoEventData;
  "session.warning": SessionWarningEventData;
  "session.title_changed": SessionTitleChangedEventData;
  "session.truncation": SessionTruncationEventData;
  "session.compaction": SessionCompactionEventData;
  "message.delta": MessageDeltaEventData;
  "message.complete": MessageCompleteEventData;
  "reasoning.delta": ReasoningDeltaEventData;
  "reasoning.complete": ReasoningCompleteEventData;
  "turn.start": TurnStartEventData;
  "turn.end": TurnEndEventData;
  "tool.start": ToolStartEventData;
  "tool.complete": ToolCompleteEventData;
  "tool.partial_result": ToolPartialResultEventData;
  "skill.invoked": SkillInvokedEventData;
  "subagent.start": SubagentStartEventData;
  "subagent.complete": SubagentCompleteEventData;
  "subagent.update": SubagentUpdateEventData;
  "permission.requested": PermissionRequestedEventData;
  "human_input_required": HumanInputRequiredEventData;
  "usage": UsageEventData;
}

export interface AgentEvent<T extends EventType = EventType> {
  type: T;
  sessionId: string;
  timestamp: string;
  data: T extends keyof EventDataMap ? EventDataMap[T] : BaseEventData;
}

export type EventHandler<T extends EventType = EventType> = (
  event: AgentEvent<T>
) => void | Promise<void>;
