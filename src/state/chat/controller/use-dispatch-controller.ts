import { useCallback, useEffect, useRef, type RefObject } from "react";
import { saveModelPreference, saveReasoningEffortPreference, clearReasoningEffortPreference } from "@/services/config/settings.ts";
import type { Model } from "@/services/models/model-transform.ts";
import { parseSlashCommand } from "@/commands/tui/index.ts";
import { useCommandExecutor } from "@/state/chat/command/index.ts";
import type { DeferredCommandMessage, UseCommandExecutorArgs } from "@/state/chat/shared/types/command.ts";
import type {
  CommandExecutionTrigger,
  MessageSubmitTelemetry,
} from "@/state/chat/shared/types/index.ts";
import type { QueuedMessage } from "@/hooks/use-message-queue.ts";
import { processFileMentions } from "@/lib/ui/mention-parsing.ts";
import { snapshotTaskItems } from "@/state/chat/shared/helpers/workflow-task-state.ts";
import { createMessage } from "@/state/chat/shared/helpers/index.ts";
import {
  finalizeStreamingReasoningInMessage,
  finalizeStreamingReasoningParts,
  finalizeStreamingTextParts,
} from "@/state/parts/index.ts";
import { interruptRunningToolParts } from "@/state/chat/shared/helpers/stream-continuation.ts";
import type { Part, AgentPart } from "@/state/parts/types.ts";
import type { ParallelAgent } from "@/types/parallel-agents.ts";
import type { ChatMessage } from "@/state/chat/shared/types/index.ts";

/**
 * Deep-finalize a streaming message: text parts, reasoning parts, running
 * tool parts (both at top-level and nested inside AgentPart.agents.inlineParts),
 * and parallelAgent statuses. This brings workflow messages to the same
 * finalization level as the normal stream-completion path in
 * use-finalized-completion.ts.
 */
function fullyFinalizeStreamingMessage(
  message: ChatMessage,
  thinkingMs?: number,
): ChatMessage {
  const finalized = finalizeStreamingReasoningInMessage(message);
  const baseParts = finalized.parts ?? [];

  // Finalize top-level parts
  const topLevelFinalized = finalizeStreamingTextParts(
    interruptRunningToolParts(
      finalizeStreamingReasoningParts(baseParts, thinkingMs),
    ) ?? [],
  );

  // Finalize inlineParts nested inside AgentPart agents
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
      const isActive = agent.status === "running" || agent.status === "pending";
      if (isActive) {
        const startedAtMs = new Date(agent.startedAt).getTime();
        agentChanged = true;
        return {
          ...agent,
          status: "completed" as const,
          currentTool: undefined,
          durationMs: Number.isFinite(startedAtMs) ? Math.max(0, Date.now() - startedAtMs) : agent.durationMs,
          ...(changed && nextInlineParts ? { inlineParts: nextInlineParts } : {}),
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

  // Finalize message-level parallelAgents
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
          durationMs: Number.isFinite(startedAtMs) ? Math.max(0, Date.now() - startedAtMs) : agent.durationMs,
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
    ...(finalizedParallelAgents !== existingAgents ? { parallelAgents: finalizedParallelAgents } : {}),
  };
}

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
  getOwnershipTracker,
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
  setCurrentReasoningEffort,
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

  const dispatchQueuedMessage = useCallback((queuedMessage: QueuedMessage) => {
    if (sendMessageRef.current) {
      sendMessageRef.current(
        queuedMessage.content,
        queuedMessage.skipUserMessage ? { skipUserMessage: true } : undefined,
      );
    }
  }, []);

  dispatchQueuedMessageRef.current = dispatchQueuedMessage;
  dispatchDeferredCommandMessageRef.current = dispatchDeferredCommandMessage;

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
          ? fullyFinalizeStreamingMessage(existingMessage, existingMessage.thinkingMs)
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
              ...fullyFinalizeStreamingMessage(message, streamingMetaRef.current?.thinkingMs || message.thinkingMs),
              taskItems: snapshotTaskItems(todoItemsRef.current),
            }
            : message
        );
      });

      setStreamingMessageId(null);
      activeStreamRunIdRef.current = null;

      // Clear completed foreground agents from the live state so the
      // projection effect stops re-applying stale agent data and the
      // footer/spinner reflect the correct count.
      setParallelAgents((current) => current.filter((a) => a.background));
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
    setParallelAgents,
    setStreamingMessageId,
    activeStreamRunIdRef,
    streamingMessageIdRef,
    streamingMetaRef,
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
    getOwnershipTracker,
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
    setCurrentReasoningEffort,
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

  sendMessageRef.current = sendMessage;
  executeCommandRef.current = executeCommand;

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
      setCurrentReasoningEffort(reasoningEffort);
      onModelChange?.(effectiveModel);
      const displaySuffix =
        (agentType === "copilot" || agentType === "opencode" || agentType === "claude") && reasoningEffort
          ? ` (${reasoningEffort})`
          : "";
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
    setCurrentReasoningEffort,
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

    const timeoutId = setTimeout(() => {
      // Set the ref inside the timeout so that if React cleans up before
      // the timeout fires (e.g. Strict Mode double-mount), the ref stays
      // false and the prompt will be sent on the next mount.
      initialPromptSentRef.current = true;

      const parsed = parseSlashCommand(initialPrompt);
      if (parsed.isCommand) {
        addMessage("user", initialPrompt);
        void executeCommand(parsed.name, parsed.args, "initial_prompt");
        return;
      }

      const { message: processed, filesRead } = processFileMentions(initialPrompt);
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
