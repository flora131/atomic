import { useCallback, useEffect, useRef } from "react";
import {
  applyStreamPartEvent,
} from "@/state/parts/index.ts";
import type { ParallelAgent } from "@/components/parallel-agents-tree.tsx";
import type { AgentOrderingEvent } from "@/lib/ui/agent-ordering-contract.ts";
import {
  registerDoneStateProjection,
} from "@/lib/ui/agent-ordering-contract.ts";
import {
  getActiveBackgroundAgents,
} from "@/lib/ui/background-agent-footer.ts";
import {
  emitAgentDoneProjectionObservability,
  emitAgentDoneRenderedObservability,
} from "@/state/chat/helpers.ts";
import type { UseChatAgentProjectionArgs } from "@/state/chat/agent/projection-types.ts";

interface UseChatAgentMessageProjectionArgs extends Pick<
  UseChatAgentProjectionArgs,
  | "activeStreamRunIdRef"
  | "agentAnchorSyncVersion"
  | "agentLifecycleLedgerRef"
  | "agentMessageIdByIdRef"
  | "agentOrderingStateRef"
  | "agentType"
  | "backgroundAgentMessageIdRef"
  | "completionOrderingEventByAgentRef"
  | "doneRenderedSequenceByAgentRef"
  | "lastStreamedMessageIdRef"
  | "setBackgroundAgentMessageId"
  | "setMessagesWindowed"
  | "streamingMessageIdRef"
  | "streamingStartRef"
  | "workflowActiveRef"
> {
  parallelAgents: ParallelAgent[];
}

export function useChatAgentMessageProjection({
  activeStreamRunIdRef,
  agentAnchorSyncVersion,
  agentLifecycleLedgerRef,
  agentMessageIdByIdRef,
  agentOrderingStateRef,
  agentType,
  backgroundAgentMessageIdRef,
  completionOrderingEventByAgentRef,
  doneRenderedSequenceByAgentRef,
  lastStreamedMessageIdRef,
  parallelAgents,
  setBackgroundAgentMessageId,
  setMessagesWindowed,
  streamingMessageIdRef,
  streamingStartRef,
  workflowActiveRef,
}: UseChatAgentMessageProjectionArgs) {
  const trackProjectedAgentDoneStates = useCallback((agents: ReadonlyArray<ParallelAgent>) => {
    for (const agent of agents) {
      if (agent.status !== "completed") continue;
      const sequence = agentLifecycleLedgerRef.current.get(agent.id)?.sequence ?? 0;
      const didRecordProjection = registerDoneStateProjection(agentOrderingStateRef.current, {
        agentId: agent.id,
        sequence,
        projectionMode: "effect",
      });
      if (!didRecordProjection) continue;
      const completionEvent = completionOrderingEventByAgentRef.current.get(agent.id);
      const projectionEvent: AgentOrderingEvent = {
        sessionId: completionEvent?.sessionId ?? "unknown",
        agentId: agent.id,
        messageId:
          completionEvent?.messageId
          ?? agentMessageIdByIdRef.current.get(agent.id)
          ?? streamingMessageIdRef.current
          ?? lastStreamedMessageIdRef.current
          ?? backgroundAgentMessageIdRef.current
          ?? "",
        type: "agent_done_projected",
        sequence,
        timestampMs: Date.now(),
        source: "ui-effect",
      };
      emitAgentDoneProjectionObservability({
        provider: agentType,
        runId: activeStreamRunIdRef.current ?? undefined,
        event: projectionEvent,
        projectionMode: "effect",
        completionTimestampMs: completionEvent?.timestampMs,
      });
    }
  }, [
    activeStreamRunIdRef,
    agentLifecycleLedgerRef,
    agentMessageIdByIdRef,
    agentOrderingStateRef,
    agentType,
    backgroundAgentMessageIdRef,
    completionOrderingEventByAgentRef,
    lastStreamedMessageIdRef,
    streamingMessageIdRef,
  ]);

  const handleAgentDoneRendered = useCallback((marker: {
    messageId: string;
    agentId: string;
    timestampMs: number;
  }) => {
    const sequence = agentOrderingStateRef.current.lastCompletionSequenceByAgent.get(marker.agentId) ?? 0;
    if (doneRenderedSequenceByAgentRef.current.get(marker.agentId) === sequence) {
      return;
    }
    doneRenderedSequenceByAgentRef.current.set(marker.agentId, sequence);
    const completionEvent = completionOrderingEventByAgentRef.current.get(marker.agentId);
    const renderEvent: AgentOrderingEvent = {
      sessionId: completionEvent?.sessionId ?? "unknown",
      agentId: marker.agentId,
      messageId: marker.messageId,
      type: "agent_done_rendered",
      sequence,
      timestampMs: marker.timestampMs,
      source: "ui-effect",
    };
    emitAgentDoneRenderedObservability({
      provider: agentType,
      runId: activeStreamRunIdRef.current ?? undefined,
      event: renderEvent,
      completionTimestampMs: completionEvent?.timestampMs,
      projectionMode: agentOrderingStateRef.current.projectionSourceByAgent.get(marker.agentId),
    });
  }, [activeStreamRunIdRef, agentOrderingStateRef, agentType, completionOrderingEventByAgentRef, doneRenderedSequenceByAgentRef]);

  const applyBackgroundAgentUpdate = useCallback((messageId: string, agents: ParallelAgent[]) => {
    setMessagesWindowed((prev) =>
      prev.map((msg, index) =>
        msg.id === messageId
          ? applyStreamPartEvent(msg, {
            type: "parallel-agents",
            agents,
            isLastMessage: index === prev.length - 1,
          })
          : msg,
      ),
    );
    if (getActiveBackgroundAgents(agents).length === 0) {
      setBackgroundAgentMessageId(null);
      if (!workflowActiveRef.current) {
        streamingStartRef.current = null;
      }
    }
  }, [setBackgroundAgentMessageId, setMessagesWindowed, streamingStartRef, workflowActiveRef]);
  const applyBackgroundAgentUpdateRef = useRef(applyBackgroundAgentUpdate);
  applyBackgroundAgentUpdateRef.current = applyBackgroundAgentUpdate;

  useEffect(() => {
    if (parallelAgents.length === 0) return;

    const messageId = streamingMessageIdRef.current;
    if (messageId) {
      setMessagesWindowed((prev) =>
        prev.map((msg, index) => {
          if (msg.id !== messageId) {
            return msg;
          }
          const existingAgentIds = new Set((msg.parallelAgents ?? []).map((a) => a.id));
          const filteredAgents = parallelAgents.filter((agent) => {
            const mappedMessageId = agentMessageIdByIdRef.current.get(agent.id);
            if (mappedMessageId && mappedMessageId !== messageId) {
              return false;
            }
            if (agent.status === "running" || agent.status === "pending" || agent.status === "background") {
              return true;
            }
            return existingAgentIds.has(agent.id);
          });
          trackProjectedAgentDoneStates(filteredAgents);
          return applyStreamPartEvent(msg, {
            type: "parallel-agents",
            agents: filteredAgents,
            isLastMessage: index === prev.length - 1,
          });
        }),
      );
      return;
    }

    const lastMsgId = lastStreamedMessageIdRef.current;
    if (lastMsgId) {
      setMessagesWindowed((prev) =>
        prev.map((msg, index) => {
          if (msg.id !== lastMsgId) {
            return msg;
          }
          const filteredAgents = parallelAgents.filter((agent) => {
            const mappedMessageId = agentMessageIdByIdRef.current.get(agent.id);
            return !mappedMessageId || mappedMessageId === lastMsgId;
          });
          trackProjectedAgentDoneStates(filteredAgents);
          return applyStreamPartEvent(msg, {
            type: "parallel-agents",
            agents: filteredAgents,
            isLastMessage: index === prev.length - 1,
          });
        }),
      );
      return;
    }

    if (backgroundAgentMessageIdRef.current) {
      const filteredAgents = parallelAgents.filter((agent) => {
        const mappedMessageId = agentMessageIdByIdRef.current.get(agent.id);
        return !mappedMessageId || mappedMessageId === backgroundAgentMessageIdRef.current;
      });
      trackProjectedAgentDoneStates(filteredAgents);
      applyBackgroundAgentUpdateRef.current(backgroundAgentMessageIdRef.current, filteredAgents);
    }
  }, [
    agentAnchorSyncVersion,
    agentMessageIdByIdRef,
    backgroundAgentMessageIdRef,
    lastStreamedMessageIdRef,
    parallelAgents,
    setMessagesWindowed,
    trackProjectedAgentDoneStates,
    streamingMessageIdRef,
  ]);

  return { handleAgentDoneRendered };
}
