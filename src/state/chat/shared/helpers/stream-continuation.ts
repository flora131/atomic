import type { Part, ToolPart } from "@/state/parts/types.ts";
import { isHitlToolName } from "@/state/streaming/pipeline-tools/shared.ts";
import { HITL_DECLINED_MESSAGE } from "@/lib/ui/hitl-response.ts";
import {
  incrementRuntimeParityCounter,
  observeRuntimeParityHistogram,
  runtimeParityDebug,
  setRuntimeParityGauge,
} from "@/services/workflows/runtime-parity-observability.ts";

export type SessionLoopFinishReason =
  | "tool-calls"
  | "stop"
  | "max-tokens"
  | "max-turns"
  | "error"
  | "unknown";

export interface SessionLoopContinuationInput {
  finishReason?: SessionLoopFinishReason;
  hasActiveForegroundAgents: boolean;
  hasRunningBlockingTool: boolean;
  hasPendingTaskContract: boolean;
}

export interface SessionLoopContinuationSignal {
  shouldContinue: boolean;
  reason: "finish-reason" | "pending-work" | "terminal";
}

export interface QueueDispatchOptions {
  delayMs?: number;
  schedule?: (callback: () => void, delayMs: number) => void;
  shouldDispatch?: () => boolean;
}

export interface StreamControlState {
  isStreaming: boolean;
  streamingMessageId: string | null;
  streamingStart: number | null;
  hasStreamingMeta: boolean;
  hasRunningTool: boolean;
  isAgentOnlyStream: boolean;
  hasPendingCompletion: boolean;
  hasPendingBackgroundWork: boolean;
}

export interface StopStreamOptions {
  preserveStreamingStart?: boolean;
  hasActiveBackgroundAgents?: boolean;
}

export interface StartStreamOptions {
  messageId: string;
  startedAt: number;
  isAgentOnlyStream?: boolean;
}

export interface ComposerSubmitGuardState {
  isStreaming: boolean;
  runningAskQuestionToolCount: number;
}

export interface QueueResumeGuardState {
  isStreaming: boolean;
  runningAskQuestionToolCount: number;
}

const DEFAULT_QUEUE_DISPATCH_DELAY_MS = 50;

const ASK_QUESTION_TOOL_SUFFIX = "ask_question";
const ASK_USER_TOOL_SUFFIX = "ask_user";
const NON_BLOCKING_TOOL_SUFFIX = "skill";

const CONTINUE_FINISH_REASONS = new Set<SessionLoopFinishReason>([
  "tool-calls",
  "unknown",
]);

export function shouldContinueParentSessionLoop(
  input: SessionLoopContinuationInput,
): SessionLoopContinuationSignal {
  observeRuntimeParityHistogram(
    "workflow.runtime.parity.loop_pending_flags",
    Number(input.hasActiveForegroundAgents) + Number(input.hasRunningBlockingTool) + Number(input.hasPendingTaskContract),
    { finishReason: input.finishReason ?? "unset" },
  );
  setRuntimeParityGauge(
    "workflow.runtime.parity.loop_pending_task_contract",
    input.hasPendingTaskContract ? 1 : 0,
    { finishReason: input.finishReason ?? "unset" },
  );

  if (
    input.hasActiveForegroundAgents
    || input.hasRunningBlockingTool
    || input.hasPendingTaskContract
  ) {
    incrementRuntimeParityCounter("workflow.runtime.parity.loop_decision_total", {
      decision: "continue",
      reason: "pending-work",
      finishReason: input.finishReason ?? "unset",
    });
    runtimeParityDebug("loop_decision", {
      decision: "continue",
      reason: "pending-work",
      finishReason: input.finishReason ?? "unset",
      hasActiveForegroundAgents: input.hasActiveForegroundAgents,
      hasRunningBlockingTool: input.hasRunningBlockingTool,
      hasPendingTaskContract: input.hasPendingTaskContract,
    });
    return {
      shouldContinue: true,
      reason: "pending-work",
    };
  }

  if (input.finishReason && CONTINUE_FINISH_REASONS.has(input.finishReason)) {
    incrementRuntimeParityCounter("workflow.runtime.parity.loop_decision_total", {
      decision: "continue",
      reason: "finish-reason",
      finishReason: input.finishReason,
    });
    runtimeParityDebug("loop_decision", {
      decision: "continue",
      reason: "finish-reason",
      finishReason: input.finishReason,
    });
    return {
      shouldContinue: true,
      reason: "finish-reason",
    };
  }

  incrementRuntimeParityCounter("workflow.runtime.parity.loop_decision_total", {
    decision: "stop",
    reason: "terminal",
    finishReason: input.finishReason ?? "unset",
  });
  runtimeParityDebug("loop_decision", {
    decision: "stop",
    reason: "terminal",
    finishReason: input.finishReason ?? "unset",
  });

  return {
    shouldContinue: false,
    reason: "terminal",
  };
}

export function createStoppedStreamControlState(
  current: StreamControlState,
  options?: StopStreamOptions,
): StreamControlState {
  return {
    ...current,
    isStreaming: false,
    streamingMessageId: null,
    streamingStart: options?.preserveStreamingStart ? current.streamingStart : null,
    hasStreamingMeta: false,
    hasRunningTool: false,
    isAgentOnlyStream: false,
    hasPendingCompletion: false,
    hasPendingBackgroundWork: options?.hasActiveBackgroundAgents ?? false,
  };
}

export function createStartedStreamControlState(
  current: StreamControlState,
  options: StartStreamOptions,
): StreamControlState {
  return {
    ...current,
    isStreaming: true,
    streamingMessageId: options.messageId,
    streamingStart: options.startedAt,
    hasStreamingMeta: false,
    hasRunningTool: false,
    isAgentOnlyStream: options.isAgentOnlyStream ?? false,
    hasPendingCompletion: false,
    hasPendingBackgroundWork: false,
  };
}

/**
 * Freeze running tool parts by transitioning them to "interrupted" with
 * their elapsed duration captured, so tool timers stop on Ctrl+C / ESC.
 */
export function interruptRunningToolParts(parts?: readonly Part[]): Part[] | undefined {
  if (!parts) return undefined;
  return parts.map((part) => {
    if (part.type === "tool") {
      const toolPart = part as ToolPart;
      if (toolPart.state.status === "running") {
        // HITL tools get a distinct error state signalling a user decline
        // rather than a generic abort, and their pending question is cleared.
        if (isHitlToolName(toolPart.toolName)) {
          return {
            ...toolPart,
            state: { status: "error" as const, error: HITL_DECLINED_MESSAGE },
            hitlResponse: toolPart.hitlResponse ?? {
              cancelled: true,
              responseMode: "declined",
              answerText: "",
              displayText: HITL_DECLINED_MESSAGE,
            },
            pendingQuestion: undefined,
          };
        }
        const startedAtMs = new Date(toolPart.state.startedAt).getTime();
        const durationMs = Number.isFinite(startedAtMs) ? Math.max(0, Date.now() - startedAtMs) : undefined;
        return { ...toolPart, state: { status: "interrupted" as const, durationMs } };
      }
    }
    return part;
  });
}

export function isAskQuestionToolName(toolName: string): boolean {
  const normalized = toolName.trim().toLowerCase();
  return normalized === ASK_QUESTION_TOOL_SUFFIX
    || normalized.endsWith(`/${ASK_QUESTION_TOOL_SUFFIX}`)
    || normalized.endsWith(`__${ASK_QUESTION_TOOL_SUFFIX}`)
    || normalized === ASK_USER_TOOL_SUFFIX
    || normalized.endsWith(`/${ASK_USER_TOOL_SUFFIX}`)
    || normalized.endsWith(`__${ASK_USER_TOOL_SUFFIX}`);
}

/**
 * Some lightweight lifecycle tools (for example Skill loaders) may emit start
 * events without a matching complete event, depending on SDK/provider behavior.
 * They should not block stream finalization.
 */
export function shouldTrackToolAsBlocking(toolName: string): boolean {
  const normalized = toolName.trim().toLowerCase();
  if (normalized.length === 0) {
    return true;
  }

  return normalized !== NON_BLOCKING_TOOL_SUFFIX
    && !normalized.endsWith(`/${NON_BLOCKING_TOOL_SUFFIX}`)
    && !normalized.endsWith(`__${NON_BLOCKING_TOOL_SUFFIX}`);
}

export function shouldDeferComposerSubmit(state: ComposerSubmitGuardState): boolean {
  return state.isStreaming && state.runningAskQuestionToolCount > 0;
}

export function shouldDispatchQueuedMessage(state: QueueResumeGuardState): boolean {
  return !state.isStreaming && state.runningAskQuestionToolCount === 0;
}

export function dispatchNextQueuedMessage<T>(
  dequeue: () => T | undefined,
  dispatch: (message: T) => void,
  options?: QueueDispatchOptions,
): boolean {
  const delayMs = options?.delayMs ?? DEFAULT_QUEUE_DISPATCH_DELAY_MS;
  if (!Number.isFinite(delayMs) || delayMs < 0) {
    incrementRuntimeParityCounter("workflow.runtime.parity.queue_dispatch_invariant_failures_total", {
      reason: "invalid_delay",
    });
    throw new Error(`dispatchNextQueuedMessage requires non-negative finite delay, received ${delayMs}`);
  }
  const schedule = options?.schedule ?? ((callback: () => void, delay: number) => {
    setTimeout(callback, delay);
  });

  // Legacy fast-path: preserve return semantics when no guard is needed.
  if (!options?.shouldDispatch) {
    const nextMessage = dequeue();
    if (!nextMessage) {
      incrementRuntimeParityCounter("workflow.runtime.parity.queue_dispatch_total", {
        result: "no-op",
        mode: "unguarded",
      });
      return false;
    }

    schedule(() => {
      dispatch(nextMessage);
    }, delayMs);

    incrementRuntimeParityCounter("workflow.runtime.parity.queue_dispatch_total", {
      result: "scheduled",
      mode: "unguarded",
    });
    runtimeParityDebug("queue_dispatch", {
      mode: "unguarded",
      delayMs,
      scheduled: true,
    });

    return true;
  }

  schedule(() => {
    if (!options.shouldDispatch?.()) {
      incrementRuntimeParityCounter("workflow.runtime.parity.queue_dispatch_total", {
        result: "guard_blocked",
        mode: "guarded",
      });
      return;
    }
    const nextMessage = dequeue();
    if (!nextMessage) {
      incrementRuntimeParityCounter("workflow.runtime.parity.queue_dispatch_total", {
        result: "empty_queue",
        mode: "guarded",
      });
      return;
    }
    incrementRuntimeParityCounter("workflow.runtime.parity.queue_dispatch_total", {
      result: "dispatched",
      mode: "guarded",
    });
    dispatch(nextMessage);
  }, delayMs);

  runtimeParityDebug("queue_dispatch", {
    mode: "guarded",
    delayMs,
    scheduled: true,
  });

  return true;
}
