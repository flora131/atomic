import { useMemo, type ReactNode } from "react";
import { MessageBubble } from "@/components/chat-message-bubble.tsx";
import { shouldShowMessageLoadingIndicator } from "@/state/chat/shared/helpers/loading-state.ts";
import { shouldHideStaleSubagentToolPlaceholder } from "@/state/chat/shared/helpers/index.ts";
import type { ParallelAgent } from "@/types/parallel-agents.ts";
import type { ChatMessage, StreamingMeta, UserQuestion, WorkflowChatState } from "@/state/chat/shared/types/index.ts";
import type { SyntaxStyle } from "@opentui/core";
import type { NormalizedTodoItem } from "@/state/parts/helpers/task-status.ts";

interface UseChatRenderModelArgs {
  activeBackgroundAgentCount: number;
  activeQuestion: UserQuestion | null;
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
  workflowSessionId: string | null;
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
  parallelAgents: _parallelAgents,
  showTodoPanel,
  streamingElapsedMs,
  streamingMessageId,
  streamingMeta,
  tasksExpanded,
  todoItems,
  workflowSessionId,
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
          // Only pass activeBackgroundAgentCount to the message that owns those
          // agents (the streaming or last-streamed message). Passing it to all
          // messages causes completed workflow stages to re-show their spinner
          // when a subsequent stage launches background agents.
          //
          // lastStreamedMessageId should only grant ownership when there is no
          // active streaming message — once a new workflow stage starts streaming
          // on a fresh message, the previous stage's completed message must not
          // inherit the new stage's background-agent count.
          const isAgentOwner = msg.id === streamingMessageId
            || msg.id === backgroundAgentMessageId
            || (msg.id === lastStreamedMessageId && !streamingMessageId);
          const scopedBgAgentCount = isAgentOwner ? activeBackgroundAgentCount : 0;
          const isLast = index === renderMessages.length - 1;
          const showLive = shouldShowMessageLoadingIndicator(msg, {
            liveTodoItems: liveTaskItems,
            activeBackgroundAgentCount: scopedBgAgentCount,
            keepAliveForWorkflow: workflowState.workflowActive && isLast && !msg.wasInterrupted,
          });
          const scopedStreamingMeta = showLive
            ? (streamingMessageId
              ? (msg.id === streamingMessageId ? streamingMeta : null)
              : streamingMeta)
            : null;
          return (
            <MessageBubble
              key={msg.id}
              message={msg}
              isLast={isLast}
              syntaxStyle={markdownSyntaxStyle}
              hideLoading={activeQuestion !== null}
              activeBackgroundAgentCount={scopedBgAgentCount}
              todoItems={msg.streaming ? todoItems : undefined}
              elapsedMs={showLive ? streamingElapsedMs : undefined}
              streamingMeta={scopedStreamingMeta}
              collapsed={false}
              tasksExpanded={tasksExpanded}
              workflowSessionId={workflowSessionId}
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
    workflowSessionId,
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
