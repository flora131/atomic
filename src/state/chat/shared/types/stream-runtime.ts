import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { CorrelationService } from "@/services/events/consumers/correlation-service.ts";
import type { Session } from "@/services/agents/types.ts";
import type { AgentType } from "@/services/models/index.ts";
import type { AgentLifecycleLedger, AgentLifecycleViolationCode } from "@/state/chat/shared/helpers/agent-lifecycle-ledger.ts";
import type { AgentOrderingEvent, AgentOrderingState } from "@/state/chat/shared/helpers/agent-ordering-contract.ts";
import type { AutoCompactionIndicatorState } from "@/state/chat/shared/helpers/auto-compaction-lifecycle.ts";
import type { SessionLoopFinishReason } from "@/state/chat/shared/helpers/stream-continuation.ts";
import type { NormalizedTodoItem } from "@/state/parts/helpers/task-status.ts";
import type { StreamRunHandle, StreamRunResult } from "@/state/runtime/stream-run-runtime.ts";
import type {
  ChatMessage,
  MessageSkillLoad,
  StreamingMeta,
  ThinkingDropDiagnostics,
} from "@/state/chat/shared/types/message.ts";
import type { ParallelAgent } from "@/types/parallel-agents.ts";

export interface DeferredPostCompleteDelta {
  messageId: string;
  runId?: number;
  delta: string;
  completionSequence: number;
}

export interface UseChatStreamRuntimeArgs {
  agentType?: AgentType;
  appendCompactionSummaryAndSync: (summary: string) => void;
  continueQueuedConversationRef: MutableRefObject<() => void>;
  currentModelRef: MutableRefObject<string>;
  getSession?: () => Session | null;
  messages: ChatMessage[];
  onStreamMessage?: (
    content: string,
    options?: import("@/commands/tui/registry.ts").StreamMessageOptions,
  ) => void | Promise<void>;
  setIsStreaming: Dispatch<SetStateAction<boolean>>;
  setMessagesWindowed: (next: SetStateAction<ChatMessage[]>) => void;
  setStreamingMeta: Dispatch<SetStateAction<StreamingMeta | null>>;
}

export interface UseChatStreamRuntimeResult {
  state: {
    agentAnchorSyncVersion: number;
    compactionSummary: string | null;
    parallelAgents: ParallelAgent[];
    showCompactionHistory: boolean;
    streamingElapsedMs: number;
    todoItems: NormalizedTodoItem[];
    toolCompletionVersion: number;
    activeBackgroundAgentCount: number;
    workflowSessionDir: string | null;
    workflowSessionId: string | null;
  };
  setters: {
    setCompactionSummary: Dispatch<SetStateAction<string | null>>;
    setIsAutoCompacting: Dispatch<SetStateAction<boolean>>;
    setParallelAgents: Dispatch<SetStateAction<ParallelAgent[]>>;
    setShowCompactionHistory: Dispatch<SetStateAction<boolean>>;
    setTodoItems: Dispatch<SetStateAction<NormalizedTodoItem[]>>;
    setToolCompletionVersion: Dispatch<SetStateAction<number>>;
    setActiveBackgroundAgentCount: Dispatch<SetStateAction<number>>;
    setWorkflowSessionDir: Dispatch<SetStateAction<string | null>>;
    setWorkflowSessionId: Dispatch<SetStateAction<string | null>>;
  };
  refs: {
    activeBackgroundAgentCountRef: MutableRefObject<number>;
    activeForegroundRunHandleIdRef: MutableRefObject<string | null>;
    activeSkillSessionIdRef: MutableRefObject<string | null>;
    activeStreamRunIdRef: MutableRefObject<number | null>;
    agentLifecycleLedgerRef: MutableRefObject<AgentLifecycleLedger>;
    agentMessageIdByIdRef: MutableRefObject<Map<string, string>>;
    agentOrderingStateRef: MutableRefObject<AgentOrderingState>;
    autoCompactionIndicatorRef: MutableRefObject<AutoCompactionIndicatorState>;
    awaitedStreamRunIdsRef: MutableRefObject<Set<string>>;
    backgroundAgentMessageIdRef: MutableRefObject<string | null>;
    backgroundProgressSnapshotRef: MutableRefObject<Map<string, { toolUses: number; currentTool?: string }>>;
    closedThinkingSourcesRef: MutableRefObject<Set<string>>;
    completionOrderingEventByAgentRef: MutableRefObject<Map<string, AgentOrderingEvent>>;
    continueAssistantStreamInPlaceRef: MutableRefObject<((messageId: string, content: string) => void) | null>;
    deferredCompleteTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
    deferredPostCompleteDeltasByAgentRef: MutableRefObject<Map<string, Array<{
      messageId: string;
      runId?: number;
      delta: string;
      completionSequence: number;
    }>>>;
    doneRenderedSequenceByAgentRef: MutableRefObject<Map<string, number>>;
    hasRunningToolRef: MutableRefObject<boolean>;
    isAgentOnlyStreamRef: MutableRefObject<boolean>;
    isStreamingRef: MutableRefObject<boolean>;
    lastStreamedMessageIdRef: MutableRefObject<string | null>;
    lastStreamingContentRef: MutableRefObject<string>;
    lastTurnFinishReasonRef: MutableRefObject<SessionLoopFinishReason | null>;
    loadedSkillsRef: MutableRefObject<Set<string>>;
    nextRunIdFloorRef: MutableRefObject<number | null>;
    parallelAgentsRef: MutableRefObject<ParallelAgent[]>;
    parallelInterruptHandlerRef: MutableRefObject<(() => void) | null>;
    pendingCompleteRef: MutableRefObject<(() => void) | null>;
    runningAskQuestionToolIdsRef: MutableRefObject<Set<string>>;
    runningBlockingToolIdsRef: MutableRefObject<Set<string>>;
    startAssistantStreamRef: MutableRefObject<((content: string) => void) | null>;
    streamingMessageIdRef: MutableRefObject<string | null>;
    streamingMetaRef: MutableRefObject<StreamingMeta | null>;
    streamingStartRef: MutableRefObject<number | null>;
    thinkingDropDiagnosticsRef: MutableRefObject<ThinkingDropDiagnostics>;
    todoItemsRef: MutableRefObject<NormalizedTodoItem[]>;
    toolMessageIdByIdRef: MutableRefObject<Map<string, string>>;
    toolNameByIdRef: MutableRefObject<Map<string, string>>;
    wasInterruptedRef: MutableRefObject<boolean>;
    workflowSessionDirRef: MutableRefObject<string | null>;
    workflowSessionIdRef: MutableRefObject<string | null>;
    workflowTaskIdsRef: MutableRefObject<Set<string>>;
  };
  actions: {
    appendSkillLoadIndicator: (skillLoad: MessageSkillLoad) => void;
    applyAutoCompactionIndicator: (next: AutoCompactionIndicatorState) => void;
    asSessionLoopFinishReason: (value: unknown) => SessionLoopFinishReason | null;
    clearDeferredCompletion: () => void;
    deleteAgentMessageBinding: (agentId: string) => void;
    finalizeThinkingSourceTracking: (options?: { preserveStreamingMeta?: boolean }) => void;
    getActiveStreamRunId: () => string | null;
    getCorrelationService: () => CorrelationService | null;
    handleStreamComplete: () => void;
    handleStreamStartupError: (error: unknown) => void;
    hasPendingTaskResultContract: () => boolean;
    isWorkflowTaskUpdate: (
      todos: NormalizedTodoItem[],
      previousTodos?: readonly NormalizedTodoItem[],
    ) => boolean;
    resetConsumers: () => void;
    resetLoadedSkillTracking: (options?: { resetSessionBinding?: boolean }) => void;
    resolveAgentScopedMessageId: (agentId?: string) => string | null;
    resolveTrackedRun: (
      action: "complete" | "interrupt" | "fail",
      overrides?: Partial<StreamRunResult>,
      options?: { runId?: string | null; clearActive?: boolean },
    ) => StreamRunResult | null;
    separateAndInterruptAgents: (agents: ParallelAgent[]) => {
      interruptedAgents: ParallelAgent[];
      remainingLiveAgents: ParallelAgent[];
    };
    sendBackgroundMessageToAgent: (content: string) => void;
    setAgentMessageBinding: (agentId: string, messageId: string) => void;
    setBackgroundAgentMessageId: (messageId: string | null) => void;
    setLastStreamedMessageId: (messageId: string | null) => void;
    setStreamingMessageId: (messageId: string | null) => void;
    shouldHideActiveStreamContent: () => boolean;
    startAssistantStream: (
      content: string,
      options?: import("@/commands/tui/registry.ts").StreamMessageOptions,
    ) => StreamRunHandle | null;
    stopSharedStreamState: (options?: {
      preserveStreamingStart?: boolean;
      preserveStreamingMeta?: boolean;
      hasActiveBackgroundAgents?: boolean;
    }) => void;
    terminateAgentLifecycleContractViolation: (args: {
      code: AgentLifecycleViolationCode;
      eventType: "stream.agent.start" | "stream.agent.update" | "stream.agent.complete";
      agentId: string;
    }) => void;
    trackAwaitedRun: (handle: StreamRunHandle | null) => StreamRunHandle | null;
  };
}
