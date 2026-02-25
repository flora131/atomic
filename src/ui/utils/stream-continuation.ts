import type { Part, ToolPart } from "../parts/types.ts";

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
}

export interface StopStreamOptions {
  preserveStreamingStart?: boolean;
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
const NON_BLOCKING_TOOL_SUFFIX = "skill";

export function invalidateActiveStreamGeneration(currentGeneration: number): number {
  return currentGeneration + 1;
}

export function isCurrentStreamCallback(
  activeGeneration: number,
  callbackGeneration: number,
): boolean {
  return activeGeneration === callbackGeneration;
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
  };
}

export function interruptRunningToolCalls<T extends { status: string }>(
  toolCalls?: readonly T[],
): T[] | undefined {
  if (!toolCalls) return undefined;
  return toolCalls.map((toolCall) =>
    toolCall.status === "running"
      ? { ...toolCall, status: "interrupted" }
      : { ...toolCall },
  );
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
    || normalized.endsWith(`__${ASK_QUESTION_TOOL_SUFFIX}`);
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
  const schedule = options?.schedule ?? ((callback: () => void, delay: number) => {
    setTimeout(callback, delay);
  });

  // Legacy fast-path: preserve return semantics when no guard is needed.
  if (!options?.shouldDispatch) {
    const nextMessage = dequeue();
    if (!nextMessage) {
      return false;
    }

    schedule(() => {
      dispatch(nextMessage);
    }, delayMs);

    return true;
  }

  schedule(() => {
    if (!options.shouldDispatch?.()) {
      return;
    }
    const nextMessage = dequeue();
    if (!nextMessage) {
      return;
    }
    dispatch(nextMessage);
  }, delayMs);

  return true;
}
