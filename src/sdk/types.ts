/**
 * SDK Types for Coding Agent Client Interface
 *
 * This module defines the unified interface for interacting with multiple
 * coding agent SDKs (Claude, OpenCode, Copilot) through a common abstraction.
 */

import type { AgentType } from "../utils/telemetry/types.ts";

/**
 * Permission modes for tool execution approval
 */
export type PermissionMode = "auto" | "prompt" | "deny";

/**
 * Configuration for MCP (Model Context Protocol) servers
 */
export interface McpServerConfig {
  /** Unique identifier for the MCP server */
  name: string;
  /** Command to launch the MCP server */
  command: string;
  /** Arguments to pass to the MCP server command */
  args?: string[];
  /** Environment variables for the MCP server process */
  env?: Record<string, string>;
}

/**
 * OpenCode agent modes for different use cases
 * - build: Default mode with full tool access for development
 * - plan: Restricted mode that denies file edits by default
 * - general: Subagent for complex multi-step tasks
 * - explore: Fast read-only codebase exploration
 */
export type OpenCodeAgentMode = "build" | "plan" | "general" | "explore";

/**
 * Model display information for UI rendering.
 * Contains the model name and provider/tier for display purposes.
 */
export interface ModelDisplayInfo {
  /** Model name/ID for display (e.g., "Opus 4.5", "Sonnet 4.5", "GPT-4") */
  model: string;
  /** Provider or tier name for display (e.g., "Claude Code", "GitHub Copilot") */
  tier: string;
}

/**
 * Formats a model ID into a human-readable display name.
 * Examples:
 *   - "claude-opus-4-5-20251101" → "Opus 4.5"
 *   - "claude-sonnet-4-5-20250929" → "Sonnet 4.5"
 *   - "claude-3-opus" → "Opus"
 *   - "gpt-4" → "GPT-4"
 */
export function formatModelDisplayName(modelId: string): string {
  if (!modelId) return "Claude";

  const lower = modelId.toLowerCase();

  // Handle Claude model formats
  if (lower.includes("claude")) {
    // Extract model family (opus, sonnet, haiku)
    let family = "";
    if (lower.includes("opus")) family = "Opus";
    else if (lower.includes("sonnet")) family = "Sonnet";
    else if (lower.includes("haiku")) family = "Haiku";

    if (!family) return "Claude";

    // Extract version number (e.g., "4-5" or "4.5" or just "4")
    // Match patterns like "opus-4-5", "opus-4.5", "sonnet-4-5-20250929"
    const versionMatch = lower.match(
      /(?:opus|sonnet|haiku)[- ]?(\d+)(?:[.-](\d+))?/
    );

    if (versionMatch) {
      const major = versionMatch[1];
      const minor = versionMatch[2];
      if (minor) {
        return `${family} ${major}.${minor}`;
      }
      return `${family} ${major}`;
    }

    return family;
  }

  // Handle GPT models
  if (lower.includes("gpt")) {
    return modelId.toUpperCase().replace(/-/g, "-");
  }

  // For other models, return capitalized
  return modelId
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Configuration for creating a new agent session.
 * Reference: Feature list step 2
 */
export interface SessionConfig {
  /** Model identifier to use for the session */
  model?: string;
  /** Optional session ID for tracking/resumption */
  sessionId?: string;
  /** System prompt to configure agent behavior */
  systemPrompt?: string;
  /** Tools available to the agent during the session */
  tools?: string[];
  /** MCP servers to connect for extended capabilities */
  mcpServers?: McpServerConfig[];
  /** Permission mode for tool execution */
  permissionMode?: PermissionMode;
  /** Maximum budget in USD for the session (if supported) */
  maxBudgetUsd?: number;
  /** Maximum number of turns/interactions in the session */
  maxTurns?: number;
  /** OpenCode agent mode (only for OpenCode client) */
  agentMode?: OpenCodeAgentMode;
}

/**
 * Message role in a conversation
 */
export type MessageRole = "user" | "assistant" | "system" | "tool";

/**
 * Content types for agent messages
 */
export type MessageContentType = "text" | "tool_use" | "tool_result" | "thinking";

/**
 * Metadata associated with an agent message
 */
export interface MessageMetadata {
  /** Token usage for this message */
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
  };
  /** Model used to generate this message */
  model?: string;
  /** Tool name if this is a tool-related message */
  toolName?: string;
  /** Tool input if this is a tool use message */
  toolInput?: unknown;
  /** Stop reason if this is a completion */
  stopReason?: string;
  /** Additional arbitrary metadata */
  [key: string]: unknown;
}

/**
 * A message in the agent conversation.
 * Reference: Feature list step 4
 */
export interface AgentMessage {
  /** Type discriminator for the message content */
  type: MessageContentType;
  /** The message content (text or structured data) */
  content: string | unknown;
  /** Role of the message sender */
  role?: MessageRole;
  /** Associated metadata */
  metadata?: MessageMetadata;
}

/**
 * Context usage information for monitoring token consumption
 */
export interface ContextUsage {
  /** Current input tokens used */
  inputTokens: number;
  /** Current output tokens used */
  outputTokens: number;
  /** Maximum allowed tokens (context window size) */
  maxTokens: number;
  /** Percentage of context window used (0-100) */
  usagePercentage: number;
}

/**
 * Interface for an active agent session.
 * Reference: Feature list step 3
 */
export interface Session {
  /** Unique identifier for this session */
  readonly id: string;

  /**
   * Send a message to the agent and wait for the complete response.
   * @param message - The message to send
   * @returns Promise resolving to the agent's response message
   */
  send(message: string): Promise<AgentMessage>;

  /**
   * Send a message and stream the response incrementally.
   * @param message - The message to send
   * @returns AsyncIterable yielding partial response chunks
   */
  stream(message: string): AsyncIterable<AgentMessage>;

  /**
   * Summarize the current conversation to reduce context usage.
   * Useful for long-running sessions approaching context limits.
   * @returns Promise resolving when summarization is complete
   */
  summarize(): Promise<void>;

  /**
   * Get current context window usage statistics.
   * @returns Promise resolving to context usage information
   */
  getContextUsage(): Promise<ContextUsage>;

  /**
   * Destroy the session and release resources.
   * Should be called when the session is no longer needed.
   */
  destroy(): Promise<void>;
}

/**
 * Event types emitted by coding agent sessions.
 * Reference: Feature list step 5
 */
export type EventType =
  | "session.start"
  | "session.idle"
  | "session.error"
  | "message.delta"
  | "message.complete"
  | "tool.start"
  | "tool.complete"
  | "subagent.start"
  | "subagent.complete";

/**
 * Base event data shared by all events
 */
export interface BaseEventData {
  /** Additional event-specific information */
  [key: string]: unknown;
}

/**
 * Event data for session.start events
 */
export interface SessionStartEventData extends BaseEventData {
  /** Session configuration used */
  config?: SessionConfig;
}

/**
 * Event data for session.idle events
 */
export interface SessionIdleEventData extends BaseEventData {
  /** Reason for idle state */
  reason?: string;
}

/**
 * Event data for session.error events
 */
export interface SessionErrorEventData extends BaseEventData {
  /** Error that occurred */
  error: Error | string;
  /** Error code if available */
  code?: string;
}

/**
 * Event data for message.delta events (streaming)
 */
export interface MessageDeltaEventData extends BaseEventData {
  /** Partial message content */
  delta: string;
  /** Content type of the delta */
  contentType?: MessageContentType;
}

/**
 * Event data for message.complete events
 */
export interface MessageCompleteEventData extends BaseEventData {
  /** Complete message */
  message: AgentMessage;
}

/**
 * Event data for tool.start events
 */
export interface ToolStartEventData extends BaseEventData {
  /** Name of the tool being invoked */
  toolName: string;
  /** Input arguments for the tool */
  toolInput?: unknown;
}

/**
 * Event data for tool.complete events
 */
export interface ToolCompleteEventData extends BaseEventData {
  /** Name of the tool that completed */
  toolName: string;
  /** Result from the tool execution */
  toolResult?: unknown;
  /** Whether the tool execution was successful */
  success: boolean;
  /** Error message if tool failed */
  error?: string;
}

/**
 * Event data for subagent.start events
 */
export interface SubagentStartEventData extends BaseEventData {
  /** Subagent identifier */
  subagentId: string;
  /** Type of subagent */
  subagentType?: string;
  /** Task assigned to the subagent */
  task?: string;
}

/**
 * Event data for subagent.complete events
 */
export interface SubagentCompleteEventData extends BaseEventData {
  /** Subagent identifier */
  subagentId: string;
  /** Result from the subagent */
  result?: unknown;
  /** Whether the subagent task was successful */
  success: boolean;
}

/**
 * Map of event types to their corresponding data types
 */
export interface EventDataMap {
  "session.start": SessionStartEventData;
  "session.idle": SessionIdleEventData;
  "session.error": SessionErrorEventData;
  "message.delta": MessageDeltaEventData;
  "message.complete": MessageCompleteEventData;
  "tool.start": ToolStartEventData;
  "tool.complete": ToolCompleteEventData;
  "subagent.start": SubagentStartEventData;
  "subagent.complete": SubagentCompleteEventData;
}

/**
 * Event emitted by coding agent sessions.
 * Reference: Feature list step 6
 */
export interface AgentEvent<T extends EventType = EventType> {
  /** Type of the event */
  type: T;
  /** Session ID that emitted this event */
  sessionId: string;
  /** ISO 8601 timestamp when the event occurred */
  timestamp: string;
  /** Event-specific data */
  data: T extends keyof EventDataMap ? EventDataMap[T] : BaseEventData;
}

/**
 * Event handler callback type
 */
export type EventHandler<T extends EventType = EventType> = (
  event: AgentEvent<T>
) => void | Promise<void>;

/**
 * Tool definition for registering custom tools
 */
export interface ToolDefinition {
  /** Unique name for the tool */
  name: string;
  /** Human-readable description of what the tool does */
  description: string;
  /** JSON Schema for the tool's input parameters */
  inputSchema: Record<string, unknown>;
  /**
   * Handler function to execute the tool
   * @param input - Validated input matching the input schema
   * @returns Tool execution result
   */
  handler: (input: unknown) => unknown | Promise<unknown>;
}

/**
 * Unified interface for coding agent clients.
 * Reference: Feature list step 7
 *
 * This interface abstracts the differences between various coding agent SDKs
 * (Claude, OpenCode, Copilot) to provide a consistent API for session management,
 * event handling, and tool registration.
 */
export interface CodingAgentClient {
  /** The type of agent this client connects to */
  readonly agentType: AgentType;

  /**
   * Create a new agent session.
   * @param config - Configuration for the session
   * @returns Promise resolving to an active Session
   */
  createSession(config?: SessionConfig): Promise<Session>;

  /**
   * Resume an existing session by ID.
   * @param sessionId - ID of the session to resume
   * @returns Promise resolving to the resumed Session, or null if not found
   */
  resumeSession(sessionId: string): Promise<Session | null>;

  /**
   * Register an event handler for a specific event type.
   * @param eventType - The type of event to listen for
   * @param handler - Callback function to handle the event
   * @returns Function to unregister the handler
   */
  on<T extends EventType>(eventType: T, handler: EventHandler<T>): () => void;

  /**
   * Register a custom tool that can be invoked by the agent.
   * @param tool - Tool definition including name, schema, and handler
   */
  registerTool(tool: ToolDefinition): void;

  /**
   * Start the client and begin processing events.
   * Should be called after registering event handlers.
   */
  start(): Promise<void>;

  /**
   * Stop the client and clean up resources.
   * Should be called when the client is no longer needed.
   */
  stop(): Promise<void>;

  /**
   * Get model display information for UI rendering.
   * Returns the current model name and provider/tier for display.
   * Should be called after start() to get accurate information.
   * @param modelHint - Optional model ID to use for display (e.g., from CLI options)
   */
  getModelDisplayInfo(modelHint?: string): Promise<ModelDisplayInfo>;
}

/**
 * Factory function type for creating coding agent clients
 */
export type CodingAgentClientFactory = (
  agentType: AgentType,
  options?: Record<string, unknown>
) => CodingAgentClient;
