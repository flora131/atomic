/**
 * Part ID System
 *
 * Generates monotonically increasing IDs for message parts.
 * Format: part_<12-hex-timestamp>_<4-hex-counter>
 * Lexicographic sort = chronological order.
 *
 * Inspired by OpenCode's Identifier.ascending() pattern.
 */

/** Branded string type for part identifiers. */
export type PartId = string;

let globalPartCounter = 0;

/**
 * Creates a new unique PartId with timestamp-encoded ordering.
 * Lexicographic comparison of PartIds yields chronological order.
 */
export function createPartId(): PartId {
  const timestamp = Date.now();
  const counter = globalPartCounter++;
  return `part_${timestamp.toString(16).padStart(12, "0")}_${counter.toString(16).padStart(4, "0")}`;
}

/**
 * Resets the global counter (for testing only).
 * @internal
 */
export function _resetPartCounter(): void {
  globalPartCounter = 0;
}
