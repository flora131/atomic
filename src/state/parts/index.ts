/**
 * Parts Module
 *
 * Parts-based message rendering system. Each ChatMessage contains
 * an ordered Part[] array for chronological content rendering.
 */

export { type PartId, createPartId, _resetPartCounter } from "@/state/parts/id.ts";
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
  type TaskResultPart,
  type WorkflowStepPart,
  type Part,
} from "@/state/parts/types.ts";
export { binarySearchById, upsertPart, findLastPartIndex } from "@/state/parts/store.ts";
export {
  shouldFinalizeOnToolComplete,
  hasActiveForegroundAgents,
  shouldFinalizeDeferredStream,
  hasActiveBackgroundAgentsForSpinner,
} from "@/state/parts/guards.ts";
export { getMessageText } from "@/state/parts/helpers/message-text.ts";
export {
  TASK_STATUS_VALUES,
  isTaskStatus,
  isTodoWriteToolName,
  normalizeTaskStatus,
  normalizeTaskItem,
  normalizeTaskItems,
  normalizeTodoItem,
  normalizeTodoItems,
  mergeBlockedBy,
  reconcileTodoWriteItems,
  type TaskStatus,
  type NormalizedTaskItem,
  type NormalizedTodoItem,
} from "@/state/parts/helpers/task-status.ts";
export { handleTextDelta } from "@/state/parts/handlers.ts";
export {
  type StreamPartEvent,
  applyStreamPartEvent,
  toToolState,
  isSubagentToolName,
  mergeParallelAgentsIntoParts,
  finalizeStreamingReasoningParts,
  finalizeStreamingReasoningInMessage,
  finalizeStreamingTextParts,
} from "@/state/parts/stream-pipeline.ts";
