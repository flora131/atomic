/**
 * Message windowing utilities for the main chat view.
 *
 * Provides helpers for deciding which messages to auto-collapse
 * vs. keep fully expanded.
 */

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
