import type { MutableRefObject } from "react";
import type { TextareaRenderable } from "@opentui/core";
import { parseSlashCommand } from "@/commands/tui/index.ts";
import { finalizeStreamingReasoningInMessage, finalizeStreamingReasoningParts } from "@/state/parts/index.ts";
import { parseAtMentions, processFileMentions } from "@/lib/ui/mention-parsing.ts";
import { shouldApplyBackslashLineContinuation } from "@/lib/ui/newline-strategies.ts";
import {
  interruptRunningToolCalls,
  interruptRunningToolParts,
  shouldDeferComposerSubmit,
} from "@/lib/ui/stream-continuation.ts";
import { consumeWorkflowInputSubmission } from "@/lib/ui/workflow-input-resolver.ts";
import type { ChatMessage } from "@/state/chat/types.ts";
import type { UseComposerControllerArgs } from "@/state/chat/composer/types.ts";

interface HandleComposerSubmitArgs extends Pick<
  UseComposerControllerArgs,
  | "addMessage"
  | "agentType"
  | "clearDeferredCompletion"
  | "currentModelRef"
  | "emitMessageSubmitTelemetry"
  | "executeCommand"
  | "finalizeTaskItemsOnInterrupt"
  | "finalizeThinkingSourceTracking"
  | "getActiveStreamRunId"
  | "isStreamingRef"
  | "lastStreamingContentRef"
  | "messageQueue"
  | "onInterrupt"
  | "parallelAgentsRef"
  | "parallelInterruptHandlerRef"
  | "resolveTrackedRun"
  | "runningAskQuestionToolIdsRef"
  | "sendMessage"
  | "separateAndInterruptAgents"
  | "setIsStreaming"
  | "setMessagesWindowed"
  | "setParallelAgents"
  | "setTodoItems"
  | "setWorkflowSessionDir"
  | "setWorkflowSessionId"
  | "shouldHideActiveStreamContent"
  | "stopSharedStreamState"
  | "streamingMessageIdRef"
  | "streamingMetaRef"
  | "streamingStartRef"
  | "todoItemsRef"
  | "updateWorkflowState"
  | "waitForUserInputResolverRef"
  | "workflowSessionDirRef"
  | "workflowSessionIdRef"
  | "workflowState"
  | "workflowTaskIdsRef"
> {
  appendPromptHistory: (value: string) => void;
  clearComposerAutocomplete: () => void;
  kittyKeyboardDetectedRef: MutableRefObject<boolean>;
  textareaRef: MutableRefObject<TextareaRenderable | null>;
}

function replaceTextareaValue(textarea: TextareaRenderable, value: string) {
  textarea.gotoBufferHome();
  textarea.gotoBufferEnd({ select: true });
  textarea.deleteChar();
  if (value) {
    textarea.insertText(value);
  }
}

export function handleComposerSubmit({
  addMessage,
  agentType,
  appendPromptHistory,
  clearComposerAutocomplete,
  clearDeferredCompletion,
  currentModelRef,
  emitMessageSubmitTelemetry,
  executeCommand,
  finalizeTaskItemsOnInterrupt,
  finalizeThinkingSourceTracking,
  getActiveStreamRunId,
  isStreamingRef,
  kittyKeyboardDetectedRef,
  lastStreamingContentRef,
  messageQueue,
  onInterrupt,
  parallelAgentsRef,
  parallelInterruptHandlerRef,
  resolveTrackedRun,
  runningAskQuestionToolIdsRef,
  sendMessage,
  separateAndInterruptAgents,
  setIsStreaming,
  setMessagesWindowed,
  setParallelAgents,
  setTodoItems,
  setWorkflowSessionDir,
  setWorkflowSessionId,
  shouldHideActiveStreamContent,
  stopSharedStreamState,
  streamingMessageIdRef,
  streamingMetaRef,
  streamingStartRef,
  textareaRef,
  todoItemsRef,
  updateWorkflowState,
  waitForUserInputResolverRef,
  workflowSessionDirRef,
  workflowSessionIdRef,
  workflowState,
  workflowTaskIdsRef,
}: HandleComposerSubmitArgs): void {
  const value = textareaRef.current?.plainText ?? "";
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return;
  }

  if (shouldApplyBackslashLineContinuation(value, kittyKeyboardDetectedRef.current)) {
    const textarea = textareaRef.current;
    if (textarea) {
      replaceTextareaValue(textarea, value.slice(0, -1) + "\n");
    }
    return;
  }

  if (shouldDeferComposerSubmit({
    isStreaming: isStreamingRef.current,
    runningAskQuestionToolCount: runningAskQuestionToolIdsRef.current.size,
  })) {
    return;
  }

  appendPromptHistory(trimmedValue);

  const textarea = textareaRef.current;
  if (textarea) {
    replaceTextareaValue(textarea, "");
  }

  clearComposerAutocomplete();

  const parsed = parseSlashCommand(trimmedValue);
  if (parsed.isCommand) {
    if (agentType === "copilot" && workflowSessionDirRef.current && parsed.name !== "ralph") {
      setWorkflowSessionDir(null);
      setWorkflowSessionId(null);
      workflowSessionDirRef.current = null;
      workflowSessionIdRef.current = null;
      workflowTaskIdsRef.current = new Set();
      todoItemsRef.current = [];
      setTodoItems([]);
    }

    addMessage("user", trimmedValue);
    void executeCommand(parsed.name, parsed.args, "input");
    return;
  }

  if (waitForUserInputResolverRef.current) {
    const workflowInput = consumeWorkflowInputSubmission(
      waitForUserInputResolverRef.current,
      workflowState.workflowActive,
      trimmedValue,
    );
    waitForUserInputResolverRef.current = workflowInput.nextResolver;
    if (workflowInput.consumed) {
      addMessage("user", trimmedValue);
      return;
    }
  }

  if (agentType === "copilot" && workflowSessionDirRef.current && !trimmedValue.startsWith("/ralph")) {
    setWorkflowSessionDir(null);
    setWorkflowSessionId(null);
    workflowSessionDirRef.current = null;
    workflowSessionIdRef.current = null;
    workflowTaskIdsRef.current = new Set();
    todoItemsRef.current = [];
    setTodoItems([]);
  }

  if (trimmedValue.startsWith("@")) {
    const atMentions = parseAtMentions(trimmedValue);
    if (atMentions.length > 0) {
      if (isStreamingRef.current) {
        emitMessageSubmitTelemetry({
          messageLength: trimmedValue.length,
          queued: true,
          fromInitialPrompt: false,
          hasFileMentions: false,
          hasAgentMentions: true,
        });
        messageQueue.enqueue(trimmedValue);
        return;
      }

      emitMessageSubmitTelemetry({
        messageLength: trimmedValue.length,
        queued: false,
        fromInitialPrompt: false,
        hasFileMentions: false,
        hasAgentMentions: true,
      });
      addMessage("user", trimmedValue);
      isStreamingRef.current = true;
      setIsStreaming(true);

      for (const mention of atMentions) {
        void executeCommand(mention.agentName, mention.args, "mention");
      }
      return;
    }
  }

  const { message: processedValue, filesRead } = processFileMentions(trimmedValue);
  const hasFileMentions = filesRead.length > 0;

  if (isStreamingRef.current) {
    clearDeferredCompletion();
    const currentAgents = parallelAgentsRef.current;
    const { interruptedAgents, remainingLiveAgents } = separateAndInterruptAgents(currentAgents);
    parallelAgentsRef.current = remainingLiveAgents;
    setParallelAgents(remainingLiveAgents);

    const interruptedId = streamingMessageIdRef.current;
    const interruptedTaskItems = finalizeTaskItemsOnInterrupt();
    if (interruptedId) {
      const durationMs = streamingStartRef.current ? Date.now() - streamingStartRef.current : undefined;
      const finalMeta = streamingMetaRef.current;
      setMessagesWindowed((previousMessages: ChatMessage[]) =>
        previousMessages.map((message: ChatMessage) =>
          message.id === interruptedId
            ? {
              ...finalizeStreamingReasoningInMessage(message),
              wasInterrupted: true,
              streaming: false,
              durationMs,
              modelId: currentModelRef.current,
              outputTokens: finalMeta?.outputTokens,
              thinkingMs: finalMeta?.thinkingMs,
              thinkingText: finalMeta?.thinkingText || undefined,
              toolCalls: interruptRunningToolCalls(message.toolCalls),
              parts: interruptRunningToolParts(
                finalizeStreamingReasoningParts(message.parts ?? [], finalMeta?.thinkingMs || message.thinkingMs),
              ),
              taskItems: interruptedTaskItems,
              parallelAgents: interruptedAgents,
            }
            : message,
        ),
      );
    }

    stopSharedStreamState();
    finalizeThinkingSourceTracking();
    const interruptedRunId = getActiveStreamRunId();
    const hideInterruptedMessage = shouldHideActiveStreamContent();
    resolveTrackedRun("interrupt", {
      content: lastStreamingContentRef.current,
      wasInterrupted: true,
    }, { runId: interruptedRunId });
    if (hideInterruptedMessage && interruptedId) {
      setMessagesWindowed((previousMessages: ChatMessage[]) =>
        previousMessages.filter((message: ChatMessage) => message.id !== interruptedId),
      );
    }

    onInterrupt?.();
    parallelInterruptHandlerRef.current?.();
    emitMessageSubmitTelemetry({
      messageLength: trimmedValue.length,
      queued: false,
      fromInitialPrompt: false,
      hasFileMentions,
      hasAgentMentions: false,
    });
    sendMessage(processedValue);
    return;
  }

  emitMessageSubmitTelemetry({
    messageLength: trimmedValue.length,
    queued: false,
    fromInitialPrompt: false,
    hasFileMentions,
    hasAgentMentions: false,
  });
  sendMessage(processedValue);
}
