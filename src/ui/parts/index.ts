/**
 * Parts Module
 *
 * Parts-based message rendering system. Each ChatMessage contains
 * an ordered Part[] array for chronological content rendering.
 */

export { type PartId, createPartId, _resetPartCounter } from "./id.ts";
export {
  type BasePart,
  type ToolState,
  type TextPart,
  type ReasoningPart,
  type ToolPart,
  type AgentPart,
  type TaskListPart,
  type SkillLoadPart,
  type McpSnapshotPart,
  type CompactionPart,
  type Part,
} from "./types.ts";
export { binarySearchById, upsertPart, findLastPartIndex } from "./store.ts";
export {
  shouldFinalizeOnToolComplete,
  hasActiveForegroundAgents,
  shouldFinalizeDeferredStream,
} from "./guards.ts";
export { getMessageText } from "./helpers.ts";
export { handleTextDelta } from "./handlers.ts";
export {
  type StreamPartEvent,
  applyStreamPartEvent,
  toToolState,
  shouldGroupSubagentTrees,
  mergeParallelAgentsIntoParts,
  syncToolCallsIntoParts,
  finalizeStreamingReasoningParts,
  finalizeStreamingReasoningInMessage,
} from "./stream-pipeline.ts";
