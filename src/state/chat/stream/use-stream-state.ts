/**
 * Stream State Hook
 *
 * Owns all reactive state (useState) and derived memos (useMemo) for the
 * chat stream runtime. Extracted from use-runtime.ts to isolate state
 * declarations from ref management and action definitions.
 */

import { useMemo, useState } from "react";
import type { NormalizedTodoItem } from "@/state/parts/helpers/task-status.ts";
import type { ParallelAgent } from "@/types/parallel-agents.ts";
import type { ChatMessage } from "@/state/chat/shared/types/index.ts";

export function useStreamState(messages: ChatMessage[]) {
  const [parallelAgents, setParallelAgents] = useState<ParallelAgent[]>([]);
  const [compactionSummary, setCompactionSummary] = useState<string | null>(null);
  const [showCompactionHistory, setShowCompactionHistory] = useState(false);
  const [_isAutoCompacting, setIsAutoCompacting] = useState(false);
  const [todoItems, setTodoItems] = useState<NormalizedTodoItem[]>([]);
  const [workflowSessionDir, setWorkflowSessionDir] = useState<string | null>(null);
  const [workflowSessionId, setWorkflowSessionId] = useState<string | null>(null);
  const [toolCompletionVersion, setToolCompletionVersion] = useState(0);
  const [activeBackgroundAgentCount, setActiveBackgroundAgentCount] = useState(0);
  const [agentAnchorSyncVersion, setAgentAnchorSyncVersion] = useState(0);
  const [streamingElapsedMs, setStreamingElapsedMs] = useState(0);

  const hasInProgressTask = useMemo(
    () => todoItems.some((item) => item.status === "in_progress"),
    [todoItems],
  );

  const hasLiveLoadingIndicator = useMemo(
    () => activeBackgroundAgentCount > 0 || hasInProgressTask || messages.some((message) => message.streaming),
    [activeBackgroundAgentCount, hasInProgressTask, messages],
  );

  return {
    // Reactive state values (exposed in final return `state`)
    parallelAgents,
    compactionSummary,
    showCompactionHistory,
    todoItems,
    workflowSessionDir,
    workflowSessionId,
    toolCompletionVersion,
    activeBackgroundAgentCount,
    agentAnchorSyncVersion,
    streamingElapsedMs,
    // Derived memos
    hasInProgressTask,
    hasLiveLoadingIndicator,
    // State setters
    setParallelAgents,
    setCompactionSummary,
    setShowCompactionHistory,
    setIsAutoCompacting,
    setTodoItems,
    setWorkflowSessionDir,
    setWorkflowSessionId,
    setToolCompletionVersion,
    setActiveBackgroundAgentCount,
    setAgentAnchorSyncVersion,
    setStreamingElapsedMs,
  };
}

export type UseStreamStateResult = ReturnType<typeof useStreamState>;
