import { useEffect } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { ParallelAgent } from "@/types/parallel-agents.ts";
import type { NormalizedTodoItem } from "@/state/parts/helpers/task-status.ts";
import type { AgentLifecycleLedger } from "@/lib/ui/agent-lifecycle-ledger.ts";
import type { AgentOrderingEvent } from "@/lib/ui/agent-ordering-contract.ts";
import { StreamRunRuntime } from "@/state/runtime/stream-run-runtime.ts";

interface UseChatRuntimeEffectsArgs {
  activeForegroundRunHandleIdRef: MutableRefObject<string | null>;
  agentLifecycleLedgerRef: MutableRefObject<AgentLifecycleLedger>;
  backgroundProgressSnapshotRef: MutableRefObject<Map<string, { toolUses: number; currentTool?: string }>>;
  deferredCompleteTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  deferredPostCompleteDeltasByAgentRef: MutableRefObject<Map<string, Array<{
    messageId: string;
    runId?: number;
    delta: string;
    completionSequence: number;
  }>>>;
  doneRenderedSequenceByAgentRef: MutableRefObject<Map<string, number>>;
  hasLiveLoadingIndicator: boolean;
  parallelAgents: ParallelAgent[];
  parallelAgentsRef: MutableRefObject<ParallelAgent[]>;
  parallelInterruptHandlerRef: MutableRefObject<(() => void) | null>;
  pendingBackgroundUpdatesRef: MutableRefObject<string[]>;
  setStreamingElapsedMs: Dispatch<SetStateAction<number>>;
  streamRunRuntimeRef: MutableRefObject<StreamRunRuntime>;
  streamingStartRef: MutableRefObject<number | null>;
  todoItems: NormalizedTodoItem[];
  todoItemsRef: MutableRefObject<NormalizedTodoItem[]>;
  workflowSessionDir: string | null;
  workflowSessionDirRef: MutableRefObject<string | null>;
  workflowSessionId: string | null;
  workflowSessionIdRef: MutableRefObject<string | null>;
  completionOrderingEventByAgentRef: MutableRefObject<Map<string, AgentOrderingEvent>>;
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
  useEffect(() => {
    todoItemsRef.current = todoItems;
  }, [todoItems, todoItemsRef]);

  useEffect(() => {
    parallelAgentsRef.current = parallelAgents;
  }, [parallelAgents, parallelAgentsRef]);

  useEffect(() => {
    workflowSessionDirRef.current = workflowSessionDir;
  }, [workflowSessionDir, workflowSessionDirRef]);

  useEffect(() => {
    workflowSessionIdRef.current = workflowSessionId;
  }, [workflowSessionId, workflowSessionIdRef]);

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
