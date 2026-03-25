/**
 * Terminal Chat UI Component
 *
 * React components for a terminal-based chat interface using OpenTUI.
 * Supports message streaming, sticky scroll, and keyboard navigation.
 *
 * Reference: Feature 15 - Implement terminal chat UI
 */

import React, { useState, useRef, useMemo } from "react";
import {
  ChatShell,
  useChatStreamRuntime,
  useChatAppOrchestration,
  useChatRuntimeStack,
  useChatUiControllerStack,
  useChatShellState,
  defaultWorkflowChatState,
  type DeferredCommandMessage,
  type ChatAppProps,
  type ChatMessage,
  type StreamingMeta,
  type WorkflowChatState,
} from "@/state/chat/exports.ts";
import { useMessageQueue } from "@/hooks/use-message-queue.ts";
import { useEventBusContext } from "@/services/events/event-bus-provider.tsx";

export * from "@/state/chat/exports.ts";

const EMPTY_MESSAGES: ChatMessage[] = [];

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
  initialMessages = EMPTY_MESSAGES,
  onSendMessage,
  onStreamMessage,
  onExit,
  onResetSession,
  onInterrupt,
  onTerminateBackgroundAgents,
  setStreamingState,
  version = "0.1.0",
  model = "",
  tier = "",
  workingDir = "~/",
  getSession,
  ensureSession,
  onWorkflowResumeWithAnswer,
  agentType,
  modelOps,
  getModelDisplayInfo,
  createSubagentSession,
  streamWithSession,
  initialPrompt,
  onModelChange,
  onSessionMcpServersChange,
  initialModelId,
  initialReasoningEffort,
  onCommandExecutionTelemetry,
  onMessageSubmitTelemetry,
}: ChatAppProps): React.ReactNode {
  // Core message state
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingMeta, setStreamingMeta] = useState<StreamingMeta | null>(null);
  const setMessagesWindowed = setMessages;

  const [workflowState, setWorkflowState] = useState<WorkflowChatState>(() => {
    return defaultWorkflowChatState;
  });
  const shellState = useChatShellState({
    initialModelId,
    initialReasoningEffort,
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
    workflowActiveRef: shellState.workflowActiveRef,
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

  // Memoize the app config object to preserve referential equality across
  // renders, preventing unnecessary downstream re-renders in the controller stack.
  const app = useMemo(() => ({
    createSubagentSession,
    streamWithSession,
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
  }), [
    createSubagentSession,
    streamWithSession,
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
  ]);

  const { chatShellProps } = useChatUiControllerStack({
    agentType,
    app,
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
