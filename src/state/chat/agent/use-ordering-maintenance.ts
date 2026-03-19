import { useEffect } from "react";
import {
  pruneAgentOrderingState,
} from "@/state/chat/shared/helpers/agent-ordering-contract.ts";
import type { UseChatAgentProjectionArgs } from "@/state/chat/agent/projection-types.ts";

interface UseChatAgentOrderingMaintenanceArgs extends Pick<
  UseChatAgentProjectionArgs,
  | "agentMessageIdByIdRef"
  | "agentOrderingStateRef"
  | "completionOrderingEventByAgentRef"
  | "deferredPostCompleteDeltasByAgentRef"
  | "deleteAgentMessageBinding"
  | "doneRenderedSequenceByAgentRef"
> {
  parallelAgents: UseChatAgentProjectionArgs["parallelAgents"];
}

export function useChatAgentOrderingMaintenance({
  agentMessageIdByIdRef,
  agentOrderingStateRef,
  completionOrderingEventByAgentRef,
  deferredPostCompleteDeltasByAgentRef,
  deleteAgentMessageBinding,
  doneRenderedSequenceByAgentRef,
  parallelAgents,
}: UseChatAgentOrderingMaintenanceArgs) {
  useEffect(() => {
    const activeAgentIds = new Set(parallelAgents.map((agent) => agent.id));
    pruneAgentOrderingState(agentOrderingStateRef.current, activeAgentIds);
    for (const agentId of Array.from(completionOrderingEventByAgentRef.current.keys())) {
      if (!activeAgentIds.has(agentId)) completionOrderingEventByAgentRef.current.delete(agentId);
    }
    for (const agentId of Array.from(doneRenderedSequenceByAgentRef.current.keys())) {
      if (!activeAgentIds.has(agentId)) doneRenderedSequenceByAgentRef.current.delete(agentId);
    }
    for (const agentId of Array.from(deferredPostCompleteDeltasByAgentRef.current.keys())) {
      if (!activeAgentIds.has(agentId)) deferredPostCompleteDeltasByAgentRef.current.delete(agentId);
    }
    for (const agentId of Array.from(agentMessageIdByIdRef.current.keys())) {
      if (!activeAgentIds.has(agentId)) deleteAgentMessageBinding(agentId);
    }
  }, [
    agentMessageIdByIdRef,
    agentOrderingStateRef,
    completionOrderingEventByAgentRef,
    deferredPostCompleteDeltasByAgentRef,
    deleteAgentMessageBinding,
    doneRenderedSequenceByAgentRef,
    parallelAgents,
  ]);
}
