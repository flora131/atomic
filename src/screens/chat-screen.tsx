/**
 * Terminal Chat UI Component
 *
 * React components for a terminal-based chat interface using OpenTUI.
 * Supports message streaming, sticky scroll, and keyboard navigation.
 *
 * Reference: Feature 15 - Implement terminal chat UI
 */

import React, { useState, useCallback, useRef } from "react";
import { ChatShell } from "@/state/chat/shell/ChatShell.tsx";
import { useChatStreamRuntime } from "@/state/chat/stream/use-runtime.ts";
import { useChatAppOrchestration } from "@/state/chat/controller/use-app-orchestration.ts";
import { useChatRuntimeStack } from "@/state/chat/controller/use-runtime-stack.ts";
import { useChatUiControllerStack } from "@/state/chat/controller/use-ui-controller-stack.ts";
import { useChatShellState } from "@/state/chat/controller/use-shell-state.ts";
import type { DeferredCommandMessage } from "@/state/chat/command/executor-types.ts";
import { useMessageQueue } from "@/hooks/use-message-queue.ts";
import { useEventBusContext } from "@/services/events/event-bus-provider.tsx";
import type {
  ChatAppProps,
  ChatMessage,
  StreamingMeta,
  WorkflowChatState,
} from "@/state/chat/types.ts";
import { defaultWorkflowChatState } from "@/state/chat/types.ts";

export * from "@/state/chat/exports.ts";

// ============================================================================
// CHAT APP COMPONENT
// ============================================================================

/**
 * Main chat application component.
 *
 * Features:
 * - Scrollable message history with sticky scroll to bottom
 * - Text input for sending messages
 * - Keyboard shortcuts (ESC, Ctrl+C) to exit
 * - Message streaming support
 *
 * @example
 * ```tsx
 * <ChatApp
 *   onSendMessage={(content) => console.log("Sent:", content)}
 *   onExit={() => console.log("Exiting")}
 * />
 * ```
 */
export function ChatApp({
  initialMessages = [],
  onSendMessage,
  onStreamMessage,
  onExit,
  onResetSession,
  onInterrupt,
  onTerminateBackgroundAgents,
  setStreamingState,
  placeholder: _placeholder = "Type a message...",
  title: _title,
  syntaxStyle: _syntaxStyle,
  version = "0.1.0",
  model = "",
  tier = "",
  workingDir = "~/",
  suggestion: _suggestion,
  getSession,
  ensureSession,
  onWorkflowResumeWithAnswer,
  agentType,
  modelOps,
  getModelDisplayInfo,
  createSubagentSession,
  initialPrompt,
  onModelChange,
  onSessionMcpServersChange,
  initialModelId,
  onCommandExecutionTelemetry,
  onMessageSubmitTelemetry,
}: ChatAppProps): React.ReactNode {
  // title and suggestion are deprecated, kept for backwards compatibility
  void _title;
  void _suggestion;

  // Core message state
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingMeta, setStreamingMeta] = useState<StreamingMeta | null>(null);
  const setMessagesWindowed = useCallback((next: React.SetStateAction<ChatMessage[]>) => {
    setMessages(next);
  }, []);

  const [workflowState, setWorkflowState] = useState<WorkflowChatState>(defaultWorkflowChatState);
  const shellState = useChatShellState({
    initialModelId,
    model,
  });

  const messageQueue = useMessageQueue();
  const deferredCommandQueueRef = useRef<DeferredCommandMessage[]>([]);
  // Event bus — used to publish sub-agent stream events and flush pending
  // batched text deltas before stream finalization.
  const { bus: eventBus, dispatcher: batchDispatcher } = useEventBusContext();

  const runtime = useChatStreamRuntime({
    agentType,
    appendCompactionSummaryAndSync: shellState.actions.appendCompactionSummaryAndSync,
    continueQueuedConversationRef: shellState.continueQueuedConversationRef,
    currentModelRef: shellState.currentModelRef,
    getSession,
    messages,
    onStreamMessage,
    setIsStreaming,
    setMessagesWindowed,
    setStreamingMeta,
  });

  const orchestration = useChatAppOrchestration({
    applyWorkflowStateUpdate: shellState.actions.updateWorkflowState,
    deferredCommandQueueRef,
    dispatchDeferredCommandMessageRef: shellState.dispatchDeferredCommandMessageRef,
    dispatchQueuedMessageRef: shellState.dispatchQueuedMessageRef,
    isStreaming,
    isStreamingRef: runtime.refs.isStreamingRef,
    isWorkflowTaskUpdate: runtime.actions.isWorkflowTaskUpdate,
    messageQueue,
    onMessageSubmitTelemetry,
    runningAskQuestionToolIdsRef: runtime.refs.runningAskQuestionToolIdsRef,
    setTodoItems: runtime.setters.setTodoItems,
    setWorkflowState,
    todoItemsRef: runtime.refs.todoItemsRef,
    workflowSessionIdRef: runtime.refs.workflowSessionIdRef,
  });
  shellState.continueQueuedConversationRef.current = orchestration.continueQueuedConversation;

  const runtimeStack = useChatRuntimeStack({
    agentType,
    batchDispatcher,
    getSession,
    isStreaming,
    onWorkflowResumeWithAnswer,
    orchestration,
    runtime,
    setIsStreaming,
    setMessagesWindowed,
    setStreamingMeta,
    shellState,
    messages,
    workflowState,
  });

  const { chatShellProps } = useChatUiControllerStack({
    agentType,
    app: {
      createSubagentSession,
      ensureSession,
      getModelDisplayInfo,
      getSession,
      initialModelId,
      initialPrompt,
      model,
      modelOps,
      onCommandExecutionTelemetry,
      onExit,
      onInterrupt,
      onModelChange,
      onResetSession,
      onSendMessage,
      onSessionMcpServersChange,
      onTerminateBackgroundAgents,
      setStreamingState,
      tier,
      version,
      workingDir,
    },
    deferredCommandQueueRef,
    eventBus,
    hitl: runtimeStack,
    isStreaming,
    messageQueue,
    messages,
    orchestration,
    runtime,
    setIsStreaming,
    setMessagesWindowed,
    setStreamingMeta,
    shellState,
    streamingMeta,
    workflowState,
  });

  return (
    <ChatShell {...chatShellProps} />
  );
}

// ============================================================================
// EXPORTS
// ============================================================================

export default ChatApp;
