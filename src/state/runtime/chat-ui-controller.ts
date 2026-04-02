import type {
  CommandExecutionTelemetry,
  MessageSubmitTelemetry,
  OnTerminateBackgroundAgents,
} from "@/types/chat.ts";
import type { SessionConfig } from "@/services/agents/types.ts";
import { SessionExpiredError } from "@/services/events/adapters/provider-shared.ts";
import { registerAgentToolNames } from "@/components/tool-registry/registry/index.ts";
import { createChatUIRuntimeState } from "@/state/runtime/chat-ui-runtime-state.ts";
import { createStreamAdapter, createStreamAdapterForSession } from "@/state/runtime/chat-ui-stream-adapter.ts";
import type { Session } from "@/services/agents/contracts/session.ts";
import { clearAgentEventBuffer } from "@/state/streaming/pipeline.ts";
import type {
  ChatUIDebugSubscription,
  ChatUIState,
  CreateChatUIControllerArgs,
} from "@/state/runtime/chat-ui-controller-types.ts";

export type { ChatUIDebugSubscription, ChatUIState } from "@/state/runtime/chat-ui-controller-types.ts";
export { createChatUIRuntimeState } from "@/state/runtime/chat-ui-runtime-state.ts";

/** Best-effort error logger for cleanup paths where throwing is undesirable. */
function logCleanupError(context: string, error: unknown): void {
  if (process.env.DEBUG) {
    console.debug(`[chat-ui-controller] ${context}:`, error);
  }
}

export function createChatUIController(args: CreateChatUIControllerArgs) {
  const {
    client,
    resolvedAgentType,
    sessionConfig,
    clientStartPromise,
    modelOps,
    state,
    debugSub,
    onExitResolved,
  } = args;

  async function abortAndDestroySession(session: NonNullable<ChatUIState["session"]>): Promise<void> {
    if (state.streamAbortController && !state.streamAbortController.signal.aborted) {
      state.streamAbortController.abort();
    }

    const pendingAbort = state.pendingAbortPromise;
    if (pendingAbort) {
      try {
        await pendingAbort;
      } catch (error) {
        logCleanupError("pendingAbortPromise in abortAndDestroy", error);
      }
    } else if (session.abort) {
      const abortPromise = session.abort();
      state.pendingAbortPromise = abortPromise;
      try {
        await abortPromise;
      } catch (error) {
        logCleanupError("session.abort()", error);
      } finally {
        if (state.pendingAbortPromise === abortPromise) {
          state.pendingAbortPromise = null;
        }
      }
    }

    if (session.abortBackgroundAgents) {
      try {
        await session.abortBackgroundAgents();
      } catch (error) {
        logCleanupError("session.abortBackgroundAgents()", error);
      }
    }

    try {
      await session.destroy();
    } catch (error) {
      logCleanupError("session.destroy()", error);
    }
  }

  async function cleanup(): Promise<void> {
    state.currentRunId = null;
    state.isStreaming = false;
    state.pendingBackgroundTerminationPromise = null;

    await debugSub.unsubscribe();
    state.dispatcher.dispose();
    state.bus.clear();

    for (const handler of state.cleanupHandlers) {
      handler();
    }
    state.cleanupHandlers = [];

    if (state.session) {
      await abortAndDestroySession(state.session);
      state.session = null;
    }

    if (state.root) {
      try {
        state.root.unmount();
      } catch (error) {
        logCleanupError("root.unmount()", error);
      }
      state.root = null;
    }

    if (state.renderer) {
      try {
        if (process.stdout.isTTY) {
          try {
            process.stdout.write("\x1b[>4;0m");
          } catch (error) {
            logCleanupError("stdout.write escape sequence", error);
          }
        }
        state.renderer.destroy();
      } catch (error) {
        logCleanupError("renderer.destroy()", error);
      }
      state.renderer = null;
    }

    const duration = Date.now() - state.startTime;
    state.telemetryTracker?.end({
      durationMs: duration,
      messageCount: state.messageCount,
    });

    onExitResolved({
      messageCount: state.messageCount,
      duration,
    });
  }

  async function ensureSession(): Promise<void> {
    if (state.session) return;
    if (state.sessionCreationPromise) {
      await state.sessionCreationPromise;
      return;
    }

    state.sessionCreationPromise = (async () => {
      try {
        if (clientStartPromise) {
          await clientStartPromise;
        }

        state.currentRunId = null;

        if (modelOps && sessionConfig) {
          const pendingModel = modelOps.getPendingModel();
          const currentModel = await modelOps.getCurrentModel();
          if (pendingModel) {
            sessionConfig.model = pendingModel;
          } else if (currentModel) {
            sessionConfig.model = currentModel;
          }

          if (
            resolvedAgentType === "copilot"
            || resolvedAgentType === "opencode"
            || resolvedAgentType === "claude"
          ) {
            const pendingEffort =
              "getPendingReasoningEffort" in modelOps
              && typeof modelOps.getPendingReasoningEffort === "function"
                ? modelOps.getPendingReasoningEffort()
                : undefined;
            const selectedModel = sessionConfig.model;
            const preferredEffort =
              pendingEffort !== undefined
                ? pendingEffort
                : sessionConfig.reasoningEffort;

            if (
              selectedModel &&
              "sanitizeReasoningEffortForModel" in modelOps &&
              typeof modelOps.sanitizeReasoningEffortForModel === "function"
            ) {
              sessionConfig.reasoningEffort = await modelOps.sanitizeReasoningEffortForModel(
                selectedModel,
                preferredEffort,
              );
            } else if (pendingEffort !== undefined) {
              sessionConfig.reasoningEffort = pendingEffort;
            }
          }
        }

        state.session = await client.createSession(sessionConfig);
        modelOps?.invalidateModelCache?.();
        state.ownedSessionIds.add(state.session.id);
      } finally {
        state.sessionCreationPromise = null;
      }
    })();

    await state.sessionCreationPromise;
  }

  async function handleSendMessage(_content: string): Promise<void> {
    try {
      await ensureSession();
    } catch (error) {
      console.error("Failed to create session:", error);
      return;
    }

    state.messageCount++;
  }

  async function handleStreamMessage(
    content: string,
    options?: {
      agent?: string;
      skillCommand?: { name: string; args: string };
      isAgentOnlyStream?: boolean;
    },
  ): Promise<void> {
    const pendingAbort = state.pendingAbortPromise;
    if (pendingAbort) {
      try {
        await pendingAbort;
      } catch (error) {
        logCleanupError("pendingAbortPromise in handleStreamMessage", error);
      }
    }

    // Wait for any in-flight background-agent termination to complete before
    // starting a new stream. Without this, a racing session.abort() from the
    // termination handler can silently kill the new stream.
    const pendingBgTermination = state.pendingBackgroundTerminationPromise;
    if (pendingBgTermination) {
      try {
        await pendingBgTermination;
      } catch (error) {
        logCleanupError("pendingBackgroundTerminationPromise in handleStreamMessage", error);
      }
    }

    state.currentRunId = null;

    try {
      await ensureSession();
    } catch (error) {
      console.error("Failed to create session:", error);
      return;
    }

    let effectiveContent = content;
    if (state.backgroundAgentsTerminated) {
      state.backgroundAgentsTerminated = false;
      effectiveContent =
        "[System: All background agents were terminated by the user (Ctrl+C). "
        + "Do not reference or wait for any previously running background agents.]\n\n"
        + content;
    }

    // Clear stale agent event buffer before starting a new stream
    clearAgentEventBuffer();

    state.streamAbortController = new AbortController();
    const thisRunId = ++state.runCounter;
    state.currentRunId = thisRunId;
    state.isStreaming = true;

    const adapter = createStreamAdapter({ client, state, resolvedAgentType });
    const messageId = crypto.randomUUID();
    debugSub.writeRawLine(`❯ ${content}`, {
      sessionId: state.session?.id,
      runId: thisRunId,
      component: "prompt",
    });

    const knownAgentNames = client.getKnownAgentNames?.() ?? [];
    if (knownAgentNames.length > 0) {
      registerAgentToolNames(knownAgentNames);
    }

    try {
      // Guard against session being nulled by a concurrent interrupt
      const session = state.session;
      if (!session) {
        state.currentRunId = null;
        state.isStreaming = false;
        return;
      }

      await adapter.startStreaming(session, effectiveContent, {
        runId: thisRunId,
        messageId,
        abortSignal: state.streamAbortController?.signal,
        agent: options?.agent,
        suppressSyntheticAgentLifecycle:
          resolvedAgentType === "claude" && options?.isAgentOnlyStream === true,
        knownAgentNames,
        skillCommand: options?.skillCommand,
      });

      state.messageCount++;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        // Don't null currentRunId here — let the finally block handle cleanup
        // via its guard (state.currentRunId === thisRunId). Nulling it here
        // caused the guard to fail, leaving state.isStreaming stuck at true.
        return;
      }

      const isSessionError =
        error instanceof SessionExpiredError ||
        /unknown.session|session.*(not found|expired|invalid)/i.test(
          error instanceof Error ? error.message : String(error),
        );
      if (isSessionError && state.session) {
        const expiredSessionId = state.session.id;
        adapter.dispose();
        state.session = null;
        try {
          // Try to resume the existing session first to preserve conversation
          // history. Only fall back to creating a brand-new session when
          // resume fails (e.g. the session truly no longer exists).
          const resumed = await client.resumeSession(expiredSessionId);
          if (resumed) {
            state.session = resumed;
            state.ownedSessionIds.add(resumed.id);
          } else {
            await ensureSession();
          }
          const retryAdapter = createStreamAdapter({ client, state, resolvedAgentType });
          state.streamAbortController = new AbortController();
          const retryRunId = ++state.runCounter;
          state.currentRunId = retryRunId;

          // Guard session after ensureSession
          const retrySession = state.session;
          if (!retrySession) {
            state.currentRunId = null;
            state.isStreaming = false;
            return;
          }

          try {
            await retryAdapter.startStreaming(retrySession, effectiveContent, {
              runId: retryRunId,
              messageId,
              abortSignal: state.streamAbortController?.signal,
              agent: options?.agent,
              suppressSyntheticAgentLifecycle:
                resolvedAgentType === "claude" && options?.isAgentOnlyStream === true,
              knownAgentNames,
              skillCommand: options?.skillCommand,
            });
            state.messageCount++;
          } finally {
            retryAdapter.dispose();
            // Only clean up state if this retry is still the active run
            if (state.currentRunId === retryRunId) {
              state.streamAbortController = null;
              state.isStreaming = false;
              state.currentRunId = null;
            }
          }
        } catch (retryError) {
          console.error("[chat-ui-controller] Session retry failed:", retryError);
          // Don't null currentRunId — let the outer finally block handle
          // cleanup so state.isStreaming is properly reset.
        }
        return;
      }

      // Don't null currentRunId — let the finally block handle cleanup
      // via its guard so state.isStreaming is properly reset.
    } finally {
      adapter.dispose();
      // Only clean up state if this run is still the active run.
      // Prevents a stale finally block from clobbering a newer stream's state.
      if (state.currentRunId === thisRunId) {
        state.streamAbortController = null;
        state.isStreaming = false;
        state.currentRunId = null;
      }
    }
  }

  async function handleExit(): Promise<void> {
    await cleanup();
  }

  function handleInterrupt(sourceType: "ui" | "signal"): void {
    if (state.isStreaming) {
      if (state.streamAbortController?.signal.aborted) return;

      // Abort the controller synchronously so the stream sees the signal immediately
      if (
        state.streamAbortController
        && !state.streamAbortController.signal.aborted
      ) {
        state.streamAbortController.abort();
      }

      // Do NOT set isStreaming=false here — let the stream's finally block
      // handle cleanup to avoid the race where a new stream starts while
      // the old one's finally block hasn't run yet.

      if (!state.pendingAbortPromise) {
        const abortPromise = (async () => {
          if (state.session?.abort) {
            await state.session.abort();
          }
          // For signal-based interrupts the UI-layer
          // terminateActiveBackgroundAgents never fires, so we must
          // explicitly abort background agents here.
          if (sourceType === "signal" && state.session?.abortBackgroundAgents) {
            await state.session.abortBackgroundAgents();
          }
        })();

        state.pendingAbortPromise = abortPromise;
        // Attach .catch() directly to the abort promise to prevent unhandled rejection
        abortPromise
          .finally(() => {
            if (state.pendingAbortPromise === abortPromise) {
              state.pendingAbortPromise = null;
            }
          })
          .catch((error) => {
            logCleanupError("abort promise in handleInterrupt", error);
          });
      }

      state.telemetryTracker?.trackInterrupt(sourceType);
      state.interruptCount = 0;
      if (state.interruptTimeout) {
        clearTimeout(state.interruptTimeout);
        state.interruptTimeout = null;
      }
      return;
    }

    state.interruptCount++;
    if (state.interruptCount >= 2) {
      state.interruptCount = 0;
      if (state.interruptTimeout) {
        clearTimeout(state.interruptTimeout);
        state.interruptTimeout = null;
      }
      void cleanup();
      return;
    }

    // For signal-based interrupts when not streaming, still try to
    // abort background agents (the UI-layer key handlers handle this
    // for "ui" interrupts via terminateActiveBackgroundAgents).
    if (sourceType === "signal" && state.session?.abortBackgroundAgents) {
      void state.session.abortBackgroundAgents().catch((error) => {
        logCleanupError("abortBackgroundAgents in handleInterrupt (not streaming)", error);
      });
    }

    if (state.interruptTimeout) {
      clearTimeout(state.interruptTimeout);
    }
    state.interruptTimeout = setTimeout(() => {
      state.interruptCount = 0;
      state.interruptTimeout = null;
    }, 1000);
  }

  function registerSignalHandlers(): void {
    const sigintHandler = () => {
      handleInterrupt("signal");
    };

    const sigtermHandler = () => {
      void cleanup();
    };

    process.on("SIGINT", sigintHandler);
    process.on("SIGTERM", sigtermHandler);

    state.cleanupHandlers.push(() => {
      process.off("SIGINT", sigintHandler);
      process.off("SIGTERM", sigtermHandler);
      if (state.interruptTimeout) {
        clearTimeout(state.interruptTimeout);
      }
      if (state.streamAbortController) {
        state.streamAbortController.abort();
      }
    });
  }

  const setStreamingState = (isStreaming: boolean) => {
    if (isStreaming) {
      state.isStreaming = true;
      if (state.currentRunId === null) {
        state.currentRunId = ++state.runCounter;
      }
      return;
    }

    state.isStreaming = false;
    state.currentRunId = null;
  };

  const handleInterruptFromUI = () => {
    handleInterrupt("ui");
  };

  const handleTerminateBackgroundAgentsFromUI: OnTerminateBackgroundAgents =
    async () => {
      const terminationWork = (async () => {
        if (state.session?.abortBackgroundAgents) {
          try {
            await state.session.abortBackgroundAgents();
            state.backgroundAgentsTerminated = true;
            state.telemetryTracker?.trackBackgroundTermination("execute", 1, 1);
          } catch (error) {
            console.error("Failed to abort background agents:", error);
            throw error;
          }
          return;
        }

        if (state.session?.abort) {
          // If there's already a pending abort from handleInterrupt, piggyback on
          // it instead of issuing a second session.abort() that could race with and
          // kill a newly-started stream.
          if (state.pendingAbortPromise) {
            try {
              await state.pendingAbortPromise;
            } catch (error) {
              logCleanupError("pendingAbortPromise in background termination", error);
            }
            state.backgroundAgentsTerminated = true;
            state.telemetryTracker?.trackBackgroundTermination("fallback", 1, 1);
            return;
          }

          try {
            await state.session.abort();
            state.backgroundAgentsTerminated = true;
            state.telemetryTracker?.trackBackgroundTermination("fallback", 1, 1);
          } catch (error) {
            console.error(
              "Failed to abort session during background-agent termination:",
              error,
            );
            throw error;
          }
          return;
        }

        state.telemetryTracker?.trackBackgroundTermination("noop", 0);
      })();

      state.pendingBackgroundTerminationPromise = terminationWork;
      try {
        await terminationWork;
      } finally {
        if (state.pendingBackgroundTerminationPromise === terminationWork) {
          state.pendingBackgroundTerminationPromise = null;
        }
      }
    };

  const getSession = () => state.session;

  const resetSession = async () => {
    state.currentRunId = null;
    state.isStreaming = false;
    state.pendingBackgroundTerminationPromise = null;
    if (state.session) {
      await abortAndDestroySession(state.session);
      state.session = null;
    }
    modelOps?.invalidateModelCache?.();
    state.ownedSessionIds.clear();
  };

  /** Register a custom tool on the underlying CodingAgentClient. */
  const registerTool = (tool: Parameters<typeof client.registerTool>[0]) => {
    client.registerTool(tool);
  };

  const createSubagentSession = async (config?: SessionConfig) => {
    // Inherit parent session config as defaults (model, reasoningEffort,
    // maxThinkingTokens, systemPrompt, permissionMode, agentMode).
    // Stage-level config overrides take precedence via the spread order.
    // `sessionId` is always excluded — each session must have its own.
    const { sessionId: _parentSessionId, ...inheritableConfig } = sessionConfig ?? {};
    const mergedConfig: SessionConfig = { ...inheritableConfig, ...config };

    const session = await client.createSession(mergedConfig);
    state.ownedSessionIds.add(session.id);
    return session;
  };

  /**
   * Stream a message through a specific session using the real SDK adapter
   * pipeline, capturing the full response text. Each stage session gets its
   * own adapter + runId so the ownership tracker auto-registers via
   * `stream.session.start` and all events flow through the standard
   * BatchDispatcher → StreamPipelineConsumer → UI path.
   */
  const streamWithSession = async (
    targetSession: Session,
    prompt: string,
    options?: { abortSignal?: AbortSignal },
  ): Promise<string> => {
    const adapter = createStreamAdapterForSession({
      bus: state.bus,
      sessionId: targetSession.id,
      client,
      agentType: resolvedAgentType,
    });

    const thisRunId = ++state.runCounter;
    const messageId = crypto.randomUUID();
    let capturedText = "";

    const unsubscribe = state.bus.on("stream.text.delta", (event) => {
      if (event.runId === thisRunId && typeof event.data?.delta === "string") {
        capturedText += event.data.delta;
      }
    });

    try {
      await adapter.startStreaming(targetSession, prompt, {
        runId: thisRunId,
        messageId,
        abortSignal: options?.abortSignal,
      });
    } finally {
      unsubscribe();
      adapter.dispose();
    }

    return capturedText;
  };

  const handleModelChange = (newModel: string) => {
    if (sessionConfig) {
      sessionConfig.model = newModel;
    }
  };

  const handleSessionMcpServersChange = (
    servers: SessionConfig["mcpServers"],
  ) => {
    if (sessionConfig) {
      sessionConfig.mcpServers = servers;
    }
  };

  const handleCommandTelemetry = (event: CommandExecutionTelemetry) => {
    state.telemetryTracker?.trackCommandExecution(event);
  };

  const handleMessageTelemetry = (event: MessageSubmitTelemetry) => {
    state.telemetryTracker?.trackMessageSubmit(event);
  };

  return {
    cleanup,
    ensureSession,
    handleSendMessage,
    handleStreamMessage,
    handleExit,
    handleInterrupt,
    registerSignalHandlers,
    setStreamingState,
    handleInterruptFromUI,
    handleTerminateBackgroundAgentsFromUI,
    getSession,
    resetSession,
    createSubagentSession,
    registerTool,
    streamWithSession,
    handleModelChange,
    handleSessionMcpServersChange,
    handleCommandTelemetry,
    handleMessageTelemetry,
  };
}
