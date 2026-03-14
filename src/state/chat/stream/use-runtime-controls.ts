import { useCallback } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { ChatMessage, StreamingMeta } from "@/state/chat/shared/types/index.ts";
import {
  createMessage,
  mergeClosedThinkingSources,
  traceThinkingSourceLifecycle,
} from "@/state/chat/shared/helpers/index.ts";
import type { AutoCompactionIndicatorState } from "@/state/chat/shared/helpers/auto-compaction-lifecycle.ts";
import {
  clearRunningAutoCompactionIndicator,
} from "@/state/chat/shared/helpers/auto-compaction-lifecycle.ts";
import {
  createStoppedStreamControlState,
  type SessionLoopFinishReason,
} from "@/state/chat/shared/helpers/stream-continuation.ts";
import type { NormalizedTodoItem } from "@/state/parts/helpers/task-status.ts";
import { hasWorkflowTaskIdOverlap } from "@/state/chat/shared/helpers/workflow-task-state.ts";

interface UseChatRuntimeControlsArgs {
  activeForegroundRunHandleIdRef: MutableRefObject<string | null>;
  appendCompactionSummaryAndSync: (summary: string) => void;
  autoCompactionIndicatorRef: MutableRefObject<AutoCompactionIndicatorState>;
  closedThinkingSourcesRef: MutableRefObject<Set<string>>;
  deferredCompleteTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  hasRunningToolRef: MutableRefObject<boolean>;
  isAgentOnlyStreamRef: MutableRefObject<boolean>;
  isStreamingRef: MutableRefObject<boolean>;
  lastTurnFinishReasonRef: MutableRefObject<SessionLoopFinishReason | null>;
  nextRunIdFloorRef: MutableRefObject<number | null>;
  pendingCompleteRef: MutableRefObject<(() => void) | null>;
  resetLoadedSkillTracking: (options?: { resetSessionBinding?: boolean }) => void;
  runningAskQuestionToolIdsRef: MutableRefObject<Set<string>>;
  runningBlockingToolIdsRef: MutableRefObject<Set<string>>;
  setCompactionSummary: Dispatch<SetStateAction<string | null>>;
  setIsAutoCompacting: Dispatch<SetStateAction<boolean>>;
  setIsStreaming: Dispatch<SetStateAction<boolean>>;
  setMessagesWindowed: (next: SetStateAction<ChatMessage[]>) => void;
  setShowCompactionHistory: Dispatch<SetStateAction<boolean>>;
  setStreamingMessageId: (messageId: string | null) => void;
  setStreamingMeta: Dispatch<SetStateAction<StreamingMeta | null>>;
  setTodoItems: Dispatch<SetStateAction<NormalizedTodoItem[]>>;
  streamingMessageIdRef: MutableRefObject<string | null>;
  streamingMetaRef: MutableRefObject<StreamingMeta | null>;
  streamingStartRef: MutableRefObject<number | null>;
  todoItemsRef: MutableRefObject<NormalizedTodoItem[]>;
  workflowSessionIdRef: MutableRefObject<string | null>;
  workflowTaskIdsRef: MutableRefObject<Set<string>>;
}

export function useChatRuntimeControls({
  activeForegroundRunHandleIdRef,
  appendCompactionSummaryAndSync,
  autoCompactionIndicatorRef,
  closedThinkingSourcesRef,
  deferredCompleteTimeoutRef,
  hasRunningToolRef,
  isAgentOnlyStreamRef,
  isStreamingRef,
  lastTurnFinishReasonRef,
  nextRunIdFloorRef,
  pendingCompleteRef,
  resetLoadedSkillTracking,
  runningAskQuestionToolIdsRef,
  runningBlockingToolIdsRef,
  setCompactionSummary,
  setIsAutoCompacting,
  setIsStreaming,
  setMessagesWindowed,
  setShowCompactionHistory,
  setStreamingMessageId,
  setStreamingMeta,
  setTodoItems,
  streamingMessageIdRef,
  streamingMetaRef,
  streamingStartRef,
  todoItemsRef,
  workflowSessionIdRef,
  workflowTaskIdsRef,
}: UseChatRuntimeControlsArgs) {
  const asSessionLoopFinishReason = useCallback((value: unknown): SessionLoopFinishReason | null => {
    if (typeof value !== "string") {
      return null;
    }
    const token = value.trim();
    if (
      token === "tool-calls"
      || token === "stop"
      || token === "max-tokens"
      || token === "max-turns"
      || token === "error"
      || token === "unknown"
    ) {
      return token;
    }
    return null;
  }, []);

  const hasPendingTaskResultContract = useCallback((): boolean => {
    return todoItemsRef.current.some((task) => {
      const isTerminalStatus = task.status === "completed" || task.status === "error";
      if (!isTerminalStatus || task.taskResult) {
        return false;
      }

      const canonicalId = task.identity?.canonicalId;
      const hasProviderBindings = Boolean(
        task.identity?.providerBindings
        && Object.keys(task.identity.providerBindings).length > 0,
      );

      return Boolean(canonicalId) || hasProviderBindings;
    });
  }, [todoItemsRef]);

  const clearDeferredCompletion = useCallback(() => {
    pendingCompleteRef.current = null;
    if (deferredCompleteTimeoutRef.current) {
      clearTimeout(deferredCompleteTimeoutRef.current);
      deferredCompleteTimeoutRef.current = null;
    }
  }, [deferredCompleteTimeoutRef, pendingCompleteRef]);

  const resetThinkingSourceTracking = useCallback(() => {
    closedThinkingSourcesRef.current = new Set();
    streamingMetaRef.current = null;
    setStreamingMeta(null);
  }, [closedThinkingSourcesRef, setStreamingMeta, streamingMetaRef]);

  const finalizeThinkingSourceTracking = useCallback((options?: {
    preserveStreamingMeta?: boolean;
  }) => {
    const previousMeta = streamingMetaRef.current;
    const previousClosedSources = closedThinkingSourcesRef.current;
    const mergedClosedSources = mergeClosedThinkingSources(
      previousClosedSources,
      previousMeta,
    );
    for (const sourceKey of mergedClosedSources) {
      if (!previousClosedSources.has(sourceKey)) {
        traceThinkingSourceLifecycle("finalize", sourceKey, "chat stream teardown");
      }
    }
    closedThinkingSourcesRef.current = mergedClosedSources;

    if (options?.preserveStreamingMeta && previousMeta) {
      const preservedMeta: StreamingMeta = {
        outputTokens: previousMeta.outputTokens,
        thinkingMs: previousMeta.thinkingMs,
        thinkingText: "",
      };
      const hasPreservedCounters = preservedMeta.outputTokens > 0 || preservedMeta.thinkingMs > 0;
      streamingMetaRef.current = hasPreservedCounters ? preservedMeta : null;
      setStreamingMeta(hasPreservedCounters ? preservedMeta : null);
      return;
    }

    streamingMetaRef.current = null;
    setStreamingMeta(null);
  }, [closedThinkingSourcesRef, setStreamingMeta, streamingMetaRef]);

  const isWorkflowTaskUpdate = useCallback((
    todos: NormalizedTodoItem[],
    previousTodos: readonly NormalizedTodoItem[] = todoItemsRef.current,
  ): boolean => {
    return hasWorkflowTaskIdOverlap(todos, workflowTaskIdsRef.current, previousTodos);
  }, [todoItemsRef, workflowTaskIdsRef]);

  const resetTodoItemsForNewStream = useCallback(() => {
    if (workflowSessionIdRef.current) return;
    todoItemsRef.current = [];
    setTodoItems([]);
  }, [setTodoItems, todoItemsRef, workflowSessionIdRef]);

  const applyAutoCompactionIndicator = useCallback((next: AutoCompactionIndicatorState) => {
    autoCompactionIndicatorRef.current = next;

    if (next.status === "running") {
      setIsAutoCompacting(true);
      const messageId = streamingMessageIdRef.current;
      if (messageId) {
        setMessagesWindowed((prev) =>
          prev.map((msg) =>
            msg.id === messageId ? { ...msg, spinnerVerb: "Compacting" } : msg
          ),
        );
      }
    } else if (next.status === "completed") {
      setIsAutoCompacting(false);
      resetLoadedSkillTracking();
      const newMessage = createMessage("assistant", "", true);
      setStreamingMessageId(newMessage.id);
      setMessagesWindowed(() => {
        const summaryText = `[Auto-compaction completed at ${new Date().toISOString()}] Context was automatically compacted to reduce token usage.`;
        appendCompactionSummaryAndSync(summaryText);
        setCompactionSummary(summaryText);
        setShowCompactionHistory(false);
        return [newMessage];
      });
    } else if (next.status === "error") {
      setIsAutoCompacting(false);
      const messageId = streamingMessageIdRef.current;
      if (messageId) {
        setMessagesWindowed((prev) =>
          prev.map((msg) =>
            msg.id === messageId && msg.spinnerVerb === "Compacting"
              ? { ...msg, spinnerVerb: undefined }
              : msg,
          ),
        );
      }
    } else {
      setIsAutoCompacting(false);
    }
  }, [
    appendCompactionSummaryAndSync,
    autoCompactionIndicatorRef,
    resetLoadedSkillTracking,
    setCompactionSummary,
    setIsAutoCompacting,
    setMessagesWindowed,
    setShowCompactionHistory,
    setStreamingMessageId,
    streamingMessageIdRef,
  ]);

  const stopSharedStreamState = useCallback((options?: {
    preserveStreamingStart?: boolean;
    preserveStreamingMeta?: boolean;
    hasActiveBackgroundAgents?: boolean;
  }) => {
    const next = createStoppedStreamControlState(
      {
        isStreaming: isStreamingRef.current,
        streamingMessageId: streamingMessageIdRef.current,
        streamingStart: streamingStartRef.current,
        hasStreamingMeta: streamingMetaRef.current !== null,
        hasRunningTool: hasRunningToolRef.current,
        isAgentOnlyStream: isAgentOnlyStreamRef.current,
        hasPendingCompletion: pendingCompleteRef.current !== null,
        hasPendingBackgroundWork: false,
      },
      {
        preserveStreamingStart: options?.preserveStreamingStart,
        hasActiveBackgroundAgents: options?.hasActiveBackgroundAgents,
      },
    );

    setStreamingMessageId(next.streamingMessageId);
    streamingStartRef.current = next.streamingStart;
    if (!options?.preserveStreamingMeta) {
      streamingMetaRef.current = null;
    }
    pendingCompleteRef.current = null;
    isAgentOnlyStreamRef.current = next.isAgentOnlyStream;
    isStreamingRef.current = next.isStreaming;
    hasRunningToolRef.current = next.hasRunningTool;
    if (!next.isStreaming) {
      activeForegroundRunHandleIdRef.current = null;
      nextRunIdFloorRef.current = null;
      lastTurnFinishReasonRef.current = null;
    }
    runningBlockingToolIdsRef.current.clear();
    runningAskQuestionToolIdsRef.current.clear();
    setIsStreaming(next.isStreaming);
    if (!options?.preserveStreamingMeta) {
      setStreamingMeta(null);
    }

    const nextCompactionState = clearRunningAutoCompactionIndicator(
      autoCompactionIndicatorRef.current,
    );
    if (nextCompactionState !== autoCompactionIndicatorRef.current) {
      applyAutoCompactionIndicator(nextCompactionState);
    }
  }, [
    activeForegroundRunHandleIdRef,
    applyAutoCompactionIndicator,
    autoCompactionIndicatorRef,
    hasRunningToolRef,
    isAgentOnlyStreamRef,
    isStreamingRef,
    lastTurnFinishReasonRef,
    nextRunIdFloorRef,
    pendingCompleteRef,
    runningAskQuestionToolIdsRef,
    runningBlockingToolIdsRef,
    setIsStreaming,
    setStreamingMessageId,
    setStreamingMeta,
    streamingMessageIdRef,
    streamingMetaRef,
    streamingStartRef,
  ]);

  return {
    applyAutoCompactionIndicator,
    asSessionLoopFinishReason,
    clearDeferredCompletion,
    finalizeThinkingSourceTracking,
    hasPendingTaskResultContract,
    isWorkflowTaskUpdate,
    resetThinkingSourceTracking,
    resetTodoItemsForNewStream,
    stopSharedStreamState,
  };
}
