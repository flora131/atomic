import {
  useCallback,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";

import {
  finalizeStreamingReasoningInMessage,
  finalizeStreamingReasoningParts,
  finalizeStreamingTextParts,
} from "@/state/parts/index.ts";
import { interruptRunningToolParts } from "@/state/chat/shared/helpers/stream-continuation.ts";
import { createMessage } from "@/state/chat/shared/helpers/index.ts";
import { snapshotTaskItems } from "@/state/chat/shared/helpers/workflow-task-state.ts";
import type { Part, AgentPart } from "@/state/parts/types.ts";
import type { ParallelAgent } from "@/types/parallel-agents.ts";
import type {
  ChatMessage,
  StreamingMeta,
} from "@/state/chat/shared/types/index.ts";
import type { NormalizedTodoItem } from "@/state/parts/helpers/task-status.ts";
import type { StreamMessageOptions } from "@/commands/tui/registry.ts";
import type { StreamRunHandle } from "@/state/runtime/stream-run-runtime.ts";

// ---------------------------------------------------------------------------
// Module-level pure helper – not exported; only used by the hook callbacks.
// ---------------------------------------------------------------------------

function fullyFinalizeStreamingMessage(
  message: ChatMessage,
  thinkingMs?: number,
): ChatMessage {
  const finalized = finalizeStreamingReasoningInMessage(message);
  const baseParts = finalized.parts ?? [];

  const topLevelFinalized = finalizeStreamingTextParts(
    interruptRunningToolParts(
      finalizeStreamingReasoningParts(baseParts, thinkingMs),
    ) ?? [],
  );

  const partsWithFinalizedAgents = topLevelFinalized.map((part) => {
    if (part.type !== "agent") return part;
    const agentPart = part as AgentPart;
    let agentChanged = false;
    const nextAgents: ParallelAgent[] = agentPart.agents.map((agent) => {
      let changed = false;
      let nextInlineParts = agent.inlineParts;
      if (nextInlineParts && nextInlineParts.length > 0) {
        nextInlineParts = finalizeStreamingTextParts(
          interruptRunningToolParts(nextInlineParts) ?? [],
        );
        if (nextInlineParts !== agent.inlineParts) changed = true;
      }
      const isActive =
        agent.status === "running" || agent.status === "pending";
      if (isActive) {
        const startedAtMs = new Date(agent.startedAt).getTime();
        agentChanged = true;
        return {
          ...agent,
          status: "completed" as const,
          currentTool: undefined,
          durationMs: Number.isFinite(startedAtMs)
            ? Math.max(0, Date.now() - startedAtMs)
            : agent.durationMs,
          ...(changed && nextInlineParts
            ? { inlineParts: nextInlineParts }
            : {}),
        };
      }
      if (changed) {
        agentChanged = true;
        return { ...agent, inlineParts: nextInlineParts };
      }
      return agent;
    });
    return agentChanged ? { ...agentPart, agents: nextAgents } : part;
  });

  const existingAgents = finalized.parallelAgents;
  let finalizedParallelAgents = existingAgents;
  if (existingAgents && existingAgents.length > 0) {
    let parallelChanged = false;
    finalizedParallelAgents = existingAgents.map((agent) => {
      if (agent.background) return agent;
      if (agent.status === "running" || agent.status === "pending") {
        parallelChanged = true;
        const startedAtMs = new Date(agent.startedAt).getTime();
        return {
          ...agent,
          status: "completed" as const,
          currentTool: undefined,
          durationMs: Number.isFinite(startedAtMs)
            ? Math.max(0, Date.now() - startedAtMs)
            : agent.durationMs,
        };
      }
      return agent;
    });
    if (!parallelChanged) finalizedParallelAgents = existingAgents;
  }

  return {
    ...finalized,
    streaming: false,
    parts: partsWithFinalizedAgents as Part[],
    ...(finalizedParallelAgents !== existingAgents
      ? { parallelAgents: finalizedParallelAgents }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Hook interfaces
// ---------------------------------------------------------------------------

export interface UseMessageDispatchArgs {
  activeStreamRunIdRef: RefObject<number | null>;
  continueQueuedConversation: () => void;
  isStreamingRef: RefObject<boolean>;
  onSendMessage?: (content: string) => void | Promise<void>;
  setIsStreaming: Dispatch<SetStateAction<boolean>>;
  setLastStreamedMessageId: (messageId: string | null) => void;
  setMessagesWindowed: (next: SetStateAction<ChatMessage[]>) => void;
  setParallelAgents: Dispatch<SetStateAction<ParallelAgent[]>>;
  setStreamingMessageId: (messageId: string | null) => void;
  startAssistantStream: (
    content: string,
    options?: StreamMessageOptions,
  ) => StreamRunHandle | null;
  streamingMessageIdRef: RefObject<string | null>;
  streamingMetaRef: RefObject<StreamingMeta | null>;
  streamingStartRef: RefObject<number | null>;
  todoItemsRef: RefObject<NormalizedTodoItem[]>;
}

export interface UseMessageDispatchResult {
  addMessage: (
    role: "user" | "assistant" | "system",
    content: string,
  ) => void;
  setStreamingWithFinalize: (streaming: boolean) => void;
  sendMessage: (
    content: string,
    options?: { skipUserMessage?: boolean },
  ) => void;
}

// ---------------------------------------------------------------------------
// Hook implementation
// ---------------------------------------------------------------------------

export function useMessageDispatch({
  activeStreamRunIdRef,
  continueQueuedConversation,
  isStreamingRef,
  onSendMessage,
  setIsStreaming,
  setLastStreamedMessageId,
  setMessagesWindowed,
  setParallelAgents,
  setStreamingMessageId,
  startAssistantStream,
  streamingMessageIdRef,
  streamingMetaRef,
  streamingStartRef,
  todoItemsRef,
}: UseMessageDispatchArgs): UseMessageDispatchResult {
  const addMessage = useCallback(
    (role: "user" | "assistant" | "system", content: string) => {
      const streaming = role === "assistant" && isStreamingRef.current;
      const message = createMessage(role, content, streaming);

      if (streaming && !streamingStartRef.current) {
        streamingStartRef.current = Date.now();
      }

      if (streaming) {
        setStreamingMessageId(message.id);
      }

      setMessagesWindowed((prev) => {
        const finalized = prev.map((existingMessage) =>
          existingMessage.streaming
            ? fullyFinalizeStreamingMessage(
                existingMessage,
                existingMessage.thinkingMs,
              )
            : existingMessage,
        );
        return [...finalized, message];
      });
    },
    [isStreamingRef, setMessagesWindowed, setStreamingMessageId, streamingStartRef],
  );

  const setStreamingWithFinalize = useCallback(
    (streaming: boolean) => {
      if (!streaming && isStreamingRef.current) {
        streamingStartRef.current = null;
        const activeStreamingMessageId = streamingMessageIdRef.current;
        if (activeStreamingMessageId) {
          setLastStreamedMessageId(activeStreamingMessageId);
        }

        setMessagesWindowed((prev) => {
          if (!activeStreamingMessageId) {
            return prev;
          }

          return prev.map((message) =>
            message.id === activeStreamingMessageId &&
            message.role === "assistant" &&
            message.streaming
              ? {
                  ...fullyFinalizeStreamingMessage(
                    message,
                    streamingMetaRef.current?.thinkingMs ||
                      message.thinkingMs,
                  ),
                  taskItems: snapshotTaskItems(todoItemsRef.current),
                }
              : message,
          );
        });

        setStreamingMessageId(null);
        activeStreamRunIdRef.current = null;

        setParallelAgents((current) => current.filter((a) => a.background));
      }

      if (streaming && activeStreamRunIdRef.current !== null) {
        activeStreamRunIdRef.current = null;
      }

      isStreamingRef.current = streaming;
      setIsStreaming(streaming);
      if (!streaming) {
        continueQueuedConversation();
      }
    },
    [
      continueQueuedConversation,
      isStreamingRef,
      setIsStreaming,
      setLastStreamedMessageId,
      setMessagesWindowed,
      setParallelAgents,
      setStreamingMessageId,
      activeStreamRunIdRef,
      streamingMessageIdRef,
      streamingMetaRef,
      streamingStartRef,
      todoItemsRef,
    ],
  );

  const sendMessage = useCallback(
    (content: string, options?: { skipUserMessage?: boolean }) => {
      if (!options?.skipUserMessage) {
        const userMessage = createMessage("user", content);
        setMessagesWindowed((prev) => [...prev, userMessage]);
      }

      if (onSendMessage) {
        void Promise.resolve(onSendMessage(content));
      }
      startAssistantStream(content);
    },
    [onSendMessage, setMessagesWindowed, startAssistantStream],
  );

  return { addMessage, setStreamingWithFinalize, sendMessage };
}
