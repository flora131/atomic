import { useMemo, type ReactNode } from "react";
import { MessageBubble } from "@/components/chat-message-bubble.tsx";
import { shouldShowMessageLoadingIndicator } from "@/state/chat/shared/helpers/loading-state.ts";
import { shouldHideStaleSubagentToolPlaceholder } from "@/state/chat/shared/helpers/index.ts";
import type { ParallelAgent } from "@/types/parallel-agents.ts";
import type { ChatMessage, StreamingMeta, WorkflowChatState } from "@/state/chat/shared/types/index.ts";
import type { SyntaxStyle } from "@opentui/core";
import type { NormalizedTodoItem } from "@/state/parts/helpers/task-status.ts";

interface UseChatRenderModelArgs {
  activeBackgroundAgentCount: number;
  activeQuestion: unknown;
  handleAgentDoneRendered: (marker: {
    messageId: string;
    agentId: string;
    timestampMs: number;
  }) => void;
  isVerbose: boolean;
  markdownSyntaxStyle: SyntaxStyle;
  messages: ChatMessage[];
  parallelAgents: ParallelAgent[];
  showTodoPanel: boolean;
  streamingElapsedMs: number;
  streamingMessageId: string | null;
  streamingMeta: StreamingMeta | null;
  tasksExpanded: boolean;
  todoItems: NormalizedTodoItem[];
  workflowSessionDir: string | null;
  workflowState: WorkflowChatState;
  backgroundAgentMessageId: string | null;
  lastStreamedMessageId: string | null;
}

interface UseChatRenderModelResult {
  messageContent: ReactNode;
  renderMessages: ChatMessage[];
}

export function useChatRenderModel({
  activeBackgroundAgentCount,
  activeQuestion,
  backgroundAgentMessageId,
  handleAgentDoneRendered,
  isVerbose,
  lastStreamedMessageId,
  markdownSyntaxStyle,
  messages,
  parallelAgents,
  showTodoPanel,
  streamingElapsedMs,
  streamingMessageId,
  streamingMeta,
  tasksExpanded,
  todoItems,
  workflowSessionDir,
  workflowState,
}: UseChatRenderModelArgs): UseChatRenderModelResult {
  const renderMessages = useMemo(() => {
    const activeMessageIds = new Set<string>();
    if (streamingMessageId) activeMessageIds.add(streamingMessageId);
    if (lastStreamedMessageId) activeMessageIds.add(lastStreamedMessageId);
    if (backgroundAgentMessageId) activeMessageIds.add(backgroundAgentMessageId);
    const filtered = messages.filter(
      (message) => !shouldHideStaleSubagentToolPlaceholder(message, activeMessageIds),
    );

    return reorderStreamingMessageToEnd(filtered, streamingMessageId);
  }, [backgroundAgentMessageId, lastStreamedMessageId, messages, streamingMessageId]);

  const messageContent = useMemo(() => {
    if (renderMessages.length === 0) {
      return null;
    }

    return (
      <>
        {renderMessages.map((msg, index) => {
          const liveTaskItems = msg.streaming ? todoItems : undefined;
          const showLive = shouldShowMessageLoadingIndicator(msg, liveTaskItems, activeBackgroundAgentCount);
          const scopedStreamingMeta = showLive
            ? (streamingMessageId
              ? (msg.id === streamingMessageId ? streamingMeta : null)
              : streamingMeta)
            : null;
          return (
            <MessageBubble
              key={msg.id}
              message={msg}
              isLast={index === renderMessages.length - 1}
              isVerbose={isVerbose}
              syntaxStyle={markdownSyntaxStyle}
              hideLoading={activeQuestion !== null}
              activeBackgroundAgentCount={activeBackgroundAgentCount}
              todoItems={msg.streaming ? todoItems : undefined}
              elapsedMs={showLive ? streamingElapsedMs : undefined}
              streamingMeta={scopedStreamingMeta}
              collapsed={false}
              tasksExpanded={tasksExpanded}
              workflowSessionDir={workflowSessionDir}
              workflowActive={workflowState.workflowActive}
              showTodoPanel={showTodoPanel}
              onAgentDoneRendered={handleAgentDoneRendered}
            />
          );
        })}
      </>
    );
  }, [
    activeBackgroundAgentCount,
    activeQuestion,
    handleAgentDoneRendered,
    isVerbose,
    markdownSyntaxStyle,
    renderMessages,
    showTodoPanel,
    streamingElapsedMs,
    streamingMessageId,
    streamingMeta,
    tasksExpanded,
    todoItems,
    workflowSessionDir,
    workflowState.workflowActive,
  ]);

  return {
    messageContent,
    renderMessages,
  };
}

/**
 * Ensure the streaming message is always rendered last so that system
 * messages (info, warning, retry) appended during streaming appear
 * above the spinner and chatbox rather than below them.
 */
export function reorderStreamingMessageToEnd(
  messages: ChatMessage[],
  streamingMessageId: string | null,
): ChatMessage[] {
  if (!streamingMessageId) return messages;

  const streamIdx = messages.findIndex((m) => m.id === streamingMessageId);
  if (streamIdx < 0 || streamIdx >= messages.length - 1) return messages;

  const streamingMsg = messages[streamIdx]!;
  return [
    ...messages.slice(0, streamIdx),
    ...messages.slice(streamIdx + 1),
    streamingMsg,
  ];
}
