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
export type AtomicCommandType = "init" | "update" | "uninstall" | "run";

/**
 * Agent types supported by Atomic
 */
export type AgentType = "claude" | "opencode" | "copilot";

/**
 * Event logged when an Atomic CLI command is executed.
 * Reference: Spec Section 5.3.1
 */
export interface AtomicCommandEvent {
  /** Anonymous UUID v4 for user correlation, rotated monthly */
  anonymousId: string;
  /** Unique UUID v4 for this specific event */
  eventId: string;
  /** Event type discriminator */
  eventType: "atomic_command";
  /** ISO 8601 timestamp when event occurred */
  timestamp: string;
  /** The Atomic CLI command that was executed */
  command: AtomicCommandType;
  /** The agent type selected (null for agent-agnostic commands) */
  agentType: AgentType | null;
  /** Whether the command succeeded */
  success: boolean;
  /** Operating system platform */
  platform: NodeJS.Platform;
  /** Atomic CLI version */
  atomicVersion: string;
  /** Source of the event (always 'cli' for CLI commands) */
  source: "cli";
}

/**
 * Event logged when CLI args contain slash commands.
 * Reference: Spec Section 5.3.2
 */
export interface CliCommandEvent {
  /** Anonymous UUID v4 for user correlation, rotated monthly */
  anonymousId: string;
  /** Unique UUID v4 for this specific event */
  eventId: string;
  /** Event type discriminator */
  eventType: "cli_command";
  /** ISO 8601 timestamp when event occurred */
  timestamp: string;
  /** The agent type being invoked */
  agentType: AgentType;
  /** Array of slash commands found in CLI args */
  commands: string[];
  /** Number of commands (for quick aggregation) */
  commandCount: number;
  /** Operating system platform */
  platform: NodeJS.Platform;
  /** Atomic CLI version */
  atomicVersion: string;
  /** Source of the event (always 'cli' for CLI commands) */
  source: "cli";
}

/**
 * Event logged when an agent session ends.
 * Tracked via agent-specific hooks (Claude Code Stop hook, Copilot CLI sessionEnd, OpenCode plugin).
 * Reference: Spec Section 5.3.3
 */
export interface AgentSessionEvent {
  /** Anonymous UUID v4 for user correlation, rotated monthly */
  anonymousId: string;
  /** Unique UUID v4 for this specific event */
  eventId: string;
  /** Unique UUID v4 for this specific session (same as eventId for session events) */
  sessionId: string;
  /** Event type discriminator */
  eventType: "agent_session";
  /** ISO 8601 timestamp when session ended */
  timestamp: string;
  /** The agent type that was running */
  agentType: AgentType;
  /** Array of Atomic slash commands used during the session */
  commands: string[];
  /** Number of commands (for quick aggregation) */
  commandCount: number;
  /** Operating system platform */
  platform: NodeJS.Platform;
  /** Atomic CLI version */
  atomicVersion: string;
  /** Source of the event (always 'session_hook' for session events) */
  source: "session_hook";
}

/**
 * Union type for all telemetry events.
 * Extensible to support additional event types.
 */
export type TelemetryEvent = AtomicCommandEvent | CliCommandEvent | AgentSessionEvent;