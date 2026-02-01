/**
 * Components Module Index
 *
 * Re-exports all UI components from the components directory.
 *
 * Reference: Feature 24 - Add components module index with exports
 */

// ============================================================================
// AUTOCOMPLETE COMPONENT
// ============================================================================

export {
  Autocomplete,
  navigateUp,
  navigateDown,
  useAutocompleteKeyboard,
  type AutocompleteProps,
  type KeyboardHandlerResult,
  type UseAutocompleteKeyboardOptions,
} from "./autocomplete.tsx";

// ============================================================================
// USER QUESTION DIALOG COMPONENT
// ============================================================================

export {
  UserQuestionDialog,
  toggleSelection,
  type UserQuestionDialogProps,
  type UserQuestion,
  type QuestionOption,
  type QuestionAnswer,
} from "./user-question-dialog.tsx";

// ============================================================================
// WORKFLOW STATUS BAR COMPONENT
// ============================================================================

export {
  WorkflowStatusBar,
  getWorkflowIcon,
  formatWorkflowType,
  formatIteration,
  formatFeatureProgress,
  type WorkflowStatusBarProps,
  type FeatureProgress,
} from "./workflow-status-bar.tsx";

// ============================================================================
// TOOL RESULT COMPONENT
// ============================================================================

export {
  ToolResult,
  shouldCollapse,
  getErrorColor,
  getToolSummary,
  type ToolResultProps,
  type ToolSummary,
} from "./tool-result.tsx";

// ============================================================================
// QUEUE INDICATOR COMPONENT
// ============================================================================

export {
  QueueIndicator,
  formatQueueCount,
  getQueueIcon,
  truncateContent,
  type QueueIndicatorProps,
} from "./queue-indicator.tsx";

// ============================================================================
// TIMESTAMP DISPLAY COMPONENT
// ============================================================================

export {
  TimestampDisplay,
  formatModelId,
  buildDisplayParts,
  type TimestampDisplayProps,
} from "./timestamp-display.tsx";

