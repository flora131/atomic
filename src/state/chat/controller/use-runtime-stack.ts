import type { Dispatch, SetStateAction } from "react";
import type { BatchDispatcher } from "@/services/events/batch-dispatcher.ts";
import type { ChatAppProps, ChatMessage, StreamingMeta, WorkflowChatState } from "@/state/chat/shared/types/index.ts";
import { useChatAgentProjection } from "@/state/chat/agent/index.ts";
import type { UseChatStreamRuntimeResult } from "@/state/chat/shared/types/stream-runtime.ts";
import type { UseChatShellStateResult } from "@/state/chat/controller/use-shell-state.ts";
import { useChatAppOrchestration } from "@/state/chat/controller/use-app-orchestration.ts";
import { useStreamSubscriptions } from "@/state/chat/stream/index.ts";
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
      agentMessageBindings,
      backgroundAgentMessageId,
      lastStreamedMessageId,
      parallelAgents,
      hasRunningTool,
      streamingMessageId,
      workflowSessionDir,
    },
    setters: {
      setActiveBackgroundAgentCount,
      setParallelAgents,
      setTodoItems,
      setHasRunningTool,
      setWorkflowSessionDir,
      setWorkflowSessionId,
    },
    refs: {
      activeBackgroundAgentCountRef,
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
    },
  } = runtime;

  const {
    waitForUserInputResolverRef,
    workflowActiveRef,
  } = shellState;

  const {
    activeHitlToolCallId,
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
    activeBackgroundAgentCountRef,
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
    deferredCompleteTimeoutRef,
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
    pendingCompleteRef,
    resetLoadedSkillTracking,
    resolveAgentScopedMessageId,
    runningAskQuestionToolIdsRef,
    runningBlockingToolIdsRef,
    sendBackgroundMessageToAgent,
    setActiveBackgroundAgentCount,
    setAgentMessageBinding,
    setIsStreaming,
    setMessagesWindowed,
    setParallelAgents,
    setStreamingMeta,
    setHasRunningTool,
    streamingMessageIdRef,
    streamingMetaRef,
    streamingStartRef,
    toolMessageIdByIdRef,
    toolNameByIdRef,
  });

  const { handleAgentDoneRendered } = useChatAgentProjection({
    activeBackgroundAgentCountRef,
    activeStreamRunIdRef,
    agentMessageBindings,
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
    setActiveBackgroundAgentCount,
    setBackgroundAgentMessageId,
    setMessagesWindowed,
    setParallelAgents,
    startAssistantStreamRef,
    stopSharedStreamState,
    streamingMessageIdRef,
    streamingStartRef,
    todoItemsRef,
    hasRunningTool,
    streamingMessageId,
    lastStreamedMessageId,
    backgroundAgentMessageId,
    workflowActiveRef,
  });

  return {
    activeHitlToolCallId,
    activeHitlToolCallIdRef,
    activeQuestion,
    handleAgentDoneRendered,
    handleQuestionAnswer,
    resetHitlState,
  };
}
