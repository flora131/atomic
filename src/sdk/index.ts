/**
 * SDK module for unified coding agent client interface
 *
 * This module exports all types and interfaces needed to interact with
 * various coding agent SDKs through a common abstraction layer.
 *
 * Architecture:
 * - types.ts: Shared interfaces (CodingAgentClient, Session, etc.)
 * - base-client.ts: Common utilities (EventEmitter, createAgentEvent)
 * - init.ts: Agent-specific initialization helpers
 * - clients/: Shared client module exports (Claude, OpenCode, Copilot)
 *
 * Each agent client implements the CodingAgentClient interface (Strategy Pattern)
 * while containing agent-specific logic for SDK integration.
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
export { stripProviderPrefix, formatModelDisplayName } from "./types.ts";

// Base client utilities for shared patterns
export {
  EventEmitter,
  createAgentEvent,
  requireRunning,
  type ClientState,
} from "./base-client.ts";

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
  SkillInvokedEventData,
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

// Shared client exports
export * from "./clients/index.ts";

// Note: Hook modules have been removed.
// Hooks are now passthrough to underlying SDKs:
// - Claude SDK handles .claude/settings.json hooks natively
// - OpenCode SDK handles hooks natively
// - Copilot SDK handles hooks natively
