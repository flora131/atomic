import type { Dispatch, RefObject, SetStateAction } from "react";
import type { BatchDispatcher } from "@/services/events/batch-dispatcher.ts";
import type { AskUserQuestionEventData } from "@/services/workflows/graph/index.ts";
import type { ParallelAgent } from "@/types/parallel-agents.ts";
import type { ChatMessage, MessageSkillLoad, StreamingMeta } from "@/state/chat/shared/types/index.ts";
import type { AgentLifecycleLedger, AgentLifecycleViolationCode } from "@/state/chat/shared/helpers/agent-lifecycle-ledger.ts";
import type { AgentOrderingEvent, AgentOrderingState } from "@/state/chat/shared/helpers/agent-ordering-contract.ts";
import type { SessionLoopFinishReason } from "@/state/chat/shared/helpers/stream-continuation.ts";
import type { DeferredPostCompleteDelta } from "@/state/chat/shared/types/stream-runtime.ts";

export interface UseStreamSubscriptionsArgs {
  activeSkillSessionIdRef: RefObject<string | null>;
  activeStreamRunIdRef: RefObject<number | null>;
  agentLifecycleLedgerRef: RefObject<AgentLifecycleLedger>;
  agentMessageIdByIdRef: RefObject<Map<string, string>>;
  agentOrderingStateRef: RefObject<AgentOrderingState>;
  agentType?: string;
  appendSkillLoadIndicator: (skillLoad: MessageSkillLoad) => void;
  applyAutoCompactionIndicator: (next: {
    status: "idle" | "running" | "completed" | "error";
    errorMessage?: string;
  }) => void;
  asSessionLoopFinishReason: (value: unknown) => SessionLoopFinishReason | null;
  backgroundAgentMessageIdRef: RefObject<string | null>;
  backgroundProgressSnapshotRef: RefObject<Map<string, { toolUses: number; currentTool?: string }>>;
  batchDispatcher: BatchDispatcher;
  completionOrderingEventByAgentRef: RefObject<Map<string, AgentOrderingEvent>>;
  deferredPostCompleteDeltasByAgentRef: RefObject<Map<string, DeferredPostCompleteDelta[]>>;
  doneRenderedSequenceByAgentRef: RefObject<Map<string, number>>;
  handleAskUserQuestion: (eventData: AskUserQuestionEventData) => void;
  handlePermissionRequest: (
    requestId: string,
    toolName: string,
    question: string,
    options: Array<{ label: string; value: string; description?: string }>,
    respond: (answer: string | string[]) => void,
    header?: string,
    toolCallId?: string,
  ) => void;
  handleStreamComplete: () => void;
  handleStreamStartupError: (error: unknown) => void;
  hasPendingTaskResultContract: () => boolean;
  hasRunningToolRef: RefObject<boolean>;
  isStreamingRef: RefObject<boolean>;
  lastStreamedMessageIdRef: RefObject<string | null>;
  lastTurnFinishReasonRef: RefObject<SessionLoopFinishReason | null>;
  loadedSkillsRef: RefObject<Set<string>>;
  nextRunIdFloorRef: RefObject<number | null>;
  parallelAgentsRef: RefObject<ParallelAgent[]>;
  resetLoadedSkillTracking: () => void;
  resolveAgentScopedMessageId: (agentId?: string) => string | null;
  runningAskQuestionToolIdsRef: RefObject<Set<string>>;
  runningBlockingToolIdsRef: RefObject<Set<string>>;
  sendBackgroundMessageToAgent: (content: string) => void;
  setAgentMessageBinding: (agentId: string, messageId: string) => void;
  setIsStreaming: Dispatch<SetStateAction<boolean>>;
  setMessagesWindowed: (next: SetStateAction<ChatMessage[]>) => void;
  setParallelAgents: Dispatch<SetStateAction<ParallelAgent[]>>;
  setStreamingMeta: Dispatch<SetStateAction<StreamingMeta | null>>;
  setToolCompletionVersion: Dispatch<SetStateAction<number>>;
  streamingMessageIdRef: RefObject<string | null>;
  streamingMetaRef: RefObject<StreamingMeta | null>;
  streamingStartRef: RefObject<number | null>;
  deferredCompleteTimeoutRef: RefObject<ReturnType<typeof setTimeout> | null>;
  pendingCompleteRef: RefObject<(() => void) | null>;
  terminateAgentLifecycleContractViolation: (args: {
    code: AgentLifecycleViolationCode;
    eventType: "stream.agent.start" | "stream.agent.update" | "stream.agent.complete";
    agentId: string;
  }) => void;
  toolMessageIdByIdRef: RefObject<Map<string, string>>;
  toolNameByIdRef: RefObject<Map<string, string>>;
  activeBackgroundAgentCountRef: RefObject<number>;
  setActiveBackgroundAgentCount: Dispatch<SetStateAction<number>>;
}
