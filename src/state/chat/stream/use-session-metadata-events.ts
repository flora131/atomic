import { useBusSubscription } from "@/services/events/hooks.ts";
import type { ChatMessage, StreamingMeta } from "@/state/chat/shared/types/index.ts";
import type { UseStreamSubscriptionsArgs } from "@/state/chat/stream/subscription-types.ts";

export function useSessionMetadataEvents({
  resolveAgentScopedMessageId,
  setMessagesWindowed,
  setParallelAgents,
  setStreamingMeta,
  streamingMetaRef,
}: Pick<
  UseStreamSubscriptionsArgs,
  | "resolveAgentScopedMessageId"
  | "setMessagesWindowed"
  | "setParallelAgents"
  | "setStreamingMeta"
  | "streamingMetaRef"
>): void {
  useBusSubscription("stream.usage", (event) => {
    const usageAgentId = event.data.agentId;
    const incoming = event.data.outputTokens ?? 0;

    if (usageAgentId) {
      const scopedMessageId = resolveAgentScopedMessageId(usageAgentId);
      setParallelAgents((current) =>
        current.map((agent) =>
          agent.id === usageAgentId
            ? {
              ...agent,
              tokens: incoming > 0
                ? Math.max(agent.tokens ?? 0, incoming)
                : agent.tokens,
            }
            : agent,
        ),
      );

      if (scopedMessageId && incoming > 0) {
        setMessagesWindowed((prev: ChatMessage[]) =>
          prev.map((msg: ChatMessage) =>
            msg.id === scopedMessageId
              ? { ...msg, outputTokens: Math.max(msg.outputTokens ?? 0, incoming) }
              : msg,
          ),
        );
      }
      return;
    }

    const prevMeta = streamingMetaRef.current ?? {
      outputTokens: 0,
      thinkingMs: 0,
      thinkingText: "",
    };
    const nextMeta: StreamingMeta = {
      ...prevMeta,
      outputTokens: Math.max(prevMeta.outputTokens, incoming > 0 ? incoming : 0),
    };
    streamingMetaRef.current = nextMeta;
    setStreamingMeta(nextMeta);

    const messageId = resolveAgentScopedMessageId();
    if (messageId && nextMeta.outputTokens > 0) {
      setMessagesWindowed((prev: ChatMessage[]) =>
        prev.map((msg: ChatMessage) =>
          msg.id === messageId ? { ...msg, outputTokens: nextMeta.outputTokens } : msg,
        ),
      );
    }
  });

  useBusSubscription("stream.thinking.complete", (event) => {
    const thinkingAgentId = event.data.agentId;

    if (thinkingAgentId) {
      const scopedMessageId = resolveAgentScopedMessageId(thinkingAgentId);
      setParallelAgents((current) =>
        current.map((agent) =>
          agent.id === thinkingAgentId
            ? {
              ...agent,
              thinkingMs: Math.max(agent.thinkingMs ?? 0, event.data.durationMs),
            }
            : agent,
        ),
      );

      if (scopedMessageId && event.data.durationMs > 0) {
        setMessagesWindowed((prev: ChatMessage[]) =>
          prev.map((msg: ChatMessage) =>
            msg.id === scopedMessageId
              ? { ...msg, thinkingMs: Math.max(msg.thinkingMs ?? 0, event.data.durationMs) }
              : msg,
          ),
        );
      }
      return;
    }

    const prevMeta = streamingMetaRef.current ?? {
      outputTokens: 0,
      thinkingMs: 0,
      thinkingText: "",
    };
    const nextMeta: StreamingMeta = {
      ...prevMeta,
      thinkingMs: Math.max(prevMeta.thinkingMs, event.data.durationMs),
    };
    streamingMetaRef.current = nextMeta;
    setStreamingMeta(nextMeta);

    const messageId = resolveAgentScopedMessageId();
    if (messageId && nextMeta.thinkingMs > 0) {
      setMessagesWindowed((prev: ChatMessage[]) =>
        prev.map((msg: ChatMessage) =>
          msg.id === messageId ? { ...msg, thinkingMs: nextMeta.thinkingMs } : msg,
        ),
      );
    }
  });
}
