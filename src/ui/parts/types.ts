/**
 * Part Type Definitions
 *
 * Discriminated union types for the parts-based message rendering system.
 * Each ChatMessage contains an ordered Part[] array where each part
 * receives a monotonically increasing timestamp-encoded ID.
 */

import type { PartId } from "./id.ts";

/**
 * Common base for all part types.
 */
export interface BasePart {
  /** Unique identifier, encodes creation timestamp for ordering */
  id: PartId;
  /** Discriminant field for the part union */
  type: string;
  /** ISO 8601 timestamp, for display only (ordering uses id) */
  createdAt: string;
}

// ============================================================================
// TOOL STATE MACHINE
// ============================================================================

/**
 * Discriminated union for tool execution states.
 * No backward transitions allowed:
 *   pending → running → completed | error | interrupted
 */
export type ToolState =
  | { status: "pending" }
  | { status: "running"; startedAt: string }
  | { status: "completed"; output: unknown; durationMs: number }
  | { status: "error"; error: string; output?: unknown }
  | { status: "interrupted"; partialOutput?: unknown };
