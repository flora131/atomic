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
} from "@/lib/ui/format.ts";

// Navigation utilities
export {
  navigateUp,
  navigateDown,
} from "@/lib/ui/navigation.ts";

// Task status normalization utilities (re-exported from canonical location)
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
} from "@/state/parts/helpers/task-status.ts";

// Session info filtering utilities
export { isLikelyFilePath } from "@/lib/ui/session-info-filters.ts";

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
} from "@/lib/ui/tool-preview-truncation.ts";
