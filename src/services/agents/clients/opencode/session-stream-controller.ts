import type { AgentMessage } from "@/services/agents/types.ts";

const PRE_PROMPT_TERMINAL_SETTLE_MS = 500;

export interface OpenCodeSessionStreamController {
  enqueueDelta: (messageChunk: AgentMessage) => void;
  dequeueDelta: () => AgentMessage | undefined;
  hasQueuedDelta: () => boolean;
  clearQueuedDeltas: () => void;
  waitForStreamSignal: () => Promise<void>;
  clearSettleWaitTimer: () => void;
  handleStreamAbort: () => void;
  isRelatedSession: (candidateSessionId: string) => boolean;
  registerRelatedSession: (candidateSessionId: unknown) => void;
  buildSyntheticToolUseId: () => string;
  markToolStarted: (toolUseId: string) => boolean;
  markToolCompleted: (toolUseId: string) => boolean;
  markTerminalEventSeen: () => void;
  markStreamDone: (value?: boolean) => void;
  isStreamDone: () => boolean;
  setStreamError: (error: Error | null) => void;
  getStreamError: () => Error | null;
  setPromptInFlight: (value: boolean) => void;
  isPromptInFlight: () => boolean;
  shouldAutoCompleteTerminalWait: () => boolean;
  resetStreamTerminalState: () => void;
}

export function createOpenCodeSessionStreamController(args: {
  sessionId: string;
  isSubagentDispatch: boolean;
}): OpenCodeSessionStreamController {
  const deltaQueue: AgentMessage[] = [];
  let deltaQueueHead = 0;
  let resolveNext: (() => void) | null = null;
  let settleWaitTimer: ReturnType<typeof setTimeout> | null = null;
  let streamDone = false;
  let streamError: Error | null = null;
  let terminalEventSeen = false;
  let terminalEventAt: number | null = null;
  let promptInFlight = false;
  const relatedSessionIds = new Set<string>([args.sessionId]);
  const startedToolUseIds = new Set<string>();
  const completedToolUseIds = new Set<string>();
  let syntheticToolUseCounter = 0;

  const compactDeltaQueue = (force = false): void => {
    if (deltaQueueHead === 0) {
      return;
    }
    if (force || deltaQueueHead >= deltaQueue.length) {
      deltaQueue.length = 0;
      deltaQueueHead = 0;
      return;
    }
    if (deltaQueueHead >= 128 && deltaQueueHead * 2 >= deltaQueue.length) {
      deltaQueue.splice(0, deltaQueueHead);
      deltaQueueHead = 0;
    }
  };

  const clearSettleWaitTimer = (): void => {
    if (settleWaitTimer !== null) {
      clearTimeout(settleWaitTimer);
      settleWaitTimer = null;
    }
  };

  const wakeStreamLoop = (): void => {
    if (!resolveNext) {
      return;
    }
    const resolve = resolveNext;
    resolveNext = null;
    clearSettleWaitTimer();
    resolve();
  };

  const enqueueDelta = (messageChunk: AgentMessage): void => {
    deltaQueue.push(messageChunk);
    wakeStreamLoop();
  };

  const hasQueuedDelta = (): boolean => deltaQueueHead < deltaQueue.length;

  const dequeueDelta = (): AgentMessage | undefined => {
    if (!hasQueuedDelta()) {
      return undefined;
    }
    const nextChunk = deltaQueue[deltaQueueHead];
    deltaQueueHead += 1;
    compactDeltaQueue();
    return nextChunk;
  };

  const waitForStreamSignal = async (): Promise<void> => {
    await new Promise<void>((resolve) => {
      resolveNext = resolve;
      if (terminalEventSeen && terminalEventAt !== null && promptInFlight) {
        const elapsed = Date.now() - terminalEventAt;
        const remaining = PRE_PROMPT_TERMINAL_SETTLE_MS - elapsed;
        if (remaining <= 0) {
          wakeStreamLoop();
          return;
        }
        settleWaitTimer = setTimeout(() => {
          settleWaitTimer = null;
          wakeStreamLoop();
        }, remaining);
      }
    });
  };

  return {
    enqueueDelta,
    dequeueDelta,
    hasQueuedDelta,
    clearQueuedDeltas: () => {
      deltaQueue.length = 0;
      deltaQueueHead = 0;
    },
    waitForStreamSignal,
    clearSettleWaitTimer,
    handleStreamAbort: () => {
      streamDone = true;
      terminalEventSeen = true;
      terminalEventAt = Date.now();
      wakeStreamLoop();
    },
    isRelatedSession: (candidateSessionId: string): boolean => {
      if (!args.isSubagentDispatch) {
        return candidateSessionId === args.sessionId;
      }
      return candidateSessionId.length > 0 && relatedSessionIds.has(candidateSessionId);
    },
    registerRelatedSession: (candidateSessionId: unknown): void => {
      if (typeof candidateSessionId !== "string" || candidateSessionId.length === 0) {
        return;
      }
      relatedSessionIds.add(candidateSessionId);
    },
    buildSyntheticToolUseId: (): string => {
      syntheticToolUseCounter += 1;
      return `tool_${args.sessionId}_${syntheticToolUseCounter}`;
    },
    markToolStarted: (toolUseId: string): boolean => {
      if (startedToolUseIds.has(toolUseId)) {
        return false;
      }
      startedToolUseIds.add(toolUseId);
      return true;
    },
    markToolCompleted: (toolUseId: string): boolean => {
      if (completedToolUseIds.has(toolUseId)) {
        return false;
      }
      completedToolUseIds.add(toolUseId);
      return true;
    },
    markTerminalEventSeen: (): void => {
      terminalEventSeen = true;
      terminalEventAt = Date.now();
      wakeStreamLoop();
    },
    markStreamDone: (value = true): void => {
      streamDone = value;
      wakeStreamLoop();
    },
    isStreamDone: (): boolean => streamDone,
    setStreamError: (error: Error | null): void => {
      streamError = error;
    },
    getStreamError: (): Error | null => streamError,
    setPromptInFlight: (value: boolean): void => {
      promptInFlight = value;
      wakeStreamLoop();
    },
    isPromptInFlight: (): boolean => promptInFlight,
    shouldAutoCompleteTerminalWait: (): boolean =>
      terminalEventSeen
      && terminalEventAt !== null
      && (!promptInFlight || Date.now() - terminalEventAt >= PRE_PROMPT_TERMINAL_SETTLE_MS),
    resetStreamTerminalState: (): void => {
      streamDone = false;
      streamError = null;
      terminalEventSeen = false;
      terminalEventAt = null;
    },
  };
}
