/**
 * Hooks Module Index
 *
 * Re-exports all hooks and their types for the UI module.
 *
 * Reference: Feature 14 - Create hooks module index with exports
 */

// ============================================================================
// USE STREAMING STATE
// ============================================================================

export {
  // Hook
  useStreamingState,
  default as useStreamingStateDefault,

  // Types
  type StreamingState,
  type ToolExecutionState,
  type ToolExecutionStatus,
  type ToolExecutionTimestamps,
  type UseStreamingStateReturn,

  // Utility functions
  createInitialStreamingState,
  generateToolExecutionId,
  getCurrentTimestamp,
  createToolExecution,
  getActiveToolExecutions,
  getCompletedToolExecutions,
  getErroredToolExecutions,
} from "./use-streaming-state.ts";

// ============================================================================
// USE MESSAGE QUEUE
// ============================================================================

export {
  // Hook
  useMessageQueue,
  default as useMessageQueueDefault,

  // Types
  type QueuedMessage,
  type UseMessageQueueReturn,
} from "./use-message-queue.ts";

// ============================================================================
// USE VERBOSE MODE
// ============================================================================

export {
  // Hook
  useVerboseMode,
  default as useVerboseModeDefault,

  // Types
  type UseVerboseModeReturn,
} from "./use-verbose-mode.ts";
