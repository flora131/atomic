import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { ParallelAgent } from "@/types/parallel-agents.ts";
import type { AgentOrderingEvent, AgentOrderingState } from "@/state/chat/shared/helpers/agent-ordering-contract.ts";
import type { AgentLifecycleLedger } from "@/state/chat/shared/helpers/agent-lifecycle-ledger.ts";
import type { ChatMessage, TaskItem } from "@/state/chat/types.ts";
import type { NormalizedTodoItem } from "@/state/parts/helpers/task-status.ts";

export interface DeferredPostCompleteDelta {
  messageId: string;
  runId?: number;
  delta: string;
  completionSequence: number;
}

export interface UseChatAgentProjectionArgs {
  activeBackgroundAgentCountRef: MutableRefObject<number>;
  activeStreamRunIdRef: MutableRefObject<number | null>;
  agentAnchorSyncVersion: number;
  agentLifecycleLedgerRef: MutableRefObject<AgentLifecycleLedger>;
  agentMessageIdByIdRef: MutableRefObject<Map<string, string>>;
  agentOrderingStateRef: MutableRefObject<AgentOrderingState>;
  agentType?: string;
  awaitedStreamRunIdsRef: MutableRefObject<Set<string>>;
  backgroundAgentMessageIdRef: MutableRefObject<string | null>;
  completionOrderingEventByAgentRef: MutableRefObject<Map<string, AgentOrderingEvent>>;
  continueAssistantStreamInPlaceRef: MutableRefObject<((messageId: string, content: string) => void) | null>;
  continueQueuedConversation: () => void;
  deferredCompleteTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  deferredPostCompleteDeltasByAgentRef: MutableRefObject<Map<string, DeferredPostCompleteDelta[]>>;
  deleteAgentMessageBinding: (agentId: string) => void;
  doneRenderedSequenceByAgentRef: MutableRefObject<Map<string, number>>;
  finalizeThinkingSourceTracking: (options?: { preserveStreamingMeta?: boolean }) => void;
  getActiveStreamRunId: () => string | null;
  hasRunningToolRef: MutableRefObject<boolean>;
  isAgentOnlyStreamRef: MutableRefObject<boolean>;
  isStreamingRef: MutableRefObject<boolean>;
  lastStreamedMessageIdRef: MutableRefObject<string | null>;
  lastStreamingContentRef: MutableRefObject<string>;
  messages: ChatMessage[];
  parallelAgents: ParallelAgent[];
  parallelAgentsRef: MutableRefObject<ParallelAgent[]>;
  pendingCompleteRef: MutableRefObject<(() => void) | null>;
  resolveTrackedRun: (
    action: "complete" | "interrupt" | "fail",
    overrides?: { content?: string; wasInterrupted?: boolean; error?: unknown; wasCancelled?: boolean },
    options?: { runId?: string | null; clearActive?: boolean },
  ) => unknown;
  sendBackgroundMessageToAgent: (content: string) => void;
  setActiveBackgroundAgentCount: Dispatch<SetStateAction<number>>;
  setBackgroundAgentMessageId: (messageId: string | null) => void;
  setMessagesWindowed: (next: React.SetStateAction<ChatMessage[]>) => void;
  setParallelAgents: React.Dispatch<React.SetStateAction<ParallelAgent[]>>;
  startAssistantStreamRef: MutableRefObject<((content: string) => void) | null>;
  stopSharedStreamState: (options?: {
    preserveStreamingStart?: boolean;
    preserveStreamingMeta?: boolean;
  }) => void;
  streamingMessageIdRef: MutableRefObject<string | null>;
  streamingStartRef: MutableRefObject<number | null>;
  todoItemsRef: MutableRefObject<NormalizedTodoItem[]>;
  toolCompletionVersion: number;
  workflowActiveRef: MutableRefObject<boolean>;
}

export type SetMessagesWindowed = UseChatAgentProjectionArgs["setMessagesWindowed"];
export type TaskItemsSnapshot = TaskItem[] | undefined;
