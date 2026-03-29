import type { Dispatch, RefObject, SetStateAction } from "react";
import type { ParallelAgent } from "@/types/parallel-agents.ts";
import type { AgentOrderingEvent, AgentOrderingState } from "@/state/chat/shared/helpers/agent-ordering-contract.ts";
import type { AgentLifecycleLedger } from "@/state/chat/shared/helpers/agent-lifecycle-ledger.ts";
import type { ChatMessage, TaskItem } from "@/state/chat/shared/types/index.ts";
import type { NormalizedTodoItem } from "@/state/parts/helpers/task-status.ts";
import type { DeferredPostCompleteDelta } from "@/state/chat/shared/types/stream-runtime.ts";

export interface UseChatAgentProjectionArgs {
  activeBackgroundAgentCountRef: RefObject<number>;
  activeStreamRunIdRef: RefObject<number | null>;
  agentMessageBindings: ReadonlyMap<string, string>;
  agentLifecycleLedgerRef: RefObject<AgentLifecycleLedger>;
  agentMessageIdByIdRef: RefObject<Map<string, string>>;
  agentOrderingStateRef: RefObject<AgentOrderingState>;
  agentType?: string;
  awaitedStreamRunIdsRef: RefObject<Set<string>>;
  backgroundAgentMessageIdRef: RefObject<string | null>;
  completionOrderingEventByAgentRef: RefObject<Map<string, AgentOrderingEvent>>;
  continueAssistantStreamInPlaceRef: RefObject<((messageId: string, content: string) => void) | null>;
  continueQueuedConversation: () => void;
  deferredCompleteTimeoutRef: RefObject<ReturnType<typeof setTimeout> | null>;
  deferredPostCompleteDeltasByAgentRef: RefObject<Map<string, DeferredPostCompleteDelta[]>>;
  deleteAgentMessageBinding: (agentId: string) => void;
  doneRenderedSequenceByAgentRef: RefObject<Map<string, number>>;
  finalizeThinkingSourceTracking: (options?: { preserveStreamingMeta?: boolean }) => void;
  getActiveStreamRunId: () => string | null;
  hasRunningToolRef: RefObject<boolean>;
  isAgentOnlyStreamRef: RefObject<boolean>;
  isStreamingRef: RefObject<boolean>;
  lastStreamedMessageIdRef: RefObject<string | null>;
  lastStreamingContentRef: RefObject<string>;
  messages: ChatMessage[];
  parallelAgents: ParallelAgent[];
  parallelAgentsRef: RefObject<ParallelAgent[]>;
  pendingCompleteRef: RefObject<(() => void) | null>;
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
  startAssistantStreamRef: RefObject<((content: string) => void) | null>;
  stopSharedStreamState: (options?: {
    preserveStreamingStart?: boolean;
    preserveStreamingMeta?: boolean;
  }) => void;
  streamingMessageIdRef: RefObject<string | null>;
  streamingStartRef: RefObject<number | null>;
  todoItemsRef: RefObject<NormalizedTodoItem[]>;
  hasRunningTool: boolean;
  streamingMessageId: string | null;
  lastStreamedMessageId: string | null;
  backgroundAgentMessageId: string | null;
  workflowActiveRef: RefObject<boolean>;
}

export type SetMessagesWindowed = UseChatAgentProjectionArgs["setMessagesWindowed"];
export type TaskItemsSnapshot = TaskItem[] | undefined;
