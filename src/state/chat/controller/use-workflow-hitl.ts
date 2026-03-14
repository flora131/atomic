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
import { isHitlToolName } from "@/state/streaming/pipeline-tools/shared.ts";
import type { ToolPart } from "@/state/parts/types.ts";
import type { ChatMessage, WorkflowChatState } from "@/state/chat/shared/types/index.ts";
import type {
  QuestionAnswer,
  UserQuestion,
} from "@/components/user-question-dialog.tsx";
import type { AskUserQuestionEventData } from "@/services/workflows/graph/index.ts";
import { createMessage } from "@/state/chat/shared/helpers/index.ts";
import { applyStreamPartEvent } from "@/state/parts/index.ts";
import { normalizeHitlAnswer } from "@/lib/ui/hitl-response.ts";
import { rejectPendingWorkflowInput, type WorkflowInputResolver } from "@/services/workflows/helpers/workflow-input-resolver.ts";
import {
  normalizeTodoItems,
  type NormalizedTodoItem,
} from "@/state/parts/helpers/task-status.ts";
import {
  applyTaskSnapshotToLatestAssistantMessage,
  preferTerminalTaskItems,
} from "@/state/chat/shared/helpers/workflow-task-state.ts";

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

interface QueuedQuestionEntry {
  question: UserQuestion;
  requestId: string | null;
  toolCallId: string | null;
  respond?: (answer: string | string[]) => void;
  source: "permission" | "ask-user";
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
  const pendingQuestionsRef = useRef<QueuedQuestionEntry[]>([]);
  const activeHitlToolCallIdRef = useRef<string | null>(null);
  const activeQuestionEntryRef = useRef<QueuedQuestionEntry | null>(null);
  const workflowStartedRef = useRef<string | null>(null);
  /** Maps SDK toolCallId → actual ToolPart.toolCallId when IDs differ */
  const hitlToolIdMapRef = useRef<Map<string, string>>(new Map());

  const setDisplayedQuestion = useCallback((entry: QueuedQuestionEntry | null) => {
    activeQuestionEntryRef.current = entry;
    activeHitlToolCallIdRef.current = entry?.toolCallId ?? null;
    setActiveQuestion(entry?.question ?? null);
  }, []);

  const addPendingQuestion = useCallback((entry: QueuedQuestionEntry) => {
    pendingQuestionsRef.current = [...pendingQuestionsRef.current, entry];
  }, []);

  const removePendingQuestion = useCallback((): QueuedQuestionEntry | undefined => {
    const [removed, ...remaining] = pendingQuestionsRef.current;
    pendingQuestionsRef.current = remaining;
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

    const targetToolId = toolCallId ?? activeHitlToolCallIdRef.current;
    const entry: QueuedQuestionEntry = {
      question: userQuestion,
      requestId,
      toolCallId: targetToolId ?? null,
      respond,
      source: "permission",
    };

    if (activeQuestionEntryRef.current) {
      addPendingQuestion(entry);
    } else {
      setDisplayedQuestion(entry);
    }

    setMessagesWindowed((previousMessages) =>
      previousMessages.map((message) => {
        let resolvedToolId: string | null = targetToolId ?? null;

        if (targetToolId) {
          const hasToolCall = message.toolCalls?.some((toolCall) => toolCall.id === targetToolId) ?? false;
          const hasToolPart = message.parts?.some(
            (part) => part.type === "tool" && part.toolCallId === targetToolId,
          ) ?? false;

          if (!hasToolCall && !hasToolPart) {
            resolvedToolId = null;
          }
        }

        if (!resolvedToolId) {
          const runningHitlPart = message.parts?.find(
            (p) =>
              p.type === "tool" &&
              isHitlToolName((p as ToolPart).toolName) &&
              (p as ToolPart).state.status === "running" &&
              !(p as ToolPart).pendingQuestion,
          ) as ToolPart | undefined;
          if (!runningHitlPart) return message;
          resolvedToolId = runningHitlPart.toolCallId;
          if (targetToolId) {
            hitlToolIdMapRef.current.set(targetToolId, resolvedToolId);
          }
          entry.toolCallId = resolvedToolId;
        }

        return applyStreamPartEvent(message, {
          type: "tool-hitl-request",
          toolId: resolvedToolId,
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
  }, [addPendingQuestion, setDisplayedQuestion, setMessagesWindowed, workflowState.workflowActive]);

  const handleAskUserQuestion = useCallback((eventData: AskUserQuestionEventData) => {
    if (workflowState.workflowActive) {
      const autoAnswer = eventData.options?.[0]?.label ?? "continue";
      if (eventData.respond) {
        eventData.respond(autoAnswer);
      } else if (onWorkflowResumeWithAnswer && eventData.requestId) {
        onWorkflowResumeWithAnswer(eventData.requestId, autoAnswer);
      }
      return;
    }

    const mappedOptions = eventData.options?.map((option) => ({
      label: option.label,
      value: option.label,
      description: option.description,
    })) || [];

    const userQuestion: UserQuestion = {
      header: eventData.header || "Question",
      question: eventData.question,
      options: mappedOptions,
      multiSelect: false,
    };

    const targetToolId = eventData.toolCallId ?? null;
    const entry: QueuedQuestionEntry = {
      question: userQuestion,
      requestId: eventData.requestId,
      toolCallId: targetToolId,
      respond: eventData.respond,
      source: "ask-user",
    };

    if (activeQuestionEntryRef.current) {
      addPendingQuestion(entry);
    } else {
      setDisplayedQuestion(entry);
    }

    const respond = eventData.respond ?? (() => {});
    setMessagesWindowed((previousMessages) =>
      previousMessages.map((message) => {
        // Resolve the tool ID: use the provided toolCallId if it matches an
        // existing tool call/part, otherwise fall back to scanning for the
        // most recent running HITL tool part by name.
        let resolvedToolId: string | null = targetToolId;

        if (targetToolId) {
          const hasToolCall = message.toolCalls?.some((toolCall) => toolCall.id === targetToolId) ?? false;
          const hasToolPart = message.parts?.some(
            (part) => part.type === "tool" && part.toolCallId === targetToolId,
          ) ?? false;

          if (!hasToolCall && !hasToolPart) {
            resolvedToolId = null;
          }
        }

        // Fallback: when toolCallId is missing or doesn't match any part
        // (e.g. Claude SDK / Copilot SDK don't always include toolCallId
        // in human_input_required events), find the running HITL tool part.
        if (!resolvedToolId) {
          const runningHitlPart = message.parts?.find(
            (p) =>
              p.type === "tool" &&
              isHitlToolName((p as ToolPart).toolName) &&
              (p as ToolPart).state.status === "running" &&
              !(p as ToolPart).pendingQuestion,
          ) as ToolPart | undefined;
          if (!runningHitlPart) return message;
          resolvedToolId = runningHitlPart.toolCallId;
          if (targetToolId) {
            hitlToolIdMapRef.current.set(targetToolId, resolvedToolId);
          }
          // Backfill the entry's toolCallId so handleQuestionAnswer can
          // match the answer back to the correct tool part later.
          entry.toolCallId = resolvedToolId;
        }

        return applyStreamPartEvent(message, {
          type: "tool-hitl-request",
          toolId: resolvedToolId,
          request: {
            requestId: eventData.requestId,
            header: eventData.header || "Question",
            question: eventData.question,
            options: mappedOptions,
            multiSelect: false,
            respond,
          },
        });
      }),
    );
  }, [addPendingQuestion, onWorkflowResumeWithAnswer, setDisplayedQuestion, setMessagesWindowed, workflowState.workflowActive]);

  const handleQuestionAnswer = useCallback((answer: QuestionAnswer) => {
    const normalizedHitl = normalizeHitlAnswer(answer);
    const answeredEntry = activeQuestionEntryRef.current;

    const nextQuestion = removePendingQuestion();
    setDisplayedQuestion(nextQuestion ?? null);

    if (answeredEntry?.respond) {
      if (answer.cancelled) {
        answeredEntry.respond("deny");
      } else {
        answeredEntry.respond(answer.selected);
      }
    }

    if (
      answeredEntry?.source === "ask-user"
      && answeredEntry.requestId
      && !answeredEntry.respond
    ) {
      const { requestId } = answeredEntry;

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
    if (answeredEntry?.toolCallId) {
      const rawToolId = answeredEntry.toolCallId;
      const hitlToolId = hitlToolIdMapRef.current.get(rawToolId) ?? rawToolId;
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
        answerMessage.hitlContext = {
          question: answeredEntry?.question.question ?? "",
          header: answeredEntry?.question.header ?? "Question",
          answer: answerText,
          cancelled: answer.cancelled,
          responseMode: normalizedHitl.responseMode,
        };
        if (streamingIndex >= 0) {
          return [
            ...previousMessages.slice(0, streamingIndex),
            answerMessage,
            ...previousMessages.slice(streamingIndex),
          ];
        }
        return [...previousMessages, answerMessage];
      });
    } else {
      // Tool call already stores the answer on the part — also insert a visible
      // HITL-context user message into the conversation stream so the Q&A is
      // rendered as a dedicated widget the user can see.
      const answerText = answer.cancelled
        ? normalizedHitl.displayText
        : Array.isArray(answer.selected)
          ? answer.selected.join(", ")
          : answer.selected;
      setMessagesWindowed((previousMessages) => {
        const streamingIndex = previousMessages.findIndex((message) => message.streaming);
        const hitlMessage = createMessage("user", answerText);
        hitlMessage.hitlContext = {
          question: answeredEntry?.question.question ?? "",
          header: answeredEntry?.question.header ?? "Question",
          answer: answerText,
          cancelled: answer.cancelled,
          responseMode: normalizedHitl.responseMode,
        };
        if (streamingIndex >= 0) {
          return [
            ...previousMessages.slice(0, streamingIndex),
            hitlMessage,
            ...previousMessages.slice(streamingIndex),
          ];
        }
        return [...previousMessages, hitlMessage];
      });
    }

    const selectedArray = Array.isArray(answer.selected) ? answer.selected : [answer.selected];
    if (selectedArray.includes("Approve")) {
      updateWorkflowState({ ralphState: { ...workflowState.ralphState, specApproved: true, pendingApproval: false } });
    } else if (selectedArray.includes("Reject")) {
      updateWorkflowState({ ralphState: { ...workflowState.ralphState, specApproved: false, pendingApproval: false } });
    }
  }, [getSession, onWorkflowResumeWithAnswer, removePendingQuestion, setMessagesWindowed, updateWorkflowState, workflowState.workflowActive]);

  const resetHitlState = useCallback(() => {
    pendingQuestionsRef.current = [];
    setDisplayedQuestion(null);
  }, [setDisplayedQuestion]);

  return {
    activeHitlToolCallIdRef,
    activeQuestion,
    handleAskUserQuestion,
    handlePermissionRequest,
    handleQuestionAnswer,
    resetHitlState,
  };
}
