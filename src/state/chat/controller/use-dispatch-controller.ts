import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import { saveModelPreference, saveReasoningEffortPreference, clearReasoningEffortPreference } from "@/services/config/settings.ts";
import type { Model } from "@/services/models/model-transform.ts";
import {
  globalRegistry,
  parseSlashCommand,
} from "@/commands/tui/index.ts";
import { useCommandExecutor } from "@/state/chat/command/index.ts";
import type { DeferredCommandMessage, UseCommandExecutorArgs } from "@/state/chat/shared/types/command.ts";
import type {
  CommandExecutionTrigger,
  MessageSubmitTelemetry,
} from "@/state/chat/types.ts";
import type { QueuedMessage } from "@/hooks/use-message-queue.ts";
import {
  parseAtMentions,
  processFileMentions,
} from "@/lib/ui/mention-parsing.ts";
import { snapshotTaskItems } from "@/state/chat/shared/helpers/workflow-task-state.ts";
import { createMessage } from "@/state/chat/helpers.ts";
import { finalizeStreamingReasoningInMessage } from "@/state/parts/index.ts";

interface UseChatDispatchControllerArgs extends Omit<
  UseCommandExecutorArgs,
  "addMessage" | "sendMessageRef" | "setStreamingWithFinalize" | "startAssistantStream"
> {
  activeStreamRunIdRef: MutableRefObject<number | null>;
  continueQueuedConversation: () => void;
  dispatchDeferredCommandMessageRef: MutableRefObject<(message: DeferredCommandMessage) => void>;
  dispatchQueuedMessageRef: MutableRefObject<(queuedMessage: QueuedMessage) => void>;
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

export function useChatDispatchController({
  activeStreamRunIdRef,
  agentType,
  appendCompactionSummaryAndSync,
  appendHistoryBufferAndSync,
  appendSkillLoadIndicator,
  autoCompactionIndicatorRef,
  backgroundProgressSnapshotRef,
  clearHistoryBufferAndSync,
  continueQueuedConversation,
  createSubagentSession,
  currentModelRef,
  deferredCommandQueueRef,
  dispatchDeferredCommandMessageRef,
  dispatchQueuedMessageRef,
  emitMessageSubmitTelemetry,
  ensureSession,
  eventBus,
  getCorrelationService,
  getModelDisplayInfo,
  getSession,
  hasRunningToolRef,
  initialPrompt,
  isAgentOnlyStreamRef,
  isStreaming,
  isStreamingRef,
  loadedSkillsRef,
  mcpServerToggles,
  messages,
  modelOps,
  onCommandExecutionTelemetry,
  onExit,
  onModelChange,
  onResetSession,
  onSendMessage,
  onSessionMcpServersChange,
  pendingCompleteRef,
  parallelInterruptHandlerRef,
  resetLoadedSkillTracking,
  runningAskQuestionToolIdsRef,
  setAvailableModels,
  setCompactionSummary,
  setCurrentModelDisplayName,
  setCurrentModelId,
  setIsAutoCompacting,
  setIsStreaming,
  setLastStreamedMessageId,
  setMcpServerToggles,
  setMessagesWindowed,
  setParallelAgents,
  setShowCompactionHistory,
  setShowModelSelector,
  setStreamingMessageId,
  setStreamingMeta,
  setStreamingState,
  setTheme,
  setTodoItems,
  setTranscriptMode,
  setWorkflowSessionDir,
  setWorkflowSessionId,
  startAssistantStream,
  stopSharedStreamState,
  streamingMessageIdRef,
  streamingMetaRef,
  streamingStartRef,
  todoItemsRef,
  toggleTheme,
  trackAwaitedRun,
  updateWorkflowState,
  waitForUserInputResolverRef,
  workflowActiveRef,
  workflowSessionDirRef,
  workflowSessionIdRef,
  workflowState,
  workflowTaskIdsRef,
}: UseChatDispatchControllerArgs): UseChatDispatchControllerResult {
  const sendMessageRef = useRef<((content: string, options?: { skipUserMessage?: boolean }) => void) | null>(null);
  const executeCommandRef = useRef<((commandName: string, args: string, trigger?: CommandExecutionTrigger) => Promise<boolean>) | null>(null);

  const dispatchDeferredCommandMessage = useCallback((message: DeferredCommandMessage) => {
    if (sendMessageRef.current) {
      sendMessageRef.current(
        message.content,
        message.skipUserMessage ? { skipUserMessage: true } : undefined,
      );
      return;
    }

    deferredCommandQueueRef.current.unshift(message);
  }, [deferredCommandQueueRef]);

  const isAgentCommand = useCallback((name: string): boolean => {
    const cmd = globalRegistry.get(name);
    return cmd?.category === "agent";
  }, []);

  const dispatchQueuedMessage = useCallback((queuedMessage: QueuedMessage) => {
    const atMentions = parseAtMentions(queuedMessage.content, isAgentCommand);
    if (atMentions.length > 0 && executeCommandRef.current) {
      if (!queuedMessage.skipUserMessage) {
        const visibleContent = queuedMessage.displayContent ?? queuedMessage.content;
        setMessagesWindowed((prev) => [...prev, createMessage("user", visibleContent)]);
      }

      isStreamingRef.current = true;
      setIsStreaming(true);
      for (const mention of atMentions) {
        void executeCommandRef.current(mention.agentName, mention.args, "mention");
      }
      return;
    }

    if (sendMessageRef.current) {
      sendMessageRef.current(
        queuedMessage.content,
        queuedMessage.skipUserMessage ? { skipUserMessage: true } : undefined,
      );
    }
  }, [isAgentCommand, isStreamingRef, setIsStreaming, setMessagesWindowed]);

  useEffect(() => {
    dispatchQueuedMessageRef.current = dispatchQueuedMessage;
  }, [dispatchQueuedMessage, dispatchQueuedMessageRef]);

  useEffect(() => {
    dispatchDeferredCommandMessageRef.current = dispatchDeferredCommandMessage;
  }, [dispatchDeferredCommandMessage, dispatchDeferredCommandMessageRef]);

  const addMessage = useCallback((role: "user" | "assistant" | "system", content: string) => {
    const streaming = role === "assistant" && isStreamingRef.current;
    const message = createMessage(role, content, streaming);

    if (streaming && workflowActiveRef.current) {
      message.spinnerVerb = "Running workflow";
      if (!streamingStartRef.current) {
        streamingStartRef.current = Date.now();
      }
    }

    if (streaming) {
      setStreamingMessageId(message.id);
    }

    setMessagesWindowed((prev) => {
      const finalized = prev.map((existingMessage) =>
        existingMessage.streaming
          ? {
            ...finalizeStreamingReasoningInMessage(existingMessage),
            streaming: false,
            completedAt: new Date(),
          }
          : existingMessage
      );
      return [...finalized, message];
    });
  }, [
    isStreamingRef,
    setMessagesWindowed,
    setStreamingMessageId,
    streamingStartRef,
    workflowActiveRef,
  ]);

  const setStreamingWithFinalize = useCallback((streaming: boolean) => {
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
          message.id === activeStreamingMessageId && message.role === "assistant" && message.streaming
            ? {
              ...finalizeStreamingReasoningInMessage(message),
              streaming: false,
              completedAt: new Date(),
              taskItems: snapshotTaskItems(todoItemsRef.current),
            }
            : message
        );
      });

      setStreamingMessageId(null);
      activeStreamRunIdRef.current = null;
    }

    isStreamingRef.current = streaming;
    setIsStreaming(streaming);
    if (!streaming) {
      continueQueuedConversation();
    }
  }, [
    continueQueuedConversation,
    isStreamingRef,
    setIsStreaming,
    setLastStreamedMessageId,
    setMessagesWindowed,
    setStreamingMessageId,
    activeStreamRunIdRef,
    streamingMessageIdRef,
    streamingStartRef,
    todoItemsRef,
  ]);

  const executeCommand = useCommandExecutor({
    addMessage,
    agentType,
    appendCompactionSummaryAndSync,
    appendHistoryBufferAndSync,
    appendSkillLoadIndicator,
    autoCompactionIndicatorRef,
    backgroundProgressSnapshotRef,
    clearHistoryBufferAndSync,
    createSubagentSession,
    currentModelRef,
    deferredCommandQueueRef,
    ensureSession,
    eventBus,
    getCorrelationService,
    getModelDisplayInfo,
    getSession,
    hasRunningToolRef,
    isAgentOnlyStreamRef,
    isStreaming,
    isStreamingRef,
    loadedSkillsRef,
    mcpServerToggles,
    messages,
    modelOps,
    onCommandExecutionTelemetry,
    onExit,
    onModelChange,
    onResetSession,
    onSendMessage,
    onSessionMcpServersChange,
    pendingCompleteRef,
    parallelInterruptHandlerRef,
    resetLoadedSkillTracking,
    runningAskQuestionToolIdsRef,
    sendMessageRef,
    setAvailableModels,
    setCompactionSummary,
    setCurrentModelDisplayName,
    setCurrentModelId,
    setIsAutoCompacting,
    setIsStreaming,
    setMcpServerToggles,
    setMessagesWindowed,
    setParallelAgents,
    setShowCompactionHistory,
    setShowModelSelector,
    setStreamingMessageId,
    setStreamingMeta,
    setStreamingState,
    setTheme,
    setTodoItems,
    setTranscriptMode,
    setWorkflowSessionDir,
    setWorkflowSessionId,
    setStreamingWithFinalize,
    startAssistantStream,
    stopSharedStreamState,
    streamingMessageIdRef,
    streamingMetaRef,
    streamingStartRef,
    todoItemsRef,
    toggleTheme,
    trackAwaitedRun,
    updateWorkflowState,
    waitForUserInputResolverRef,
    workflowActiveRef,
    workflowSessionDirRef,
    workflowSessionIdRef,
    workflowState,
    workflowTaskIdsRef,
  });

  const sendMessage = useCallback((content: string, options?: { skipUserMessage?: boolean }) => {
    if (!options?.skipUserMessage) {
      const userMessage = createMessage("user", content);
      setMessagesWindowed((prev) => [...prev, userMessage]);
    }

    if (onSendMessage) {
      void Promise.resolve(onSendMessage(content));
    }
    startAssistantStream(content);
  }, [onSendMessage, setMessagesWindowed, startAssistantStream]);

  useEffect(() => {
    sendMessageRef.current = sendMessage;
  }, [sendMessage]);

  useEffect(() => {
    executeCommandRef.current = executeCommand;
  }, [executeCommand]);

  const handleModelSelect = useCallback(async (selectedModel: Model, reasoningEffort?: string) => {
    setShowModelSelector(false);

    try {
      if (modelOps && "setPendingReasoningEffort" in modelOps) {
        (modelOps as { setPendingReasoningEffort: (effort: string | undefined) => void })
          .setPendingReasoningEffort(reasoningEffort);
      }

      const result = await modelOps?.setModel(selectedModel.id);
      const effectiveModel =
        modelOps?.getPendingModel?.()
        ?? await modelOps?.getCurrentModel?.()
        ?? selectedModel.id;
      const effortSuffix = reasoningEffort ? ` (${reasoningEffort})` : "";
      if (result?.requiresNewSession) {
        addMessage("assistant", `Model **${selectedModel.modelID}**${effortSuffix} will be used for the next session.`);
      } else {
        addMessage("assistant", `Switched to model **${selectedModel.modelID}**${effortSuffix}`);
      }

      setCurrentModelId(effectiveModel);
      onModelChange?.(effectiveModel);
      const displaySuffix = agentType === "copilot" && reasoningEffort ? ` (${reasoningEffort})` : "";
      setCurrentModelDisplayName(`${selectedModel.modelID}${displaySuffix}`);
      if (agentType) {
        saveModelPreference(agentType, effectiveModel);
        if (reasoningEffort) {
          saveReasoningEffortPreference(agentType, reasoningEffort);
        } else {
          clearReasoningEffortPreference(agentType);
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      addMessage("assistant", `Failed to switch model: ${errorMessage}`);
    }
  }, [
    addMessage,
    agentType,
    modelOps,
    onModelChange,
    setCurrentModelDisplayName,
    setCurrentModelId,
    setShowModelSelector,
  ]);

  const handleModelSelectorCancel = useCallback(() => {
    setShowModelSelector(false);
  }, [setShowModelSelector]);

  const initialPromptSentRef = useRef(false);
  useEffect(() => {
    if (initialPromptSentRef.current || !initialPrompt) {
      return;
    }

    initialPromptSentRef.current = true;
    const timeoutId = setTimeout(() => {
      const parsed = parseSlashCommand(initialPrompt);
      if (parsed.isCommand) {
        addMessage("user", initialPrompt);
        void executeCommand(parsed.name, parsed.args, "initial_prompt");
        return;
      }

      if (initialPrompt.startsWith("@")) {
        const afterAt = initialPrompt.slice(1);
        const spaceIndex = afterAt.indexOf(" ");
        const agentName = spaceIndex === -1 ? afterAt : afterAt.slice(0, spaceIndex);
        const agentArgs = spaceIndex === -1 ? "" : afterAt.slice(spaceIndex + 1).trim();
        const agentCommand = globalRegistry.get(agentName);
        if (agentCommand && agentCommand.category === "agent") {
          addMessage("user", initialPrompt);
          void executeCommand(agentName, agentArgs, "mention");
          return;
        }
      }

      const { message: processed, filesRead } = processFileMentions(initialPrompt, isAgentCommand);
      emitMessageSubmitTelemetry({
        messageLength: initialPrompt.length,
        queued: false,
        fromInitialPrompt: true,
        hasFileMentions: filesRead.length > 0,
        hasAgentMentions: false,
      });
      sendMessage(processed);
    }, 0);

    return () => clearTimeout(timeoutId);
  }, [
    addMessage,
    emitMessageSubmitTelemetry,
    executeCommand,
    initialPrompt,
    sendMessage,
  ]);

  return {
    addMessage,
    executeCommand,
    handleModelSelect,
    handleModelSelectorCancel,
    sendMessage,
  };
}
