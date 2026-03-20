import type { Dispatch, RefObject, SetStateAction } from "react";
import type { AgentType } from "@/services/models/index.ts";
import type { NormalizedTodoItem } from "@/state/parts/helpers/task-status.ts";
import type { SessionLoopFinishReason } from "@/state/chat/shared/helpers/stream-continuation.ts";
import type { ChatMessage, StreamingMeta } from "@/state/chat/shared/types/index.ts";
import type { ParallelAgent } from "@/types/parallel-agents.ts";
import type { StreamRunHandle, StreamRunResult } from "@/state/runtime/stream-run-runtime.ts";
import type { StreamMessageOptions } from "@/commands/tui/registry.ts";

export interface UseChatStreamLifecycleArgs {
  activeStreamRunIdRef: RefObject<number | null>;
  agentType?: AgentType;
  awaitedStreamRunIdsRef: RefObject<Set<string>>;
  bindTrackedRunToMessage: (runId: string | null | undefined, messageId: string) => void;
  clearDeferredCompletion: () => void;
  continueAssistantStreamInPlaceRef: RefObject<((messageId: string, content: string) => void) | null>;
  continueQueuedConversationRef: RefObject<() => void>;
  currentModelRef: RefObject<string>;
  deferredCompleteTimeoutRef: RefObject<ReturnType<typeof setTimeout> | null>;
  finalizeThinkingSourceTracking: (options?: {
    preserveStreamingMeta?: boolean;
  }) => void;
  getActiveStreamRunId: () => string | null;
  hasRunningToolRef: RefObject<boolean>;
  isAgentOnlyStreamRef: RefObject<boolean>;
  isStreamingRef: RefObject<boolean>;
  lastStreamingContentRef: RefObject<string>;
  lastTurnFinishReasonRef: RefObject<SessionLoopFinishReason | null>;
  nextRunIdFloorRef: RefObject<number | null>;
  onStreamMessage?: (
    content: string,
    options?: StreamMessageOptions,
  ) => void | Promise<void>;
  parallelAgentsRef: RefObject<ParallelAgent[]>;
  pendingCompleteRef: RefObject<(() => void) | null>;
  resetConsumers: () => void;
  resetTodoItemsForNewStream: () => void;
  resetThinkingSourceTracking: () => void;
  resolveTrackedRun: (
    action: "complete" | "interrupt" | "fail",
    overrides?: Partial<StreamRunResult>,
    options?: { runId?: string | null; clearActive?: boolean },
  ) => StreamRunResult | null;
  runningAskQuestionToolIdsRef: RefObject<Set<string>>;
  runningBlockingToolIdsRef: RefObject<Set<string>>;
  sendBackgroundMessageToAgent: (content: string) => void;
  setBackgroundAgentMessageId: (messageId: string | null) => void;
  setIsStreaming: Dispatch<SetStateAction<boolean>>;
  setLastStreamedMessageId: (messageId: string | null) => void;
  setMessagesWindowed: (next: SetStateAction<ChatMessage[]>) => void;
  setParallelAgents: Dispatch<SetStateAction<ParallelAgent[]>>;
  setStreamingMessageId: (messageId: string | null) => void;
  setToolCompletionVersion: Dispatch<SetStateAction<number>>;
  shouldHideActiveStreamContent: () => boolean;
  startAssistantStreamRef: RefObject<((content: string) => void) | null>;
  startTrackedAssistantRun: (
    options?: StreamMessageOptions,
  ) => StreamRunHandle;
  stopSharedStreamState: (options?: {
    preserveStreamingStart?: boolean;
    preserveStreamingMeta?: boolean;
    hasActiveBackgroundAgents?: boolean;
  }) => void;
  streamingMessageIdRef: RefObject<string | null>;
  streamingMetaRef: RefObject<StreamingMeta | null>;
  streamingStartRef: RefObject<number | null>;
  todoItemsRef: RefObject<NormalizedTodoItem[]>;
  toolMessageIdByIdRef: RefObject<Map<string, string>>;
  toolNameByIdRef: RefObject<Map<string, string>>;
  wasInterruptedRef: RefObject<boolean>;
  activeBackgroundAgentCountRef: RefObject<number>;
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
}
