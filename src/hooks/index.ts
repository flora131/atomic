/**
 * Hooks Module Index
 *
 * Re-exports all hooks and their types for the UI module.
 *
 * Reference: Feature 14 - Create hooks module index with exports
 */

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
} from "@/hooks/use-message-queue.ts";

// ============================================================================
// USE VERBOSE MODE
// ============================================================================

export {
  // Hook
  useVerboseMode,
  default as useVerboseModeDefault,

  // Types
  type UseVerboseModeReturn,
} from "@/hooks/use-verbose-mode.ts";

// ============================================================================
// USE STABLE CALLBACK / VALUE
// ============================================================================

export {
  // Hooks
  useStableCallback,
  useStableValue,
  default as useStableCallbackDefault,
} from "@/hooks/use-stable-callback.ts";
