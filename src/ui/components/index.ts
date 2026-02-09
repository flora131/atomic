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
  getToolSummary,
  type ToolResultProps,
  type ToolSummary,
} from "./tool-result.tsx";

// ============================================================================
// SKILL LOAD INDICATOR COMPONENT
// ============================================================================

export {
  SkillLoadIndicator,
  type SkillLoadIndicatorProps,
  type SkillLoadStatus,
} from "./skill-load-indicator.tsx";

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

// ============================================================================
// PARALLEL AGENTS TREE COMPONENT
// ============================================================================

export {
  ParallelAgentsTree,
  getAgentColor,
  getStatusIcon,
  formatDuration,
  truncateText,
  getElapsedTime,
  STATUS_ICONS,
  AGENT_COLORS,
  type ParallelAgentsTreeProps,
  type ParallelAgent,
  type AgentStatus,
} from "./parallel-agents-tree.tsx";

// ============================================================================
// MODEL SELECTOR DIALOG COMPONENT
// ============================================================================

export {
  ModelSelectorDialog,
  type ModelSelectorDialogProps,
} from "./model-selector-dialog.tsx";

// ============================================================================
// CONTEXT INFO DISPLAY COMPONENT
// ============================================================================

export {
  ContextInfoDisplay,
  type ContextInfoDisplayProps,
} from "./context-info-display.tsx";
