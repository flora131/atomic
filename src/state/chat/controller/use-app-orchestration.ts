import { useCallback, useMemo } from "react";
import type { MutableRefObject } from "react";
import { saveTasksToActiveSession } from "@/commands/tui/workflow-commands.ts";
import type { DeferredCommandMessage } from "@/state/chat/command/executor-types.ts";
import { dispatchNextQueuedMessage, shouldDispatchQueuedMessage } from "@/state/chat/shared/helpers/stream-continuation.ts";
import { normalizeInterruptedTasks, snapshotTaskItems } from "@/state/chat/shared/helpers/workflow-task-state.ts";
import type { UseMessageQueueReturn } from "@/hooks/use-message-queue.ts";
import type { MessageSubmitTelemetry, TaskItem, WorkflowChatState } from "@/state/chat/types.ts";
import type { QueuedMessage } from "@/hooks/use-message-queue.ts";
import type { NormalizedTodoItem } from "@/state/parts/helpers/task-status.ts";

interface UseChatAppOrchestrationArgs {
  applyWorkflowStateUpdate: (
    setState: React.Dispatch<React.SetStateAction<WorkflowChatState>>,
    updates: Partial<WorkflowChatState>,
  ) => void;
  deferredCommandQueueRef: MutableRefObject<DeferredCommandMessage[]>;
  dispatchDeferredCommandMessageRef: MutableRefObject<(message: DeferredCommandMessage) => void>;
  dispatchQueuedMessageRef: MutableRefObject<(message: QueuedMessage) => void>;
  isStreaming: boolean;
  isStreamingRef: MutableRefObject<boolean>;
  isWorkflowTaskUpdate: (
    todos: NormalizedTodoItem[],
    previousTodos?: readonly NormalizedTodoItem[],
  ) => boolean;
  messageQueue: UseMessageQueueReturn;
  onMessageSubmitTelemetry?: (event: MessageSubmitTelemetry) => void;
  runningAskQuestionToolIdsRef: MutableRefObject<Set<string>>;
  setTodoItems: React.Dispatch<React.SetStateAction<NormalizedTodoItem[]>>;
  setWorkflowState: React.Dispatch<React.SetStateAction<WorkflowChatState>>;
  todoItemsRef: MutableRefObject<NormalizedTodoItem[]>;
  workflowSessionIdRef: MutableRefObject<string | null>;
}

export function useChatAppOrchestration({
  applyWorkflowStateUpdate,
  deferredCommandQueueRef,
  dispatchDeferredCommandMessageRef,
  dispatchQueuedMessageRef,
  isStreaming,
  isStreamingRef,
  isWorkflowTaskUpdate,
  messageQueue,
  onMessageSubmitTelemetry,
  runningAskQuestionToolIdsRef,
  setTodoItems,
  setWorkflowState,
  todoItemsRef,
  workflowSessionIdRef,
}: UseChatAppOrchestrationArgs) {
  const continueQueuedConversation = useCallback(() => {
    if (
      shouldDispatchQueuedMessage({
        isStreaming: isStreamingRef.current,
        runningAskQuestionToolCount: runningAskQuestionToolIdsRef.current.size,
      })
    ) {
      const nextDeferred = deferredCommandQueueRef.current.shift();
      if (nextDeferred) {
        dispatchDeferredCommandMessageRef.current(nextDeferred);
        return;
      }
    }

    dispatchNextQueuedMessage<QueuedMessage>(
      () => messageQueue.dequeue(),
      (queuedMessage: QueuedMessage) => {
        dispatchQueuedMessageRef.current(queuedMessage);
      },
      {
        shouldDispatch: () => shouldDispatchQueuedMessage({
          isStreaming: isStreamingRef.current,
          runningAskQuestionToolCount: runningAskQuestionToolIdsRef.current.size,
        }),
      },
    );
  }, [
    deferredCommandQueueRef,
    dispatchDeferredCommandMessageRef,
    dispatchQueuedMessageRef,
    isStreamingRef,
    messageQueue,
    runningAskQuestionToolIdsRef,
  ]);

  const finalizeTaskItemsOnInterrupt = useCallback((): TaskItem[] | undefined => {
    const current = todoItemsRef.current;
    if (current.length === 0) return undefined;

    const updated = normalizeInterruptedTasks(current);
    todoItemsRef.current = updated;
    setTodoItems(updated);

    if (workflowSessionIdRef.current && isWorkflowTaskUpdate(updated)) {
      void saveTasksToActiveSession(updated, workflowSessionIdRef.current);
    }

    return snapshotTaskItems(updated) as TaskItem[] | undefined;
  }, [isWorkflowTaskUpdate, setTodoItems, todoItemsRef, workflowSessionIdRef]);

  const dynamicPlaceholder = useMemo(() => {
    if (messageQueue.count > 0) {
      return "Press ↑ to edit queued messages...";
    }
    if (isStreaming) {
      return "Type a message (enter to enqueue, ctrl+c to interrupt)...";
    }
    return "Enter a message...";
  }, [isStreaming, messageQueue.count]);

  const updateWorkflowState = useCallback((updates: Partial<WorkflowChatState>) => {
    applyWorkflowStateUpdate(setWorkflowState, updates);
  }, [applyWorkflowStateUpdate, setWorkflowState]);

  const emitMessageSubmitTelemetry = useCallback((event: MessageSubmitTelemetry) => {
    onMessageSubmitTelemetry?.(event);
  }, [onMessageSubmitTelemetry]);

  return {
    continueQueuedConversation,
    dynamicPlaceholder,
    emitMessageSubmitTelemetry,
    finalizeTaskItemsOnInterrupt,
    updateWorkflowState,
  };
}
