/**
 * Part ID System
 *
 * Generates monotonically increasing IDs for message parts.
 * Format: part_<12-hex-composite>
 * Composite = timestamp * 0x1000 + counter (48-bit encoding).
 * Counter resets each millisecond, supporting up to 4096 IDs/ms.
 * Lexicographic sort = chronological order.
 *
 * Mirrors OpenCode's Identifier.ascending() pattern
 * (see research/docs/2026-03-18-opencode-streaming-order-architecture.md §1).
 */

/** Branded string type for part identifiers. */
export type PartId = string;

let lastPartTimestamp = 0;
let partCounter = 0;

/**
 * Creates a new unique PartId with timestamp-encoded ordering.
 * Encodes `timestamp * 0x1000 + counter` into a single composite value,
 * giving 12 bits (4,096 IDs) per millisecond with automatic counter reset.
 * Lexicographic comparison of PartIds yields chronological order.
 */
export function createPartId(): PartId {
  const timestamp = Date.now();
  if (timestamp !== lastPartTimestamp) {
    lastPartTimestamp = timestamp;
    partCounter = 0;
  }
  const counter = partCounter++;
  const composite = BigInt(timestamp) * BigInt(0x1000) + BigInt(counter);
  return `part_${composite.toString(16).padStart(12, "0")}` as PartId;
}

/**
 * Resets the internal state (for testing only).
 * @internal
 */
export function _resetPartCounter(): void {
  lastPartTimestamp = 0;
  partCounter = 0;
}
