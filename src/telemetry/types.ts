/**
 * Telemetry types for anonymous usage tracking
 *
 * Schema follows the spec in Section 5.1 of the telemetry implementation document.
 */

/**
 * Persistent telemetry state stored in telemetry.json
 */
export interface TelemetryState {
  /** Master toggle for telemetry collection */
  enabled: boolean;
  /** Has user explicitly consented to telemetry? */
  consentGiven: boolean;
  /** Anonymous UUID v4 for session correlation */
  anonymousId: string;
  /** ISO 8601 timestamp when state was first created */
  createdAt: string;
  /** ISO 8601 timestamp of last ID rotation */
  rotatedAt: string;
}

/**
 * Atomic CLI command types that are tracked
 * Reference: Spec Section 5.3.1
 */
export type AtomicCommandType = "init" | "update" | "uninstall" | "run" | "chat";

/**
 * Agent types supported by Atomic
 */
export type AgentType = "claude" | "opencode" | "copilot";

/**
 * Valid telemetry event sources.
 */
export type TelemetryEventSource = "cli" | "session_hook" | "tui";

/**
 * Base event fields shared by all telemetry events.
 */
export interface TelemetryEventBase {
  /** Anonymous UUID v4 for user correlation, rotated monthly */
  anonymousId: string;
  /** Unique UUID v4 for this specific event */
  eventId: string;
  /** ISO 8601 timestamp when event occurred */
  timestamp: string;
  /** Operating system platform */
  platform: NodeJS.Platform;
  /** Atomic CLI version */
  atomicVersion: string;
  /** Source of the event */
  source: TelemetryEventSource;
}

export interface AtomicCommandEvent extends TelemetryEventBase {
  /** Event type discriminator */
  eventType: "atomic_command";
  /** The Atomic CLI command that was executed */
  command: AtomicCommandType;
  /** The agent type selected (null for agent-agnostic commands) */
  agentType: AgentType | null;
  /** Whether the command succeeded */
  success: boolean;
  /** Source of the event (always 'cli' for CLI commands) */
  source: "cli";
}

export interface CliCommandEvent extends TelemetryEventBase {
  /** Event type discriminator */
  eventType: "cli_command";
  /** The agent type being invoked */
  agentType: AgentType;
  /** Array of slash commands found in CLI args */
  commands: string[];
  /** Number of commands (for quick aggregation) */
  commandCount: number;
  /** Source of the event (always 'cli' for CLI commands) */
  source: "cli";
}

export interface AgentSessionEvent extends TelemetryEventBase {
  /** Unique UUID v4 for this specific session (same as eventId for session events) */
  sessionId: string;
  /** Event type discriminator */
  eventType: "agent_session";
  /** The agent type that was running */
  agentType: AgentType;
  /** Array of Atomic slash commands used during the session */
  commands: string[];
  /** Number of commands (for quick aggregation) */
  commandCount: number;
  /** Source of the event (always 'session_hook' for session events) */
  source: "session_hook";
}

/**
 * Trigger source for a TUI command invocation.
 */
export type TuiCommandTrigger = "input" | "autocomplete" | "initial_prompt" | "mention";

/**
 * Command categories used by the TUI command registry.
 * Kept local to telemetry to avoid coupling telemetry to UI modules.
 */
export type TuiCommandCategory = "builtin" | "workflow" | "skill" | "agent" | "custom" | "unknown";

/**
 * Event logged when a TUI chat session starts.
 */
export interface TuiSessionStartEvent extends TelemetryEventBase {
  eventType: "tui_session_start";
  source: "tui";
  sessionId: string;
  agentType: AgentType;
  workflowEnabled: boolean;
  hasInitialPrompt: boolean;
}

/**
 * Event logged when a TUI chat session ends.
 */
export interface TuiSessionEndEvent extends TelemetryEventBase {
  eventType: "tui_session_end";
  source: "tui";
  sessionId: string;
  agentType: AgentType;
  durationMs: number;
  messageCount: number;
  commandCount: number;
  toolCallCount: number;
  interruptCount: number;
}

/**
 * Event logged when a user submits a message through the TUI.
 */
export interface TuiMessageSubmitEvent extends TelemetryEventBase {
  eventType: "tui_message_submit";
  source: "tui";
  sessionId: string;
  agentType: AgentType;
  messageLength: number;
  queued: boolean;
  fromInitialPrompt: boolean;
  hasFileMentions: boolean;
  hasAgentMentions: boolean;
}

/**
 * Event logged when a slash command executes in the TUI.
 */
export interface TuiCommandExecutionEvent extends TelemetryEventBase {
  eventType: "tui_command_execution";
  source: "tui";
  sessionId: string;
  agentType: AgentType;
  commandName: string;
  commandCategory: TuiCommandCategory;
  argsLength: number;
  success: boolean;
  trigger: TuiCommandTrigger;
}

/**
 * Event logged for tool lifecycle events in the TUI.
 */
export interface TuiToolLifecycleEvent extends TelemetryEventBase {
  eventType: "tui_tool_lifecycle";
  source: "tui";
  sessionId: string;
  agentType: AgentType;
  toolName: string;
  phase: "start" | "complete";
  success?: boolean;
}

/**
 * Event logged when a user interrupts a TUI stream.
 */
export interface TuiInterruptEvent extends TelemetryEventBase {
  eventType: "tui_interrupt";
  source: "tui";
  sessionId: string;
  agentType: AgentType;
  sourceType: "ui" | "signal";
}

export type TelemetryEvent =
  | AtomicCommandEvent
  | CliCommandEvent
  | AgentSessionEvent
  | TuiSessionStartEvent
  | TuiSessionEndEvent
  | TuiMessageSubmitEvent
  | TuiCommandExecutionEvent
  | TuiToolLifecycleEvent
  | TuiInterruptEvent;
