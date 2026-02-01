/**
 * FooterStatus Component
 *
 * Displays a status line at the bottom of the chat interface.
 * Shows permission mode, queued message count, and keyboard shortcut hints.
 *
 * Reference: Feature - Create FooterStatus component for status line
 */

import React from "react";
import { useTheme } from "../theme.tsx";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Props for the FooterStatus component.
 */
export interface FooterStatusProps {
  /** Whether verbose mode is enabled */
  verboseMode?: boolean;
  /** Whether a response is currently streaming */
  isStreaming?: boolean;
  /** Number of messages in the queue */
  queuedCount?: number;
  /** Current model ID */
  modelId?: string;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get the permission mode indicator text.
 *
 * @returns Permission mode indicator string
 */
export function getPermissionModeIndicator(): string {
  return "Auto-approve";
}

/**
 * Format the queued count for display.
 *
 * @param count - Number of queued messages
 * @returns Formatted queue count string, or empty if count is 0
 */
export function formatQueuedCount(count: number): string {
  if (count === 0) return "";
  if (count === 1) return "1 queued";
  return `${count} queued`;
}

/**
 * Get keyboard shortcut hints.
 *
 * @returns Array of shortcut hint strings
 */
export function getShortcutHints(): string[] {
  return [
    "Ctrl+O: verbose",
    "Ctrl+C: copy",
    "Ctrl+V: paste",
  ];
}

/**
 * Build the status line parts.
 *
 * @param props - FooterStatus props
 * @returns Array of status parts to display
 */
export function buildStatusParts(props: FooterStatusProps): string[] {
  const parts: string[] = [];

  // Permission mode
  parts.push(getPermissionModeIndicator());

  // Model ID if provided
  if (props.modelId) {
    parts.push(props.modelId);
  }

  // Streaming indicator
  if (props.isStreaming) {
    parts.push("streaming...");
  }

  // Queued count
  if (props.queuedCount && props.queuedCount > 0) {
    parts.push(formatQueuedCount(props.queuedCount));
  }

  // Verbose mode indicator
  if (props.verboseMode) {
    parts.push("verbose");
  }

  return parts;
}

// ============================================================================
// FOOTER STATUS COMPONENT
// ============================================================================

/**
 * Status line component for the bottom of the chat interface.
 *
 * Displays permission mode, queue count, streaming status, and shortcuts.
 *
 * @example
 * ```tsx
 * <FooterStatus
 *   verboseMode={verboseMode}
 *   isStreaming={isStreaming}
 *   queuedCount={messageQueue.count}
 *   modelId="claude-3-opus"
 * />
 * ```
 */
export function FooterStatus({
  verboseMode = false,
  isStreaming = false,
  queuedCount = 0,
  modelId,
}: FooterStatusProps): React.ReactNode {
  const { theme } = useTheme();

  const statusParts = buildStatusParts({ verboseMode, isStreaming, queuedCount, modelId });
  const shortcuts = getShortcutHints();

  return (
    <box
      flexDirection="row"
      justifyContent="space-between"
      paddingLeft={1}
      paddingRight={1}
    >
      {/* Left side: status indicators */}
      <text style={{ fg: theme.colors.muted }}>
        {statusParts.join(" │ ")}
      </text>

      {/* Right side: keyboard shortcuts */}
      <text style={{ fg: theme.colors.muted }}>
        {shortcuts.join("  ")}
      </text>
    </box>
  );
}

// ============================================================================
// EXPORTS
// ============================================================================

export default FooterStatus;
