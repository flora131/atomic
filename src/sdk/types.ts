/**
 * SDK Types for Coding Agent Client Interface
 *
 * This module defines the unified interface for interacting with multiple
 * coding agent SDKs (Claude, OpenCode, Copilot) through a common abstraction.
 */

import type { AgentType } from "../telemetry/types.ts";

/**
 * Permission modes for tool execution approval
 *
 * - "auto": Auto-accept file edits and filesystem operations
 * - "prompt": Default mode, requires user approval for tool execution
 * - "deny": Deny all tool executions
 * - "bypass": Bypass all permission checks (all tools auto-execute)
 *
 * Note: When using "bypass" mode, AskUserQuestion tool is the only exception
 * that still pauses for human input.
 */
export type PermissionMode = "auto" | "prompt" | "deny" | "bypass";

/**
 * Configuration for MCP (Model Context Protocol) servers
 */
export interface McpServerConfig {
  /** Unique identifier for the MCP server */
  name: string;
  /** Transport type: stdio for local processes, http/sse for remote servers */
  type?: "stdio" | "http" | "sse";
  /** Command to launch the MCP server (required for stdio transport) */
  command?: string;
  /** Arguments to pass to the MCP server command */
  args?: string[];
  /** Environment variables for the MCP server process */
  env?: Record<string, string>;
  /** URL for HTTP/SSE transport */
  url?: string;
  /** HTTP headers for authenticated remote servers (SSE/HTTP only) */
  headers?: Record<string, string>;
  /** Working directory for stdio server process */
  cwd?: string;
  /** Connection timeout in milliseconds */
  timeout?: number;
  /** Whether the server is enabled (default: true) */
  enabled?: boolean;
  /** Optional reason shown when the server is disabled */
  disabledReason?: string;
  /** Restrict available tools to this whitelist (default: all tools) */
  tools?: string[];
}

/** Authentication status for an MCP server. */
export type McpAuthStatus = "Unsupported" | "Not logged in" | "Bearer token" | "OAuth";

/** MCP resource metadata from runtime server introspection. */
export interface McpRuntimeResource {
  name: string;
  title?: string;
  uri: string;
}

/** MCP resource template metadata from runtime server introspection. */
export interface McpRuntimeResourceTemplate {
  name: string;
  title?: string;
  uriTemplate: string;
}

/** Runtime MCP details for a specific server. */
export interface McpRuntimeServerSnapshot {
  authStatus?: McpAuthStatus;
  tools?: string[];
  resources?: McpRuntimeResource[];
  resourceTemplates?: McpRuntimeResourceTemplate[];
  httpHeaders?: Record<string, string>;
  envHttpHeaders?: Record<string, string>;
}

/** Runtime MCP details keyed by server name. */
export interface McpRuntimeSnapshot {
  servers: Record<string, McpRuntimeServerSnapshot>;
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
  /** Whether the model supports reasoning effort levels */
  supportsReasoning?: boolean;
  /** Context window size in tokens (if known from model metadata) */
  contextWindow?: number;
}

/**
 * Strips provider prefix from a model ID.
 * Examples:
 *   - "anthropic/claude-sonnet-4" → "claude-sonnet-4"
 *   - "github-copilot/gpt-5.2" → "gpt-5.2"
 *   - "opus" → "opus"
 */
export function stripProviderPrefix(modelId: string): string {
  return modelId.includes("/") ? modelId.split("/").slice(1).join("/") : modelId;
}

/**
 * Formats a model ID for display. Returns the raw model ID as-is,
 * stripping the provider prefix if present.
 */
export function formatModelDisplayName(modelId: string): string {
  if (!modelId) return "";
  return stripProviderPrefix(modelId);
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
  /** Reasoning effort level for models that support it (Copilot SDK) */
  reasoningEffort?: string;
  /** Maximum thinking tokens for the model (Claude Agent SDK). Defaults to 16000. */
  maxThinkingTokens?: number;
  /**
   * Programmatically defined custom sub-agents (Claude SDK format)
   * Key: Agent name, Value: Agent definition
   */
  agents?: Record<string, {
    description: string;
    prompt: string;
    tools?: string[];
    model?: "sonnet" | "opus" | "haiku" | "inherit";
  }>;
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
   * @param options - Optional dispatch options. The `agent` field is used by
   *   the OpenCode client to dispatch to a named sub-agent via AgentPartInput.
   *   Other clients ignore it.
   * @returns AsyncIterable yielding partial response chunks
   */
  stream(message: string, options?: { agent?: string }): AsyncIterable<AgentMessage>;

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
   * Returns the token count for system prompt + tools (pre-message baseline).
   * Throws if called before the baseline has been captured (before first query completes).
   */
  getSystemToolsTokens(): number;

  /**
   * Optional runtime MCP server snapshot.
   * Implementations may omit this and callers should gracefully fall back.
   */
  getMcpSnapshot?(): Promise<McpRuntimeSnapshot | null>;

  /**
   * Destroy the session and release resources.
   * Should be called when the session is no longer needed.
   */
  destroy(): Promise<void>;

  /**
   * Abort any ongoing work in the session.
   * Optional - only supported by some SDKs (e.g., Copilot).
   * When supported, this cancels in-flight agent work including sub-agent invocations.
   * @returns Promise resolving when the abort request is acknowledged
   */
  abort?(): Promise<void>;

  /**
   * Abort only background agents while preserving foreground work.
   * Used for Ctrl+F background agent termination.
   * Implementations should selectively terminate background agent
   * sessions/queries without affecting the main foreground session.
   * Falls back to full session abort when granular control is unavailable.
   * @returns Promise resolving when all background agents are aborted
   */
  abortBackgroundAgents?(): Promise<void>;
}

/**
 * Event types emitted by coding agent sessions.
 * Reference: Feature list step 5
 */
export type EventType =
  | "session.start"
  | "session.idle"
  | "session.error"
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
  /** Provider-native thinking source identity (for reasoning/thinking deltas) */
  thinkingSourceKey?: string;
  /** Parent tool call ID when this delta belongs to a sub-agent */
  parentToolCallId?: string;
  /** Runtime message ID for per-message correlation */
  messageId?: string;
}

/**
 * Event data for message.complete events
 */
export interface MessageCompleteEventData extends BaseEventData {
  /** Complete message */
  message: AgentMessage;
  /** Tool requests made by the model in this message (Copilot SDK) */
  toolRequests?: Array<{
    toolCallId: string;
    name: string;
    arguments: unknown;
  }>;
  /** Parent tool call ID when this message is from a sub-agent */
  parentToolCallId?: string;
}

/**
 * Event data for tool.start events
 */
export interface ToolStartEventData extends BaseEventData {
  /** Name of the tool being invoked */
  toolName: string;
  /** Input arguments for the tool */
  toolInput?: unknown;
  /** SDK-native tool use ID (camelCase variant) */
  toolUseId?: string;
  /** SDK-native tool use ID (Claude hook variant) */
  toolUseID?: string;
  /** SDK-native tool call ID (Copilot variant) */
  toolCallId?: string;
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
  /** SDK-native tool use ID (camelCase variant) */
  toolUseId?: string;
  /** SDK-native tool use ID (Claude hook variant) */
  toolUseID?: string;
  /** SDK-native tool call ID (Copilot variant) */
  toolCallId?: string;
}

/**
 * Event data for skill.invoked events
 */
export interface SkillInvokedEventData extends BaseEventData {
  /** Name of the skill that was invoked */
  skillName: string;
  /** File path of the skill */
  skillPath?: string;
}

/**
 * Event data for reasoning.delta events (streaming thinking content)
 */
export interface ReasoningDeltaEventData extends BaseEventData {
  /** Partial reasoning content */
  delta: string;
  /** Reasoning block identifier */
  reasoningId: string;
}

/**
 * Event data for reasoning.complete events
 */
export interface ReasoningCompleteEventData extends BaseEventData {
  /** Reasoning block identifier */
  reasoningId: string;
  /** Complete reasoning content */
  content: string;
}

/**
 * Event data for turn.start events
 */
export interface TurnStartEventData extends BaseEventData {
  /** Unique turn identifier */
  turnId: string;
}

/**
 * Event data for turn.end events
 */
export interface TurnEndEventData extends BaseEventData {
  /** Unique turn identifier */
  turnId: string;
}

/**
 * Event data for tool.partial_result events (streaming tool output)
 */
export interface ToolPartialResultEventData extends BaseEventData {
  /** Tool call ID this output belongs to */
  toolCallId: string;
  /** Incremental output text */
  partialOutput: string;
}

/**
 * Event data for session.info events
 */
export interface SessionInfoEventData extends BaseEventData {
  /** Information category */
  infoType: string;
  /** Human-readable message */
  message: string;
}

/**
 * Event data for session.warning events
 */
export interface SessionWarningEventData extends BaseEventData {
  /** Warning category */
  warningType: string;
  /** Human-readable message */
  message: string;
}

/**
 * Event data for session.title_changed events
 */
export interface SessionTitleChangedEventData extends BaseEventData {
  /** New session title */
  title: string;
}

/**
 * Event data for session.truncation events
 */
export interface SessionTruncationEventData extends BaseEventData {
  /** Maximum token budget */
  tokenLimit: number;
  /** Tokens removed during truncation */
  tokensRemoved: number;
  /** Messages removed during truncation */
  messagesRemoved: number;
}

/**
 * Event data for session.compaction events
 */
export interface SessionCompactionEventData extends BaseEventData {
  /** Whether this is a start or complete event */
  phase: "start" | "complete";
  /** Whether compaction succeeded (only for complete phase) */
  success?: boolean;
  /** Error message on failure (only for complete phase) */
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
  /** SDK-native tool use ID (camelCase variant) */
  toolUseId?: string;
  /** SDK-native tool use ID (Claude hook variant) */
  toolUseID?: string;
  /** SDK-native tool call ID (Copilot variant) */
  toolCallId?: string;
}

/**
 * Event data for subagent.update events (progress notification)
 */
export interface SubagentUpdateEventData extends BaseEventData {
  /** Subagent identifier */
  subagentId: string;
  /** Current tool being used by the sub-agent */
  currentTool?: string;
  /** Number of tool uses so far */
  toolUses?: number;
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
 * Option for a permission request
 */
export interface PermissionOption {
  /** Display label for the option */
  label: string;
  /** Value to return when selected */
  value: string;
  /** Optional description */
  description?: string;
}

/**
 * Event data for permission.requested events (HITL)
 */
export interface PermissionRequestedEventData extends BaseEventData {
  /** Unique request identifier */
  requestId: string;
  /** Tool requesting permission */
  toolName: string;
  /** Tool input that requires permission */
  toolInput?: unknown;
  /** Question/prompt for the user */
  question: string;
  /** Header/label for the question dialog (e.g., "Color", "Auth method") */
  header?: string;
  /** Available options to choose from */
  options: PermissionOption[];
  /** Whether multiple options can be selected */
  multiSelect?: boolean;
  /** Callback to provide the answer */
  respond?: (answer: string | string[]) => void;
  /** SDK-native tool use ID for correlating with ToolPart (optional) */
  toolCallId?: string;
}

/**
 * Option for human_input_required events from askUserNode
 */
export interface HumanInputOption {
  /** Display label for the option */
  label: string;
  /** Optional description */
  description?: string;
}

/**
 * Event data for human_input_required events from workflow graph askUserNode.
 * Emitted when a workflow graph requires human input to continue execution.
 */
export interface HumanInputRequiredEventData extends BaseEventData {
  /** Unique request identifier for correlating responses */
  requestId: string;
  /** Question/prompt for the user */
  question: string;
  /** Header/label for the question dialog */
  header?: string;
  /** Available options to choose from */
  options?: HumanInputOption[];
  /** Node ID that emitted the signal */
  nodeId: string;
  /** Callback to provide the answer and resume workflow */
  respond?: (answer: string | string[]) => void;
}

/**
 * Map of event types to their corresponding data types
 */
export interface EventDataMap {
  "session.start": SessionStartEventData;
  "session.idle": SessionIdleEventData;
  "session.error": SessionErrorEventData;
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
 * Context passed to tool execute functions.
 * Modeled after OpenCode's ToolContext (packages/plugin/src/tool.ts).
 */
export interface ToolContext {
  /** Active session ID */
  sessionID: string;
  /** Current message ID within the session */
  messageID: string;
  /** Agent type executing the tool (e.g., "claude", "copilot", "opencode") */
  agent: string;
  /** Current working directory — prefer over process.cwd() for resolving relative paths */
  directory: string;
  /** Abort signal for cancellation — tools should check this for long-running operations */
  abort: AbortSignal;
}

/** Serializable result returned by a tool handler */
export type ToolHandlerResult = string | Record<string, unknown>;

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
  handler: (
    input: Record<string, unknown>,
    context: ToolContext
  ) => ToolHandlerResult | Promise<ToolHandlerResult>;
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

  /**
   * Update the model for the currently active session, when the SDK supports it.
   * Implementations should preserve existing conversation history.
   */
  setActiveSessionModel?(
    model: string,
    options?: { reasoningEffort?: string }
  ): Promise<void>;

  /**
   * Get the system tools token baseline at the client level (pre-session).
   * Available after start() for SDKs that support probing (e.g., Claude SDK
   * probe query, Copilot SDK session.usage_info event).
   * Returns null if the baseline is not yet available.
   */
  getSystemToolsTokens(): number | null;

  /** Known agent/sub-agent tool names (Copilot uses agent names as tool names) */
  getKnownAgentNames?(): string[];
}

/**
 * Factory function type for creating coding agent clients
 */
export type CodingAgentClientFactory = (
  agentType: AgentType,
  options?: Record<string, unknown>
) => CodingAgentClient;
