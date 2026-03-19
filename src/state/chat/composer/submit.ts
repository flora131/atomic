import type { MutableRefObject } from "react";
import type { TextareaRenderable } from "@opentui/core";
import { globalRegistry, parseSlashCommand } from "@/commands/tui/index.ts";
import { parseAtMentions, processFileMentions } from "@/lib/ui/mention-parsing.ts";
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
  | "setIsStreaming"
  | "setTodoItems"
  | "setWorkflowSessionDir"
  | "setWorkflowSessionId"
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
  emitMessageSubmitTelemetry,
  executeCommand,
  isStreamingRef,
  kittyKeyboardDetectedRef,
  messageQueue,
  runningAskQuestionToolIdsRef,
  sendMessage,
  setIsStreaming,
  setTodoItems,
  setWorkflowSessionDir,
  setWorkflowSessionId,
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

  if (agentType === "copilot" && workflowSessionDirRef.current) {
    setWorkflowSessionDir(null);
    setWorkflowSessionId(null);
    workflowSessionDirRef.current = null;
    workflowSessionIdRef.current = null;
    workflowTaskIdsRef.current = new Set();
    todoItemsRef.current = [];
    setTodoItems([]);
  }

  if (trimmedValue.startsWith("@")) {
    const isAgentCommand = (name: string): boolean => {
      const cmd = globalRegistry.get(name);
      return cmd?.category === "agent";
    };
    const atMentions = parseAtMentions(trimmedValue, isAgentCommand);
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

  const isAgentCmd = (name: string): boolean => {
    const cmd = globalRegistry.get(name);
    return cmd?.category === "agent";
  };
  const { message: processedValue, filesRead } = processFileMentions(trimmedValue, isAgentCmd);
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

  emitMessageSubmitTelemetry({
    messageLength: trimmedValue.length,
    queued: false,
    fromInitialPrompt: false,
    hasFileMentions,
    hasAgentMentions: false,
  });
  sendMessage(processedValue);
}
