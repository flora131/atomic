/**
 * useStreamingState Hook for Real-time Updates
 *
 * Manages streaming state for chat interactions, including message
 * streaming, tool executions, and pending questions.
 *
 * Reference: Feature 13 - Create useStreamingState hook for real-time updates
 */

import { useState, useCallback } from "react";
import type { UserQuestion } from "../components/user-question-dialog.tsx";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Status of a tool execution.
 */
export type ToolExecutionStatus = "pending" | "running" | "completed" | "error" | "interrupted";

/**
 * Timestamps for tool execution tracking.
 */
export interface ToolExecutionTimestamps {
  /** When the tool execution started */
  startedAt: string;
  /** When the tool execution completed (if completed) */
  completedAt?: string;
}

/**
 * State for a single tool execution.
 */
export interface ToolExecutionState {
  /** Unique identifier for this tool execution */
  id: string;
  /** Name of the tool being executed */
  toolName: string;
  /** Current execution status */
  status: ToolExecutionStatus;
  /** Input parameters passed to the tool */
  input: Record<string, unknown>;
  /** Output from the tool (if completed) */
  output?: unknown;
  /** Error message (if status is 'error') */
  error?: string;
  /** Execution timestamps */
  timestamps: ToolExecutionTimestamps;
}

/**
 * Overall streaming state for the chat interface.
 */
export interface StreamingState {
  /** Whether a message is currently being streamed */
  isStreaming: boolean;
  /** ID of the message currently being streamed */
  streamingMessageId: string | null;
  /** Map of active tool executions by ID */
  toolExecutions: Map<string, ToolExecutionState>;
  /** Queue of pending questions waiting for user input */
  pendingQuestions: UserQuestion[];
}

/**
 * Return type for the useStreamingState hook.
 */
export interface UseStreamingStateReturn {
  /** Current streaming state */
  state: StreamingState;
  /** Start streaming a new message */
  startStreaming: (messageId: string) => void;
  /** Stop streaming the current message */
  stopStreaming: () => void;
  /** Handle a chunk of streamed content (returns the chunk for processing) */
  handleChunk: (chunk: string) => string;
  /** Handle tool execution start */
  handleToolStart: (id: string, toolName: string, input: Record<string, unknown>) => void;
  /** Handle tool execution completion */
  handleToolComplete: (id: string, output: unknown) => void;
  /** Handle tool execution error */
  handleToolError: (id: string, error: string) => void;
  /** Handle tool execution interruption */
  handleToolInterrupt: (id: string) => void;
  /** Add a pending question */
  addPendingQuestion: (question: UserQuestion) => void;
  /** Remove a pending question (after it's answered) */
  removePendingQuestion: () => UserQuestion | undefined;
  /** Clear all tool executions */
  clearToolExecutions: () => void;
  /** Reset all state to initial values */
  reset: () => void;
}

// ============================================================================
// INITIAL STATE
// ============================================================================

/**
 * Create initial streaming state.
 */
export function createInitialStreamingState(): StreamingState {
  return {
    isStreaming: false,
    streamingMessageId: null,
    toolExecutions: new Map(),
    pendingQuestions: [],
  };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Generate a unique tool execution ID.
 */
export function generateToolExecutionId(): string {
  return `tool_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Get current ISO timestamp.
 */
export function getCurrentTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Create a new tool execution state.
 */
export function createToolExecution(
  id: string,
  toolName: string,
  input: Record<string, unknown>
): ToolExecutionState {
  return {
    id,
    toolName,
    status: "running",
    input,
    timestamps: {
      startedAt: getCurrentTimestamp(),
    },
  };
}

/**
 * Get all active (running) tool executions.
 */
export function getActiveToolExecutions(
  executions: Map<string, ToolExecutionState>
): ToolExecutionState[] {
  return Array.from(executions.values()).filter(
    (exec) => exec.status === "running"
  );
}

/**
 * Get all completed tool executions.
 */
export function getCompletedToolExecutions(
  executions: Map<string, ToolExecutionState>
): ToolExecutionState[] {
  return Array.from(executions.values()).filter(
    (exec) => exec.status === "completed"
  );
}

/**
 * Get all errored tool executions.
 */
export function getErroredToolExecutions(
  executions: Map<string, ToolExecutionState>
): ToolExecutionState[] {
  return Array.from(executions.values()).filter(
    (exec) => exec.status === "error"
  );
}

// ============================================================================
// HOOK IMPLEMENTATION
// ============================================================================

/**
 * Hook for managing streaming state in the chat interface.
 *
 * Tracks message streaming, tool executions, and pending questions.
 * Provides callbacks for handling real-time updates from the AI.
 *
 * @returns Streaming state and handler callbacks
 *
 * @example
 * ```tsx
 * const {
 *   state,
 *   startStreaming,
 *   stopStreaming,
 *   handleChunk,
 *   handleToolStart,
 *   handleToolComplete,
 *   handleToolError,
 * } = useStreamingState();
 *
 * // Start streaming a message
 * startStreaming("msg_123");
 *
 * // Handle chunks as they arrive
 * const chunk = handleChunk("Hello");
 * appendToMessage(chunk);
 *
 * // Handle tool execution
 * handleToolStart("tool_1", "Read", { file: "test.ts" });
 * // ... tool executes ...
 * handleToolComplete("tool_1", { content: "file contents" });
 *
 * // Stop streaming when done
 * stopStreaming();
 * ```
 */
export function useStreamingState(): UseStreamingStateReturn {
  const [state, setState] = useState<StreamingState>(createInitialStreamingState);

  /**
   * Start streaming a new message.
   */
  const startStreaming = useCallback((messageId: string) => {
    setState((prev) => ({
      ...prev,
      isStreaming: true,
      streamingMessageId: messageId,
    }));
  }, []);

  /**
   * Stop streaming the current message.
   */
  const stopStreaming = useCallback(() => {
    setState((prev) => ({
      ...prev,
      isStreaming: false,
      streamingMessageId: null,
    }));
  }, []);

  /**
   * Handle a chunk of streamed content.
   * Returns the chunk for the caller to process (e.g., append to message).
   */
  const handleChunk = useCallback((chunk: string): string => {
    // No state update needed - just pass through the chunk
    // The caller is responsible for updating message content
    return chunk;
  }, []);

  /**
   * Handle tool execution start.
   */
  const handleToolStart = useCallback(
    (id: string, toolName: string, input: Record<string, unknown>) => {
      setState((prev) => {
        const newExecutions = new Map(prev.toolExecutions);
        newExecutions.set(id, createToolExecution(id, toolName, input));
        return {
          ...prev,
          toolExecutions: newExecutions,
        };
      });
    },
    []
  );

  /**
   * Handle tool execution completion.
   */
  const handleToolComplete = useCallback((id: string, output: unknown) => {
    setState((prev) => {
      const newExecutions = new Map(prev.toolExecutions);
      const existing = newExecutions.get(id);

      if (existing) {
        newExecutions.set(id, {
          ...existing,
          status: "completed",
          output,
          timestamps: {
            ...existing.timestamps,
            completedAt: getCurrentTimestamp(),
          },
        });
      }

      return {
        ...prev,
        toolExecutions: newExecutions,
      };
    });
  }, []);

  /**
   * Handle tool execution error.
   */
  const handleToolError = useCallback((id: string, error: string) => {
    setState((prev) => {
      const newExecutions = new Map(prev.toolExecutions);
      const existing = newExecutions.get(id);

      if (existing) {
        newExecutions.set(id, {
          ...existing,
          status: "error",
          error,
          timestamps: {
            ...existing.timestamps,
            completedAt: getCurrentTimestamp(),
          },
        });
      }

      return {
        ...prev,
        toolExecutions: newExecutions,
      };
    });
  }, []);

  /**
   * Handle tool execution interruption.
   */
  const handleToolInterrupt = useCallback((id: string) => {
    setState((prev) => {
      const newExecutions = new Map(prev.toolExecutions);
      const existing = newExecutions.get(id);

      if (existing) {
        newExecutions.set(id, {
          ...existing,
          status: "interrupted",
          timestamps: {
            ...existing.timestamps,
            completedAt: getCurrentTimestamp(),
          },
        });
      }

      return {
        ...prev,
        toolExecutions: newExecutions,
      };
    });
  }, []);

  /**
   * Add a pending question to the queue.
   */
  const addPendingQuestion = useCallback((question: UserQuestion) => {
    setState((prev) => ({
      ...prev,
      pendingQuestions: [...prev.pendingQuestions, question],
    }));
  }, []);

  /**
   * Remove and return the first pending question from the queue.
   */
  const removePendingQuestion = useCallback((): UserQuestion | undefined => {
    let removed: UserQuestion | undefined;

    setState((prev) => {
      if (prev.pendingQuestions.length === 0) {
        return prev;
      }

      [removed] = prev.pendingQuestions;
      return {
        ...prev,
        pendingQuestions: prev.pendingQuestions.slice(1),
      };
    });

    return removed;
  }, []);

  /**
   * Clear all tool executions.
   */
  const clearToolExecutions = useCallback(() => {
    setState((prev) => ({
      ...prev,
      toolExecutions: new Map(),
    }));
  }, []);

  /**
   * Reset all state to initial values.
   */
  const reset = useCallback(() => {
    setState(createInitialStreamingState());
  }, []);

  return {
    state,
    startStreaming,
    stopStreaming,
    handleChunk,
    handleToolStart,
    handleToolComplete,
    handleToolError,
    handleToolInterrupt,
    addPendingQuestion,
    removePendingQuestion,
    clearToolExecutions,
    reset,
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export default useStreamingState;
