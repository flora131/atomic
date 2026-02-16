/**
 * Parts Module
 *
 * Parts-based message rendering system. Each ChatMessage contains
 * an ordered Part[] array for chronological content rendering.
 */

export { type PartId, createPartId, _resetPartCounter } from "./id.ts";
export { type BasePart, type ToolState } from "./types.ts";
