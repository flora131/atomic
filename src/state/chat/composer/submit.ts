import type { RefObject } from "react";
import type { TextareaRenderable } from "@opentui/core";
import { globalRegistry, parseSlashCommand } from "@/commands/tui/index.ts";
import { processFileMentions } from "@/lib/ui/mention-parsing.ts";
import { shouldApplyBackslashLineContinuation } from "@/state/chat/shared/helpers/newline-strategies.ts";
import { shouldDeferComposerSubmit } from "@/state/chat/shared/helpers/stream-continuation.ts";
import { consumeWorkflowInputSubmission } from "@/services/workflows/helpers/workflow-input-resolver.ts";
import type { UseComposerControllerArgs } from "@/state/chat/composer/types.ts";

interface HandleComposerSubmitArgs extends Pick<
  UseComposerControllerArgs,
  | "addMessage"
  | "agentType"
  | "emitMessageSubmitTelemetry"
  | "executeCommand"
  | "isStreamingRef"
  | "messageQueue"
  | "runningAskQuestionToolIdsRef"
  | "sendMessage"
  | "setTodoItems"
  | "setWorkflowSessionDir"
  | "setWorkflowSessionId"
  | "todoItemsRef"
  | "waitForUserInputResolverRef"
  | "workflowSessionDirRef"
  | "workflowSessionIdRef"
  | "workflowState"
  | "workflowTaskIdsRef"
> {
  appendPromptHistory: (value: string) => void;
  clearComposerAutocomplete: () => void;
  kittyKeyboardDetectedRef: RefObject<boolean>;
  textareaRef: RefObject<TextareaRenderable | null>;
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
  emitMessageSubmitTelemetry,
  executeCommand,
  isStreamingRef,
  kittyKeyboardDetectedRef,
  messageQueue,
  runningAskQuestionToolIdsRef,
  sendMessage,
  setTodoItems,
  setWorkflowSessionDir,
  setWorkflowSessionId,
  textareaRef,
  todoItemsRef,
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
    if (agentType === "copilot" && workflowSessionDirRef.current) {
      const cmd = globalRegistry.get(parsed.name);
      const isWorkflowCommand = cmd?.category === "workflow";
      if (!isWorkflowCommand) {
        setWorkflowSessionDir(null);
        setWorkflowSessionId(null);
        workflowSessionDirRef.current = null;
        workflowSessionIdRef.current = null;
        workflowTaskIdsRef.current = new Set();
        todoItemsRef.current = [];
        setTodoItems([]);
      }
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

  // Don't clear workflow session state during an active workflow —
  // the message will be enqueued for the conductor.
  if (agentType === "copilot" && workflowSessionDirRef.current && !workflowState.workflowActive) {
    setWorkflowSessionDir(null);
    setWorkflowSessionId(null);
    workflowSessionDirRef.current = null;
    workflowSessionIdRef.current = null;
    workflowTaskIdsRef.current = new Set();
    todoItemsRef.current = [];
    setTodoItems([]);
  }

  const { message: processedValue, filesRead } = processFileMentions(trimmedValue);
  const hasFileMentions = filesRead.length > 0;

  if (isStreamingRef.current) {
    emitMessageSubmitTelemetry({
      messageLength: trimmedValue.length,
      queued: true,
      fromInitialPrompt: false,
      hasFileMentions,
      hasAgentMentions: false,
    });
    messageQueue.enqueue(processedValue);
    return;
  }

  // During a workflow interrupt gap (active workflow, not streaming, no
  // resolver yet), enqueue the message for the conductor's
  // checkQueuedMessage to pick up. This closes the race condition between
  // interruptStreaming() resetting isStreamingRef and the conductor's
  // waitForResumeInput() setting the resolver.
  if (workflowState.workflowActive) {
    emitMessageSubmitTelemetry({
      messageLength: trimmedValue.length,
      queued: true,
      fromInitialPrompt: false,
      hasFileMentions,
      hasAgentMentions: false,
    });
    messageQueue.enqueue(processedValue);
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
