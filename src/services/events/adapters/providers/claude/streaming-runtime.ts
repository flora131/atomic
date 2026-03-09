import type { BusEvent } from "@/services/events/bus-events.ts";
import type { StreamAdapterOptions } from "@/services/events/adapters/types.ts";
import type {
  CodingAgentClient,
  Session,
  AgentEvent,
  AgentMessage,
  EventHandler,
  EventType,
} from "@/services/agents/types.ts";
import type {
  ClaudeProviderEventSource,
  ProviderStreamEventType,
} from "@/services/agents/provider-events.ts";
import type { WorkflowRuntimeFeatureFlags } from "@/services/workflows/runtime-contracts.ts";
import type { ClaudeSyntheticForegroundAgent } from "@/services/events/adapters/providers/claude/tool-state.ts";
import { resolveAgentOnlyTaskLabel } from "@/services/events/adapters/provider-shared.ts";
import { classifyError, computeDelay, retrySleep, DEFAULT_MAX_RETRIES } from "@/services/events/adapters/retry.ts";

export async function startClaudeStreaming(args: {
  session: Session;
  message: string;
  options: StreamAdapterOptions;
  client?: CodingAgentClient;
  sessionId: string;
  busPublish: (event: BusEvent<"stream.session.retry">) => void;
  getAbortController: () => AbortController | null;
  setAbortController: (controller: AbortController | null) => void;
  getUnsubscribers: () => Array<() => void>;
  setUnsubscribers: (unsubscribers: Array<() => void>) => void;
  cleanupSubscriptions: (unsubscribers: Array<() => void>) => Array<() => void>;
  getTextAccumulator: () => string;
  setTextAccumulator: (value: string) => void;
  resetToolState: () => void;
  clearThinkingStartTimes: () => void;
  setSyntheticForegroundAgent: (value: ClaudeSyntheticForegroundAgent | null) => void;
  setAccumulatedOutputTokens: (value: number) => void;
  createSubagentTracker: (runId: number) => void;
  setPreferClientToolHooks: (value: boolean) => void;
  resolveRuntimeFeatureFlags: (
    value: Partial<WorkflowRuntimeFeatureFlags> | undefined,
  ) => WorkflowRuntimeFeatureFlags;
  setRuntimeFeatureFlags: (value: WorkflowRuntimeFeatureFlags) => void;
  resetTurnMetadataState: () => void;
  publishSessionStart: (runId: number) => void;
  publishSyntheticAgentStart: (runId: number) => void;
  publishSyntheticAgentComplete: (runId: number, success: boolean, error?: string) => void;
  publishTextComplete: (runId: number, messageId: string) => void;
  publishSessionError: (runId: number, error: unknown) => void;
  cleanupOrphanedTools: (runId: number) => void;
  publishSessionIdle: (runId: number, reason: "generator-complete" | "aborted" | "error") => void;
  processStreamChunk: (chunk: AgentMessage, runId: number, messageId: string) => void;
  createAgentEvent: <T extends EventType>(event: {
    type: T;
    sessionId: string;
    timestamp: number;
    data: unknown;
    nativeSessionId?: unknown;
  }) => AgentEvent<T>;
  createHandler: <T extends ProviderStreamEventType>(
    type: T,
    runId: number,
    messageId: string,
  ) => EventHandler<T>;
}): Promise<void> {
  const { runId, messageId, agent, runtimeFeatureFlags, abortSignal } = args.options;

  args.setUnsubscribers(args.cleanupSubscriptions(args.getUnsubscribers()));

  const abortController = new AbortController();
  args.setAbortController(abortController);
  const forwardExternalAbort = () => {
    args.getAbortController()?.abort();
  };
  if (abortSignal?.aborted) {
    forwardExternalAbort();
  } else if (abortSignal) {
    abortSignal.addEventListener("abort", forwardExternalAbort, { once: true });
  }

  args.setTextAccumulator("");
  args.clearThinkingStartTimes();
  args.resetToolState();
  args.setSyntheticForegroundAgent(
    agent
      ? {
          id: `agent-only-${messageId}`,
          name: agent,
          task: resolveAgentOnlyTaskLabel(args.message, agent),
          started: false,
          completed: false,
          sawNativeSubagentStart: false,
        }
      : null,
  );
  args.setAccumulatedOutputTokens(0);
  args.createSubagentTracker(runId);
  args.setPreferClientToolHooks(false);
  args.setRuntimeFeatureFlags(args.resolveRuntimeFeatureFlags(runtimeFeatureFlags));
  args.resetTurnMetadataState();

  args.publishSessionStart(runId);
  args.publishSyntheticAgentStart(runId);

  const client =
    args.client ?? (args.session as Session & { __client?: CodingAgentClient }).__client;
  const providerClient = client as (CodingAgentClient & ClaudeProviderEventSource) | undefined;
  if (providerClient && typeof providerClient.onProviderEvent === "function") {
    args.setPreferClientToolHooks(true);
    const providerEventTypes: ProviderStreamEventType[] = [
      "tool.start",
      "tool.complete",
      "subagent.start",
      "subagent.complete",
      "subagent.update",
      "session.error",
      "usage",
      "permission.requested",
      "human_input_required",
      "skill.invoked",
      "message.delta",
      "reasoning.delta",
      "reasoning.complete",
      "message.complete",
      "turn.start",
      "turn.end",
      "tool.partial_result",
      "session.info",
      "session.warning",
      "session.title_changed",
      "session.truncation",
      "session.compaction",
    ];
    const handlers = new Map(
      providerEventTypes.map((type) => [type, args.createHandler(type, runId, messageId)]),
    );

    const unsubscribe = providerClient.onProviderEvent((event) => {
      if (event.type === "tool.start" || event.type === "tool.complete") {
        args.setPreferClientToolHooks(true);
      }
      const handler = handlers.get(event.type);
      if (handler) {
        handler(args.createAgentEvent(event));
      }
    });
    args.setUnsubscribers([...args.getUnsubscribers(), unsubscribe]);
  }

  let streamCompletionReason: "generator-complete" | "aborted" | "error" = "generator-complete";

  try {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= DEFAULT_MAX_RETRIES; attempt++) {
      try {
        const stream = args.session.stream(args.message, agent ? { agent } : undefined);

        for await (const chunk of stream) {
          if (args.getAbortController()?.signal.aborted) {
            streamCompletionReason = "aborted";
            break;
          }

          args.processStreamChunk(chunk, runId, messageId);
        }

        const wasAborted = args.getAbortController()?.signal.aborted ?? false;
        if (!wasAborted && args.getTextAccumulator().length > 0) {
          args.publishTextComplete(runId, messageId);
        }
        if (!wasAborted) {
          args.publishSyntheticAgentComplete(runId, true);
        }

        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (args.getAbortController()?.signal.aborted) {
          streamCompletionReason = "aborted";
          break;
        }

        const classified = classifyError(error);
        if (!classified.isRetryable || attempt >= DEFAULT_MAX_RETRIES) {
          break;
        }

        const delay = computeDelay(attempt, classified);
        args.busPublish({
          type: "stream.session.retry",
          sessionId: args.sessionId,
          runId,
          timestamp: Date.now(),
          data: {
            attempt,
            delay,
            message: `${classified.message} — retrying in ${Math.ceil(delay / 1000)}s`,
            nextRetryAt: Date.now() + delay,
          },
        });

        args.setTextAccumulator("");
        const signal = args.getAbortController()?.signal;
        if (!signal) {
          break;
        }
        await retrySleep(delay, signal);
      }
    }

    if (lastError) {
      throw lastError;
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (args.getAbortController()?.signal.aborted) {
      streamCompletionReason = "aborted";
    }
    if (args.getAbortController() && !args.getAbortController()!.signal.aborted) {
      streamCompletionReason = "error";
      args.publishSessionError(runId, error);
    }
    args.publishSyntheticAgentComplete(runId, false, errorMessage);
  } finally {
    if (abortSignal) {
      abortSignal.removeEventListener("abort", forwardExternalAbort);
    }
    if (args.getAbortController()?.signal.aborted) {
      streamCompletionReason = "aborted";
      args.publishSyntheticAgentComplete(runId, false, "Tool execution aborted");
    }
    args.cleanupOrphanedTools(runId);
    args.publishSessionIdle(runId, streamCompletionReason);
  }
}
