import type { ParallelAgent } from "../components/parallel-agents-tree.tsx";

type TaskProgressStatus = "pending" | "in_progress" | "completed" | "error";

export interface TaskProgressItem {
  status: TaskProgressStatus;
}

export interface LoadingStateMessage {
  streaming?: boolean;
  parallelAgents?: readonly ParallelAgent[];
  taskItems?: readonly TaskProgressItem[];
}

function resolveTaskProgressItems(
  message: {
    streaming?: boolean;
    taskItems?: readonly TaskProgressItem[];
  },
  liveTodoItems?: readonly TaskProgressItem[],
): readonly TaskProgressItem[] | undefined {
  if (message.streaming && liveTodoItems && liveTodoItems.length > 0) {
    return liveTodoItems;
  }
  return message.taskItems;
}

export function isTaskProgressComplete(taskItems?: readonly TaskProgressItem[] | null): boolean {
  if (!taskItems || taskItems.length === 0) {
    return false;
  }
  return taskItems.every((task) => task.status === "completed");
}

export function shouldShowMessageLoadingIndicator(
  message: LoadingStateMessage,
  liveTodoItems?: readonly TaskProgressItem[],
): boolean {
  const taskItems = resolveTaskProgressItems(message, liveTodoItems);
  if (isTaskProgressComplete(taskItems)) {
    return false;
  }

  const hasActiveBackgroundAgents = (message.parallelAgents ?? []).some(
    (agent) => agent.background && agent.status === "background",
  );

  return Boolean(message.streaming) || hasActiveBackgroundAgents;
}

export function hasLiveLoadingIndicator(
  messages: readonly LoadingStateMessage[],
  liveTodoItems?: readonly TaskProgressItem[],
): boolean {
  return messages.some((message) =>
    shouldShowMessageLoadingIndicator(
      message,
      message.streaming ? liveTodoItems : undefined,
    )
  );
}

export function shouldShowCompletionSummary(
  message: { streaming?: boolean; durationMs?: number },
  hasActiveBackgroundAgents: boolean,
): boolean {
  return !message.streaming
    && !hasActiveBackgroundAgents
    && message.durationMs != null
    && message.durationMs >= 1000;
}
