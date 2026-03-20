import type { Dispatch, RefObject, SetStateAction } from "react";
import type { OwnershipTracker } from "@/services/events/consumers/wire-consumers.ts";
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
  continueQueuedConversationRef: RefObject<() => void>;
  currentModelRef: RefObject<string>;
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
    activeBackgroundAgentCountRef: RefObject<number>;
    activeForegroundRunHandleIdRef: RefObject<string | null>;
    activeSkillSessionIdRef: RefObject<string | null>;
    activeStreamRunIdRef: RefObject<number | null>;
    agentLifecycleLedgerRef: RefObject<AgentLifecycleLedger>;
    agentMessageIdByIdRef: RefObject<Map<string, string>>;
    agentOrderingStateRef: RefObject<AgentOrderingState>;
    autoCompactionIndicatorRef: RefObject<AutoCompactionIndicatorState>;
    awaitedStreamRunIdsRef: RefObject<Set<string>>;
    backgroundAgentMessageIdRef: RefObject<string | null>;
    backgroundProgressSnapshotRef: RefObject<Map<string, { toolUses: number; currentTool?: string }>>;
    closedThinkingSourcesRef: RefObject<Set<string>>;
    completionOrderingEventByAgentRef: RefObject<Map<string, AgentOrderingEvent>>;
    continueAssistantStreamInPlaceRef: RefObject<((messageId: string, content: string) => void) | null>;
    deferredCompleteTimeoutRef: RefObject<ReturnType<typeof setTimeout> | null>;
    deferredPostCompleteDeltasByAgentRef: RefObject<Map<string, Array<{
      messageId: string;
      runId?: number;
      delta: string;
      completionSequence: number;
    }>>>;
    doneRenderedSequenceByAgentRef: RefObject<Map<string, number>>;
    hasRunningToolRef: RefObject<boolean>;
    isAgentOnlyStreamRef: RefObject<boolean>;
    isStreamingRef: RefObject<boolean>;
    lastStreamedMessageIdRef: RefObject<string | null>;
    lastStreamingContentRef: RefObject<string>;
    lastTurnFinishReasonRef: RefObject<SessionLoopFinishReason | null>;
    loadedSkillsRef: RefObject<Set<string>>;
    nextRunIdFloorRef: RefObject<number | null>;
    parallelAgentsRef: RefObject<ParallelAgent[]>;
    parallelInterruptHandlerRef: RefObject<(() => void) | null>;
    pendingCompleteRef: RefObject<(() => void) | null>;
    runningAskQuestionToolIdsRef: RefObject<Set<string>>;
    runningBlockingToolIdsRef: RefObject<Set<string>>;
    startAssistantStreamRef: RefObject<((content: string) => void) | null>;
    streamingMessageIdRef: RefObject<string | null>;
    streamingMetaRef: RefObject<StreamingMeta | null>;
    streamingStartRef: RefObject<number | null>;
    thinkingDropDiagnosticsRef: RefObject<ThinkingDropDiagnostics>;
    todoItemsRef: RefObject<NormalizedTodoItem[]>;
    toolMessageIdByIdRef: RefObject<Map<string, string>>;
    toolNameByIdRef: RefObject<Map<string, string>>;
    wasInterruptedRef: RefObject<boolean>;
    workflowSessionDirRef: RefObject<string | null>;
    workflowSessionIdRef: RefObject<string | null>;
    workflowTaskIdsRef: RefObject<Set<string>>;
  };
  actions: {
    appendSkillLoadIndicator: (skillLoad: MessageSkillLoad) => void;
    applyAutoCompactionIndicator: (next: AutoCompactionIndicatorState) => void;
    asSessionLoopFinishReason: (value: unknown) => SessionLoopFinishReason | null;
    clearDeferredCompletion: () => void;
    deleteAgentMessageBinding: (agentId: string) => void;
    finalizeThinkingSourceTracking: (options?: { preserveStreamingMeta?: boolean }) => void;
    getActiveStreamRunId: () => string | null;
    getOwnershipTracker: () => OwnershipTracker | null;
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
