/**
 * UI Utilities
 *
 * Exports utility functions for the UI module.
 */

// Format utilities
export {
  formatDuration,
  formatTimestamp,
  truncateText,
  type FormattedDuration,
  type FormattedTimestamp,
} from "./format.ts";

// Navigation utilities
export {
  navigateUp,
  navigateDown,
} from "./navigation.ts";

// Task status normalization utilities
export {
  TASK_STATUS_VALUES,
  isTaskStatus,
  normalizeTaskStatus,
  normalizeTaskItem,
  normalizeTaskItems,
  normalizeTodoItem,
  normalizeTodoItems,
  type TaskStatus,
  type NormalizedTaskItem,
  type NormalizedTodoItem,
} from "./task-status.ts";

// Message window utilities
export {
  computeMessageWindow,
  applyMessageWindow,
  type MessageWindowResult,
  type AppliedMessageWindow,
} from "./message-window.ts";

// Tool preview truncation utilities
export {
  MAIN_CHAT_TOOL_PREVIEW_LIMITS,
  TASK_TOOL_PREVIEW_MAX_LINES,
  truncateToolHeader,
  truncateToolText,
  truncateToolLines,
  getMainChatToolMaxLines,
  type ToolPreviewTruncationLimits,
  type TruncateToolLinesOptions,
  type TruncateToolLinesResult,
} from "./tool-preview-truncation.ts";
