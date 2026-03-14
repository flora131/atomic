import {
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { isBackgroundAgent } from "@/state/chat/shared/helpers/background-agent-footer.ts";
import type { NormalizedTodoItem } from "@/state/parts/helpers/task-status.ts";
import type { AutoCompactionIndicatorState } from "@/state/chat/shared/helpers/auto-compaction-lifecycle.ts";
import { type SessionLoopFinishReason } from "@/state/chat/shared/helpers/stream-continuation.ts";
import { createAgentLifecycleLedger } from "@/state/chat/shared/helpers/agent-lifecycle-ledger.ts";
import type {
  AgentOrderingEvent,
} from "@/state/chat/shared/helpers/agent-ordering-contract.ts";
import {
  createAgentOrderingState,
} from "@/state/chat/shared/helpers/agent-ordering-contract.ts";
import { createLoadedSkillTrackingSet } from "@/state/chat/shared/helpers/skill-load-tracking.ts";
import {
  StreamRunRuntime,
} from "@/state/runtime/stream-run-runtime.ts";
import type {
  StreamingMeta,
  ThinkingDropDiagnostics,
} from "@/state/chat/shared/types/index.ts";
import {
  createThinkingDropDiagnostics,
} from "@/state/chat/shared/helpers/index.ts";
import type { ParallelAgent } from "@/types/parallel-agents.ts";
import type {
  UseChatStreamRuntimeArgs,
  UseChatStreamRuntimeResult,
} from "@/state/chat/stream/runtime-types.ts";
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
  const [parallelAgents, setParallelAgents] = useState<ParallelAgent[]>([]);
  const [compactionSummary, setCompactionSummary] = useState<string | null>(null);
  const [showCompactionHistory, setShowCompactionHistory] = useState(false);
  const [_isAutoCompacting, setIsAutoCompacting] = useState(false);
  const autoCompactionIndicatorRef = useRef<AutoCompactionIndicatorState>({ status: "idle" });
  const [todoItems, setTodoItems] = useState<NormalizedTodoItem[]>([]);
  const [workflowSessionDir, setWorkflowSessionDir] = useState<string | null>(null);
  const [workflowSessionId, setWorkflowSessionId] = useState<string | null>(null);
  const [toolCompletionVersion, setToolCompletionVersion] = useState(0);
  const [activeBackgroundAgentCount, setActiveBackgroundAgentCount] = useState(0);
  const [agentAnchorSyncVersion, setAgentAnchorSyncVersion] = useState(0);
  const [streamingElapsedMs, setStreamingElapsedMs] = useState(0);

  const activeBackgroundAgentCountRef = useRef(0);
  const todoItemsRef = useRef<NormalizedTodoItem[]>([]);
  const lastStreamingContentRef = useRef("");
  const streamRunRuntimeRef = useRef(new StreamRunRuntime());
  const activeForegroundRunHandleIdRef = useRef<string | null>(null);
  const awaitedStreamRunIdsRef = useRef<Set<string>>(new Set());
  const parallelInterruptHandlerRef = useRef<(() => void) | null>(null);
  const workflowSessionDirRef = useRef<string | null>(null);
  const workflowSessionIdRef = useRef<string | null>(null);
  const workflowTaskIdsRef = useRef<Set<string>>(new Set());
  const toolNameByIdRef = useRef<Map<string, string>>(new Map());
  const toolMessageIdByIdRef = useRef<Map<string, string>>(new Map());
  const agentMessageIdByIdRef = useRef<Map<string, string>>(new Map());
  const agentLifecycleLedgerRef = useRef(createAgentLifecycleLedger());
  const agentOrderingStateRef = useRef(createAgentOrderingState());
  const completionOrderingEventByAgentRef = useRef<Map<string, AgentOrderingEvent>>(new Map());
  const doneRenderedSequenceByAgentRef = useRef<Map<string, number>>(new Map());
  const deferredPostCompleteDeltasByAgentRef = useRef<Map<string, Array<{
    messageId: string;
    runId?: number;
    delta: string;
    completionSequence: number;
  }>>>(new Map());
  const streamingMessageIdRef = useRef<string | null>(null);
  const activeStreamRunIdRef = useRef<number | null>(null);
  const nextRunIdFloorRef = useRef<number | null>(null);
  const lastTurnFinishReasonRef = useRef<SessionLoopFinishReason | null>(null);
  const lastStreamedMessageIdRef = useRef<string | null>(null);
  const backgroundAgentMessageIdRef = useRef<string | null>(null);
  const streamingStartRef = useRef<number | null>(null);
  const isStreamingRef = useRef(false);
  const streamingMetaRef = useRef<StreamingMeta | null>(null);
  const closedThinkingSourcesRef = useRef<Set<string>>(new Set());
  const thinkingDropDiagnosticsRef = useRef<ThinkingDropDiagnostics>(createThinkingDropDiagnostics());
  const wasInterruptedRef = useRef(false);
  const parallelAgentsRef = useRef<ParallelAgent[]>([]);
  const pendingCompleteRef = useRef<(() => void) | null>(null);
  const deferredCompleteTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isAgentOnlyStreamRef = useRef(false);
  const hasRunningToolRef = useRef(false);
  const runningBlockingToolIdsRef = useRef<Set<string>>(new Set());
  const runningAskQuestionToolIdsRef = useRef<Set<string>>(new Set());
  const loadedSkillsRef = useRef<Set<string>>(createLoadedSkillTrackingSet(messages));
  const activeSkillSessionIdRef = useRef<string | null>(null);
  const continueAssistantStreamInPlaceRef = useRef<((messageId: string, content: string) => void) | null>(null);
  const startAssistantStreamRef = useRef<((content: string) => void) | null>(null);
  const backgroundAgentSendChainRef = useRef<Promise<void>>(Promise.resolve());
  const pendingBackgroundUpdatesRef = useRef<string[]>([]);
  const backgroundUpdateFlushInFlightRef = useRef(false);
  const backgroundProgressSnapshotRef = useRef<Map<string, {
    toolUses: number;
    currentTool?: string;
  }>>(new Map());

  const setStreamingMessageId = useCallback((messageId: string | null): void => {
    if (streamingMessageIdRef.current === messageId) return;
    streamingMessageIdRef.current = messageId;
    setAgentAnchorSyncVersion((version) => version + 1);
  }, []);

  const setLastStreamedMessageId = useCallback((messageId: string | null): void => {
    if (lastStreamedMessageIdRef.current === messageId) return;
    lastStreamedMessageIdRef.current = messageId;
    setAgentAnchorSyncVersion((version) => version + 1);
  }, []);

  const setBackgroundAgentMessageId = useCallback((messageId: string | null): void => {
    if (backgroundAgentMessageIdRef.current === messageId) return;
    backgroundAgentMessageIdRef.current = messageId;
    setAgentAnchorSyncVersion((version) => version + 1);
  }, []);

  const resetLoadedSkillTracking = useCallback((options?: {
    resetSessionBinding?: boolean;
  }) => {
    loadedSkillsRef.current.clear();
    if (options?.resetSessionBinding) {
      activeSkillSessionIdRef.current = null;
    }
  }, []);

  const setAgentMessageBinding = useCallback((agentId: string, messageId: string): void => {
    if (agentMessageIdByIdRef.current.get(agentId) === messageId) return;
    agentMessageIdByIdRef.current.set(agentId, messageId);
    setAgentAnchorSyncVersion((version) => version + 1);
  }, []);

  const deleteAgentMessageBinding = useCallback((agentId: string): void => {
    if (!agentMessageIdByIdRef.current.has(agentId)) return;
    agentMessageIdByIdRef.current.delete(agentId);
    setAgentAnchorSyncVersion((version) => version + 1);
  }, []);

  const {
    bindTrackedRunToMessage,
    getActiveStreamRunId,
    resolveTrackedRun,
    shouldHideActiveStreamContent,
    startTrackedAssistantRun,
    trackAwaitedRun,
  } = useChatRunTracking({
    activeForegroundRunHandleIdRef,
    awaitedStreamRunIdsRef,
    streamRunRuntimeRef,
  });

  const separateAndInterruptAgents = useCallback((agents: ParallelAgent[]) => {
    const backgroundAgents = agents.filter(isBackgroundAgent);
    const foregroundAgents = agents.filter((agent) => !isBackgroundAgent(agent));

    return {
      interruptedAgents: [
        ...foregroundAgents.map((agent) =>
          agent.status === "running" || agent.status === "pending"
            ? {
              ...agent,
              status: "interrupted" as const,
              currentTool: undefined,
              durationMs: Date.now() - new Date(agent.startedAt).getTime(),
            }
            : agent,
        ),
        ...backgroundAgents,
      ],
      remainingLiveAgents: backgroundAgents,
    };
  }, []);

  const resolveAgentScopedMessageId = useCallback((agentId?: string): string | null => {
    if (!agentId) {
      return streamingMessageIdRef.current ?? lastStreamedMessageIdRef.current;
    }

    const mappedMessageId = agentMessageIdByIdRef.current.get(agentId);
    if (mappedMessageId) {
      return mappedMessageId;
    }

    const scopedAgent = parallelAgentsRef.current.find((agent) => agent.id === agentId);
    const shouldPreferBackgroundMessage = scopedAgent ? isBackgroundAgent(scopedAgent) : false;

    if (shouldPreferBackgroundMessage) {
      return (
        backgroundAgentMessageIdRef.current
        ?? streamingMessageIdRef.current
        ?? lastStreamedMessageIdRef.current
      );
    }

    return streamingMessageIdRef.current ?? lastStreamedMessageIdRef.current;
  }, []);

  const { appendSkillLoadIndicator, sendBackgroundMessageToAgent } = useChatBackgroundDispatch({
    backgroundAgentSendChainRef,
    backgroundUpdateFlushInFlightRef,
    getSession,
    isAgentOnlyStreamRef,
    isStreamingRef,
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
  });
  const { resetConsumers, getCorrelationService } = useChatStreamConsumer({
    agentType,
    activeForegroundRunHandleIdRef,
    activeStreamRunIdRef,
    agentLifecycleLedgerRef,
    agentOrderingStateRef,
    applyAutoCompactionIndicator,
    backgroundAgentMessageIdRef,
    clearDeferredCompletion,
    closedThinkingSourcesRef,
    completionOrderingEventByAgentRef,
    deferredPostCompleteDeltasByAgentRef,
    hasRunningToolRef,
    isAgentOnlyStreamRef,
    isStreamingRef,
    isWorkflowTaskUpdate,
    lastStreamedMessageIdRef,
    lastStreamingContentRef,
    pendingCompleteRef,
    resolveAgentScopedMessageId,
    runningAskQuestionToolIdsRef,
    runningBlockingToolIdsRef,
    sendBackgroundMessageToAgent,
    setMessagesWindowed,
    setParallelAgents,
    setStreamingMeta,
    setTodoItems,
    setToolCompletionVersion,
    shouldHideActiveStreamContent,
    streamRunRuntimeRef,
    streamingMessageIdRef,
    streamingMetaRef,
    thinkingDropDiagnosticsRef,
    todoItemsRef,
    toolMessageIdByIdRef,
    toolNameByIdRef,
    workflowSessionIdRef,
  });
  const {
    continueAssistantStreamInPlace,
    handleStreamComplete,
    handleStreamStartupError,
    startAssistantStream,
    terminateAgentLifecycleContractViolation,
  } = useChatStreamLifecycle({
    activeBackgroundAgentCountRef,
    activeStreamRunIdRef,
    agentType,
    awaitedStreamRunIdsRef,
    bindTrackedRunToMessage,
    clearDeferredCompletion,
    continueAssistantStreamInPlaceRef,
    continueQueuedConversationRef,
    currentModelRef,
    deferredCompleteTimeoutRef,
    finalizeThinkingSourceTracking,
    getActiveStreamRunId,
    hasRunningToolRef,
    isAgentOnlyStreamRef,
    isStreamingRef,
    lastStreamingContentRef,
    lastTurnFinishReasonRef,
    nextRunIdFloorRef,
    onStreamMessage,
    parallelAgentsRef,
    pendingCompleteRef,
    resetConsumers,
    resetTodoItemsForNewStream,
    resetThinkingSourceTracking,
    resolveTrackedRun,
    runningAskQuestionToolIdsRef,
    runningBlockingToolIdsRef,
    sendBackgroundMessageToAgent,
    setActiveBackgroundAgentCount,
    setBackgroundAgentMessageId,
    setIsStreaming,
    setLastStreamedMessageId,
    setMessagesWindowed,
    setParallelAgents,
    setStreamingMessageId,
    setToolCompletionVersion,
    shouldHideActiveStreamContent,
    startAssistantStreamRef,
    startTrackedAssistantRun,
    stopSharedStreamState,
    streamingMessageIdRef,
    streamingMetaRef,
    streamingStartRef,
    todoItemsRef,
    toolMessageIdByIdRef,
    toolNameByIdRef,
    wasInterruptedRef,
  });

  startAssistantStreamRef.current = (content: string) => {
    startAssistantStream(content);
  };

  continueAssistantStreamInPlaceRef.current = (messageId: string, content: string) => {
    continueAssistantStreamInPlace(messageId, content);
  };

  const hasLiveLoadingIndicator = useMemo(
    () => activeBackgroundAgentCount > 0 || messages.some((message) => {
      return message.streaming || todoItems.some((item) => item.status === "in_progress");
    }),
    [activeBackgroundAgentCount, messages, todoItems],
  );

  useChatRuntimeEffects({
    activeForegroundRunHandleIdRef,
    agentLifecycleLedgerRef,
    backgroundProgressSnapshotRef,
    completionOrderingEventByAgentRef,
    deferredCompleteTimeoutRef,
    deferredPostCompleteDeltasByAgentRef,
    doneRenderedSequenceByAgentRef,
    hasLiveLoadingIndicator,
    parallelAgents,
    parallelAgentsRef,
    parallelInterruptHandlerRef,
    pendingBackgroundUpdatesRef,
    setStreamingElapsedMs,
    streamRunRuntimeRef,
    streamingStartRef,
    todoItems,
    todoItemsRef,
    workflowSessionDir,
    workflowSessionDirRef,
    workflowSessionId,
    workflowSessionIdRef,
  });

  return {
    state: {
      activeBackgroundAgentCount,
      agentAnchorSyncVersion,
      compactionSummary,
      parallelAgents,
      showCompactionHistory,
      streamingElapsedMs,
      todoItems,
      toolCompletionVersion,
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
      setToolCompletionVersion,
      setWorkflowSessionDir,
      setWorkflowSessionId,
    },
    refs: {
      activeBackgroundAgentCountRef,
      activeForegroundRunHandleIdRef,
      activeSkillSessionIdRef,
      activeStreamRunIdRef,
      agentLifecycleLedgerRef,
      agentMessageIdByIdRef,
      agentOrderingStateRef,
      autoCompactionIndicatorRef,
      awaitedStreamRunIdsRef,
      backgroundAgentMessageIdRef,
      backgroundProgressSnapshotRef,
      closedThinkingSourcesRef,
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
      parallelInterruptHandlerRef,
      pendingCompleteRef,
      runningAskQuestionToolIdsRef,
      runningBlockingToolIdsRef,
      startAssistantStreamRef,
      streamingMessageIdRef,
      streamingMetaRef,
      streamingStartRef,
      thinkingDropDiagnosticsRef,
      todoItemsRef,
      toolMessageIdByIdRef,
      toolNameByIdRef,
      wasInterruptedRef,
      workflowSessionDirRef,
      workflowSessionIdRef,
      workflowTaskIdsRef,
    },
    actions: {
      appendSkillLoadIndicator,
      applyAutoCompactionIndicator,
      asSessionLoopFinishReason,
      clearDeferredCompletion,
      deleteAgentMessageBinding,
      finalizeThinkingSourceTracking,
      getActiveStreamRunId,
      getCorrelationService,
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
      terminateAgentLifecycleContractViolation,
      trackAwaitedRun,
    },
  };
}
