/**
 * Message windowing utilities for the main chat view.
 *
 * Keeps in-memory messages bounded while tracking how many older messages
 * are hidden from the default chat view.
 */

export interface MessageWindowResult<T> {
  visibleMessages: T[];
  hiddenMessageCount: number;
}

export interface AppliedMessageWindow<T> {
  inMemoryMessages: T[];
  evictedMessages: T[];
  evictedCount: number;
}

/**
 * Compute what should be visible in the main chat list and how many earlier
 * messages are hidden.
 */
export function computeMessageWindow<T>(
  messages: T[],
  trimmedMessageCount: number,
  maxVisible: number
): MessageWindowResult<T> {
  const inMemoryOverflow = Math.max(0, messages.length - maxVisible);
  const visibleMessages = inMemoryOverflow > 0 ? messages.slice(-maxVisible) : messages;
  return {
    visibleMessages,
    hiddenMessageCount: trimmedMessageCount + inMemoryOverflow,
  };
}

/**
 * Apply a hard in-memory cap by evicting oldest messages when overflow exists.
 */
export function applyMessageWindow<T>(
  messages: T[],
  maxVisible: number
): AppliedMessageWindow<T> {
  const overflowCount = Math.max(0, messages.length - maxVisible);
  if (overflowCount === 0) {
    return {
      inMemoryMessages: messages,
      evictedMessages: [],
      evictedCount: 0,
    };
  }
  return {
    inMemoryMessages: messages.slice(overflowCount),
    evictedMessages: messages.slice(0, overflowCount),
    evictedCount: overflowCount,
  };
}

/**
 * Determine whether a message at the given index should be auto-collapsed.
 * Messages in the last `expandedCount` positions are kept fully expanded.
 * Messages that are live (streaming or have active background agents) are
 * never collapsed regardless of position.
 */
export function shouldCollapseMessage(
  index: number,
  totalMessages: number,
  expandedCount: number,
  isLive: boolean
): boolean {
  if (isLive) return false;
  return index < totalMessages - expandedCount;
}
