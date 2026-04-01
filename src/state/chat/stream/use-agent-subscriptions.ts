import { useBusSubscription } from "@/services/events/hooks.ts";
import { runtimeParityDebug } from "@/services/workflows/runtime-parity-observability.ts";
import type { ParallelAgent } from "@/types/parallel-agents.ts";
import {
  isClaudeSyntheticForegroundAgentId,
  mergeAgentTaskLabel,
  resolveAgentCurrentToolForUpdate,
  resolveIncomingSubagentTaskLabel,
  resolveSubagentStartCorrelationId,
} from "@/state/chat/shared/helpers/index.ts";
import {
  registerAgentLifecycleComplete,
  registerAgentLifecycleStart,
  registerAgentLifecycleUpdate,
} from "@/state/chat/shared/helpers/agent-lifecycle-ledger.ts";
import {
  registerAgentCompletionSequence,
  resetAgentOrderingForAgent,
  type AgentOrderingEvent,
} from "@/state/chat/shared/helpers/agent-ordering-contract.ts";
import { getActiveBackgroundAgents, isBackgroundAgent } from "@/state/chat/shared/helpers/background-agent-footer.ts";
import { hasActiveBackgroundAgentsForSpinner } from "@/state/parts/guards.ts";
import type { UseStreamSubscriptionsArgs } from "@/state/chat/stream/subscription-types.ts";

export function useStreamAgentSubscriptions({
  activeBackgroundAgentCountRef,
  agentLifecycleLedgerRef,
  agentMessageIdByIdRef,
  agentOrderingStateRef,
  agentType,
  backgroundAgentMessageIdRef,
  backgroundProgressSnapshotRef,
  completionOrderingEventByAgentRef,
  deferredCompleteTimeoutRef,
  deferredPostCompleteDeltasByAgentRef,
  doneRenderedSequenceByAgentRef,
  lastStreamedMessageIdRef,
  parallelAgentsRef,
  pendingCompleteRef,
  resolveAgentScopedMessageId,
  sendBackgroundMessageToAgent,
  setActiveBackgroundAgentCount,
  setAgentMessageBinding,
  setParallelAgents,
  streamingMessageIdRef,
  toolMessageIdByIdRef,
}: Pick<
  UseStreamSubscriptionsArgs,
  | "activeBackgroundAgentCountRef"
  | "agentLifecycleLedgerRef"
  | "agentMessageIdByIdRef"
  | "agentOrderingStateRef"
  | "agentType"
  | "backgroundAgentMessageIdRef"
  | "backgroundProgressSnapshotRef"
  | "completionOrderingEventByAgentRef"
  | "deferredCompleteTimeoutRef"
  | "deferredPostCompleteDeltasByAgentRef"
  | "doneRenderedSequenceByAgentRef"
  | "lastStreamedMessageIdRef"
  | "parallelAgentsRef"
  | "pendingCompleteRef"
  | "resolveAgentScopedMessageId"
  | "sendBackgroundMessageToAgent"
  | "setActiveBackgroundAgentCount"
  | "setAgentMessageBinding"
  | "setParallelAgents"
  | "streamingMessageIdRef"
  | "toolMessageIdByIdRef"
>): void {
  useBusSubscription("stream.agent.start", (event) => {
    const data = event.data;
    const correlationId = resolveSubagentStartCorrelationId(data);
    const lifecycleTransition = registerAgentLifecycleStart(agentLifecycleLedgerRef.current, data.agentId);
    if (!lifecycleTransition.ok) {
      return;
    }

    resetAgentOrderingForAgent(agentOrderingStateRef.current, data.agentId);
    doneRenderedSequenceByAgentRef.current.delete(data.agentId);
    completionOrderingEventByAgentRef.current.delete(data.agentId);
    deferredPostCompleteDeltasByAgentRef.current.delete(data.agentId);

    const startedAt = new Date(event.timestamp).toISOString();
    const status: ParallelAgent["status"] = data.isBackground ? "background" : "running";

    const existingMessageId = agentMessageIdByIdRef.current.get(data.agentId);
    const correlatedMessageId = correlationId
      ? toolMessageIdByIdRef.current.get(correlationId)
      : undefined;
    const fallbackForegroundMessageId =
      streamingMessageIdRef.current
      ?? lastStreamedMessageIdRef.current;
    const fallbackBackgroundMessageId =
      backgroundAgentMessageIdRef.current
      ?? fallbackForegroundMessageId;
    const resolvedMessageId =
      correlatedMessageId
      ?? existingMessageId
      ?? (data.isBackground ? fallbackBackgroundMessageId : fallbackForegroundMessageId);
    if (resolvedMessageId) {
      setAgentMessageBinding(data.agentId, resolvedMessageId);
    }

    if (data.isBackground) {
      backgroundProgressSnapshotRef.current.set(data.agentId, {
        toolUses: 0,
        currentTool: data.agentType ? `Running ${data.agentType}...` : undefined,
      });
    }

    setParallelAgents((current) => {
      const existingIndex = current.findIndex((agent) => agent.id === data.agentId);
      const correlatedIndex = existingIndex < 0 && correlationId
        ? current.findIndex((agent) => agent.taskToolCallId === correlationId)
        : -1;
      const syntheticPlaceholderIndex = existingIndex < 0 && correlatedIndex < 0
        ? current.findIndex((agent) =>
          isClaudeSyntheticForegroundAgentId(agent.id)
            && !agent.background,
        )
        : -1;
      const targetIndex = existingIndex >= 0
        ? existingIndex
        : (correlatedIndex >= 0 ? correlatedIndex : syntheticPlaceholderIndex);

      let updated: typeof current;
      if (targetIndex >= 0) {
        const existing = current[targetIndex];
        if (existing && (existing.status === "completed" || existing.status === "error" || existing.status === "interrupted")) {
          updated = [
            ...current.filter((agent, index) => index !== targetIndex && agent.id !== data.agentId),
            {
              id: data.agentId,
              taskToolCallId: correlationId,
              name: data.agentType || "agent",
              task: resolveIncomingSubagentTaskLabel(data.task, data.agentType),
              status,
              startedAt,
              background: data.isBackground,
              currentTool: undefined,
            },
          ];
        } else {
          updated = current.map((agent, index) =>
            index === targetIndex
              ? {
                ...agent,
                id: data.agentId,
                name: data.agentType || agent.name,
                task: mergeAgentTaskLabel(agent.task, data.task, data.agentType),
                status,
                background: data.isBackground || agent.background,
                taskToolCallId: correlationId ?? agent.taskToolCallId,
                currentTool: agent.currentTool,
                toolUses: agent.toolUses,
              }
              : agent,
          );
        }
      } else {
        updated = [
          ...current,
          {
            id: data.agentId,
            taskToolCallId: correlationId,
            name: data.agentType || "agent",
            task: resolveIncomingSubagentTaskLabel(data.task, data.agentType),
            status,
            startedAt,
            background: data.isBackground,
            currentTool: undefined,
          },
        ];
      }
      // Sync the ref so downstream handlers in the same event batch
      // see the latest agent list immediately.
      parallelAgentsRef.current = updated;

      // Keep activeBackgroundAgentCount in sync when background agents start
      // so the footer count reflects the live value immediately.
      if (data.isBackground) {
        const newActiveCount = getActiveBackgroundAgents(updated).length;
        if (activeBackgroundAgentCountRef.current !== newActiveCount) {
          activeBackgroundAgentCountRef.current = newActiveCount;
          setActiveBackgroundAgentCount(newActiveCount);
        }
      }

      return updated;
    });
  });

  useBusSubscription("stream.agent.update", (event) => {
    const data = event.data;
    const lifecycleTransition = registerAgentLifecycleUpdate(
      agentLifecycleLedgerRef.current,
      data.agentId,
    );
    if (!lifecycleTransition.ok) {
      return;
    }

    const existingAgent = parallelAgentsRef.current.find((agent) => agent.id === data.agentId);
    const nextCurrentTool = resolveAgentCurrentToolForUpdate({
      incomingCurrentTool: data.currentTool,
      existingCurrentTool: existingAgent?.currentTool,
      agentName: existingAgent?.name,
    });
    const nextToolUses = data.toolUses ?? existingAgent?.toolUses;

    let progressMessage: string | null = null;
    if (existingAgent && isBackgroundAgent(existingAgent)) {
      const snapshot = backgroundProgressSnapshotRef.current.get(existingAgent.id) ?? {
        toolUses: existingAgent.toolUses ?? 0,
        currentTool: existingAgent.currentTool,
      };
      const effectiveToolUses = nextToolUses ?? 0;
      const toolUsesAdvanced = effectiveToolUses > snapshot.toolUses;
      const toolChanged = typeof nextCurrentTool === "string" && nextCurrentTool !== snapshot.currentTool;

      if (toolUsesAdvanced || (toolChanged && effectiveToolUses > 0)) {
        const lines = [
          `Background task "${existingAgent.name}" progress:`,
          "",
          `- Tool uses: ${effectiveToolUses}`,
        ];
        if (nextCurrentTool) {
          lines.push(`- Current tool: ${nextCurrentTool}`);
        }
        progressMessage = lines.join("\n");
      }

      backgroundProgressSnapshotRef.current.set(existingAgent.id, {
        toolUses: effectiveToolUses,
        currentTool: nextCurrentTool,
      });
    }

    setParallelAgents((current) =>
      current.map((agent) =>
        agent.id === data.agentId
          ? {
            ...agent,
            currentTool: nextCurrentTool ?? agent.currentTool,
            toolUses: nextToolUses ?? agent.toolUses,
          }
          : agent,
      ),
    );

    if (progressMessage) {
      sendBackgroundMessageToAgent(progressMessage);
    }
  });

  useBusSubscription("stream.agent.complete", (event) => {
    const data = event.data;
    const lifecycleTransition = registerAgentLifecycleComplete(
      agentLifecycleLedgerRef.current,
      data.agentId,
    );
    if (!lifecycleTransition.ok) {
      return;
    }

    if (data.success) {
      registerAgentCompletionSequence(
        agentOrderingStateRef.current,
        data.agentId,
        lifecycleTransition.entry.sequence,
      );
      const completionOrderingEvent: AgentOrderingEvent = {
        sessionId: event.sessionId,
        agentId: data.agentId,
        messageId:
          resolveAgentScopedMessageId(data.agentId)
          ?? agentMessageIdByIdRef.current.get(data.agentId)
          ?? streamingMessageIdRef.current
          ?? lastStreamedMessageIdRef.current
          ?? backgroundAgentMessageIdRef.current
          ?? "",
        type: "agent_complete_received",
        sequence: lifecycleTransition.entry.sequence,
        timestampMs: event.timestamp,
        source: "typed-bus",
      };
      completionOrderingEventByAgentRef.current.set(data.agentId, completionOrderingEvent);
      runtimeParityDebug("agent_complete_received", {
        provider: agentType,
        runId: event.runId,
        event: completionOrderingEvent,
      });
    } else {
      resetAgentOrderingForAgent(agentOrderingStateRef.current, data.agentId);
      doneRenderedSequenceByAgentRef.current.delete(data.agentId);
      completionOrderingEventByAgentRef.current.delete(data.agentId);
    }

    const completingAgent = parallelAgentsRef.current.find((agent) => agent.id === data.agentId);
    const isBgAgent = completingAgent && isBackgroundAgent(completingAgent);

    setParallelAgents((current) => {
      const updated = isClaudeSyntheticForegroundAgentId(data.agentId)
        && current.some((agent) => agent.id !== data.agentId && !isClaudeSyntheticForegroundAgentId(agent.id))
        ? current.filter((agent) => agent.id !== data.agentId)
        : current.map((agent) => {
          if (agent.id !== data.agentId) {
            return agent;
          }

          // Don't override user-initiated interrupts — the Ctrl+C / ESC
          // handler already set this agent to "interrupted".  Late-arriving
          // synthetic completions (e.g. from flushCopilotOrphanedAgentCompletions
          // during abort) must not revert the status to "completed".
          if (agent.status === "interrupted") {
            return agent;
          }

          const startedAtMs = new Date(agent.startedAt).getTime();
          return {
            ...agent,
            status: data.success ? "completed" as const : "error" as const,
            currentTool: undefined,
            result: data.result ?? agent.result,
            error: data.error,
            durationMs: Number.isFinite(startedAtMs)
              ? Math.max(0, Date.now() - startedAtMs)
              : agent.durationMs,
          };
        });
      // Sync the ref so downstream handlers in the same event batch
      // (e.g. stream.session.idle) see the updated agent state immediately,
      // rather than reading a stale ref that blocks stream finalization.
      parallelAgentsRef.current = updated;

      // Keep activeBackgroundAgentCount in sync as agents complete so the
      // spinner text and footer reflect the live count rather than staying
      // pinned to the value set by the last stream.session.partial-idle event.
      const newActiveCount = getActiveBackgroundAgents(updated).length;
      if (activeBackgroundAgentCountRef.current !== newActiveCount) {
        activeBackgroundAgentCountRef.current = newActiveCount;
        setActiveBackgroundAgentCount(newActiveCount);
      }

      return updated;
    });
    backgroundProgressSnapshotRef.current.delete(data.agentId);

    if (!isBgAgent) {
      return;
    }

    const agentName = completingAgent?.name ?? data.agentId;
    if (data.success) {
      const result = data.result ?? completingAgent?.result;
      if (typeof result === "string" && result.trim().length > 0) {
        sendBackgroundMessageToAgent(`Background task "${agentName}" completed:\n\n${result}`);
      } else {
        sendBackgroundMessageToAgent(`Background task "${agentName}" completed.`);
      }
    } else {
      const errorText = data.error?.trim();
      if (errorText) {
        sendBackgroundMessageToAgent(`Background task "${agentName}" failed:\n\n${errorText}`);
      } else {
        sendBackgroundMessageToAgent(`Background task "${agentName}" failed.`);
      }
    }

    // Trigger deferred completion when the last background agent finishes.
    // parallelAgentsRef.current is already synced above so the completing
    // agent is already marked "completed"/"error".
    if (!hasActiveBackgroundAgentsForSpinner(parallelAgentsRef.current) && pendingCompleteRef.current) {
      if (deferredCompleteTimeoutRef.current) {
        clearTimeout(deferredCompleteTimeoutRef.current);
        deferredCompleteTimeoutRef.current = null;
      }
      const pendingComplete = pendingCompleteRef.current;
      pendingCompleteRef.current = null;
      pendingComplete();
    }
  });
}
