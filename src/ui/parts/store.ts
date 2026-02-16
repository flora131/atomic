/**
 * Part Store Utilities
 *
 * Binary search insertion and update operations for maintaining
 * sorted Part[] arrays. Parts are ordered by their PartId which
 * encodes creation timestamps for automatic chronological ordering.
 *
 * Inspired by OpenCode's sync.tsx binary search pattern.
 */

import type { Part } from "./types.ts";
import type { PartId } from "./id.ts";

/**
 * Binary search for a part by ID in a sorted Part[] array.
 *
 * @returns The index if found (>= 0), or the bitwise complement (~insertionPoint)
 *          if not found (< 0). Use `~result` to get the insertion index.
 */
export function binarySearchById(parts: ReadonlyArray<Part>, targetId: PartId): number {
  let lo = 0;
  let hi = parts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const cmp = parts[mid].id.localeCompare(targetId);
    if (cmp === 0) return mid;
    if (cmp < 0) lo = mid + 1;
    else hi = mid - 1;
  }
  return ~lo;
}

/**
 * Insert or update a part in a sorted Part[] array.
 * If a part with the same ID exists, it is replaced in place.
 * If not, the part is inserted at the correct sorted position.
 *
 * @returns A new array with the part inserted or updated.
 */
export function upsertPart(parts: ReadonlyArray<Part>, newPart: Part): Part[] {
  const idx = binarySearchById(parts, newPart.id);
  if (idx >= 0) {
    const updated = [...parts];
    updated[idx] = newPart;
    return updated;
  }
  const insertIdx = ~idx;
  const updated = [...parts];
  updated.splice(insertIdx, 0, newPart);
  return updated;
}

/**
 * Find the last index of a part matching a predicate.
 * Useful for finding the last TextPart during streaming.
 */
export function findLastPartIndex(parts: ReadonlyArray<Part>, predicate: (part: Part) => boolean): number {
  for (let i = parts.length - 1; i >= 0; i--) {
    if (predicate(parts[i])) return i;
  }
  return -1;
}
