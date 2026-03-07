import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { sortTasksTopologically } from "@/components/task-order.ts";
import type { ChatMessage, WorkflowChatState } from "@/state/chat/types.ts";
import type {
  QuestionAnswer,
  UserQuestion,
} from "@/components/user-question-dialog.tsx";
import type { AskUserQuestionEventData } from "@/services/workflows/graph/index.ts";
import { createMessage } from "@/state/chat/helpers.ts";
import { applyStreamPartEvent } from "@/state/parts/index.ts";
import { normalizeHitlAnswer } from "@/lib/ui/hitl-response.ts";
import { rejectPendingWorkflowInput, type WorkflowInputResolver } from "@/lib/ui/workflow-input-resolver.ts";
import {
  normalizeTodoItems,
  type NormalizedTodoItem,
} from "@/lib/ui/task-status.ts";
import {
  applyTaskSnapshotToLatestAssistantMessage,
  preferTerminalTaskItems,
} from "@/lib/ui/workflow-task-state.ts";

interface UseWorkflowHitlArgs {
  getSession?: () => import("@/services/agents/types.ts").Session | null;
  isStreaming: boolean;
  isStreamingRef: MutableRefObject<boolean>;
  onWorkflowResumeWithAnswer?: (requestId: string, answer: string | string[]) => void;
  setMessagesWindowed: (next: SetStateAction<ChatMessage[]>) => void;
  setTodoItems: Dispatch<SetStateAction<NormalizedTodoItem[]>>;
  setWorkflowSessionDir: Dispatch<SetStateAction<string | null>>;
  setWorkflowSessionId: Dispatch<SetStateAction<string | null>>;
  startAssistantStream: (content: string) => void | import("@/state/runtime/stream-run-runtime.ts").StreamRunHandle | null;
  todoItemsRef: MutableRefObject<NormalizedTodoItem[]>;
  updateWorkflowState: (updates: Partial<WorkflowChatState>) => void;
  waitForUserInputResolverRef: MutableRefObject<WorkflowInputResolver | null>;
  workflowActiveRef: MutableRefObject<boolean>;
  workflowSessionDir: string | null;
  workflowSessionDirRef: MutableRefObject<string | null>;
  workflowSessionIdRef: MutableRefObject<string | null>;
  workflowState: WorkflowChatState;
}

export function useWorkflowHitl({
  getSession,
  isStreaming,
  isStreamingRef,
  onWorkflowResumeWithAnswer,
  setMessagesWindowed,
  setTodoItems,
  setWorkflowSessionDir,
  setWorkflowSessionId,
  startAssistantStream,
  todoItemsRef,
  updateWorkflowState,
  waitForUserInputResolverRef,
  workflowActiveRef,
  workflowSessionDir,
  workflowSessionDirRef,
  workflowSessionIdRef,
  workflowState,
}: UseWorkflowHitlArgs) {
  const [activeQuestion, setActiveQuestion] = useState<UserQuestion | null>(null);
  const [pendingQuestions, setPendingQuestions] = useState<UserQuestion[]>([]);
  const permissionRespondRef = useRef<((answer: string | string[]) => void) | null>(null);
  const askUserQuestionRequestIdRef = useRef<string | null>(null);
  const activeHitlToolCallIdRef = useRef<string | null>(null);
  const workflowStartedRef = useRef<string | null>(null);

  const addPendingQuestion = useCallback((question: UserQuestion) => {
    setPendingQuestions((previous) => [...previous, question]);
  }, []);

  const removePendingQuestion = useCallback((): UserQuestion | undefined => {
    let removed: UserQuestion | undefined;
    setPendingQuestions((previous) => {
      if (previous.length === 0) return previous;
      [removed] = previous;
      return previous.slice(1);
    });
    return removed;
  }, []);

  useEffect(() => {
    if (
      workflowState.workflowActive
      && workflowState.initialPrompt
      && workflowStartedRef.current !== workflowState.initialPrompt
      && !isStreaming
    ) {
      workflowStartedRef.current = workflowState.initialPrompt;

      const timeoutId = setTimeout(() => {
        if (isStreamingRef.current) return;
        startAssistantStream(workflowState.initialPrompt!);
      }, 100);

      return () => clearTimeout(timeoutId);
    }
  }, [isStreaming, isStreamingRef, startAssistantStream, workflowState.initialPrompt, workflowState.workflowActive]);

  useEffect(() => {
    if (!workflowState.workflowActive) {
      workflowStartedRef.current = null;
    }
  }, [workflowState.workflowActive]);

  useEffect(() => {
    workflowActiveRef.current = workflowState.workflowActive;
  }, [workflowActiveRef, workflowState.workflowActive]);

  useEffect(() => {
    if (!workflowState.workflowActive) {
      waitForUserInputResolverRef.current = rejectPendingWorkflowInput(
        waitForUserInputResolverRef.current,
        "Workflow ended before input was received",
      );
    }
  }, [waitForUserInputResolverRef, workflowState.workflowActive]);

  const syncTerminalTaskStateFromSession = useCallback((sessionDir: string) => {
    let diskTasks: NormalizedTodoItem[] = [];
    try {
      const content = readFileSync(join(sessionDir, "tasks.json"), "utf-8");
      diskTasks = normalizeTodoItems(JSON.parse(content));
    } catch {
    }

    const terminalTasks = sortTasksTopologically(
      preferTerminalTaskItems(todoItemsRef.current, diskTasks),
    );
    if (terminalTasks.length === 0) return;

    todoItemsRef.current = terminalTasks;
    setTodoItems(terminalTasks);
    setMessagesWindowed((previousMessages: ChatMessage[]) =>
      applyTaskSnapshotToLatestAssistantMessage(previousMessages, terminalTasks),
    );
  }, [setMessagesWindowed, setTodoItems, todoItemsRef]);

  useEffect(() => {
    if (!workflowState.workflowActive && workflowSessionDir) {
      syncTerminalTaskStateFromSession(workflowSessionDir);
      setWorkflowSessionDir(null);
      setWorkflowSessionId(null);
      workflowSessionDirRef.current = null;
      workflowSessionIdRef.current = null;
    }
  }, [
    setWorkflowSessionDir,
    setWorkflowSessionId,
    syncTerminalTaskStateFromSession,
    workflowSessionDir,
    workflowSessionDirRef,
    workflowSessionIdRef,
    workflowState.workflowActive,
  ]);

  const handleHumanInputRequired = useCallback((question: UserQuestion) => {
    if (activeQuestion) {
      addPendingQuestion(question);
    } else {
      setActiveQuestion(question);
    }
  }, [activeQuestion, addPendingQuestion]);

  const handlePermissionRequest = useCallback((
    requestId: string,
    toolName: string,
    question: string,
    options: Array<{ label: string; value: string; description?: string }>,
    respond: (answer: string | string[]) => void,
    header?: string,
    toolCallId?: string,
  ) => {
    if (workflowState.workflowActive) {
      const autoAnswer = options[0]?.value ?? "allow";
      respond(autoAnswer);
      return;
    }

    permissionRespondRef.current = respond;
    const userQuestion: UserQuestion = {
      header: header || toolName,
      question,
      options: options.map((option) => ({
        label: option.label,
        value: option.value,
        description: option.description,
      })),
      multiSelect: false,
    };

    handleHumanInputRequired(userQuestion);

    const targetToolId = toolCallId ?? activeHitlToolCallIdRef.current;
    if (targetToolId) {
      setMessagesWindowed((previousMessages) =>
        previousMessages.map((message) => {
          const hasToolCall = message.toolCalls?.some((toolCall) => toolCall.id === targetToolId) ?? false;
          const hasToolPart = message.parts?.some(
            (part) => part.type === "tool" && part.toolCallId === targetToolId,
          ) ?? false;
          if (!hasToolCall && !hasToolPart) return message;

          return applyStreamPartEvent(message, {
            type: "tool-hitl-request",
            toolId: targetToolId,
            request: {
              requestId,
              header: header || toolName,
              question,
              options,
              multiSelect: false,
              respond,
            },
          });
        }),
      );
    }
  }, [handleHumanInputRequired, setMessagesWindowed, workflowState.workflowActive]);

  const handleAskUserQuestion = useCallback((eventData: AskUserQuestionEventData) => {
    if (workflowState.workflowActive) {
      const autoAnswer = eventData.options?.[0]?.label ?? "continue";
      if (onWorkflowResumeWithAnswer && eventData.requestId) {
        onWorkflowResumeWithAnswer(eventData.requestId, autoAnswer);
      }
      return;
    }

    askUserQuestionRequestIdRef.current = eventData.requestId;
    const userQuestion: UserQuestion = {
      header: eventData.header || "Question",
      question: eventData.question,
      options: eventData.options?.map((option) => ({
        label: option.label,
        value: option.label,
        description: option.description,
      })) || [],
      multiSelect: false,
    };

    handleHumanInputRequired(userQuestion);
  }, [handleHumanInputRequired, onWorkflowResumeWithAnswer, workflowState.workflowActive]);

  const handleQuestionAnswer = useCallback((answer: QuestionAnswer) => {
    const normalizedHitl = normalizeHitlAnswer(answer);

    const nextQuestion = removePendingQuestion();
    setActiveQuestion(nextQuestion ?? null);

    if (permissionRespondRef.current) {
      if (answer.cancelled) {
        permissionRespondRef.current("deny");
      } else {
        permissionRespondRef.current(answer.selected);
      }
      permissionRespondRef.current = null;
    }

    if (askUserQuestionRequestIdRef.current) {
      const requestId = askUserQuestionRequestIdRef.current;
      askUserQuestionRequestIdRef.current = null;

      if (!answer.cancelled) {
        if (workflowState.workflowActive && onWorkflowResumeWithAnswer) {
          onWorkflowResumeWithAnswer(requestId, answer.selected);
        } else {
          const session = getSession?.();
          if (session) {
            const answerText = Array.isArray(answer.selected)
              ? answer.selected.join(", ")
              : answer.selected;
            void session.send(answerText);
          }
        }
      }
    }

    let answerStoredOnToolCall = false;
    if (activeHitlToolCallIdRef.current) {
      const hitlToolId = activeHitlToolCallIdRef.current;
      activeHitlToolCallIdRef.current = null;
      answerStoredOnToolCall = true;

      setMessagesWindowed((previousMessages) =>
        previousMessages.map((message) => {
          const hasMatchingToolCall = message.toolCalls?.some((toolCall) => toolCall.id === hitlToolId) ?? false;
          const hasMatchingToolPart = message.parts?.some(
            (part) => part.type === "tool" && part.toolCallId === hitlToolId,
          ) ?? false;

          if (hasMatchingToolCall || hasMatchingToolPart) {
            return applyStreamPartEvent(message, {
              type: "tool-hitl-response",
              toolId: hitlToolId,
              response: normalizedHitl,
            });
          }
          return message;
        }),
      );
    }

    if (!answerStoredOnToolCall) {
      const answerText = answer.cancelled
        ? normalizedHitl.displayText
        : Array.isArray(answer.selected)
          ? answer.selected.join(", ")
          : answer.selected;
      setMessagesWindowed((previousMessages) => {
        const streamingIndex = previousMessages.findIndex((message) => message.streaming);
        const answerMessage = createMessage("user", answerText);
        if (streamingIndex >= 0) {
          return [
            ...previousMessages.slice(0, streamingIndex),
            answerMessage,
            ...previousMessages.slice(streamingIndex),
          ];
        }
        return [...previousMessages, answerMessage];
      });
    }

    const selectedArray = Array.isArray(answer.selected) ? answer.selected : [answer.selected];
    if (selectedArray.includes("Approve")) {
      updateWorkflowState({ specApproved: true, pendingApproval: false });
    } else if (selectedArray.includes("Reject")) {
      updateWorkflowState({ specApproved: false, pendingApproval: false });
    }
  }, [getSession, onWorkflowResumeWithAnswer, removePendingQuestion, setMessagesWindowed, updateWorkflowState, workflowState.workflowActive]);

  const resetHitlState = useCallback(() => {
    setActiveQuestion(null);
    setPendingQuestions([]);
    permissionRespondRef.current = null;
    askUserQuestionRequestIdRef.current = null;
    activeHitlToolCallIdRef.current = null;
  }, []);

  return {
    activeHitlToolCallIdRef,
    activeQuestion,
    handleAskUserQuestion,
    handlePermissionRequest,
    handleQuestionAnswer,
    resetHitlState,
  };
}
