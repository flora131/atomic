import { useCallback, useEffect } from "react";
import type { RefObject } from "react";
import type { Session } from "@/services/agents/types.ts";
import {
  shouldScheduleBackgroundUpdateFollowUpFlush,
  shouldStartBackgroundUpdateFlush,
} from "@/state/chat/shared/helpers/background-update-flush.ts";
import {
  appendSkillLoadToLatestAssistantMessage,
} from "@/state/chat/shared/helpers/index.ts";
import type { ChatMessage, MessageSkillLoad } from "@/state/chat/shared/types/index.ts";

interface UseChatBackgroundDispatchArgs {
  backgroundAgentSendChainRef: RefObject<Promise<void>>;
  backgroundUpdateFlushInFlightRef: RefObject<boolean>;
  getSession?: () => Session | null;
  isAgentOnlyStreamRef: RefObject<boolean>;
  isStreamingRef: RefObject<boolean>;
  pendingBackgroundUpdatesRef: RefObject<string[]>;
  setMessagesWindowed: (next: React.SetStateAction<ChatMessage[]>) => void;
}

export function useChatBackgroundDispatch({
  backgroundAgentSendChainRef,
  backgroundUpdateFlushInFlightRef,
  getSession,
  isAgentOnlyStreamRef,
  isStreamingRef,
  pendingBackgroundUpdatesRef,
  setMessagesWindowed,
}: UseChatBackgroundDispatchArgs) {
  const flushPendingBackgroundUpdatesToAgent = useCallback(() => {
    if (!shouldStartBackgroundUpdateFlush({
      hasFlushInFlight: backgroundUpdateFlushInFlightRef.current,
      isAgentOnlyStream: isAgentOnlyStreamRef.current,
      isStreaming: isStreamingRef.current,
      pendingUpdateCount: pendingBackgroundUpdatesRef.current.length,
    })) {
      return;
    }

    const session = getSession?.();
    if (!session?.send) return;

    const updates = pendingBackgroundUpdatesRef.current.splice(0);
    if (updates.length === 0) return;

    const payload = `[Background updates]\n\n${updates.join("\n\n")}`;
    let sendSucceeded = false;
    backgroundUpdateFlushInFlightRef.current = true;
    backgroundAgentSendChainRef.current = backgroundAgentSendChainRef.current
      .catch(() => undefined)
      .then(async () => {
        try {
          await session.send(payload);
          sendSucceeded = true;
        } catch (error) {
          pendingBackgroundUpdatesRef.current.unshift(...updates);
          console.debug("[background-update] failed to send to agent:", error);
        }
      })
      .finally(() => {
        backgroundUpdateFlushInFlightRef.current = false;
        if (shouldScheduleBackgroundUpdateFollowUpFlush({
          isAgentOnlyStream: isAgentOnlyStreamRef.current,
          sendSucceeded,
          isStreaming: isStreamingRef.current,
          pendingUpdateCount: pendingBackgroundUpdatesRef.current.length,
        })) {
          queueMicrotask(() => {
            flushPendingBackgroundUpdatesToAgent();
          });
        }
      });
  }, [
    backgroundAgentSendChainRef,
    backgroundUpdateFlushInFlightRef,
    getSession,
    isAgentOnlyStreamRef,
    isStreamingRef,
    pendingBackgroundUpdatesRef,
  ]);

  const appendSkillLoadIndicator = useCallback((skillLoad: MessageSkillLoad) => {
    setMessagesWindowed((prev) => appendSkillLoadToLatestAssistantMessage(prev, skillLoad));
  }, [setMessagesWindowed]);

  const sendBackgroundMessageToAgent = useCallback((content: string) => {
    const trimmed = content.trim();
    if (!trimmed) return;

    pendingBackgroundUpdatesRef.current.push(trimmed);
    flushPendingBackgroundUpdatesToAgent();
  }, [flushPendingBackgroundUpdatesToAgent, pendingBackgroundUpdatesRef]);

  useEffect(() => {
    if (!isStreamingRef.current) {
      flushPendingBackgroundUpdatesToAgent();
    }
  }, [flushPendingBackgroundUpdatesToAgent, isStreamingRef]);

  return {
    appendSkillLoadIndicator,
    sendBackgroundMessageToAgent,
  };
}
