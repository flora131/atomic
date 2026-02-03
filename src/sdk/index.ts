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

// HookManager exports
export {
  HookManager,
  createHookManager,
  type UnifiedHookEvent,
  type HookContext,
  type HookHandler,
  type HookResult,
  type HookEventData,
  type HookEventDataMap,
  type BaseHookEventData,
  type SessionStartEventData as HookSessionStartEventData,
  type SessionEndEventData as HookSessionEndEventData,
  type SessionErrorEventData as HookSessionErrorEventData,
  type ToolBeforeEventData,
  type ToolAfterEventData,
  type ToolErrorEventData,
  type MessageBeforeEventData,
  type MessageAfterEventData,
  type PermissionRequestEventData,
  type SubagentStartEventData as HookSubagentStartEventData,
  type SubagentEndEventData,
} from "./hooks.ts";

// Claude Hook Handlers exports
export {
  createSessionEndTelemetryHook,
  createDefaultClaudeHooks,
  createSessionStartHook,
  createPreToolUseHook,
  createPostToolUseHook,
} from "./claude-hooks.ts";

// Copilot Hook Handlers exports
export {
  createSessionStartHandler as createCopilotSessionStartHandler,
  createSessionEndHandler as createCopilotSessionEndHandler,
  createUserPromptHandler as createCopilotUserPromptHandler,
  registerDefaultCopilotHooks,
  createDefaultCopilotHooks,
  type CopilotHookHandlers,
} from "./copilot-hooks.ts";

// OpenCode Hook Handlers exports
export {
  createSessionStartHandler as createOpenCodeSessionStartHandler,
  createSessionIdleHandler as createOpenCodeSessionIdleHandler,
  createSessionDeletedHandler as createOpenCodeSessionDeletedHandler,
  createCommandExecuteHandler as createOpenCodeCommandExecuteHandler,
  createChatMessageHandler as createOpenCodeChatMessageHandler,
  registerDefaultOpenCodeHooks,
  createDefaultOpenCodeHooks,
  parseRalphState,
  writeRalphState,
  deleteRalphState,
  checkFeaturesPassing,
  checkCompletionPromise,
  normalizeCommandName,
  extractCommandsFromText,
  type OpenCodeHookHandlers,
  type OpenCodeHookContext,
} from "./opencode-hooks.ts";
