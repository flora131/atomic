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
  OpenCodeAgentMode,
  ModelDisplayInfo,
} from "./types.ts";

// Utility function exports
export { formatModelDisplayName } from "./types.ts";

// Type exports (continued)
export type {

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
  PermissionOption,
  PermissionRequestedEventData,
  HumanInputOption,
  HumanInputRequiredEventData,
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

// OpenCode Client exports
export {
  OpenCodeClient,
  createOpenCodeClient,
  type OpenCodeClientOptions,
  type OpenCodeHealthStatus,
} from "./opencode-client.ts";

// Copilot Client exports
export {
  CopilotClient,
  createCopilotClient,
  createAutoApprovePermissionHandler,
  createDenyAllPermissionHandler,
  type CopilotSdkEventType,
  type CopilotSdkEvent,
  type CopilotSdkPermissionRequest,
  type CopilotPermissionHandler,
  type CopilotConnectionMode,
  type CopilotClientOptions,
} from "./copilot-client.ts";

// Note: Hook modules have been removed.
// Hooks are now passthrough to underlying SDKs:
// - Claude SDK handles .claude/settings.json hooks natively
// - OpenCode SDK handles hooks natively
// - Copilot SDK handles hooks natively
