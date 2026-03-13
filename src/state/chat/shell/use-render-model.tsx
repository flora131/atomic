import { useMemo, type ReactNode } from "react";
import { MessageBubble } from "@/components/chat-message-bubble.tsx";
import { shouldShowMessageLoadingIndicator } from "@/lib/ui/loading-state.ts";
import { shouldHideStaleSubagentToolPlaceholder } from "@/state/chat/helpers.ts";
import type { ParallelAgent } from "@/components/parallel-agents-tree.tsx";
import type { ChatMessage, StreamingMeta, WorkflowChatState } from "@/state/chat/types.ts";
import type { SyntaxStyle } from "@opentui/core";
import type { NormalizedTodoItem } from "@/lib/ui/task-status.ts";

interface UseChatRenderModelArgs {
  activeBackgroundAgentCount: number;
  activeQuestion: unknown;
  handleAgentDoneRendered: (marker: {
    messageId: string;
    agentId: string;
    timestampMs: number;
  }) => void;
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
    return messages.filter(
      (message) => !shouldHideStaleSubagentToolPlaceholder(message, activeMessageIds),
    );
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
              syntaxStyle={markdownSyntaxStyle}
              hideAskUserQuestion={activeQuestion !== null}
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
