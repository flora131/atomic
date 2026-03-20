import type { RefObject } from "react";
import type { ChatMessage, StreamingMeta, TaskItem } from "@/state/chat/shared/types/index.ts";
import type { ParallelAgent } from "@/types/parallel-agents.ts";

interface InterruptSharedStateArgs {
  clearDeferredCompletion: () => void;
  continueQueuedConversation: () => void;
  finalizeTaskItemsOnInterrupt: () => TaskItem[] | undefined;
  parallelAgentsRef: RefObject<ParallelAgent[]>;
  separateAndInterruptAgents: (agents: ParallelAgent[]) => {
    interruptedAgents: ParallelAgent[];
    remainingLiveAgents: ParallelAgent[];
  };
  setMessagesWindowed: (updater: (messages: ChatMessage[]) => ChatMessage[]) => void;
  setParallelAgents: (agents: ParallelAgent[]) => void;
  stopSharedStreamState: () => void;
  streamingMessageIdRef: RefObject<string | null>;
  wasInterruptedRef: RefObject<boolean>;
}

interface InterruptForegroundAgentsArgs extends InterruptSharedStateArgs {
  finalizeThinkingSourceTracking?: () => void;
  updateInterruptedMessage: (message: ChatMessage, context: {
    interruptedAgents: ParallelAgent[];
    interruptedTaskItems: TaskItem[] | undefined;
  }) => ChatMessage;
}

interface InterruptStreamingArgs extends InterruptSharedStateArgs {
  afterStateReset: () => void;
  awaitedStreamRunIdsRef: RefObject<Set<string>>;
  finalizeThinkingSourceTracking: () => void;
  getActiveStreamRunId: () => string | null;
  lastStreamingContentRef: RefObject<string>;
  onResolveOverrides?: () => { wasCancelled?: boolean };
  resolveTrackedRun: (
    action: "interrupt",
    overrides?: { content?: string; wasInterrupted?: boolean; wasCancelled?: boolean },
    options?: { runId?: string | null; clearActive?: boolean },
  ) => unknown;
  shouldContinueAfterInterrupt: boolean;
  shouldHideActiveStreamContent: () => boolean;
  updateInterruptedMessage: (message: ChatMessage, context: {
    durationMs?: number;
    finalMeta: StreamingMeta | null;
    interruptedAgents: ParallelAgent[];
    interruptedTaskItems: TaskItem[] | undefined;
  }) => ChatMessage;
  updateInterruptedMessageVisibility?: boolean;
}

function replaceMessage(
  messages: ChatMessage[],
  messageId: string,
  updater: (message: ChatMessage) => ChatMessage,
): ChatMessage[] {
  return messages.map((message) => (message.id === messageId ? updater(message) : message));
}

export function interruptForegroundAgents({
  clearDeferredCompletion,
  continueQueuedConversation,
  finalizeTaskItemsOnInterrupt,
  finalizeThinkingSourceTracking,
  parallelAgentsRef,
  separateAndInterruptAgents,
  setMessagesWindowed,
  setParallelAgents,
  stopSharedStreamState,
  streamingMessageIdRef,
  updateInterruptedMessage,
  wasInterruptedRef,
}: InterruptForegroundAgentsArgs): void {
  const currentAgents = parallelAgentsRef.current;
  const { interruptedAgents, remainingLiveAgents } = separateAndInterruptAgents(currentAgents);
  const interruptedTaskItems = finalizeTaskItemsOnInterrupt();
  const interruptedId = streamingMessageIdRef.current;

  if (interruptedId) {
    setMessagesWindowed((previousMessages) =>
      replaceMessage(previousMessages, interruptedId, (message) =>
        updateInterruptedMessage(message, { interruptedAgents, interruptedTaskItems })),
    );
  }

  parallelAgentsRef.current = remainingLiveAgents;
  setParallelAgents(remainingLiveAgents);
  clearDeferredCompletion();
  wasInterruptedRef.current = false;
  stopSharedStreamState();
  finalizeThinkingSourceTracking?.();
  continueQueuedConversation();
}

export function interruptStreaming({
  afterStateReset,
  awaitedStreamRunIdsRef,
  clearDeferredCompletion,
  continueQueuedConversation,
  finalizeTaskItemsOnInterrupt,
  finalizeThinkingSourceTracking,
  getActiveStreamRunId,
  lastStreamingContentRef,
  onResolveOverrides,
  parallelAgentsRef,
  resolveTrackedRun,
  separateAndInterruptAgents,
  setMessagesWindowed,
  setParallelAgents,
  shouldContinueAfterInterrupt,
  shouldHideActiveStreamContent,
  stopSharedStreamState,
  streamingMessageIdRef,
  streamingMetaRef,
  streamingStartRef,
  updateInterruptedMessage,
  wasInterruptedRef,
}: InterruptStreamingArgs & {
  streamingMetaRef: RefObject<StreamingMeta | null>;
  streamingStartRef: RefObject<number | null>;
}): { suppressQueueContinuation: boolean } {
  clearDeferredCompletion();

  const currentAgents = parallelAgentsRef.current;
  const { interruptedAgents, remainingLiveAgents } = separateAndInterruptAgents(currentAgents);
  parallelAgentsRef.current = remainingLiveAgents;
  setParallelAgents(remainingLiveAgents);

  const interruptedTaskItems = finalizeTaskItemsOnInterrupt();
  const interruptedId = streamingMessageIdRef.current;
  const durationMs = streamingStartRef.current
    ? Date.now() - streamingStartRef.current
    : undefined;
  const finalMeta = streamingMetaRef.current;

  if (interruptedId) {
    setMessagesWindowed((previousMessages) =>
      replaceMessage(previousMessages, interruptedId, (message) =>
        updateInterruptedMessage(message, {
          durationMs,
          finalMeta,
          interruptedAgents,
          interruptedTaskItems,
        })),
    );
  }

  wasInterruptedRef.current = false;
  stopSharedStreamState();
  finalizeThinkingSourceTracking();
  afterStateReset();

  const interruptedRunId = getActiveStreamRunId();
  const hideInterruptedMessage = shouldHideActiveStreamContent();
  const suppressQueueContinuation =
    interruptedRunId !== null && awaitedStreamRunIdsRef.current.has(interruptedRunId);
  resolveTrackedRun("interrupt", {
    content: lastStreamingContentRef.current,
    wasInterrupted: true,
    ...onResolveOverrides?.(),
  }, { runId: interruptedRunId });

  if (hideInterruptedMessage && interruptedId) {
    setMessagesWindowed((previousMessages) =>
      previousMessages.filter((message) => message.id !== interruptedId),
    );
  }

  if (shouldContinueAfterInterrupt && !suppressQueueContinuation) {
    continueQueuedConversation();
  }

  return { suppressQueueContinuation };
}
