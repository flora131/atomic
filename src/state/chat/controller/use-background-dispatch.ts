import { useCallback, useEffect } from "react";
import type { MutableRefObject } from "react";
import type { Session } from "@/services/agents/types.ts";
import {
  shouldScheduleBackgroundUpdateFollowUpFlush,
  shouldStartBackgroundUpdateFlush,
} from "@/lib/ui/background-update-flush.ts";
import {
  appendSkillLoadToLatestAssistantMessage,
} from "@/state/chat/helpers.ts";
import type { ChatMessage, MessageSkillLoad } from "@/state/chat/types.ts";

interface UseChatBackgroundDispatchArgs {
  backgroundAgentSendChainRef: MutableRefObject<Promise<void>>;
  backgroundUpdateFlushInFlightRef: MutableRefObject<boolean>;
  getSession?: () => Session | null;
  isStreamingRef: MutableRefObject<boolean>;
  pendingBackgroundUpdatesRef: MutableRefObject<string[]>;
  setMessagesWindowed: (next: React.SetStateAction<ChatMessage[]>) => void;
}

export function useChatBackgroundDispatch({
  backgroundAgentSendChainRef,
  backgroundUpdateFlushInFlightRef,
  getSession,
  isStreamingRef,
  pendingBackgroundUpdatesRef,
  setMessagesWindowed,
}: UseChatBackgroundDispatchArgs) {
  const flushPendingBackgroundUpdatesToAgent = useCallback(() => {
    if (!shouldStartBackgroundUpdateFlush({
      hasFlushInFlight: backgroundUpdateFlushInFlightRef.current,
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
