import type {
  CopilotSession as SdkCopilotSession,
  SessionEvent as SdkSessionEvent,
} from "@github/copilot-sdk";

import type {
  AgentMessage,
  ContextUsage,
  EventType,
  Session,
  SessionConfig,
} from "@/services/agents/types.ts";
import type {
  ProviderStreamEventDataMap,
  ProviderStreamEventType,
} from "@/services/agents/provider-events.ts";

import {
  type CopilotSessionState,
  RECENT_EVENT_ID_WINDOW,
} from "@/services/agents/clients/copilot/types.ts";

export function createAbortError(message = "The operation was aborted."): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

export function subscribeCopilotSessionEvents(args: {
  sessionId: string;
  sdkSession: SdkCopilotSession;
  sessions: Map<string, CopilotSessionState>;
  handleSdkEvent: (sessionId: string, event: SdkSessionEvent) => void;
}): () => void {
  return args.sdkSession.on((event: SdkSessionEvent) => {
    const activeState = args.sessions.get(args.sessionId);
    if (activeState && activeState.sdkSession !== args.sdkSession) {
      return;
    }
    args.handleSdkEvent(args.sessionId, event);
  });
}

export function isDuplicateCopilotSdkEvent(
  state: CopilotSessionState,
  event: SdkSessionEvent,
): boolean {
  const id = (event as { id?: string }).id;
  if (!id) {
    return false;
  }

  if (state.recentEventIds.has(id)) {
    return true;
  }

  state.recentEventIds.add(id);
  state.recentEventOrder.push(id);

  if (state.recentEventOrder.length > RECENT_EVENT_ID_WINDOW) {
    const evicted = state.recentEventOrder.shift();
    if (evicted) {
      state.recentEventIds.delete(evicted);
    }
  }
  return false;
}

export function createWrappedCopilotSession(args: {
  sdkSession: SdkCopilotSession;
  config: SessionConfig;
  sessions: Map<string, CopilotSessionState>;
  subscribeSessionEvents: (
    sessionId: string,
    sdkSession: SdkCopilotSession,
  ) => () => void;
  emitEvent: <T extends EventType>(
    eventType: T,
    sessionId: string,
    data: Record<string, unknown>,
  ) => void;
  emitProviderEvent: <T extends ProviderStreamEventType>(
    eventType: T,
    sessionId: string,
    data: ProviderStreamEventDataMap[T],
    options?: {
      native?: SdkSessionEvent;
      nativeEventId?: string;
      nativeSessionId?: string;
      nativeParentEventId?: string;
      timestamp?: number;
    },
  ) => void;
  extractErrorMessage: (error: unknown) => string;
}): Session {
  const sessionId = args.sdkSession.sessionId;
  const unsubscribe = args.subscribeSessionEvents(sessionId, args.sdkSession);

  const state: CopilotSessionState = {
    sdkSession: args.sdkSession,
    sessionId,
    config: args.config,
    inputTokens: 0,
    outputTokens: 0,
    isClosed: false,
    unsubscribe,
    recentEventIds: new Set(),
    recentEventOrder: [],
    toolCallIdToName: new Map(),
    contextWindow: null,
    systemToolsBaseline: null,
    pendingAbortPromise: null,
  };

  const waitForPendingAbort = async (): Promise<void> => {
    const pendingAbort = state.pendingAbortPromise;
    if (!pendingAbort) {
      return;
    }
    try {
      await pendingAbort;
    } catch {
      // If abort fails, do not block subsequent turns.
    }
  };

  const runAbortWithLock = (): Promise<void> => {
    if (state.pendingAbortPromise) {
      return state.pendingAbortPromise;
    }

    const abortPromise = state.sdkSession.abort();
    state.pendingAbortPromise = abortPromise;
    void abortPromise
      .finally(() => {
        if (state.pendingAbortPromise === abortPromise) {
          state.pendingAbortPromise = null;
        }
      })
      .catch(() => {
        // Swallow errors from the finally-chain to avoid unhandled rejections.
      });

    return abortPromise;
  };

  args.sessions.set(sessionId, state);
  args.emitEvent("session.start", sessionId, { config: args.config });
  args.emitProviderEvent("session.start", sessionId, { config: args.config }, {
    nativeSessionId: sessionId,
  });

  return {
    id: sessionId,

    send: async (message: string): Promise<AgentMessage> => {
      if (state.isClosed) {
        throw new Error("Session is closed");
      }

      await waitForPendingAbort();

      let response: Awaited<ReturnType<SdkCopilotSession["sendAndWait"]>>;
      try {
        response = await state.sdkSession.sendAndWait({ prompt: message });
      } catch (error) {
        throw new Error(args.extractErrorMessage(error));
      }

      return {
        type: "text",
        content: response?.data.content ?? "",
        role: "assistant",
      };
    },

    stream: (
      message: string,
      options?: { agent?: string; abortSignal?: AbortSignal },
    ): AsyncIterable<AgentMessage> => {
      return {
        [Symbol.asyncIterator]: async function* () {
          if (state.isClosed) {
            throw new Error("Session is closed");
          }

          await waitForPendingAbort();

          if (options?.abortSignal?.aborted) {
            throw createAbortError();
          }

          const chunks: AgentMessage[] = [];
          let resolveChunk: (() => void) | null = null;
          let done = false;
          let aborted = false;
          let hasYieldedDeltas = false;

          const notifyConsumer = () => {
            if (resolveChunk) {
              const resolve = resolveChunk;
              resolveChunk = null;
              resolve();
            }
          };

          const abortListener = () => {
            aborted = true;
            done = true;
            notifyConsumer();
          };

          let reasoningStartMs: number | null = null;
          let reasoningDurationMs = 0;
          let streamingOutputTokens = 0;

          const eventHandler = (event: SdkSessionEvent) => {
            if (event.type === "assistant.message_delta") {
              const deltaData = event.data as Record<string, unknown>;
              if (deltaData.parentToolCallId) {
                return;
              }

              if (reasoningStartMs !== null) {
                reasoningDurationMs += Date.now() - reasoningStartMs;
                reasoningStartMs = null;
              }
              hasYieldedDeltas = true;
              chunks.push({
                type: "text",
                content: event.data.deltaContent,
                role: "assistant",
              });
              notifyConsumer();
              return;
            }

            if (event.type === "assistant.reasoning_delta") {
              if (reasoningStartMs === null) {
                reasoningStartMs = Date.now();
              }
              hasYieldedDeltas = true;
              chunks.push({
                type: "thinking",
                content: event.data.deltaContent,
                role: "assistant",
                metadata: {
                  provider: "copilot",
                  thinkingSourceKey: event.data.reasoningId,
                  streamingStats: {
                    thinkingMs: reasoningDurationMs + (Date.now() - reasoningStartMs),
                    outputTokens: 0,
                  },
                },
              });
              notifyConsumer();
              return;
            }

            if (event.type === "assistant.usage") {
              if (reasoningStartMs !== null) {
                reasoningDurationMs += Date.now() - reasoningStartMs;
                reasoningStartMs = null;
              }
              streamingOutputTokens += event.data.outputTokens ?? 0;
              chunks.push({
                type: "text",
                content: "",
                role: "assistant",
                metadata: {
                  streamingStats: {
                    outputTokens: streamingOutputTokens,
                    thinkingMs: reasoningDurationMs,
                  },
                },
              });
              notifyConsumer();
              return;
            }

            if (event.type === "assistant.message") {
              const messageData = event.data as Record<string, unknown>;
              if (messageData.parentToolCallId) {
                return;
              }
              if (!hasYieldedDeltas) {
                chunks.push({
                  type: "text",
                  content: event.data.content,
                  role: "assistant",
                  metadata: {
                    messageId: event.data.messageId,
                  },
                });
                notifyConsumer();
              }
              return;
            }

            if (event.type === "session.idle") {
              done = true;
              notifyConsumer();
            }
          };

          const unsub = state.sdkSession.on(eventHandler);
          options?.abortSignal?.addEventListener("abort", abortListener, { once: true });

          try {
            try {
              await state.sdkSession.send({ prompt: message });
            } catch (error) {
              throw new Error(args.extractErrorMessage(error));
            }

            while ((!done || chunks.length > 0) && !aborted) {
              if (chunks.length > 0) {
                yield chunks.shift()!;
              } else if (!done) {
                await new Promise<void>((resolve) => {
                  resolveChunk = resolve;
                  if (done || chunks.length > 0) {
                    resolveChunk = null;
                    resolve();
                  }
                });
              }
            }

            if (aborted) {
              throw createAbortError();
            }
          } finally {
            unsub();
            options?.abortSignal?.removeEventListener("abort", abortListener);
          }
        },
      };
    },

    summarize: async (): Promise<void> => {
      if (state.isClosed) {
        throw new Error("Session is closed");
      }

      await waitForPendingAbort();
      await state.sdkSession.sendAndWait({ prompt: "/compact" });
    },

    getContextUsage: async (): Promise<ContextUsage> => {
      if (state.contextWindow === null) {
        throw new Error("Context window size unavailable: listModels() did not return model limits.");
      }

      const maxTokens = state.contextWindow;
      return {
        inputTokens: state.inputTokens,
        outputTokens: state.outputTokens,
        maxTokens,
        usagePercentage: ((state.inputTokens + state.outputTokens) / maxTokens) * 100,
      };
    },

    destroy: async (): Promise<void> => {
      if (!state.isClosed) {
        state.isClosed = true;
        state.unsubscribe();
        await state.sdkSession.destroy();
        args.sessions.delete(sessionId);
        args.emitEvent("session.idle", sessionId, { reason: "destroyed" });
        args.emitProviderEvent("session.idle", sessionId, { reason: "destroyed" }, {
          nativeSessionId: sessionId,
        });
      }
    },

    abort: async (): Promise<void> => {
      await runAbortWithLock();
    },

    abortBackgroundAgents: async (): Promise<void> => {
      await runAbortWithLock();
    },

    getSystemToolsTokens: (): number => {
      if (state.systemToolsBaseline === null) {
        throw new Error("System tools baseline unavailable: no session.usage_info received yet.");
      }
      return state.systemToolsBaseline;
    },
  };
}
