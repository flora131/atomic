/**
 * QueueIndicator Component
 *
 * Displays a visual indicator showing the number of queued messages.
 * Only renders when there are messages in the queue.
 *
 * Reference: Feature - Create QueueIndicator component to display queued message count
 */

import React from "react";
import { useTerminalDimensions } from "@opentui/react";
import { useTheme } from "../theme.tsx";
import type { QueuedMessage } from "../hooks/use-message-queue.ts";
import { truncateText } from "../utils/format.ts";
import { PROMPT, MISC } from "../constants/icons.ts";

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
  /** Enable editing mode */
  editable?: boolean;
  /** Current edit index, -1 for none */
  editIndex?: number;
  /** Callback when user selects message to edit */
  onEdit?: (index: number) => void;
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
  return MISC.queue;
}

/** @deprecated Use truncateText from utils/format.ts directly */
export const truncateContent = (content: string, maxLength: number = 20): string =>
  truncateText(content, maxLength);

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
  editable = false,
  editIndex = -1,
  onEdit: _onEdit,
}: QueueIndicatorProps): React.ReactNode {
  const { theme } = useTheme();
  const { width: terminalWidth } = useTerminalDimensions();

  // Don't render if queue is empty
  if (count === 0) {
    return null;
  }

  const icon = getQueueIcon();
  const countText = formatQueueCount(count);

  // Calculate max truncation length based on terminal width
  // Account for padding (2 left), prefix "❯ " (2), suffix " (+N more)" (~12), border padding (~4)
  const queueMaxLength = Math.max(20, terminalWidth - 20);

  // Compact mode: shows icon, count, and first queued message preview
  if (compact) {
    // Get first message preview
    const firstMessage = queue && queue.length > 0 ? queue[0] : undefined;
    const preview = firstMessage ? truncateContent(firstMessage.content, queueMaxLength) : "";

    return (
      <box flexDirection="column" gap={0}>
        <box flexDirection="row" gap={1}>
          <box width={1} flexShrink={0}>
            <text style={{ fg: theme.colors.accent }}>{icon}</text>
          </box>
          <text style={{ fg: theme.colors.muted }}>{countText}</text>
        </box>
        {firstMessage && (
          <box paddingLeft={1}>
            <text style={{ fg: theme.colors.foreground }}>
              {PROMPT.cursor} {preview}
            </text>
            {count > 1 && (
              <text style={{ fg: theme.colors.muted }}>
                {" "}(+{count - 1} more)
              </text>
            )}
          </box>
        )}
      </box>
    );
  }

  /**
   * Render a single queued message with editing support.
   *
   * @param msg - The queued message to render
   * @param index - The index of the message in the queue
   * @returns React node for the message
   */
  const renderMessage = (msg: QueuedMessage, index: number): React.ReactNode => {
    const isEditing = editable && editIndex === index;
    const prefix = isEditing ? "› " : `${PROMPT.cursor} `;
    const style = {
      fg: isEditing ? theme.colors.accent : theme.colors.muted,
      attributes: isEditing ? 1 : 0, // bold when editing
    };

    return (
      <text key={msg.id} style={style}>
        {prefix}{truncateContent(msg.content, queueMaxLength)}
      </text>
    );
  };

  // Non-compact mode: show preview of queued messages
  return (
    <box flexDirection="column" gap={0}>
      <box flexDirection="row" gap={1}>
        <box width={1} flexShrink={0}>
          <text style={{ fg: theme.colors.accent }}>{icon}</text>
        </box>
        <text style={{ fg: theme.colors.foreground, attributes: 1 }}>
          {countText}
        </text>
      </box>
      {queue && queue.length > 0 && (
        <box flexDirection="column" paddingLeft={1}>
          {queue.slice(0, 3).map((msg, index) => renderMessage(msg, index))}
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
