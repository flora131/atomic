import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { BatchDispatcher } from "@/services/events/batch-dispatcher.ts";
import type { AskUserQuestionEventData } from "@/services/workflows/graph/index.ts";
import type { ParallelAgent } from "@/types/parallel-agents.ts";
import type { ChatMessage, MessageSkillLoad, StreamingMeta } from "@/state/chat/types.ts";
import type { AgentLifecycleLedger, AgentLifecycleViolationCode } from "@/state/chat/shared/helpers/agent-lifecycle-ledger.ts";
import type { AgentOrderingEvent, AgentOrderingState } from "@/state/chat/shared/helpers/agent-ordering-contract.ts";
import type { SessionLoopFinishReason } from "@/state/chat/shared/helpers/stream-continuation.ts";
import type { DeferredPostCompleteDelta } from "@/state/chat/shared/types/stream-runtime.ts";

export interface UseStreamSubscriptionsArgs {
  activeSkillSessionIdRef: MutableRefObject<string | null>;
  activeStreamRunIdRef: MutableRefObject<number | null>;
  agentLifecycleLedgerRef: MutableRefObject<AgentLifecycleLedger>;
  agentMessageIdByIdRef: MutableRefObject<Map<string, string>>;
  agentOrderingStateRef: MutableRefObject<AgentOrderingState>;
  agentType?: string;
  appendSkillLoadIndicator: (skillLoad: MessageSkillLoad) => void;
  applyAutoCompactionIndicator: (next: {
    status: "idle" | "running" | "completed" | "error";
    errorMessage?: string;
  }) => void;
  asSessionLoopFinishReason: (value: unknown) => SessionLoopFinishReason | null;
  backgroundAgentMessageIdRef: MutableRefObject<string | null>;
  backgroundProgressSnapshotRef: MutableRefObject<Map<string, { toolUses: number; currentTool?: string }>>;
  batchDispatcher: BatchDispatcher;
  completionOrderingEventByAgentRef: MutableRefObject<Map<string, AgentOrderingEvent>>;
  deferredPostCompleteDeltasByAgentRef: MutableRefObject<Map<string, DeferredPostCompleteDelta[]>>;
  doneRenderedSequenceByAgentRef: MutableRefObject<Map<string, number>>;
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
  hasRunningToolRef: MutableRefObject<boolean>;
  isStreamingRef: MutableRefObject<boolean>;
  lastStreamedMessageIdRef: MutableRefObject<string | null>;
  lastTurnFinishReasonRef: MutableRefObject<SessionLoopFinishReason | null>;
  loadedSkillsRef: MutableRefObject<Set<string>>;
  nextRunIdFloorRef: MutableRefObject<number | null>;
  parallelAgentsRef: MutableRefObject<ParallelAgent[]>;
  resetLoadedSkillTracking: () => void;
  resolveAgentScopedMessageId: (agentId?: string) => string | null;
  runningAskQuestionToolIdsRef: MutableRefObject<Set<string>>;
  runningBlockingToolIdsRef: MutableRefObject<Set<string>>;
  sendBackgroundMessageToAgent: (content: string) => void;
  setAgentMessageBinding: (agentId: string, messageId: string) => void;
  setIsStreaming: Dispatch<SetStateAction<boolean>>;
  setMessagesWindowed: (next: SetStateAction<ChatMessage[]>) => void;
  setParallelAgents: Dispatch<SetStateAction<ParallelAgent[]>>;
  setStreamingMeta: Dispatch<SetStateAction<StreamingMeta | null>>;
  setToolCompletionVersion: Dispatch<SetStateAction<number>>;
  streamingMessageIdRef: MutableRefObject<string | null>;
  streamingMetaRef: MutableRefObject<StreamingMeta | null>;
  streamingStartRef: MutableRefObject<number | null>;
  deferredCompleteTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  pendingCompleteRef: MutableRefObject<(() => void) | null>;
  terminateAgentLifecycleContractViolation: (args: {
    code: AgentLifecycleViolationCode;
    eventType: "stream.agent.start" | "stream.agent.update" | "stream.agent.complete";
    agentId: string;
  }) => void;
  toolMessageIdByIdRef: MutableRefObject<Map<string, string>>;
  toolNameByIdRef: MutableRefObject<Map<string, string>>;
  activeBackgroundAgentCountRef: MutableRefObject<number>;
  setActiveBackgroundAgentCount: Dispatch<SetStateAction<number>>;
}
