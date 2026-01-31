/**
 * SDK module for unified coding agent client interface
 *
 * This module exports all types and interfaces needed to interact with
 * various coding agent SDKs through a common abstraction layer.
 */

// Type exports
export type {
  // Permission and configuration types
  PermissionMode,
  McpServerConfig,
  SessionConfig,

  // Message types
  MessageRole,
  MessageContentType,
  MessageMetadata,
  AgentMessage,

  // Context usage
  ContextUsage,

  // Session interface
  Session,

  // Event types
  EventType,
  BaseEventData,
  SessionStartEventData,
  SessionIdleEventData,
  SessionErrorEventData,
  MessageDeltaEventData,
  MessageCompleteEventData,
  ToolStartEventData,
  ToolCompleteEventData,
  SubagentStartEventData,
  SubagentCompleteEventData,
  EventDataMap,
  AgentEvent,
  EventHandler,

  // Tool types
  ToolDefinition,

  // Client interface
  CodingAgentClient,
  CodingAgentClientFactory,
} from "./types.ts";

// Claude Agent Client exports
export {
  ClaudeAgentClient,
  createClaudeAgentClient,
  type ClaudeHookConfig,
} from "./claude-client.ts";
