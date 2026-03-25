import { useRef, type RefObject } from "react";
import type { Model } from "@/services/models/model-transform.ts";
import type { UseCommandExecutorArgs, DeferredCommandMessage } from "@/state/chat/shared/types/command.ts";
import type {
  CommandExecutionTrigger,
  MessageSubmitTelemetry,
} from "@/state/chat/shared/types/index.ts";
import type { QueuedMessage } from "@/hooks/use-message-queue.ts";
import { useMessageDispatch } from "@/state/chat/controller/use-message-dispatch.ts";
import { useQueueDispatch } from "@/state/chat/controller/use-queue-dispatch.ts";
import { useCommandDispatch } from "@/state/chat/controller/use-command-dispatch.ts";
import { useModelSelection } from "@/state/chat/controller/use-model-selection.ts";

// ============================================================================
// TYPES
// ============================================================================

interface UseChatDispatchControllerArgs extends Omit<
  UseCommandExecutorArgs,
  "addMessage" | "sendMessageRef" | "setStreamingWithFinalize" | "startAssistantStream"
> {
  activeStreamRunIdRef: RefObject<number | null>;
  continueQueuedConversation: () => void;
  dispatchDeferredCommandMessageRef: RefObject<(message: DeferredCommandMessage) => void>;
  dispatchQueuedMessageRef: RefObject<(queuedMessage: QueuedMessage) => void>;
  emitMessageSubmitTelemetry: (event: MessageSubmitTelemetry) => void;
  initialPrompt?: string;
  setLastStreamedMessageId: (messageId: string | null) => void;
  startAssistantStream: UseCommandExecutorArgs["startAssistantStream"];
}

interface UseChatDispatchControllerResult {
  addMessage: (role: "user" | "assistant" | "system", content: string) => void;
  executeCommand: (
    commandName: string,
    args: string,
    trigger?: CommandExecutionTrigger,
  ) => Promise<boolean>;
  handleModelSelect: (selectedModel: Model, reasoningEffort?: string) => Promise<void>;
  handleModelSelectorCancel: () => void;
  sendMessage: (content: string, options?: { skipUserMessage?: boolean }) => void;
}

// ============================================================================
// FAÇADE HOOK
// ============================================================================

/**
 * Thin façade that composes the four dispatch sub-hooks into the single
 * `UseChatDispatchControllerResult` surface expected by callers.
 *
 * Sub-hooks:
 *  - {@link useMessageDispatch}  – addMessage, setStreamingWithFinalize, sendMessage
 *  - {@link useQueueDispatch}    – deferred / queued message ref assignments
 *  - {@link useCommandDispatch}  – useCommandExecutor + initial-prompt effect
 *  - {@link useModelSelection}   – handleModelSelect, handleModelSelectorCancel
 */
export function useChatDispatchController({
  activeStreamRunIdRef,
  continueQueuedConversation,
  dispatchDeferredCommandMessageRef,
  dispatchQueuedMessageRef,
  emitMessageSubmitTelemetry,
  initialPrompt,
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
  // Model-selection props
  agentType,
  modelOps,
  onModelChange,
  setCurrentModelDisplayName,
  setCurrentModelId,
  setCurrentReasoningEffort,
  setShowModelSelector,
  // Remaining props forwarded to useCommandExecutor
  ...commandExecutorPassthrough
}: UseChatDispatchControllerArgs): UseChatDispatchControllerResult {
  // Ref used by useCommandExecutor for late-binding to sendMessage
  const sendMessageRef = useRef<((content: string, options?: { skipUserMessage?: boolean }) => void) | null>(null);

  // ── 1. Message dispatch ──────────────────────────────────────────────
  const { addMessage, setStreamingWithFinalize, sendMessage } = useMessageDispatch({
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
  });

  // ── 2. Queue dispatch ────────────────────────────────────────────────
  useQueueDispatch({
    dispatchDeferredCommandMessageRef,
    dispatchQueuedMessageRef,
    sendMessage,
  });

  // Keep sendMessageRef in sync for useCommandExecutor's late-binding
  sendMessageRef.current = sendMessage;

  // ── 3. Command dispatch ──────────────────────────────────────────────
  const { executeCommand } = useCommandDispatch({
    addMessage,
    agentType,
    emitMessageSubmitTelemetry,
    initialPrompt,
    isStreamingRef,
    modelOps,
    onModelChange,
    onSendMessage,
    sendMessage,
    sendMessageRef,
    setCurrentModelDisplayName,
    setCurrentModelId,
    setCurrentReasoningEffort,
    setIsStreaming,
    setMessagesWindowed,
    setParallelAgents,
    setShowModelSelector,
    setStreamingMessageId,
    setStreamingWithFinalize,
    startAssistantStream,
    streamingMessageIdRef,
    streamingMetaRef,
    streamingStartRef,
    todoItemsRef,
    ...commandExecutorPassthrough,
  });

  // ── 4. Model selection ───────────────────────────────────────────────
  const { handleModelSelect, handleModelSelectorCancel } = useModelSelection({
    addMessage,
    agentType,
    modelOps,
    onModelChange,
    setCurrentModelDisplayName,
    setCurrentModelId,
    setCurrentReasoningEffort,
    setShowModelSelector,
  });

  return {
    addMessage,
    executeCommand,
    handleModelSelect,
    handleModelSelectorCancel,
    sendMessage,
  };
}
