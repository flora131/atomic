import { useCallback } from "react";
import type { MutableRefObject } from "react";
import type { AgentType } from "@/services/models/index.ts";
import type { StreamPartEvent } from "@/state/parts/index.ts";
import type { AgentLifecycleLedger } from "@/lib/ui/agent-lifecycle-ledger.ts";
import type { AgentOrderingEvent, AgentOrderingState } from "@/lib/ui/agent-ordering-contract.ts";
import {
  hasDoneStateProjection,
  registerDoneStateProjection,
  registerFirstPostCompleteDeltaSequence,
} from "@/lib/ui/agent-ordering-contract.ts";
import {
  emitAgentDoneProjectionObservability,
  emitPostCompleteDeltaOrderingObservability,
  queueAgentTerminalBeforeDeferredDeltas,
  shouldDeferPostCompleteDeltaUntilDoneProjection,
} from "@/state/chat/helpers.ts";

type AgentTerminalPart = Extract<StreamPartEvent, { type: "agent-terminal" }>;
type TextDeltaPart = Extract<StreamPartEvent, { type: "text-delta" }>;

interface UseChatStreamAgentOrderingArgs {
  agentType?: AgentType;
  activeStreamRunIdRef: MutableRefObject<number | null>;
  agentLifecycleLedgerRef: MutableRefObject<AgentLifecycleLedger>;
  agentOrderingStateRef: MutableRefObject<AgentOrderingState>;
  completionOrderingEventByAgentRef: MutableRefObject<Map<string, AgentOrderingEvent>>;
  deferredPostCompleteDeltasByAgentRef: MutableRefObject<Map<string, Array<{
    messageId: string;
    runId?: number;
    delta: string;
    completionSequence: number;
  }>>>;
}

interface UseChatStreamAgentOrderingResult {
  handleAgentTerminalPart: (
    part: AgentTerminalPart,
    messageId: string,
    queueMessagePartUpdate: (messageId: string, update: StreamPartEvent) => void,
  ) => void;
  handleTextDeltaOrdering: (
    part: TextDeltaPart,
    messageId: string | null,
    queueMessagePartUpdate: (messageId: string, update: StreamPartEvent) => void,
  ) => boolean;
}

export function useChatStreamAgentOrdering({
  agentType,
  activeStreamRunIdRef,
  agentLifecycleLedgerRef,
  agentOrderingStateRef,
  completionOrderingEventByAgentRef,
  deferredPostCompleteDeltasByAgentRef,
}: UseChatStreamAgentOrderingArgs): UseChatStreamAgentOrderingResult {
  const queuePostCompleteDeltaOrderingObservability = useCallback((args: {
    agentId: string;
    messageId: string;
    completionSequence: number;
    doneProjected: boolean;
    projectionMode?: "effect" | "sync-bridge";
  }): void => {
    const didRegisterFirstPostCompleteDelta = registerFirstPostCompleteDeltaSequence(
      agentOrderingStateRef.current,
      args.agentId,
      args.completionSequence + 1,
    );
    if (!didRegisterFirstPostCompleteDelta) return;
    const scenario = completionOrderingEventByAgentRef.current.size > 1 ? "multi" : "single";
    const postCompleteDeltaEvent: AgentOrderingEvent = {
      sessionId:
        completionOrderingEventByAgentRef.current.get(args.agentId)?.sessionId
        ?? "unknown",
      agentId: args.agentId,
      messageId:
        args.messageId
        || completionOrderingEventByAgentRef.current.get(args.agentId)?.messageId
        || "",
      type: "post_complete_delta_rendered",
      sequence: args.completionSequence + 1,
      timestampMs: Date.now(),
      source: "wildcard-batch",
    };
    emitPostCompleteDeltaOrderingObservability({
      provider: agentType,
      runId: activeStreamRunIdRef.current ?? undefined,
      event: postCompleteDeltaEvent,
      doneProjected: args.doneProjected,
      scenario,
      projectionMode: args.projectionMode,
    });
  }, [
    activeStreamRunIdRef,
    agentOrderingStateRef,
    agentType,
    completionOrderingEventByAgentRef,
  ]);

  const flushDeferredPostCompleteDeltas = useCallback((
    agentId: string,
    queueMessagePartUpdate: (messageId: string, update: StreamPartEvent) => void,
  ): void => {
    const deferred = deferredPostCompleteDeltasByAgentRef.current.get(agentId);
    if (!deferred || deferred.length === 0) return;
    if (!hasDoneStateProjection(agentOrderingStateRef.current, agentId)) return;
    deferredPostCompleteDeltasByAgentRef.current.delete(agentId);
    const projectionMode = agentOrderingStateRef.current.projectionSourceByAgent.get(agentId);
    for (const deferredPart of deferred) {
      queuePostCompleteDeltaOrderingObservability({
        agentId,
        messageId: deferredPart.messageId,
        completionSequence: deferredPart.completionSequence,
        doneProjected: true,
        projectionMode,
      });
      queueMessagePartUpdate(deferredPart.messageId, {
        type: "text-delta",
        runId: deferredPart.runId,
        delta: deferredPart.delta,
        agentId,
      });
    }
  }, [
    agentOrderingStateRef,
    deferredPostCompleteDeltasByAgentRef,
    queuePostCompleteDeltaOrderingObservability,
  ]);

  const handleAgentTerminalPart = useCallback((
    part: AgentTerminalPart,
    messageId: string,
    queueMessagePartUpdate: (messageId: string, update: StreamPartEvent) => void,
  ): void => {
    if (part.status === "completed") {
      const sequence = agentLifecycleLedgerRef.current.get(part.agentId)?.sequence ?? 0;
      const didRecordProjection = registerDoneStateProjection(agentOrderingStateRef.current, {
        agentId: part.agentId,
        sequence,
        projectionMode: "sync-bridge",
      });
      if (didRecordProjection) {
        const completionEvent = completionOrderingEventByAgentRef.current.get(part.agentId);
        const projectionEvent: AgentOrderingEvent = {
          sessionId: completionEvent?.sessionId ?? "unknown",
          agentId: part.agentId,
          messageId,
          type: "agent_done_projected",
          sequence,
          timestampMs: Date.now(),
          source: "sync-bridge",
        };
        emitAgentDoneProjectionObservability({
          provider: agentType,
          runId: activeStreamRunIdRef.current ?? undefined,
          event: projectionEvent,
          projectionMode: "sync-bridge",
          completionTimestampMs: completionEvent?.timestampMs,
        });
      }
    }
    queueAgentTerminalBeforeDeferredDeltas({
      messageId,
      terminal: part,
      queueMessagePartUpdate,
      flushDeferredPostCompleteDeltas: (agentId) =>
        flushDeferredPostCompleteDeltas(agentId, queueMessagePartUpdate),
    });
  }, [
    activeStreamRunIdRef,
    agentLifecycleLedgerRef,
    agentOrderingStateRef,
    agentType,
    completionOrderingEventByAgentRef,
    flushDeferredPostCompleteDeltas,
  ]);

  const handleTextDeltaOrdering = useCallback((
    part: TextDeltaPart,
    messageId: string | null,
    queueMessagePartUpdate: (messageId: string, update: StreamPartEvent) => void,
  ): boolean => {
    const agentId = part.agentId;
    if (!agentId) {
      return false;
    }

    const completionSequence = agentOrderingStateRef.current.lastCompletionSequenceByAgent.get(agentId);
    if (typeof completionSequence !== "number") {
      return false;
    }

    const doneProjected = hasDoneStateProjection(agentOrderingStateRef.current, agentId);
    if (shouldDeferPostCompleteDeltaUntilDoneProjection({ completionSequence, doneProjected })) {
      if (!messageId) {
        return true;
      }
      const deferred = deferredPostCompleteDeltasByAgentRef.current.get(agentId) ?? [];
      deferred.push({
        messageId,
        runId: part.runId,
        delta: part.delta,
        completionSequence,
      });
      deferredPostCompleteDeltasByAgentRef.current.set(agentId, deferred);
      return true;
    }

    queuePostCompleteDeltaOrderingObservability({
      agentId,
      messageId:
        messageId
        ?? completionOrderingEventByAgentRef.current.get(agentId)?.messageId
        ?? "",
      completionSequence,
      doneProjected,
      projectionMode: agentOrderingStateRef.current.projectionSourceByAgent.get(agentId),
    });
    return false;
  }, [
    agentOrderingStateRef,
    completionOrderingEventByAgentRef,
    deferredPostCompleteDeltasByAgentRef,
    queuePostCompleteDeltaOrderingObservability,
  ]);

  return {
    handleAgentTerminalPart,
    handleTextDeltaOrdering,
  };
}
