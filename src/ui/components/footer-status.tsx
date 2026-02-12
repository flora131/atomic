/**
 * FooterStatus Component
 *
 * Displays a status bar at the bottom of the chat UI showing:
 * - Verbose mode toggle state
 * - Streaming status
 * - Queued message count
 * - Current model
 * - Permission mode
 *
 * Reference: Task #4 - Create FooterStatus component
 */

import React from "react";
import { useTheme } from "../theme.tsx";
import type { FooterState, FooterStatusProps } from "../types.ts";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Internal props for the FooterStatus component.
 * Accepts either a state object or individual props.
 */
export interface FooterStatusComponentProps {
  /** Footer state object (alternative to individual props) */
  state?: FooterState;
  /** Whether verbose mode is enabled */
  verboseMode?: boolean;
  /** Whether streaming is active */
  isStreaming?: boolean;
  /** Number of queued messages */
  queuedCount?: number;
  /** Current model ID */
  modelId?: string;
  /** Permission mode */
  permissionMode?: "auto" | "prompt" | "deny" | "bypass";
  /** Agent type */
  agentType?: string;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Format verbose mode for display.
 */
function formatVerboseMode(isVerbose: boolean): string {
  return isVerbose ? "verbose" : "compact";
}

/**
 * Format queued count for display.
 */
function formatQueuedCount(count: number): string {
  if (count === 0) return "";
  return ` · ${count} queued`;
}

/**
 * Format permission mode for display.
 */
function formatPermissionMode(
  mode: "auto" | "prompt" | "deny" | "bypass" | undefined,
): string {
  if (!mode || mode === "bypass") return "";
  return ` · ${mode}`;
}

// ============================================================================
// FOOTER STATUS COMPONENT
// ============================================================================

/**
 * Status bar component for the chat UI footer.
 *
 * Displays real-time status information including:
 * - Model ID
 * - Streaming indicator
 * - Verbose mode toggle state
 * - Queued message count
 * - Permission mode
 *
 * @example
 * ```tsx
 * <FooterStatus
 *   state={{
 *     verboseMode: false,
 *     isStreaming: true,
 *     queuedCount: 2,
 *     modelId: "claude-sonnet-4",
 *   }}
 * />
 * ```
 */
export function FooterStatus({
  state,
  verboseMode = false,
  isStreaming = false,
  queuedCount = 0,
  modelId = "",
  permissionMode,
  agentType,
}: FooterStatusComponentProps): React.ReactNode {
  const { theme } = useTheme();
  const colors = theme.colors;

  // Use state object if provided, otherwise use individual props
  const actualVerboseMode = state?.verboseMode ?? verboseMode;
  const actualIsStreaming = state?.isStreaming ?? isStreaming;
  const actualQueuedCount = state?.queuedCount ?? queuedCount;
  const actualModelId = state?.modelId ?? modelId;
  const actualPermissionMode = state?.permissionMode ?? permissionMode;
  const actualAgentType = state?.agentType ?? agentType;

  // Build status parts
  const parts: string[] = [];

  // Model ID (always shown)
  if (actualModelId) {
    parts.push(actualModelId);
  }

  // Streaming indicator
  if (actualIsStreaming) {
    parts.push("streaming");
  }

  // Verbose mode indicator with toggle hint
  parts.push(formatVerboseMode(actualVerboseMode));

  // Queue count
  const queueText = formatQueuedCount(actualQueuedCount);
  if (queueText) {
    parts.push(`${actualQueuedCount} queued`);
  }

  // Permission mode
  const permText = formatPermissionMode(actualPermissionMode);
  if (permText) {
    parts.push(actualPermissionMode!);
  }

  // Agent type
  if (actualAgentType) {
    parts.push(actualAgentType);
  }

  // Join with separator
  const statusText = parts.join(" · ");

  // Add Ctrl+O hint for verbose mode
  const verboseHint = actualVerboseMode ? " (ctrl+o to collapse)" : " (ctrl+o to expand)";

  return (
    <box
      flexDirection="row"
      paddingLeft={1}
      paddingRight={1}
      paddingTop={0}
      paddingBottom={0}
      flexShrink={0}
    >
      <text style={{ fg: colors.muted }}>
        {statusText}
        <span style={{ fg: colors.dim }}>{verboseHint}</span>
      </text>
    </box>
  );
}

// ============================================================================
// EXPORTS
// ============================================================================

export default FooterStatus;
