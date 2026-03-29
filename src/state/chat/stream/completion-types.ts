import type { UseChatStreamLifecycleArgs } from "@/state/chat/stream/lifecycle-types.ts";

export type UseChatStreamCompletionArgs = Pick<
  UseChatStreamLifecycleArgs,
  | "activeBackgroundAgentCountRef"
  | "activeStreamRunIdRef"
  | "agentType"
  | "awaitedStreamRunIdsRef"
  | "continueAssistantStreamInPlaceRef"
  | "continueQueuedConversationRef"
  | "currentModelRef"
  | "deferredCompleteTimeoutRef"
  | "finalizeThinkingSourceTracking"
  | "getActiveStreamRunId"
  | "hasRunningToolRef"
  | "isAgentOnlyStreamRef"
  | "lastStreamingContentRef"
  | "parallelAgentsRef"
  | "pendingCompleteRef"
  | "resolveTrackedRun"
  | "runningAskQuestionToolIdsRef"
  | "runningBlockingToolIdsRef"
  | "sendBackgroundMessageToAgent"
  | "setActiveBackgroundAgentCount"
  | "setBackgroundAgentMessageId"
  | "setLastStreamedMessageId"
  | "setMessagesWindowed"
  | "setParallelAgents"
  | "setHasRunningTool"
  | "shouldHideActiveStreamContent"
  | "startAssistantStreamRef"
  | "stopSharedStreamState"
  | "streamingMessageIdRef"
  | "streamingMetaRef"
  | "streamingStartRef"
  | "todoItemsRef"
  | "toolMessageIdByIdRef"
  | "toolNameByIdRef"
  | "wasInterruptedRef"
>;

export interface StreamCompletionContext {
  durationMs: number | undefined;
  finalMeta: UseChatStreamCompletionArgs["streamingMetaRef"]["current"];
  hideCompletedMessage: boolean;
  messageId: string;
  streamRunId: string | null;
  suppressQueueContinuation: boolean;
}

export interface DeferredStreamCompletionContext extends StreamCompletionContext {
  handleStreamCompleteImpl: () => void;
}

export interface FinalizedStreamCompletionContext extends StreamCompletionContext {
  currentAgents: UseChatStreamCompletionArgs["parallelAgentsRef"]["current"];
}
