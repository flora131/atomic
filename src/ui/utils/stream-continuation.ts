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

export function isAskQuestionToolName(toolName: string): boolean {
  const normalized = toolName.trim().toLowerCase();
  return normalized === ASK_QUESTION_TOOL_SUFFIX
    || normalized.endsWith(`/${ASK_QUESTION_TOOL_SUFFIX}`)
    || normalized.endsWith(`__${ASK_QUESTION_TOOL_SUFFIX}`);
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
