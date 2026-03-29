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

const EMPTY_MAP = new Map<string, string>();

export function useStreamState(messages: ChatMessage[]) {
  const [parallelAgents, setParallelAgents] = useState<ParallelAgent[]>([]);
  const [compactionSummary, setCompactionSummary] = useState<string | null>(null);
  const [showCompactionHistory, setShowCompactionHistory] = useState(false);
  // Value unused — only the setter is consumed (to trigger re-renders during compaction).
  const [_isAutoCompacting, setIsAutoCompacting] = useState(false);
  const [todoItems, setTodoItems] = useState<NormalizedTodoItem[]>([]);
  const [workflowSessionDir, setWorkflowSessionDir] = useState<string | null>(null);
  const [workflowSessionId, setWorkflowSessionId] = useState<string | null>(null);
  const [hasRunningTool, setHasRunningTool] = useState(false);
  const [activeBackgroundAgentCount, setActiveBackgroundAgentCount] = useState(0);
  const [streamingMessageId, setStreamingMessageIdState] = useState<string | null>(null);
  const [lastStreamedMessageId, setLastStreamedMessageIdState] = useState<string | null>(null);
  const [backgroundAgentMessageId, setBackgroundAgentMessageIdState] = useState<string | null>(null);
  const [agentMessageBindings, setAgentMessageBindings] = useState<ReadonlyMap<string, string>>(EMPTY_MAP);
  const [streamingElapsedMs, setStreamingElapsedMs] = useState(0);

  const hasInProgressTask = useMemo(
    () => todoItems.some((item) => item.status === "in_progress"),
    [todoItems],
  );

  const hasLiveLoadingIndicator = useMemo(
    () =>
      activeBackgroundAgentCount > 0
      || hasInProgressTask
      || messages.some((message) => message.streaming)
      // Keep the loading indicator alive during workflow stage transitions.
      // Between stages, the previous message is finalized (streaming=false)
      // before the next stage's message is created.  workflowSessionId
      // remains non-null for the entire workflow execution, bridging the gap.
      || workflowSessionId !== null,
    [activeBackgroundAgentCount, hasInProgressTask, messages, workflowSessionId],
  );

  return {
    // Reactive state values (exposed in final return `state`)
    parallelAgents,
    compactionSummary,
    showCompactionHistory,
    todoItems,
    workflowSessionDir,
    workflowSessionId,
    hasRunningTool,
    activeBackgroundAgentCount,
    streamingMessageId,
    lastStreamedMessageId,
    backgroundAgentMessageId,
    agentMessageBindings,
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
    setHasRunningTool,
    setActiveBackgroundAgentCount,
    setStreamingMessageIdState,
    setLastStreamedMessageIdState,
    setBackgroundAgentMessageIdState,
    setAgentMessageBindings,
    setStreamingElapsedMs,
  };
}

export type UseStreamStateResult = ReturnType<typeof useStreamState>;
