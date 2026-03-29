/**
 * Stream Refs Hook
 *
 * Owns all mutable ref declarations (useRef) for the chat stream runtime.
 * Extracted from use-runtime.ts to isolate ref management from state and
 * action logic. Groups refs into semantic categories via JSDoc.
 */

import { useRef } from "react";
import type { AutoCompactionIndicatorState } from "@/state/chat/shared/helpers/auto-compaction-lifecycle.ts";
import type { SessionLoopFinishReason } from "@/state/chat/shared/helpers/stream-continuation.ts";
import { createAgentLifecycleLedger } from "@/state/chat/shared/helpers/agent-lifecycle-ledger.ts";
import type { AgentOrderingEvent } from "@/state/chat/shared/helpers/agent-ordering-contract.ts";
import { createAgentOrderingState } from "@/state/chat/shared/helpers/agent-ordering-contract.ts";
import { createLoadedSkillTrackingSet } from "@/state/chat/shared/helpers/skill-load-tracking.ts";
import { StreamRunRuntime } from "@/state/runtime/stream-run-runtime.ts";
import type { StreamingMeta, ThinkingDropDiagnostics } from "@/state/chat/shared/types/index.ts";
import { createThinkingDropDiagnostics } from "@/state/chat/shared/helpers/index.ts";
import type { ParallelAgent } from "@/types/parallel-agents.ts";
import type { NormalizedTodoItem } from "@/state/parts/helpers/task-status.ts";
import type { ChatMessage } from "@/state/chat/shared/types/index.ts";

export function useStreamRefs(messages: ChatMessage[]) {
  /** Auto-compaction indicator (paired with useState for _isAutoCompacting) */
  const autoCompactionIndicatorRef = useRef<AutoCompactionIndicatorState>({ status: "idle" });

  // -- Streaming lifecycle refs --
  const streamingMessageIdRef = useRef<string | null>(null);
  const activeStreamRunIdRef = useRef<number | null>(null);
  const nextRunIdFloorRef = useRef<number | null>(null);
  const lastTurnFinishReasonRef = useRef<SessionLoopFinishReason | null>(null);
  const lastStreamedMessageIdRef = useRef<string | null>(null);
  const backgroundAgentMessageIdRef = useRef<string | null>(null);
  const streamingStartRef = useRef<number | null>(null);
  const isStreamingRef = useRef(false);
  const streamingMetaRef = useRef<StreamingMeta | null>(null);
  const lastStreamingContentRef = useRef("");
  const wasInterruptedRef = useRef(false);
  const isAgentOnlyStreamRef = useRef(false);

  // -- Stream run runtime --
  const streamRunRuntimeRef = useRef<StreamRunRuntime>(null as unknown as StreamRunRuntime);
  if (!streamRunRuntimeRef.current) {
    streamRunRuntimeRef.current = new StreamRunRuntime();
  }
  const activeForegroundRunHandleIdRef = useRef<string | null>(null);
  const awaitedStreamRunIdsRef = useRef<Set<string>>(new Set());

  // -- Tool tracking refs --
  const hasRunningToolRef = useRef(false);
  const runningBlockingToolIdsRef = useRef<Set<string>>(new Set());
  const runningAskQuestionToolIdsRef = useRef<Set<string>>(new Set());
  const toolNameByIdRef = useRef<Map<string, string>>(new Map());
  const toolMessageIdByIdRef = useRef<Map<string, string>>(new Map());

  // -- Agent lifecycle refs --
  const agentMessageIdByIdRef = useRef<Map<string, string>>(new Map());
  const agentLifecycleLedgerRef = useRef(createAgentLifecycleLedger());
  const agentOrderingStateRef = useRef(createAgentOrderingState());
  const completionOrderingEventByAgentRef = useRef<Map<string, AgentOrderingEvent>>(new Map());
  const doneRenderedSequenceByAgentRef = useRef<Map<string, number>>(new Map());
  const parallelAgentsRef = useRef<ParallelAgent[]>([]);
  const parallelInterruptHandlerRef = useRef<(() => void) | null>(null);
  const activeBackgroundAgentCountRef = useRef(0);

  // -- Workflow refs --
  const workflowSessionDirRef = useRef<string | null>(null);
  const workflowSessionIdRef = useRef<string | null>(null);
  const workflowTaskIdsRef = useRef<Set<string>>(new Set());
  const todoItemsRef = useRef<NormalizedTodoItem[]>([]);

  // -- Skill tracking refs --
  const loadedSkillsRef = useRef<Set<string>>(createLoadedSkillTrackingSet(messages));
  const activeSkillSessionIdRef = useRef<string | null>(null);

  // -- Deferred completion refs --
  const pendingCompleteRef = useRef<(() => void) | null>(null);
  const deferredCompleteTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deferredPostCompleteDeltasByAgentRef = useRef<Map<string, Array<{
    messageId: string;
    runId?: number;
    delta: string;
    completionSequence: number;
  }>>>(new Map());

  // -- Thinking & diagnostics refs --
  const closedThinkingSourcesRef = useRef<Set<string>>(new Set());
  const thinkingDropDiagnosticsRef = useRef<ThinkingDropDiagnostics>(createThinkingDropDiagnostics());

  // -- Callback indirection refs (updated during render by façade) --
  const continueAssistantStreamInPlaceRef = useRef<((messageId: string, content: string) => void) | null>(null);
  const startAssistantStreamRef = useRef<((content: string) => void) | null>(null);

  // -- Background dispatch refs (internal only, not in final return) --
  const backgroundAgentSendChainRef = useRef<Promise<void>>(Promise.resolve());
  const pendingBackgroundUpdatesRef = useRef<string[]>([]);
  const backgroundUpdateFlushInFlightRef = useRef(false);
  const backgroundProgressSnapshotRef = useRef<Map<string, {
    toolUses: number;
    currentTool?: string;
  }>>(new Map());

  return {
    // Public refs (match UseChatStreamRuntimeResult['refs'])
    activeBackgroundAgentCountRef,
    activeForegroundRunHandleIdRef,
    activeSkillSessionIdRef,
    activeStreamRunIdRef,
    agentLifecycleLedgerRef,
    agentMessageIdByIdRef,
    agentOrderingStateRef,
    autoCompactionIndicatorRef,
    awaitedStreamRunIdsRef,
    backgroundAgentMessageIdRef,
    backgroundProgressSnapshotRef,
    closedThinkingSourcesRef,
    completionOrderingEventByAgentRef,
    continueAssistantStreamInPlaceRef,
    deferredCompleteTimeoutRef,
    deferredPostCompleteDeltasByAgentRef,
    doneRenderedSequenceByAgentRef,
    hasRunningToolRef,
    isAgentOnlyStreamRef,
    isStreamingRef,
    lastStreamedMessageIdRef,
    lastStreamingContentRef,
    lastTurnFinishReasonRef,
    loadedSkillsRef,
    nextRunIdFloorRef,
    parallelAgentsRef,
    parallelInterruptHandlerRef,
    pendingCompleteRef,
    runningAskQuestionToolIdsRef,
    runningBlockingToolIdsRef,
    startAssistantStreamRef,
    streamingMessageIdRef,
    streamingMetaRef,
    streamingStartRef,
    thinkingDropDiagnosticsRef,
    todoItemsRef,
    toolMessageIdByIdRef,
    toolNameByIdRef,
    wasInterruptedRef,
    workflowSessionDirRef,
    workflowSessionIdRef,
    workflowTaskIdsRef,
    // Internal refs (used by sub-hooks but not exposed in final return)
    streamRunRuntimeRef,
    backgroundAgentSendChainRef,
    pendingBackgroundUpdatesRef,
    backgroundUpdateFlushInFlightRef,
  };
}

export type UseStreamRefsResult = ReturnType<typeof useStreamRefs>;
