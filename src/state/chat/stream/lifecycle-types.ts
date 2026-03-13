import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { AgentType } from "@/services/models/index.ts";
import type { AgentLifecycleViolationCode } from "@/lib/ui/agent-lifecycle-ledger.ts";
import type { NormalizedTodoItem } from "@/lib/ui/task-status.ts";
import type { SessionLoopFinishReason } from "@/lib/ui/stream-continuation.ts";
import type { ChatMessage, StreamingMeta } from "@/state/chat/types.ts";
import type { ParallelAgent } from "@/components/parallel-agents-tree.tsx";
import type { StreamRunHandle, StreamRunResult } from "@/state/runtime/stream-run-runtime.ts";
import type { StreamMessageOptions } from "@/commands/tui/registry.ts";

export interface UseChatStreamLifecycleArgs {
  activeStreamRunIdRef: MutableRefObject<number | null>;
  agentType?: AgentType;
  awaitedStreamRunIdsRef: MutableRefObject<Set<string>>;
  bindTrackedRunToMessage: (runId: string | null | undefined, messageId: string) => void;
  clearDeferredCompletion: () => void;
  continueAssistantStreamInPlaceRef: MutableRefObject<((messageId: string, content: string) => void) | null>;
  continueQueuedConversationRef: MutableRefObject<() => void>;
  currentModelRef: MutableRefObject<string>;
  deferredCompleteTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  finalizeThinkingSourceTracking: (options?: {
    preserveStreamingMeta?: boolean;
  }) => void;
  getActiveStreamRunId: () => string | null;
  hasRunningToolRef: MutableRefObject<boolean>;
  isAgentOnlyStreamRef: MutableRefObject<boolean>;
  isStreamingRef: MutableRefObject<boolean>;
  lastStreamingContentRef: MutableRefObject<string>;
  lastTurnFinishReasonRef: MutableRefObject<SessionLoopFinishReason | null>;
  nextRunIdFloorRef: MutableRefObject<number | null>;
  onStreamMessage?: (
    content: string,
    options?: StreamMessageOptions,
  ) => void | Promise<void>;
  parallelAgentsRef: MutableRefObject<ParallelAgent[]>;
  pendingCompleteRef: MutableRefObject<(() => void) | null>;
  resetConsumers: () => void;
  resetTodoItemsForNewStream: () => void;
  resetThinkingSourceTracking: () => void;
  resolveTrackedRun: (
    action: "complete" | "interrupt" | "fail",
    overrides?: Partial<StreamRunResult>,
    options?: { runId?: string | null; clearActive?: boolean },
  ) => StreamRunResult | null;
  runningAskQuestionToolIdsRef: MutableRefObject<Set<string>>;
  runningBlockingToolIdsRef: MutableRefObject<Set<string>>;
  sendBackgroundMessageToAgent: (content: string) => void;
  setBackgroundAgentMessageId: (messageId: string | null) => void;
  setIsStreaming: Dispatch<SetStateAction<boolean>>;
  setLastStreamedMessageId: (messageId: string | null) => void;
  setMessagesWindowed: (next: SetStateAction<ChatMessage[]>) => void;
  setParallelAgents: Dispatch<SetStateAction<ParallelAgent[]>>;
  setStreamingMessageId: (messageId: string | null) => void;
  setToolCompletionVersion: Dispatch<SetStateAction<number>>;
  shouldHideActiveStreamContent: () => boolean;
  startAssistantStreamRef: MutableRefObject<((content: string) => void) | null>;
  startTrackedAssistantRun: (
    options?: StreamMessageOptions,
  ) => StreamRunHandle;
  stopSharedStreamState: (options?: {
    preserveStreamingStart?: boolean;
    preserveStreamingMeta?: boolean;
    hasActiveBackgroundAgents?: boolean;
  }) => void;
  streamingMessageIdRef: MutableRefObject<string | null>;
  streamingMetaRef: MutableRefObject<StreamingMeta | null>;
  streamingStartRef: MutableRefObject<number | null>;
  todoItemsRef: MutableRefObject<NormalizedTodoItem[]>;
  toolMessageIdByIdRef: MutableRefObject<Map<string, string>>;
  toolNameByIdRef: MutableRefObject<Map<string, string>>;
  wasInterruptedRef: MutableRefObject<boolean>;
  activeBackgroundAgentCountRef: MutableRefObject<number>;
  setActiveBackgroundAgentCount: Dispatch<SetStateAction<number>>;
}

export interface UseChatStreamLifecycleResult {
  continueAssistantStreamInPlace: (
    messageId: string,
    content: string,
  ) => StreamRunHandle | null;
  handleStreamComplete: () => void;
  handleStreamStartupError: (error: unknown) => void;
  startAssistantStream: (
    content: string,
    options?: StreamMessageOptions,
  ) => StreamRunHandle | null;
  terminateAgentLifecycleContractViolation: (args: {
    code: AgentLifecycleViolationCode;
    eventType: "stream.agent.start" | "stream.agent.update" | "stream.agent.complete";
    agentId: string;
  }) => void;
}
