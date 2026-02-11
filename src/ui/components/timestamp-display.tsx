/**
 * TimestampDisplay Component
 *
 * Displays a right-aligned timestamp with optional duration and model information.
 * Used for showing message timing in verbose mode.
 *
 * Reference: Feature - Create TimestampDisplay component for right-aligned timestamp and model
 */

import React from "react";
import { useTheme } from "../theme.tsx";
import { formatDuration, formatTimestamp } from "../utils/format.ts";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Props for the TimestampDisplay component.
 */
export interface TimestampDisplayProps {
  /** ISO timestamp of when the message was created */
  timestamp: string;
  /** Duration in milliseconds (optional) */
  durationMs?: number;
  /** Model ID used for this message (optional) */
  modelId?: string;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Format the model ID for display.
 * Shortens long model names for compact display.
 *
 * @param modelId - Full model ID string
 * @returns Shortened model name
 */
export function formatModelId(modelId: string): string {
  // Common model name patterns to shorten
  if (modelId.includes("claude")) {
    // Extract claude version (e.g., "claude-3-opus" → "claude-3-opus")
    return modelId;
  }
  if (modelId.includes("gpt")) {
    return modelId;
  }
  // For other models, truncate if too long
  if (modelId.length > 25) {
    return `${modelId.slice(0, 22)}...`;
  }
  return modelId;
}

/**
 * Build the display parts for the timestamp line.
 *
 * @param timestamp - ISO timestamp string
 * @param durationMs - Optional duration in milliseconds
 * @param modelId - Optional model ID
 * @returns Array of display parts to join with separator
 */
export function buildDisplayParts(
  timestamp: string,
  durationMs?: number,
  modelId?: string
): string[] {
  const parts: string[] = [];

  // Always add formatted timestamp
  const formattedTime = formatTimestamp(timestamp);
  parts.push(formattedTime.text);

  // Add duration if provided
  if (durationMs !== undefined) {
    const formattedDuration = formatDuration(durationMs);
    parts.push(formattedDuration.text);
  }

  // Add model if provided
  if (modelId) {
    parts.push(formatModelId(modelId));
  }

  return parts;
}

// ============================================================================
// TIMESTAMP DISPLAY COMPONENT
// ============================================================================

/**
 * Displays timestamp, duration, and model information in a right-aligned format.
 *
 * Used in verbose mode to show timing information for messages.
 *
 * @example
 * ```tsx
 * // Basic usage with just timestamp
 * <TimestampDisplay timestamp="2026-01-31T14:30:00.000Z" />
 *
 * // With duration
 * <TimestampDisplay
 *   timestamp="2026-01-31T14:30:00.000Z"
 *   durationMs={2500}
 * />
 *
 * // With all info
 * <TimestampDisplay
 *   timestamp="2026-01-31T14:30:00.000Z"
 *   durationMs={2500}
 *   modelId="claude-3-opus"
 * />
 * ```
 */
export function TimestampDisplay({
  timestamp,
  durationMs,
  modelId,
}: TimestampDisplayProps): React.ReactNode {
  const { theme } = useTheme();

  const parts = buildDisplayParts(timestamp, durationMs, modelId);
  const displayText = parts.join(" • ");

  return (
    <box flexDirection="row" justifyContent="flex-end">
      <text style={{ fg: theme.colors.muted }}>
        {displayText}
      </text>
    </box>
  );
}

// ============================================================================
// EXPORTS
// ============================================================================

export default TimestampDisplay;
