import type {
  Session,
} from "@/services/agents/types.ts";
import type { StreamAdapterOptions } from "@/services/events/adapters/types.ts";
import { SubagentToolTracker } from "@/services/events/adapters/subagent-tool-tracker.ts";
import {
  resetTurnMetadataState,
} from "@/services/events/adapters/task-turn-normalization.ts";
import {
  buildSyntheticForegroundAgentId,
  createSessionErrorEvent,
  createSessionStartEvent,
  isSessionExpiredMessage,
  resolveAgentOnlyTaskLabel,
  SessionExpiredError,
} from "@/services/events/adapters/provider-shared.ts";
import { publishCopilotBufferedEvent, cleanupCopilotOrphanedTools, flushCopilotOrphanedAgentCompletions } from "@/services/events/adapters/providers/copilot/buffer.ts";
import { flushAllPendingTextDeltas } from "@/services/events/adapters/providers/copilot/message-tool-handlers.ts";
import {
  cleanupCopilotSubscriptions,
  subscribeToCopilotEvents,
} from "@/services/events/adapters/providers/copilot/provider-router.ts";
import {
  publishSyntheticForegroundAgentComplete,
  publishSyntheticForegroundAgentStart,
  resolveCopilotRuntimeFeatureFlags,
  resetCopilotRuntimeFeatureFlags,
} from "@/services/events/adapters/providers/copilot/support.ts";
import type {
  CopilotStreamAdapterDeps,
  CopilotStreamAdapterState,
} from "@/services/events/adapters/providers/copilot/types.ts";

export async function startCopilotStreaming(
  deps: CopilotStreamAdapterDeps,
  state: CopilotStreamAdapterState,
  session: Session,
  message: string,
  options: StreamAdapterOptions,
): Promise<void> {
  cleanupCopilotSubscriptions(state);

  state.sessionId = session.id;
  state.runId = options.runId;
  state.messageId = options.messageId;
  state.accumulatedText = "";
  state.accumulatedOutputTokens = 0;
  state.pendingIdleReason = null;
  state.isBackgroundOnly = false;
  state.thinkingStreams.clear();
  state.pendingTextDeltas.clear();
  state.contentTypeResolvedAgents.clear();
  state.toolNameById.clear();
  state.emittedToolStartIds.clear();
  state.taskToolMetadata.clear();
  state.earlyToolEvents.clear();
  state.activeSubagentToolsById.clear();
  state.toolCallIdToSubagentId.clear();
  state.innerToolCallIds.clear();
  state.suppressedNestedAgentIds.clear();
  state.syntheticForegroundAgent = options.agent
    ? {
        id: buildSyntheticForegroundAgentId(options.messageId),
        name: options.agent,
        task: resolveAgentOnlyTaskLabel(message, options.agent),
        started: false,
        completed: false,
        sawNativeSubagentStart: false,
      }
    : null;
  state.knownAgentNames = new Set(
    (options.knownAgentNames ?? []).map(name => name.toLowerCase()),
  );
  state.runtimeFeatureFlags = resolveCopilotRuntimeFeatureFlags(
    options.runtimeFeatureFlags,
  );
  resetTurnMetadataState(state.turnMetadataState);
  state.subagentTracker = new SubagentToolTracker(
    deps.bus,
    state.sessionId,
    state.runId,
  );
  state.isActive = true;

  publishCopilotBufferedEvent(
    state,
    deps.bus,
    createSessionStartEvent(state.sessionId, state.runId),
  );
  publishSyntheticForegroundAgentStart({
    syntheticForegroundAgent: state.syntheticForegroundAgent,
    subagentTracker: state.subagentTracker,
    publishEvent: event => publishCopilotBufferedEvent(state, deps.bus, event),
    sessionId: state.sessionId,
    runId: state.runId,
  });

  subscribeToCopilotEvents(deps, state);

  let abortedBySignal = false;
  const abortListener = () => {
    abortedBySignal = true;
    state.isActive = false;
    cleanupCopilotSubscriptions(state);
  };
  options.abortSignal?.addEventListener("abort", abortListener, { once: true });

  try {
    const streamIterator = session.stream(message, options);
    for await (const _chunk of streamIterator) {
      // Event delivery is handled by provider subscriptions.
    }
  } catch (error) {
    if (
      abortedBySignal ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      return;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);

    if (state.isActive) {
      publishSyntheticForegroundAgentComplete({
        syntheticForegroundAgent: state.syntheticForegroundAgent,
        subagentTracker: state.subagentTracker,
        publishEvent: event => publishCopilotBufferedEvent(state, deps.bus, event),
        sessionId: state.sessionId,
        runId: state.runId,
        accumulatedText: state.accumulatedText,
        success: false,
        error: errorMessage,
      });
      publishCopilotBufferedEvent(
        state,
        deps.bus,
        createSessionErrorEvent(state.sessionId, state.runId, error),
      );
    }

    // Re-throw session-expired errors so the controller can invalidate the
    // stale session and create a fresh one on the next message attempt.
    if (isSessionExpiredMessage(errorMessage)) {
      throw new SessionExpiredError(errorMessage);
    }
  } finally {
    // Flush any remaining buffered text deltas that were not flushed by
    // handleCopilotMessageComplete (e.g., when the stream ends without
    // a message.complete event).
    flushAllPendingTextDeltas(state, {
      publishEvent: (event) => publishCopilotBufferedEvent(state, deps.bus, event),
    });
    cleanupCopilotOrphanedTools(state, deps.bus);
    flushCopilotOrphanedAgentCompletions(state, deps.bus);
    const pendingIdleReason = state.pendingIdleReason;
    state.pendingIdleReason = null;

    const hasBackgroundAgents = state.subagentTracker?.hasActiveBackgroundAgents() ?? false;

    if (!abortedBySignal && pendingIdleReason !== null) {
      if (hasBackgroundAgents) {
        state.isBackgroundOnly = true;
        publishCopilotBufferedEvent(state, deps.bus, {
          type: "stream.session.partial-idle",
          sessionId: state.sessionId,
          runId: state.runId,
          timestamp: Date.now(),
          data: {
            completionReason: pendingIdleReason,
            activeBackgroundAgentCount:
              state.subagentTracker?.getActiveBackgroundAgentCount() ?? 0,
          },
        });
      } else {
        publishCopilotBufferedEvent(state, deps.bus, {
          type: "stream.session.idle",
          sessionId: state.sessionId,
          runId: state.runId,
          timestamp: Date.now(),
          data: { reason: pendingIdleReason },
        });
      }
    }

    if (!hasBackgroundAgents) {
      state.isActive = false;
    }
    options.abortSignal?.removeEventListener("abort", abortListener);
  }
}

export function disposeCopilotStreamAdapter(
  deps: CopilotStreamAdapterDeps,
  state: CopilotStreamAdapterState,
): void {
  state.isActive = false;
  state.isBackgroundOnly = false;
  cleanupCopilotSubscriptions(state);
  state.eventBuffer = [];
  state.eventBufferHead = 0;
  state.thinkingStreams.clear();
  state.pendingTextDeltas.clear();
  state.contentTypeResolvedAgents.clear();
  state.accumulatedText = "";
  state.accumulatedOutputTokens = 0;
  state.pendingIdleReason = null;
  state.toolNameById.clear();
  state.emittedToolStartIds.clear();
  state.taskToolMetadata.clear();
  state.earlyToolEvents.clear();
  state.activeSubagentToolsById.clear();
  state.toolCallIdToSubagentId.clear();
  state.innerToolCallIds.clear();
  state.suppressedNestedAgentIds.clear();
  state.syntheticForegroundAgent = null;
  state.knownAgentNames.clear();
  state.runtimeFeatureFlags = resetCopilotRuntimeFeatureFlags();
  resetTurnMetadataState(state.turnMetadataState);
  state.subagentTracker?.reset();
  state.subagentTracker = null;
  void deps;
}
