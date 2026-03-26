import type { AgentDefinition as ClaudeAgentDefinition } from "@anthropic-ai/claude-agent-sdk";
import type { McpRuntimeSnapshot, McpServerConfig } from "@/services/agents/contracts/mcp.ts";
import type { OpenCodeAgentMode } from "@/services/agents/contracts/models.ts";

export type PermissionMode = "auto" | "prompt" | "deny" | "bypass";

export interface SessionConfig {
  model?: string;
  sessionId?: string;
  /**
   * Completely replaces the default system prompt for this session.
   * When set, the SDK's built-in system prompt (e.g., Claude Code preset,
   * Copilot guardrails) is discarded and this string is used instead.
   * Takes precedence over `additionalInstructions`.
   */
  systemPrompt?: string;
  /** Appended to the default system prompt. Ignored when `systemPrompt` is set. */
  additionalInstructions?: string;
  tools?: string[];
  excludedTools?: string[];
  mcpServers?: McpServerConfig[];
  permissionMode?: PermissionMode;
  maxBudgetUsd?: number;
  maxTurns?: number;
  agentMode?: OpenCodeAgentMode;
  reasoningEffort?: string;
  maxThinkingTokens?: number;
  agents?: Record<string, ClaudeAgentDefinition>;
}

export type MessageRole = "user" | "assistant" | "system" | "tool";
export type MessageContentType = "text" | "tool_use" | "tool_result" | "thinking";

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

export interface ContextUsage {
  inputTokens: number;
  outputTokens: number;
  maxTokens: number;
  usagePercentage: number;
}

export interface SessionCompactionState {
  isCompacting: boolean;
  hasAutoCompacted: boolean;
}

export interface SessionMessageWithParts {
  info: {
    id: string;
    sessionID: string;
    role?: MessageRole;
    [key: string]: unknown;
  };
  parts: Array<Record<string, unknown>>;
}

export interface Session {
  readonly id: string;
  send(message: string): Promise<AgentMessage>;
  stream(
    message: string,
    options?: { agent?: string; abortSignal?: AbortSignal },
  ): AsyncIterable<AgentMessage>;
  sendAsync?(message: string, options?: { agent?: string; abortSignal?: AbortSignal }): Promise<void>;
  summarize(): Promise<void>;
  getContextUsage(): Promise<ContextUsage>;
  getSystemToolsTokens(): number;
  getMcpSnapshot?(): Promise<McpRuntimeSnapshot | null>;
  getCompactionState?(): SessionCompactionState | null;
  destroy(): Promise<void>;
  command?(
    commandName: string,
    args: string,
    options?: { agent?: string; abortSignal?: AbortSignal },
  ): Promise<void>;
  abort?(): Promise<void>;
  abortBackgroundAgents?(): Promise<void>;
}
