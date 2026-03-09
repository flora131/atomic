export type MessageRole = "user" | "assistant" | "system" | "tool";

export type MessageContentType =
  | "text"
  | "tool_use"
  | "tool_result"
  | "thinking";

export interface MessageMetadata {
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
  };
  model?: string;
  toolName?: string;
  toolInput?: unknown;
  stopReason?: string;
  [key: string]: unknown;
}

export interface AgentMessage {
  type: MessageContentType;
  content: string | unknown;
  role?: MessageRole;
  metadata?: MessageMetadata;
}
