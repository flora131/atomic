import type { Dispatch, SetStateAction } from "react";
import type { BatchDispatcher } from "@/services/events/batch-dispatcher.ts";
import type { ChatAppProps, ChatMessage, StreamingMeta, WorkflowChatState } from "@/state/chat/types.ts";
import { useChatAgentProjection } from "@/state/chat/agent/use-projection.ts";
import type { UseChatStreamRuntimeResult } from "@/state/chat/stream/runtime-types.ts";
import type { UseChatShellStateResult } from "@/state/chat/controller/use-shell-state.ts";
import { useChatAppOrchestration } from "@/state/chat/controller/use-app-orchestration.ts";
import { useStreamSubscriptions } from "@/state/chat/stream/use-subscriptions.ts";
import { useWorkflowHitl } from "@/state/chat/controller/use-workflow-hitl.ts";

type OrchestrationResult = ReturnType<typeof useChatAppOrchestration>;

interface UseChatRuntimeStackArgs {
  agentType?: string;
  batchDispatcher: BatchDispatcher;
  getSession?: ChatAppProps["getSession"];
  isStreaming: boolean;
  messages: ChatMessage[];
  onWorkflowResumeWithAnswer?: ChatAppProps["onWorkflowResumeWithAnswer"];
  orchestration: OrchestrationResult;
  runtime: UseChatStreamRuntimeResult;
  setIsStreaming: Dispatch<SetStateAction<boolean>>;
  setMessagesWindowed: (next: SetStateAction<ChatMessage[]>) => void;
  setStreamingMeta: Dispatch<SetStateAction<StreamingMeta | null>>;
  shellState: Pick<UseChatShellStateResult, "waitForUserInputResolverRef" | "workflowActiveRef">;
  workflowState: WorkflowChatState;
}

export function useChatRuntimeStack({
  agentType,
  batchDispatcher,
  getSession,
  isStreaming,
  messages,
  onWorkflowResumeWithAnswer,
  orchestration,
  runtime,
  setIsStreaming,
  setMessagesWindowed,
  setStreamingMeta,
  shellState,
  workflowState,
}: UseChatRuntimeStackArgs) {
  const {
    continueQueuedConversation,
    updateWorkflowState,
  } = orchestration;

  const {
    state: {
      agentAnchorSyncVersion,
      parallelAgents,
      toolCompletionVersion,
      workflowSessionDir,
    },
    setters: {
      setParallelAgents,
      setTodoItems,
      setToolCompletionVersion,
      setWorkflowSessionDir,
      setWorkflowSessionId,
    },
    refs: {
      activeSkillSessionIdRef,
      activeStreamRunIdRef,
      agentLifecycleLedgerRef,
      agentMessageIdByIdRef,
      agentOrderingStateRef,
      awaitedStreamRunIdsRef,
      backgroundAgentMessageIdRef,
      backgroundProgressSnapshotRef,
      completionOrderingEventByAgentRef,
      continueAssistantStreamInPlaceRef,
      deferredCompleteTimeoutRef,
      deferredPostCompleteDeltasByAgentRef,
      doneRenderedSequenceByAgentRef,
      hasRunningToolRef,
      isAgentOnlyStreamRef,
      isStreamingRef,
      lastStreamedMessageIdRef,
      lastStreamingContentRef,
      lastTurnFinishReasonRef,
      loadedSkillsRef,
      nextRunIdFloorRef,
      parallelAgentsRef,
      pendingCompleteRef,
      runningAskQuestionToolIdsRef,
      runningBlockingToolIdsRef,
      startAssistantStreamRef,
      streamingMessageIdRef,
      streamingMetaRef,
      streamingStartRef,
      todoItemsRef,
      toolMessageIdByIdRef,
      toolNameByIdRef,
      workflowSessionDirRef,
      workflowSessionIdRef,
    },
    actions: {
      appendSkillLoadIndicator,
      applyAutoCompactionIndicator,
      asSessionLoopFinishReason,
      deleteAgentMessageBinding,
      finalizeThinkingSourceTracking,
      getActiveStreamRunId,
      handleStreamComplete,
      handleStreamStartupError,
      hasPendingTaskResultContract,
      resetLoadedSkillTracking,
      resolveAgentScopedMessageId,
      resolveTrackedRun,
      sendBackgroundMessageToAgent,
      setAgentMessageBinding,
      setBackgroundAgentMessageId,
      stopSharedStreamState,
      startAssistantStream,
      terminateAgentLifecycleContractViolation,
    },
  } = runtime;

  const {
    waitForUserInputResolverRef,
    workflowActiveRef,
  } = shellState;

  const {
    activeHitlToolCallIdRef,
    activeQuestion,
    handleAskUserQuestion,
    handlePermissionRequest,
    handleQuestionAnswer,
    resetHitlState,
  } = useWorkflowHitl({
    getSession,
    isStreaming,
    isStreamingRef,
    onWorkflowResumeWithAnswer,
    setMessagesWindowed,
    setTodoItems,
    setWorkflowSessionDir,
    setWorkflowSessionId,
    startAssistantStream,
    todoItemsRef,
    updateWorkflowState,
    waitForUserInputResolverRef,
    workflowActiveRef,
    workflowSessionDir,
    workflowSessionDirRef,
    workflowSessionIdRef,
    workflowState,
  });

  useStreamSubscriptions({
    activeSkillSessionIdRef,
    activeStreamRunIdRef,
    agentLifecycleLedgerRef,
    agentMessageIdByIdRef,
    agentOrderingStateRef,
    agentType,
    applyAutoCompactionIndicator,
    appendSkillLoadIndicator,
    asSessionLoopFinishReason,
    backgroundAgentMessageIdRef,
    backgroundProgressSnapshotRef,
    batchDispatcher,
    completionOrderingEventByAgentRef,
    deferredPostCompleteDeltasByAgentRef,
    doneRenderedSequenceByAgentRef,
    handleAskUserQuestion,
    handlePermissionRequest,
    handleStreamComplete,
    handleStreamStartupError,
    hasPendingTaskResultContract,
    hasRunningToolRef,
    isStreamingRef,
    lastStreamedMessageIdRef,
    lastTurnFinishReasonRef,
    loadedSkillsRef,
    nextRunIdFloorRef,
    parallelAgentsRef,
    resetLoadedSkillTracking,
    resolveAgentScopedMessageId,
    runningAskQuestionToolIdsRef,
    runningBlockingToolIdsRef,
    sendBackgroundMessageToAgent,
    setAgentMessageBinding,
    setIsStreaming,
    setMessagesWindowed,
    setParallelAgents,
    setStreamingMeta,
    setToolCompletionVersion,
    streamingMessageIdRef,
    streamingMetaRef,
    streamingStartRef,
    terminateAgentLifecycleContractViolation,
    toolMessageIdByIdRef,
    toolNameByIdRef,
  });

  const { handleAgentDoneRendered } = useChatAgentProjection({
    activeStreamRunIdRef,
    agentAnchorSyncVersion,
    agentLifecycleLedgerRef,
    agentMessageIdByIdRef,
    agentOrderingStateRef,
    agentType,
    awaitedStreamRunIdsRef,
    backgroundAgentMessageIdRef,
    completionOrderingEventByAgentRef,
    continueAssistantStreamInPlaceRef,
    continueQueuedConversation,
    deferredCompleteTimeoutRef,
    deferredPostCompleteDeltasByAgentRef,
    deleteAgentMessageBinding,
    doneRenderedSequenceByAgentRef,
    finalizeThinkingSourceTracking,
    getActiveStreamRunId,
    hasRunningToolRef,
    isAgentOnlyStreamRef,
    isStreamingRef,
    lastStreamedMessageIdRef,
    lastStreamingContentRef,
    messages,
    parallelAgents,
    parallelAgentsRef,
    pendingCompleteRef,
    resolveTrackedRun,
    sendBackgroundMessageToAgent,
    setBackgroundAgentMessageId,
    setMessagesWindowed,
    setParallelAgents,
    startAssistantStreamRef,
    stopSharedStreamState,
    streamingMessageIdRef,
    streamingStartRef,
    todoItemsRef,
    toolCompletionVersion,
    workflowActiveRef,
  });

  return {
    activeHitlToolCallIdRef,
    activeQuestion,
    handleAgentDoneRendered,
    handleQuestionAnswer,
    resetHitlState,
  };
}
