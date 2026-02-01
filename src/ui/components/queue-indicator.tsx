/**
 * QueueIndicator Component
 *
 * Displays a visual indicator showing the number of queued messages.
 * Only renders when there are messages in the queue.
 *
 * Reference: Feature - Create QueueIndicator component to display queued message count
 */

import React from "react";
import { useTheme } from "../theme.tsx";
import type { QueuedMessage } from "../hooks/use-message-queue.ts";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Props for the QueueIndicator component.
 */
export interface QueueIndicatorProps {
  /** Number of messages in the queue */
  count: number;
  /** Array of queued messages (optional, for detailed display) */
  queue?: QueuedMessage[];
  /** Whether to show compact display (default: true) */
  compact?: boolean;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Format the queue count for display.
 *
 * @param count - Number of messages in queue
 * @returns Formatted string for display
 */
export function formatQueueCount(count: number): string {
  if (count === 0) return "";
  if (count === 1) return "1 message queued";
  return `${count} messages queued`;
}

/**
 * Get the icon for the queue indicator.
 *
 * @returns Queue icon character
 */
export function getQueueIcon(): string {
  return "📋";
}

/**
 * Truncate message content for preview.
 *
 * @param content - Message content to truncate
 * @param maxLength - Maximum length before truncation (default: 20)
 * @returns Truncated content with ellipsis if needed
 */
export function truncateContent(content: string, maxLength: number = 20): string {
  if (content.length <= maxLength) return content;
  return `${content.slice(0, maxLength - 3)}...`;
}

// ============================================================================
// QUEUE INDICATOR COMPONENT
// ============================================================================

/**
 * Visual indicator showing the number of queued messages.
 *
 * Displays a badge-style indicator when messages are queued for processing.
 * Only renders when count > 0 to avoid visual clutter.
 *
 * @example
 * ```tsx
 * // Basic usage with count
 * <QueueIndicator count={3} />
 *
 * // With queue for detailed preview
 * <QueueIndicator count={messageQueue.count} queue={messageQueue.queue} />
 *
 * // Non-compact mode for detailed view
 * <QueueIndicator count={2} queue={queue} compact={false} />
 * ```
 */
export function QueueIndicator({
  count,
  queue,
  compact = true,
}: QueueIndicatorProps): React.ReactNode {
  const { theme } = useTheme();

  // Don't render if queue is empty
  if (count === 0) {
    return null;
  }

  const icon = getQueueIcon();
  const countText = formatQueueCount(count);

  // Compact mode: single line with icon and count
  if (compact) {
    return (
      <box flexDirection="row" gap={1}>
        <text style={{ fg: theme.colors.accent }}>{icon}</text>
        <text style={{ fg: theme.colors.muted }}>{countText}</text>
      </box>
    );
  }

  // Non-compact mode: show preview of queued messages
  return (
    <box flexDirection="column" gap={0}>
      <box flexDirection="row" gap={1}>
        <text style={{ fg: theme.colors.accent }}>{icon}</text>
        <text style={{ fg: theme.colors.foreground, bold: true }}>
          {countText}
        </text>
      </box>
      {queue && queue.length > 0 && (
        <box flexDirection="column" paddingLeft={2}>
          {queue.slice(0, 3).map((msg, index) => (
            <text
              key={msg.id}
              style={{ fg: theme.colors.muted }}
            >
              {index + 1}. {truncateContent(msg.content)}
            </text>
          ))}
          {queue.length > 3 && (
            <text style={{ fg: theme.colors.muted }}>
              ...and {queue.length - 3} more
            </text>
          )}
        </box>
      )}
    </box>
  );
}

// ============================================================================
// EXPORTS
// ============================================================================

export default QueueIndicator;
