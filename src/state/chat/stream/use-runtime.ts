import type {
  UseChatStreamRuntimeArgs,
  UseChatStreamRuntimeResult,
} from "@/state/chat/stream/runtime-types.ts";
import { useStreamState } from "@/state/chat/stream/use-stream-state.ts";
import { useStreamRefs } from "@/state/chat/stream/use-stream-refs.ts";
import { useStreamActions } from "@/state/chat/stream/use-stream-actions.ts";
import { useChatBackgroundDispatch } from "@/state/chat/stream/use-background-dispatch.ts";
import { useChatRunTracking } from "@/state/chat/stream/use-run-tracking.ts";
import { useChatRuntimeControls } from "@/state/chat/stream/use-runtime-controls.ts";
import { useChatRuntimeEffects } from "@/state/chat/stream/use-runtime-effects.ts";
import { useChatStreamConsumer } from "@/state/chat/stream/use-consumer.ts";
import { useChatStreamLifecycle } from "@/state/chat/stream/use-lifecycle.ts";

export function useChatStreamRuntime({
  agentType,
  appendCompactionSummaryAndSync,
  continueQueuedConversationRef,
  currentModelRef,
  getSession,
  messages,
  onStreamMessage,
  setIsStreaming,
  setMessagesWindowed,
  setStreamingMeta,
}: UseChatStreamRuntimeArgs): UseChatStreamRuntimeResult {
  // ── State (useState + useMemo) ─────────────────────────────────────────
  const {
    parallelAgents, compactionSummary, showCompactionHistory,
    todoItems, workflowSessionDir, workflowSessionId,
    hasRunningTool, activeBackgroundAgentCount,
    streamingMessageId, lastStreamedMessageId,
    backgroundAgentMessageId, agentMessageBindings,
    streamingElapsedMs,
    hasLiveLoadingIndicator,
    setParallelAgents, setCompactionSummary, setShowCompactionHistory,
    setIsAutoCompacting, setTodoItems, setWorkflowSessionDir,
    setWorkflowSessionId, setHasRunningTool,
    setActiveBackgroundAgentCount,
    setStreamingMessageIdState, setLastStreamedMessageIdState,
    setBackgroundAgentMessageIdState, setAgentMessageBindings,
    setStreamingElapsedMs,
  } = useStreamState(messages);

  // ── Refs (useRef) ──────────────────────────────────────────────────────
  const refs = useStreamRefs(messages);
  const {
    streamRunRuntimeRef,
    backgroundAgentSendChainRef,
    pendingBackgroundUpdatesRef,
    backgroundUpdateFlushInFlightRef,
    ...publicRefs
  } = refs;

  // ── Local actions (useCallback) ────────────────────────────────────────
  const {
    setStreamingMessageId, setLastStreamedMessageId,
    setBackgroundAgentMessageId, resetLoadedSkillTracking,
    setAgentMessageBinding, deleteAgentMessageBinding,
    separateAndInterruptAgents, resolveAgentScopedMessageId,
  } = useStreamActions({
    streamingMessageIdRef: refs.streamingMessageIdRef,
    lastStreamedMessageIdRef: refs.lastStreamedMessageIdRef,
    backgroundAgentMessageIdRef: refs.backgroundAgentMessageIdRef,
    loadedSkillsRef: refs.loadedSkillsRef,
    activeSkillSessionIdRef: refs.activeSkillSessionIdRef,
    agentMessageIdByIdRef: refs.agentMessageIdByIdRef,
    parallelAgentsRef: refs.parallelAgentsRef,
    setStreamingMessageIdState,
    setLastStreamedMessageIdState,
    setBackgroundAgentMessageIdState,
    setAgentMessageBindings,
  });

  // ── Existing sub-hooks (unchanged) ─────────────────────────────────────
  const {
    bindTrackedRunToMessage,
    getActiveStreamRunId,
    resolveTrackedRun,
    shouldHideActiveStreamContent,
    startTrackedAssistantRun,
    trackAwaitedRun,
  } = useChatRunTracking({
    activeForegroundRunHandleIdRef: refs.activeForegroundRunHandleIdRef,
    awaitedStreamRunIdsRef: refs.awaitedStreamRunIdsRef,
    streamRunRuntimeRef,
  });

  const { appendSkillLoadIndicator, sendBackgroundMessageToAgent } = useChatBackgroundDispatch({
    backgroundAgentSendChainRef,
    backgroundUpdateFlushInFlightRef,
    getSession,
    isAgentOnlyStreamRef: refs.isAgentOnlyStreamRef,
    isStreamingRef: refs.isStreamingRef,
    pendingBackgroundUpdatesRef,
    setMessagesWindowed,
  });

  const {
    applyAutoCompactionIndicator,
    asSessionLoopFinishReason,
    clearDeferredCompletion,
    finalizeThinkingSourceTracking,
    hasPendingTaskResultContract,
    isWorkflowTaskUpdate,
    resetThinkingSourceTracking,
    resetTodoItemsForNewStream,
    stopSharedStreamState,
  } = useChatRuntimeControls({
    activeForegroundRunHandleIdRef: refs.activeForegroundRunHandleIdRef,
    appendCompactionSummaryAndSync,
    autoCompactionIndicatorRef: refs.autoCompactionIndicatorRef,
    closedThinkingSourcesRef: refs.closedThinkingSourcesRef,
    deferredCompleteTimeoutRef: refs.deferredCompleteTimeoutRef,
    hasRunningToolRef: refs.hasRunningToolRef,
    isAgentOnlyStreamRef: refs.isAgentOnlyStreamRef,
    setHasRunningTool,
    isStreamingRef: refs.isStreamingRef,
    lastTurnFinishReasonRef: refs.lastTurnFinishReasonRef,
    nextRunIdFloorRef: refs.nextRunIdFloorRef,
    pendingCompleteRef: refs.pendingCompleteRef,
    resetLoadedSkillTracking,
    runningAskQuestionToolIdsRef: refs.runningAskQuestionToolIdsRef,
    runningBlockingToolIdsRef: refs.runningBlockingToolIdsRef,
    setCompactionSummary,
    setIsAutoCompacting,
    setIsStreaming,
    setMessagesWindowed,
    setShowCompactionHistory,
    setStreamingMessageId,
    setStreamingMeta,
    setTodoItems,
    streamingMessageIdRef: refs.streamingMessageIdRef,
    streamingMetaRef: refs.streamingMetaRef,
    streamingStartRef: refs.streamingStartRef,
    todoItemsRef: refs.todoItemsRef,
    workflowSessionIdRef: refs.workflowSessionIdRef,
    workflowTaskIdsRef: refs.workflowTaskIdsRef,
  });

  const { resetConsumers, getOwnershipTracker } = useChatStreamConsumer({
    agentType,
    activeForegroundRunHandleIdRef: refs.activeForegroundRunHandleIdRef,
    activeStreamRunIdRef: refs.activeStreamRunIdRef,
    agentLifecycleLedgerRef: refs.agentLifecycleLedgerRef,
    agentOrderingStateRef: refs.agentOrderingStateRef,
    applyAutoCompactionIndicator,
    backgroundAgentMessageIdRef: refs.backgroundAgentMessageIdRef,
    clearDeferredCompletion,
    closedThinkingSourcesRef: refs.closedThinkingSourcesRef,
    completionOrderingEventByAgentRef: refs.completionOrderingEventByAgentRef,
    deferredPostCompleteDeltasByAgentRef: refs.deferredPostCompleteDeltasByAgentRef,
    hasRunningToolRef: refs.hasRunningToolRef,
    isAgentOnlyStreamRef: refs.isAgentOnlyStreamRef,
    isStreamingRef: refs.isStreamingRef,
    isWorkflowTaskUpdate,
    lastStreamedMessageIdRef: refs.lastStreamedMessageIdRef,
    lastStreamingContentRef: refs.lastStreamingContentRef,
    pendingCompleteRef: refs.pendingCompleteRef,
    resolveAgentScopedMessageId,
    runningAskQuestionToolIdsRef: refs.runningAskQuestionToolIdsRef,
    runningBlockingToolIdsRef: refs.runningBlockingToolIdsRef,
    sendBackgroundMessageToAgent,
    setMessagesWindowed,
    setParallelAgents,
    setStreamingMeta,
    setTodoItems,
    setHasRunningTool,
    shouldHideActiveStreamContent,
    streamRunRuntimeRef,
    streamingMessageIdRef: refs.streamingMessageIdRef,
    streamingMetaRef: refs.streamingMetaRef,
    thinkingDropDiagnosticsRef: refs.thinkingDropDiagnosticsRef,
    todoItemsRef: refs.todoItemsRef,
    toolMessageIdByIdRef: refs.toolMessageIdByIdRef,
    toolNameByIdRef: refs.toolNameByIdRef,
    workflowSessionIdRef: refs.workflowSessionIdRef,
  });

  const {
    continueAssistantStreamInPlace,
    handleStreamComplete,
    handleStreamStartupError,
    startAssistantStream,
  } = useChatStreamLifecycle({
    activeBackgroundAgentCountRef: refs.activeBackgroundAgentCountRef,
    activeStreamRunIdRef: refs.activeStreamRunIdRef,
    agentType,
    awaitedStreamRunIdsRef: refs.awaitedStreamRunIdsRef,
    bindTrackedRunToMessage,
    clearDeferredCompletion,
    continueAssistantStreamInPlaceRef: refs.continueAssistantStreamInPlaceRef,
    continueQueuedConversationRef,
    currentModelRef,
    deferredCompleteTimeoutRef: refs.deferredCompleteTimeoutRef,
    finalizeThinkingSourceTracking,
    getActiveStreamRunId,
    hasRunningToolRef: refs.hasRunningToolRef,
    isAgentOnlyStreamRef: refs.isAgentOnlyStreamRef,
    isStreamingRef: refs.isStreamingRef,
    lastStreamingContentRef: refs.lastStreamingContentRef,
    lastTurnFinishReasonRef: refs.lastTurnFinishReasonRef,
    nextRunIdFloorRef: refs.nextRunIdFloorRef,
    onStreamMessage,
    parallelAgentsRef: refs.parallelAgentsRef,
    pendingCompleteRef: refs.pendingCompleteRef,
    resetConsumers,
    resetTodoItemsForNewStream,
    resetThinkingSourceTracking,
    resolveTrackedRun,
    runningAskQuestionToolIdsRef: refs.runningAskQuestionToolIdsRef,
    runningBlockingToolIdsRef: refs.runningBlockingToolIdsRef,
    sendBackgroundMessageToAgent,
    setActiveBackgroundAgentCount,
    setBackgroundAgentMessageId,
    setIsStreaming,
    setLastStreamedMessageId,
    setMessagesWindowed,
    setParallelAgents,
    setStreamingMessageId,
    setHasRunningTool,
    shouldHideActiveStreamContent,
    startAssistantStreamRef: refs.startAssistantStreamRef,
    startTrackedAssistantRun,
    stopSharedStreamState,
    streamingMessageIdRef: refs.streamingMessageIdRef,
    streamingMetaRef: refs.streamingMetaRef,
    streamingStartRef: refs.streamingStartRef,
    todoItemsRef: refs.todoItemsRef,
    toolMessageIdByIdRef: refs.toolMessageIdByIdRef,
    toolNameByIdRef: refs.toolNameByIdRef,
    wasInterruptedRef: refs.wasInterruptedRef,
  });

  // ── Ref-mirroring (lifecycle callbacks → refs for consumer access) ─────
  refs.startAssistantStreamRef.current = (content: string) => {
    startAssistantStream(content);
  };
  refs.continueAssistantStreamInPlaceRef.current = (messageId: string, content: string) => {
    continueAssistantStreamInPlace(messageId, content);
  };

  // ── Effects ────────────────────────────────────────────────────────────
  useChatRuntimeEffects({
    activeForegroundRunHandleIdRef: refs.activeForegroundRunHandleIdRef,
    agentLifecycleLedgerRef: refs.agentLifecycleLedgerRef,
    backgroundProgressSnapshotRef: refs.backgroundProgressSnapshotRef,
    completionOrderingEventByAgentRef: refs.completionOrderingEventByAgentRef,
    deferredCompleteTimeoutRef: refs.deferredCompleteTimeoutRef,
    deferredPostCompleteDeltasByAgentRef: refs.deferredPostCompleteDeltasByAgentRef,
    doneRenderedSequenceByAgentRef: refs.doneRenderedSequenceByAgentRef,
    hasLiveLoadingIndicator,
    parallelAgents,
    parallelAgentsRef: refs.parallelAgentsRef,
    parallelInterruptHandlerRef: refs.parallelInterruptHandlerRef,
    pendingBackgroundUpdatesRef,
    setStreamingElapsedMs,
    streamRunRuntimeRef,
    streamingStartRef: refs.streamingStartRef,
    todoItems,
    todoItemsRef: refs.todoItemsRef,
    workflowSessionDir,
    workflowSessionDirRef: refs.workflowSessionDirRef,
    workflowSessionId,
    workflowSessionIdRef: refs.workflowSessionIdRef,
  });

  // ── Return (identical shape to UseChatStreamRuntimeResult) ─────────────
  return {
    state: {
      activeBackgroundAgentCount,
      agentMessageBindings,
      backgroundAgentMessageId,
      compactionSummary,
      lastStreamedMessageId,
      parallelAgents,
      showCompactionHistory,
      streamingElapsedMs,
      streamingMessageId,
      todoItems,
      hasRunningTool,
      workflowSessionDir,
      workflowSessionId,
    },
    setters: {
      setActiveBackgroundAgentCount,
      setCompactionSummary,
      setIsAutoCompacting,
      setParallelAgents,
      setShowCompactionHistory,
      setTodoItems,
      setHasRunningTool,
      setWorkflowSessionDir,
      setWorkflowSessionId,
    },
    refs: publicRefs,
    actions: {
      appendSkillLoadIndicator,
      applyAutoCompactionIndicator,
      asSessionLoopFinishReason,
      clearDeferredCompletion,
      deleteAgentMessageBinding,
      finalizeThinkingSourceTracking,
      getActiveStreamRunId,
      getOwnershipTracker,
      handleStreamComplete,
      handleStreamStartupError,
      hasPendingTaskResultContract,
      isWorkflowTaskUpdate,
      resetConsumers,
      resetLoadedSkillTracking,
      resolveAgentScopedMessageId,
      resolveTrackedRun,
      separateAndInterruptAgents,
      sendBackgroundMessageToAgent,
      setAgentMessageBinding,
      setBackgroundAgentMessageId,
      setLastStreamedMessageId,
      setStreamingMessageId,
      shouldHideActiveStreamContent,
      startAssistantStream,
      stopSharedStreamState,
      trackAwaitedRun,
    },
  };
}
