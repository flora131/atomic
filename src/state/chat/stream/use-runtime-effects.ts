import { useEffect } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { ParallelAgent } from "@/types/parallel-agents.ts";
import type { NormalizedTodoItem } from "@/state/parts/helpers/task-status.ts";
import type { AgentLifecycleLedger } from "@/state/chat/shared/helpers/agent-lifecycle-ledger.ts";
import type { AgentOrderingEvent } from "@/state/chat/shared/helpers/agent-ordering-contract.ts";
import { StreamRunRuntime } from "@/state/runtime/stream-run-runtime.ts";

interface UseChatRuntimeEffectsArgs {
  activeForegroundRunHandleIdRef: RefObject<string | null>;
  agentLifecycleLedgerRef: RefObject<AgentLifecycleLedger>;
  backgroundProgressSnapshotRef: RefObject<Map<string, { toolUses: number; currentTool?: string }>>;
  deferredCompleteTimeoutRef: RefObject<ReturnType<typeof setTimeout> | null>;
  deferredPostCompleteDeltasByAgentRef: RefObject<Map<string, Array<{
    messageId: string;
    runId?: number;
    delta: string;
    completionSequence: number;
  }>>>;
  doneRenderedSequenceByAgentRef: RefObject<Map<string, number>>;
  hasLiveLoadingIndicator: boolean;
  parallelAgents: ParallelAgent[];
  parallelAgentsRef: RefObject<ParallelAgent[]>;
  parallelInterruptHandlerRef: RefObject<(() => void) | null>;
  pendingBackgroundUpdatesRef: RefObject<string[]>;
  setStreamingElapsedMs: Dispatch<SetStateAction<number>>;
  streamRunRuntimeRef: RefObject<StreamRunRuntime>;
  streamingStartRef: RefObject<number | null>;
  todoItems: NormalizedTodoItem[];
  todoItemsRef: RefObject<NormalizedTodoItem[]>;
  workflowSessionDir: string | null;
  workflowSessionDirRef: RefObject<string | null>;
  workflowSessionId: string | null;
  workflowSessionIdRef: RefObject<string | null>;
  completionOrderingEventByAgentRef: RefObject<Map<string, AgentOrderingEvent>>;
}

export function useChatRuntimeEffects({
  activeForegroundRunHandleIdRef,
  agentLifecycleLedgerRef,
  backgroundProgressSnapshotRef,
  completionOrderingEventByAgentRef,
  deferredCompleteTimeoutRef,
  deferredPostCompleteDeltasByAgentRef,
  doneRenderedSequenceByAgentRef,
  hasLiveLoadingIndicator,
  parallelAgents,
  parallelAgentsRef,
  parallelInterruptHandlerRef,
  pendingBackgroundUpdatesRef,
  setStreamingElapsedMs,
  streamRunRuntimeRef,
  streamingStartRef,
  todoItems,
  todoItemsRef,
  workflowSessionDir,
  workflowSessionDirRef,
  workflowSessionId,
  workflowSessionIdRef,
}: UseChatRuntimeEffectsArgs) {
  // Sync refs during render (not in useEffect) so callbacks always see
  // the latest values, even when called before post-render effects fire.
  // This pattern is already used in use-message-queue.ts:137.
  todoItemsRef.current = todoItems;
  parallelAgentsRef.current = parallelAgents;
  workflowSessionDirRef.current = workflowSessionDir;
  workflowSessionIdRef.current = workflowSessionId;

  useEffect(() => {
    if (!hasLiveLoadingIndicator || !streamingStartRef.current) {
      setStreamingElapsedMs(0);
      return;
    }
    setStreamingElapsedMs(Math.floor((Date.now() - streamingStartRef.current) / 1000) * 1000);
    const interval = setInterval(() => {
      if (streamingStartRef.current) {
        setStreamingElapsedMs(Math.floor((Date.now() - streamingStartRef.current) / 1000) * 1000);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [hasLiveLoadingIndicator, setStreamingElapsedMs, streamingStartRef]);

  useEffect(() => {
    return () => {
      if (deferredCompleteTimeoutRef.current) {
        clearTimeout(deferredCompleteTimeoutRef.current);
      }
      backgroundProgressSnapshotRef.current.clear();
      agentLifecycleLedgerRef.current.clear();
      completionOrderingEventByAgentRef.current.clear();
      doneRenderedSequenceByAgentRef.current.clear();
      deferredPostCompleteDeltasByAgentRef.current.clear();
      pendingBackgroundUpdatesRef.current = [];
      parallelInterruptHandlerRef.current = null;
      streamRunRuntimeRef.current.clear();
      activeForegroundRunHandleIdRef.current = null;
    };
  }, [
    activeForegroundRunHandleIdRef,
    agentLifecycleLedgerRef,
    backgroundProgressSnapshotRef,
    completionOrderingEventByAgentRef,
    deferredCompleteTimeoutRef,
    deferredPostCompleteDeltasByAgentRef,
    doneRenderedSequenceByAgentRef,
    parallelInterruptHandlerRef,
    pendingBackgroundUpdatesRef,
    streamRunRuntimeRef,
  ]);
}
