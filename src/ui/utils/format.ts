/**
 * Format Utilities
 *
 * Utility functions for formatting duration and timestamp display.
 * Used for showing message timing information in the UI.
 *
 * Reference: Feature - Create format utilities for duration and timestamp display
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Duration format result with value and unit.
 */
export interface FormattedDuration {
  /** Formatted string (e.g., "500ms", "2.5s", "1m 30s") */
  text: string;
  /** Original milliseconds value */
  ms: number;
}

/**
 * Timestamp format result.
 */
export interface FormattedTimestamp {
  /** Formatted time string (e.g., "2:30 PM") */
  text: string;
  /** Original Date object */
  date: Date;
}

// ============================================================================
// DURATION FORMATTING
// ============================================================================

/**
 * Format a duration in milliseconds to a human-readable string.
 *
 * - Under 1000ms: Shows milliseconds (e.g., "500ms")
 * - Under 60000ms (1 minute): Shows seconds (e.g., "2.5s")
 * - 60000ms and above: Shows minutes and seconds (e.g., "1m 30s")
 *
 * @param ms - Duration in milliseconds
 * @returns Formatted duration object with text and original ms value
 *
 * @example
 * ```ts
 * formatDuration(500)    // { text: "500ms", ms: 500 }
 * formatDuration(2500)   // { text: "2.5s", ms: 2500 }
 * formatDuration(90000)  // { text: "1m 30s", ms: 90000 }
 * ```
 */
export function formatDuration(ms: number): FormattedDuration {
  // Handle negative values by treating as 0
  if (ms < 0) {
    return { text: "0ms", ms: 0 };
  }

  // Under 1 second: show milliseconds
  if (ms < 1000) {
    return { text: `${Math.round(ms)}ms`, ms };
  }

  // Under 1 minute: show whole seconds
  if (ms < 60000) {
    const seconds = Math.floor(ms / 1000);
    return { text: `${seconds}s`, ms };
  }

  // 1 minute and above: show minutes and seconds
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (seconds === 0) {
    return { text: `${minutes}m`, ms };
  }

  return { text: `${minutes}m ${seconds}s`, ms };
}

// ============================================================================
// TIMESTAMP FORMATTING
// ============================================================================

/**
 * Format a Date to a human-readable time string in HH:MM AM/PM format.
 *
 * Uses 12-hour format with AM/PM indicator.
 *
 * @param date - Date object or ISO timestamp string
 * @returns Formatted timestamp object with text and Date
 *
 * @example
 * ```ts
 * formatTimestamp(new Date("2026-01-31T14:30:00"))  // { text: "2:30 PM", ... }
 * formatTimestamp(new Date("2026-01-31T09:05:00"))  // { text: "9:05 AM", ... }
 * formatTimestamp("2026-01-31T00:00:00")            // { text: "12:00 AM", ... }
 * ```
 */
export function formatTimestamp(date: Date | string): FormattedTimestamp {
  const dateObj = typeof date === "string" ? new Date(date) : date;

  // Handle invalid dates
  if (isNaN(dateObj.getTime())) {
    return { text: "--:-- --", date: new Date() };
  }

  const hours = dateObj.getHours();
  const minutes = dateObj.getMinutes();

  // Convert to 12-hour format
  const hour12 = hours % 12 || 12;
  const ampm = hours < 12 ? "AM" : "PM";

  // Pad minutes with leading zero
  const minutesStr = minutes.toString().padStart(2, "0");

  return {
    text: `${hour12}:${minutesStr} ${ampm}`,
    date: dateObj,
  };
}

// ============================================================================
// MARKDOWN NEWLINE NORMALIZATION
// ============================================================================

/**
 * Normalize inline newlines for terminal markdown rendering.
 *
 * The marked parser preserves literal `\n` inside paragraph text tokens,
 * and OpenTUI's TextRenderable renders them as hard line breaks. In HTML
 * these would be collapsed to spaces (standard markdown behaviour for
 * soft line breaks).  This function replicates that collapsing while
 * preserving double-newline paragraph breaks and code-fence contents.
 *
 * @param content - Raw markdown string (may be streaming / partial)
 * @returns Content with single newlines collapsed to spaces
 */
export function normalizeMarkdownNewlines(content: string): string {
  // 1. Protect fenced code blocks (including unclosed fences during streaming)
  const fences: string[] = [];
  let text = content.replace(/```[^\n]*\n[\s\S]*?(?:```|$)/g, (m) => {
    fences.push(m);
    return `\x00F${fences.length - 1}\x00`;
  });

  // 2. Collapse single newlines to spaces; keep \n\n+ intact
  text = text.replace(/(?<!\n)\n(?!\n)/g, " ");

  // 3. Restore fenced code blocks
  text = text.replace(/\x00F(\d+)\x00/g, (_, i) => fences[parseInt(i)] ?? "");
  return text;
}

// ============================================================================
// TEXT TRUNCATION
// ============================================================================

/**
 * Truncate text to a maximum length with an ellipsis suffix.
 *
 * @param text - Text to truncate
 * @param maxLength - Maximum length including ellipsis (default: 40)
 * @returns Truncated text with "…" if it exceeded maxLength
 *
 * @example
 * ```ts
 * truncateText("Hello World", 8)   // "Hello W…"
 * truncateText("Short", 10)        // "Short"
 * ```
 */
export function truncateText(text: string, maxLength: number = 40): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  formatDuration,
  formatTimestamp,
  truncateText,
};
