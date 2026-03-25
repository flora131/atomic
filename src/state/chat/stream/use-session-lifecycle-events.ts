import { useBusSubscription } from "@/services/events/hooks.ts";
import type { ChatMessage } from "@/state/chat/shared/types/index.ts";
import {
  shouldBindStreamSessionRun,
  shouldProcessStreamLifecycleEvent,
} from "@/state/chat/shared/helpers/index.ts";
import {
  normalizeSessionTrackingKey,
  shouldResetLoadedSkillsForSessionChange,
} from "@/state/chat/shared/helpers/skill-load-tracking.ts";
import {
  interruptRunningToolParts,
  shouldContinueParentSessionLoop,
} from "@/state/chat/shared/helpers/stream-continuation.ts";
import { hasActiveForegroundAgents } from "@/state/parts/index.ts";
import {
  getActiveBackgroundAgents,
  isActiveBackgroundStatus,
  isBackgroundAgent,
} from "@/state/chat/shared/helpers/background-agent-footer.ts";
import type { UseStreamSubscriptionsArgs } from "@/state/chat/stream/subscription-types.ts";

export function useSessionLifecycleEvents({
  activeBackgroundAgentCountRef,
  activeSkillSessionIdRef,
  activeStreamRunIdRef,
  asSessionLoopFinishReason,
  batchDispatcher,
  handleStreamComplete,
  handleStreamStartupError,
  hasPendingTaskResultContract,
  hasRunningToolRef,
  isStreamingRef,
  lastStreamedMessageIdRef,
  lastTurnFinishReasonRef,
  nextRunIdFloorRef,
  parallelAgentsRef,
  resetLoadedSkillTracking,
  runningAskQuestionToolIdsRef,
  runningBlockingToolIdsRef,
  setActiveBackgroundAgentCount,
  setIsStreaming,
  setMessagesWindowed,
  setParallelAgents,
  setToolCompletionVersion,
  streamingMessageIdRef,
  streamingStartRef,
  toolMessageIdByIdRef,
  toolNameByIdRef,
}: Pick<
  UseStreamSubscriptionsArgs,
  | "activeBackgroundAgentCountRef"
  | "activeSkillSessionIdRef"
  | "activeStreamRunIdRef"
  | "asSessionLoopFinishReason"
  | "batchDispatcher"
  | "handleStreamComplete"
  | "handleStreamStartupError"
  | "hasPendingTaskResultContract"
  | "hasRunningToolRef"
  | "isStreamingRef"
  | "lastStreamedMessageIdRef"
  | "lastTurnFinishReasonRef"
  | "nextRunIdFloorRef"
  | "parallelAgentsRef"
  | "resetLoadedSkillTracking"
  | "runningAskQuestionToolIdsRef"
  | "runningBlockingToolIdsRef"
  | "setActiveBackgroundAgentCount"
  | "setIsStreaming"
  | "setMessagesWindowed"
  | "setParallelAgents"
  | "setToolCompletionVersion"
  | "streamingMessageIdRef"
  | "streamingStartRef"
  | "toolMessageIdByIdRef"
  | "toolNameByIdRef"
>): void {
  useBusSubscription("stream.session.start", (event) => {
    const nextSessionId = normalizeSessionTrackingKey(event.sessionId);
    if (shouldResetLoadedSkillsForSessionChange(activeSkillSessionIdRef.current, nextSessionId)) {
      resetLoadedSkillTracking();
    }
    if (nextSessionId) {
      activeSkillSessionIdRef.current = nextSessionId;
    }

    if (!shouldBindStreamSessionRun({
      activeRunId: activeStreamRunIdRef.current,
      eventRunId: event.runId,
      isStreaming: isStreamingRef.current,
      nextRunIdFloor: nextRunIdFloorRef.current,
    })) {
      return;
    }

    activeStreamRunIdRef.current = event.runId;
    nextRunIdFloorRef.current = null;
    lastTurnFinishReasonRef.current = null;
  });

  useBusSubscription("stream.turn.start", (event) => {
    const activeRunId = activeStreamRunIdRef.current;
    if (activeRunId !== null && !shouldProcessStreamLifecycleEvent(activeRunId, event.runId)) {
      return;
    }

    if (activeRunId === null) {
      if (!isStreamingRef.current) {
        return;
      }
      const runFloor = nextRunIdFloorRef.current;
      if (typeof runFloor === "number" && event.runId < runFloor) {
        return;
      }
      activeStreamRunIdRef.current = event.runId;
      nextRunIdFloorRef.current = null;
    }

    if (!isStreamingRef.current) {
      isStreamingRef.current = true;
      setIsStreaming(true);
      if (!streamingStartRef.current) {
        streamingStartRef.current = Date.now();
      }
    }

    lastTurnFinishReasonRef.current = null;
  });

  useBusSubscription("stream.turn.end", (event) => {
    if (!shouldProcessStreamLifecycleEvent(activeStreamRunIdRef.current, event.runId)) {
      return;
    }

    if (isStreamingRef.current) {
      batchDispatcher.flush();
    }

    lastTurnFinishReasonRef.current = asSessionLoopFinishReason(
      (event.data as Record<string, unknown>).finishReason,
    );
  });

  useBusSubscription("stream.session.idle", (event) => {
    if (!shouldProcessStreamLifecycleEvent(activeStreamRunIdRef.current, event.runId)) {
      return;
    }

    // Always reset the background agent counter when the session goes idle,
    // even if isStreamingRef is already false (e.g. deferred completion
    // finalized the stream before this event arrived).
    activeBackgroundAgentCountRef.current = 0;
    setActiveBackgroundAgentCount(0);

    if (!isStreamingRef.current) {
      return;
    }

    batchDispatcher.flush();

    const idleReason = typeof event.data.reason === "string"
      ? event.data.reason.trim().toLowerCase()
      : "";
    if (idleReason === "aborted") {
      const interruptedToolIds = [...runningBlockingToolIdsRef.current];
      if (interruptedToolIds.length > 0 || hasRunningToolRef.current) {
        hasRunningToolRef.current = false;
        runningBlockingToolIdsRef.current.clear();
        runningAskQuestionToolIdsRef.current.clear();
        for (const toolId of interruptedToolIds) {
          toolNameByIdRef.current.delete(toolId);
          toolMessageIdByIdRef.current.delete(toolId);
        }

        const interruptedMessageId =
          streamingMessageIdRef.current
          ?? lastStreamedMessageIdRef.current;
        if (interruptedMessageId) {
          setMessagesWindowed((prev: ChatMessage[]) =>
            prev.map((msg: ChatMessage) =>
              msg.id === interruptedMessageId
                ? {
                  ...msg,
                  parts: interruptRunningToolParts(msg.parts),
                }
                : msg,
            ),
          );
        }
        setToolCompletionVersion((version) => version + 1);
      }

      const currentAgents = parallelAgentsRef.current;
      const hasActiveAgents = currentAgents.some(
        (agent) =>
          agent.status === "running"
          || agent.status === "pending"
          || agent.status === "background",
      );
      if (hasActiveAgents) {
        const now = Date.now();
        const interruptedAgents = currentAgents.map((agent) => {
          if (
            agent.status !== "running"
            && agent.status !== "pending"
            && agent.status !== "background"
          ) {
            return agent;
          }
          const startedAtMs = new Date(agent.startedAt).getTime();
          return {
            ...agent,
            status: "interrupted" as const,
            currentTool: undefined,
            durationMs: Number.isFinite(startedAtMs)
              ? Math.max(0, now - startedAtMs)
              : agent.durationMs,
          };
        });
        parallelAgentsRef.current = interruptedAgents;
        setParallelAgents(interruptedAgents);
      }

      handleStreamComplete();
      return;
    }

    // When the session goes idle, any remaining active agents are stale —
    // the SDK has definitively declared that no more events will be produced.
    // Transition them to "completed" so the continuation check below doesn't
    // block on phantom foreground agents that never received stream.agent.complete
    // (e.g. when a task tool call is aborted without a corresponding agent
    // lifecycle event).
    const currentAgents = parallelAgentsRef.current;
    const hasStaleActiveAgents = currentAgents.some(
      (agent) =>
        agent.status === "running"
        || agent.status === "pending"
        || agent.status === "background",
    );
    if (hasStaleActiveAgents) {
      const now = Date.now();
      const cleanedAgents = currentAgents.map((agent) => {
        if (
          agent.status !== "running"
          && agent.status !== "pending"
          && agent.status !== "background"
        ) {
          return agent;
        }
        const startedAtMs = new Date(agent.startedAt).getTime();
        return {
          ...agent,
          status: "completed" as const,
          currentTool: undefined,
          durationMs: Number.isFinite(startedAtMs)
            ? Math.max(0, now - startedAtMs)
            : agent.durationMs,
        };
      });
      parallelAgentsRef.current = cleanedAgents;
      setParallelAgents(cleanedAgents);
    }

    const continuationSignal = shouldContinueParentSessionLoop({
      finishReason: lastTurnFinishReasonRef.current ?? undefined,
      hasActiveForegroundAgents: hasActiveForegroundAgents(parallelAgentsRef.current),
      hasRunningBlockingTool: hasRunningToolRef.current,
      hasPendingTaskContract: hasPendingTaskResultContract(),
    });

    if (!continuationSignal.shouldContinue) {
      handleStreamComplete();
    }
  });

  useBusSubscription("stream.session.partial-idle", (event) => {
    if (!shouldProcessStreamLifecycleEvent(activeStreamRunIdRef.current, event.runId)) {
      return;
    }

    if (!isStreamingRef.current) {
      return;
    }

    batchDispatcher.flush();

    const count = typeof event.data.activeBackgroundAgentCount === "number"
      ? event.data.activeBackgroundAgentCount
      : 0;
    activeBackgroundAgentCountRef.current = count;
    setActiveBackgroundAgentCount(count);

    // Sync parallelAgents when the provider reports fewer active background
    // agents than the local state tracks.  This handles cases where
    // stream.agent.complete events were missed (e.g. SDK omission) so the
    // footer count decrements promptly instead of waiting for session idle.
    const currentAgents = parallelAgentsRef.current;
    const localActiveBackground = getActiveBackgroundAgents(currentAgents);
    if (localActiveBackground.length > count) {
      let excess = localActiveBackground.length - count;
      const now = Date.now();
      const updatedAgents = currentAgents.map((agent) => {
        if (excess > 0 && isBackgroundAgent(agent) && isActiveBackgroundStatus(agent.status)) {
          excess--;
          const startedAtMs = new Date(agent.startedAt).getTime();
          return {
            ...agent,
            status: "completed" as const,
            currentTool: undefined,
            durationMs: Number.isFinite(startedAtMs)
              ? Math.max(0, now - startedAtMs)
              : agent.durationMs,
          };
        }
        return agent;
      });
      parallelAgentsRef.current = updatedAgents;
      setParallelAgents(updatedAgents);
    }

    handleStreamComplete();
  });

  useBusSubscription("stream.session.error", (event) => {
    if (!shouldProcessStreamLifecycleEvent(activeStreamRunIdRef.current, event.runId)) {
      return;
    }

    handleStreamStartupError(new Error(event.data.error));
  });
}
