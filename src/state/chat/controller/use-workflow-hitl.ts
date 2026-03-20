import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { sortTasksTopologically } from "@/components/task-order.ts";
import { isHitlToolName } from "@/state/streaming/pipeline-tools/shared.ts";
import type { ToolPart } from "@/state/parts/types.ts";
import type { ChatMessage, WorkflowChatState } from "@/state/chat/shared/types/index.ts";
import type {
  QuestionAnswer,
  UserQuestion,
} from "@/state/chat/shared/types/hitl.ts";
import type { AskUserQuestionEventData } from "@/services/workflows/graph/index.ts";
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
  isStreamingRef: RefObject<boolean>;
  onWorkflowResumeWithAnswer?: (requestId: string, answer: string | string[]) => void;
  setMessagesWindowed: (next: SetStateAction<ChatMessage[]>) => void;
  setTodoItems: Dispatch<SetStateAction<NormalizedTodoItem[]>>;
  setWorkflowSessionDir: Dispatch<SetStateAction<string | null>>;
  setWorkflowSessionId: Dispatch<SetStateAction<string | null>>;
  startAssistantStream: (content: string) => void | import("@/state/runtime/stream-run-runtime.ts").StreamRunHandle | null;
  todoItemsRef: RefObject<NormalizedTodoItem[]>;
  updateWorkflowState: (updates: Partial<WorkflowChatState>) => void;
  waitForUserInputResolverRef: RefObject<WorkflowInputResolver | null>;
  workflowActiveRef: RefObject<boolean>;
  workflowSessionDir: string | null;
  workflowSessionDirRef: RefObject<string | null>;
  workflowSessionIdRef: RefObject<string | null>;
  workflowState: WorkflowChatState;
}

interface QueuedQuestionEntry {
  question: UserQuestion;
  requestId: string | null;
  toolCallId: string | null;
  respond?: (answer: string | string[]) => void;
  source: "permission" | "ask-user";
}

interface HitlRequestPayload {
  requestId: string;
  header: string;
  question: string;
  options: Array<{ label: string; value: string; description?: string }>;
  multiSelect: boolean;
  respond: (answer: string | string[]) => void;
}

/**
 * Resolve the correct tool part ID for a HITL request, applying it to the message.
 *
 * Shared by both handlePermissionRequest and handleAskUserQuestion to eliminate
 * the duplicated resolve-and-apply logic.
 */
function resolveAndApplyHitlRequest(
  message: ChatMessage,
  targetToolId: string | null,
  entry: QueuedQuestionEntry,
  payload: HitlRequestPayload,
  hitlToolIdMapRef: RefObject<Map<string, string>>,
  activeQuestionEntryRef: RefObject<QueuedQuestionEntry | null>,
  activeHitlToolCallIdRef: RefObject<string | null>,
  setActiveHitlToolCallId: (id: string | null) => void,
): ChatMessage {
  let resolvedToolId: string | null = targetToolId;

  if (targetToolId) {
    const hasToolPart = message.parts?.some(
      (part) => part.type === "tool" && part.toolCallId === targetToolId,
    ) ?? false;

    if (!hasToolPart) {
      resolvedToolId = null;
    }
  }

  if (!resolvedToolId) {
    const runningHitlPart = message.parts?.find(
      (p) =>
        p.type === "tool" &&
        isHitlToolName((p as ToolPart).toolName) &&
        (p as ToolPart).state.status === "running" &&
        !(p as ToolPart).pendingQuestion &&
        !(p as ToolPart).hitlResponse,
    ) as ToolPart | undefined;
    if (!runningHitlPart) return message;
    resolvedToolId = runningHitlPart.toolCallId;
    if (targetToolId) {
      hitlToolIdMapRef.current.set(targetToolId, resolvedToolId);
    }
    entry.toolCallId = resolvedToolId;
    if (activeQuestionEntryRef.current === entry) {
      activeHitlToolCallIdRef.current = resolvedToolId;
      setActiveHitlToolCallId(resolvedToolId);
    }
  }

  return applyStreamPartEvent(message, {
    type: "tool-hitl-request",
    toolId: resolvedToolId,
    request: payload,
  });
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
  const [activeHitlToolCallId, setActiveHitlToolCallId] = useState<string | null>(null);
  const pendingQuestionsRef = useRef<QueuedQuestionEntry[]>([]);
  const activeHitlToolCallIdRef = useRef<string | null>(null);
  const activeQuestionEntryRef = useRef<QueuedQuestionEntry | null>(null);
  const workflowStartedRef = useRef<string | null>(null);
  /** Maps SDK toolCallId → actual ToolPart.toolCallId when IDs differ */
  const hitlToolIdMapRef = useRef<Map<string, string>>(new Map());
  /** Ref mirror of workflowState to avoid stale closures in callbacks */
  const workflowStateRef = useRef(workflowState);
  workflowStateRef.current = workflowState;

  const setDisplayedQuestion = useCallback((entry: QueuedQuestionEntry | null) => {
    activeQuestionEntryRef.current = entry;
    const toolCallId = entry?.toolCallId ?? null;
    activeHitlToolCallIdRef.current = toolCallId;
    setActiveHitlToolCallId(toolCallId);
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

  if (!workflowState.workflowActive) {
    workflowStartedRef.current = null;
  }
  workflowActiveRef.current = workflowState.workflowActive;

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

  /**
   * Queue or display a HITL question entry and apply the request to messages.
   */
  const enqueueAndApplyHitlRequest = useCallback((
    entry: QueuedQuestionEntry,
    targetToolId: string | null,
    payload: HitlRequestPayload,
  ) => {
    if (activeQuestionEntryRef.current) {
      addPendingQuestion(entry);
    } else {
      setDisplayedQuestion(entry);
    }

    setMessagesWindowed((previousMessages) =>
      previousMessages.map((message) =>
        resolveAndApplyHitlRequest(
          message,
          targetToolId,
          entry,
          payload,
          hitlToolIdMapRef,
          activeQuestionEntryRef,
          activeHitlToolCallIdRef,
          setActiveHitlToolCallId,
        ),
      ),
    );
  }, [addPendingQuestion, setDisplayedQuestion, setMessagesWindowed]);

  const handlePermissionRequest = useCallback((
    requestId: string,
    toolName: string,
    question: string,
    options: Array<{ label: string; value: string; description?: string }>,
    respond: (answer: string | string[]) => void,
    header?: string,
    toolCallId?: string,
  ) => {
    if (workflowStateRef.current.workflowActive) {
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

    const targetToolId = toolCallId ?? null;
    const entry: QueuedQuestionEntry = {
      question: userQuestion,
      requestId,
      toolCallId: targetToolId,
      respond,
      source: "permission",
    };

    enqueueAndApplyHitlRequest(entry, targetToolId, {
      requestId,
      header: header || toolName,
      question,
      options,
      multiSelect: false,
      respond,
    });
  }, [enqueueAndApplyHitlRequest, workflowStateRef]);

  const handleAskUserQuestion = useCallback((eventData: AskUserQuestionEventData) => {
    if (workflowStateRef.current.workflowActive) {
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
    const respond = eventData.respond ?? (() => {});
    const entry: QueuedQuestionEntry = {
      question: userQuestion,
      requestId: eventData.requestId,
      toolCallId: targetToolId,
      respond: eventData.respond,
      source: "ask-user",
    };

    enqueueAndApplyHitlRequest(entry, targetToolId, {
      requestId: eventData.requestId,
      header: eventData.header || "Question",
      question: eventData.question,
      options: mappedOptions,
      multiSelect: false,
      respond,
    });
  }, [enqueueAndApplyHitlRequest, onWorkflowResumeWithAnswer, workflowStateRef]);

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
        if (workflowActiveRef.current && onWorkflowResumeWithAnswer) {
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

    if (answeredEntry?.toolCallId) {
      const rawToolId = answeredEntry.toolCallId;
      const hitlToolId = hitlToolIdMapRef.current.get(rawToolId) ?? rawToolId;

      setMessagesWindowed((previousMessages) =>
        previousMessages.map((message) => {
          const hasMatchingToolPart = message.parts?.some(
            (part) => part.type === "tool" && part.toolCallId === hitlToolId,
          ) ?? false;

          if (hasMatchingToolPart) {
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

    const selectedArray = Array.isArray(answer.selected) ? answer.selected : [answer.selected];
    const currentRalphState = workflowStateRef.current.ralphState;
    const currentCommandState = workflowStateRef.current.workflowCommandState;
    if (selectedArray.includes("Approve")) {
      updateWorkflowState({
        workflowCommandState: { ...currentCommandState, approved: true, pendingApproval: false },
        ralphState: { ...currentRalphState, specApproved: true, pendingApproval: false },
      });
    } else if (selectedArray.includes("Reject")) {
      updateWorkflowState({
        workflowCommandState: { ...currentCommandState, approved: false, pendingApproval: false },
        ralphState: { ...currentRalphState, specApproved: false, pendingApproval: false },
      });
    }
  }, [getSession, onWorkflowResumeWithAnswer, removePendingQuestion, setDisplayedQuestion, setMessagesWindowed, updateWorkflowState]);

  const resetHitlState = useCallback(() => {
    pendingQuestionsRef.current = [];
    hitlToolIdMapRef.current.clear();
    setDisplayedQuestion(null);
  }, [setDisplayedQuestion]);

  return {
    activeHitlToolCallId,
    activeHitlToolCallIdRef,
    activeQuestion,
    handleAskUserQuestion,
    handlePermissionRequest,
    handleQuestionAnswer,
    resetHitlState,
  };
}
