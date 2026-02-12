/**
 * UI Types Module
 *
 * Shared TypeScript types for the UI layer.
 * Contains types used across components, hooks, and utilities.
 *
 * Reference: Task #3 - Add PermissionMode, FooterState, enhanced ChatMessage types
 */

// ============================================================================
// PERMISSION MODE
// ============================================================================

/**
 * Re-export PermissionMode from SDK types for convenience.
 */
export type { PermissionMode } from "../sdk/types.ts";

// ============================================================================
// FOOTER STATE
// ============================================================================

/**
 * State for the footer status bar in the chat UI.
 * Displays real-time status information to the user.
 */
export interface FooterState {
  /** Whether verbose mode is enabled (expanded tool outputs) */
  verboseMode: boolean;
  /** Whether a message is currently being streamed */
  isStreaming: boolean;
  /** Number of messages in the queue waiting to be sent */
  queuedCount: number;
  /** Current model ID being used */
  modelId: string;
  /** Current permission mode (auto, prompt, deny, bypass) */
  permissionMode?: import("../sdk/types.ts").PermissionMode;
  /** Agent type being used (claude, opencode, copilot) */
  agentType?: string;
}

/**
 * Props for the FooterStatus component.
 */
export interface FooterStatusProps {
  /** Current footer state */
  state: FooterState;
}

// ============================================================================
// VERBOSE MODE
// ============================================================================

/**
 * Props that accept verbose mode configuration.
 * Used by components that can show expanded content.
 */
export interface VerboseProps {
  /** Whether to show verbose/expanded output */
  isVerbose?: boolean;
}

// ============================================================================
// TIMESTAMP/DURATION FORMATTING
// ============================================================================

/**
 * Props that support timestamp display.
 */
export interface TimestampProps {
  /** ISO timestamp string */
  timestamp?: string;
}

/**
 * Props that support duration display.
 */
export interface DurationProps {
  /** Duration in milliseconds */
  durationMs?: number;
}

/**
 * Props that support model information display.
 */
export interface ModelProps {
  /** Model ID used for generation */
  modelId?: string;
}

// ============================================================================
// ENHANCED MESSAGE TYPES
// ============================================================================

/**
 * Enhanced message metadata for verbose display.
 * Combines timestamp, duration, and model info.
 */
export interface EnhancedMessageMeta
  extends TimestampProps, DurationProps, ModelProps {
  /** Output tokens generated */
  outputTokens?: number;
  /** Thinking/reasoning duration in milliseconds */
  thinkingMs?: number;
}

// ============================================================================
// EXPORTS
// ============================================================================
