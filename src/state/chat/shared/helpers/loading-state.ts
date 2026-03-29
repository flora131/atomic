import type { ParallelAgent } from "@/types/parallel-agents.ts";
import { hasActiveBackgroundAgentsForSpinner } from "@/state/parts/guards.ts";

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
  activeBackgroundAgentCount?: number,
  keepAliveForWorkflow?: boolean,
): boolean {
  // When the external count says background agents are running, keep the
  // spinner alive regardless of task-progress or streaming state.
  if (activeBackgroundAgentCount != null && activeBackgroundAgentCount > 0) {
    return true;
  }

  // Always show the spinner while the message is actively streaming,
  // even if all tasks have already completed.  Task completion should
  // only hide the spinner once the stream itself has finished.
  if (message.streaming) {
    return true;
  }

  // During workflow stage transitions the previous stage's message is
  // finalized (streaming=false) before the next stage creates a new
  // streaming message.  Keep the spinner on the last message while the
  // workflow is active to bridge this gap.
  if (keepAliveForWorkflow) {
    return true;
  }

  const taskItems = resolveTaskProgressItems(message, liveTodoItems);
  if (isTaskProgressComplete(taskItems)) {
    return false;
  }

  const agents = message.parallelAgents ?? [];
  const hasActiveBackground = hasActiveBackgroundAgentsForSpinner(agents);

  // Also drive re-renders while foreground agents are running/pending
  // so the elapsed timer in ParallelAgentsTree stays live.
  const hasActiveForeground = agents.some(
    (agent) => !agent.background && (agent.status === "running" || agent.status === "pending"),
  );

  return hasActiveBackground || hasActiveForeground;
}

export function hasLiveLoadingIndicator(
  messages: readonly LoadingStateMessage[],
  liveTodoItems?: readonly TaskProgressItem[],
  activeBackgroundAgentCount?: number,
  keepAliveForWorkflow?: boolean,
): boolean {
  return messages.some((message, index) =>
    shouldShowMessageLoadingIndicator(
      message,
      message.streaming ? liveTodoItems : undefined,
      activeBackgroundAgentCount,
      keepAliveForWorkflow && index === messages.length - 1,
    )
  );
}

/**
 * Context for resolving the loading indicator verb text.
 *
 * Mirrors the information available at the call-site so the function
 * remains a pure, testable helper with no React dependencies.
 */
export interface LoadingIndicatorTextContext {
  /** Whether the foreground stream is still actively producing tokens. */
  isStreaming: boolean;
  /** Optional verb override already set on the message (e.g. "Compacting"). */
  verbOverride?: string;
  /** Milliseconds spent in thinking/reasoning (drives "Reasoning" default). */
  thinkingMs?: number;
}

/**
 * Return the spinner verb text for the loading indicator.
 *
 * Priority chain:
 *   1. Explicit `verbOverride` (e.g. "Compacting", "Running workflow")
 *   2. Thinking-based inference ("Reasoning" vs "Composing")
 */
export function getLoadingIndicatorText(context: LoadingIndicatorTextContext): string {
  // 1. Explicit override always wins.
  if (context.verbOverride) {
    return context.verbOverride;
  }

  // 2. Default verb based on thinking state (matches LoadingIndicator component).
  return context.thinkingMs != null && context.thinkingMs > 0
    ? "Reasoning"
    : "Composing";
}

export function shouldShowCompletionSummary(
  message: { streaming?: boolean; durationMs?: number; wasInterrupted?: boolean },
  hasActiveBackgroundAgents: boolean,
  activeBackgroundAgentCount?: number,
): boolean {
  // Defer the completion summary when the external bus-event count
  // indicates background agents are still running.
  if (activeBackgroundAgentCount != null && activeBackgroundAgentCount > 0) {
    return false;
  }

  return !message.streaming
    && !message.wasInterrupted
    && !hasActiveBackgroundAgents
    && message.durationMs != null
    && message.durationMs >= 1000;
}
