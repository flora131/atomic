import { type RefObject } from "react";
import { useStableCallback } from "@/hooks/index.ts";
import type { DeferredCommandMessage } from "@/state/chat/shared/types/command.ts";
import type { QueuedMessage } from "@/hooks/use-message-queue.ts";

// ============================================================================
// TYPES
// ============================================================================

export interface UseQueueDispatchArgs {
  dispatchDeferredCommandMessageRef: RefObject<(message: DeferredCommandMessage) => void>;
  dispatchQueuedMessageRef: RefObject<(queuedMessage: QueuedMessage) => void>;
  sendMessage: (content: string, options?: { skipUserMessage?: boolean }) => void;
}

export interface UseQueueDispatchResult {
  dispatchDeferredCommandMessage: (message: DeferredCommandMessage) => void;
  dispatchQueuedMessage: (queuedMessage: QueuedMessage) => void;
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Sub-hook managing deferred-command and queued-message dispatching.
 *
 * Uses `useStableCallback` so the dispatch functions always delegate to the
 * latest `sendMessage` without the manual ref-mirroring that the old code
 * required (`sendMessageRef.current = sendMessage`).
 */
export function useQueueDispatch({
  dispatchDeferredCommandMessageRef,
  dispatchQueuedMessageRef,
  sendMessage,
}: UseQueueDispatchArgs): UseQueueDispatchResult {
  const dispatchDeferredCommandMessage = useStableCallback((message: DeferredCommandMessage) => {
    sendMessage(
      message.content,
      message.skipUserMessage ? { skipUserMessage: true } : undefined,
    );
  });

  const dispatchQueuedMessage = useStableCallback((queuedMessage: QueuedMessage) => {
    sendMessage(
      queuedMessage.content,
      queuedMessage.skipUserMessage ? { skipUserMessage: true } : undefined,
    );
  });

  // Assign to refs so external consumers (e.g. message-queue continuation) can invoke them.
  dispatchQueuedMessageRef.current = dispatchQueuedMessage;
  dispatchDeferredCommandMessageRef.current = dispatchDeferredCommandMessage;

  return { dispatchDeferredCommandMessage, dispatchQueuedMessage };
}
