import type { CliRenderer } from "@opentui/core";
import type { Root } from "@opentui/react";
import type { AgentType } from "@/services/models/index.ts";
import type { UnifiedModelOperations } from "@/services/models/model-operations.ts";
import type {
  CodingAgentClient,
  Session,
  SessionConfig,
} from "@/services/agents/types.ts";
import {
  createTuiTelemetrySessionTracker,
  type TuiTelemetrySessionTracker,
} from "@/services/telemetry/index.ts";
import { EventBus } from "@/services/events/event-bus.ts";
import { BatchDispatcher } from "@/services/events/batch-dispatcher.ts";
import { attachDebugSubscriber } from "@/services/events/debug-subscriber.ts";
import { OpenCodeStreamAdapter } from "@/services/events/adapters/opencode-adapter.ts";
import { ClaudeStreamAdapter } from "@/services/events/adapters/claude-adapter.ts";
import { CopilotStreamAdapter } from "@/services/events/adapters/copilot-adapter.ts";
import type { SDKStreamAdapter } from "@/services/events/adapters/types.ts";
import { cleanupMcpBridgeScripts } from "@/services/agents/tools/opencode-mcp-bridge.ts";
import { registerAgentToolNames } from "@/components/tool-registry/index.ts";
import type {
  CommandExecutionTelemetry,
  MessageSubmitTelemetry,
  OnTerminateBackgroundAgents,
} from "@/screens/chat-screen.tsx";

const FLUSH_FRAME_MS = 16;

export interface ChatUIState {
  renderer: CliRenderer | null;
  root: Root | null;
  session: Session | null;
  startTime: number;
  messageCount: number;
  cleanupHandlers: Array<() => void>;
  interruptCount: number;
  interruptTimeout: ReturnType<typeof setTimeout> | null;
  streamAbortController: AbortController | null;
  pendingAbortPromise: Promise<void> | null;
  isStreaming: boolean;
  ownedSessionIds: Set<string>;
  sessionCreationPromise: Promise<void> | null;
  runCounter: number;
  currentRunId: number | null;
  telemetryTracker: TuiTelemetrySessionTracker | null;
  bus: EventBus;
  dispatcher: BatchDispatcher;
  backgroundAgentsTerminated: boolean;
}

export type ChatUIDebugSubscription = Awaited<
  ReturnType<typeof attachDebugSubscriber>
>;

interface CreateChatUIRuntimeStateArgs {
  resolvedAgentType?: AgentType;
  workflowEnabled: boolean;
  initialPrompt?: string;
}

export async function createChatUIRuntimeState(
  args: CreateChatUIRuntimeStateArgs,
): Promise<{
  state: ChatUIState;
  debugSub: ChatUIDebugSubscription;
}> {
  const bus = new EventBus({
    validatePayloads: process.env.ATOMIC_VALIDATE_BUS_EVENTS === "1",
  });
  const dispatcher = new BatchDispatcher(bus, FLUSH_FRAME_MS);
  const debugSub = await attachDebugSubscriber(bus);

  if (debugSub.logDirPath) {
    console.info(`[Atomic] Stream debug logs: ${debugSub.logDirPath}`);
    if (debugSub.logPath) {
      console.info(`[Atomic] Stream events log: ${debugSub.logPath}`);
    }
    if (debugSub.rawLogPath) {
      console.info(`[Atomic] Stream raw log: ${debugSub.rawLogPath}`);
    }
  }

  const state: ChatUIState = {
    renderer: null,
    root: null,
    session: null,
    startTime: Date.now(),
    messageCount: 0,
    cleanupHandlers: [],
    interruptCount: 0,
    interruptTimeout: null,
    streamAbortController: null,
    pendingAbortPromise: null,
    isStreaming: false,
    ownedSessionIds: new Set(),
    sessionCreationPromise: null,
    runCounter: 0,
    currentRunId: null,
    telemetryTracker: args.resolvedAgentType
      ? createTuiTelemetrySessionTracker({
          agentType: args.resolvedAgentType,
          workflowEnabled: args.workflowEnabled,
          hasInitialPrompt: Boolean(args.initialPrompt),
        })
      : null,
    bus,
    dispatcher,
    backgroundAgentsTerminated: false,
  };

  return { state, debugSub };
}

interface CreateChatUIControllerArgs {
  client: CodingAgentClient;
  resolvedAgentType?: AgentType;
  sessionConfig?: SessionConfig;
  clientStartPromise?: Promise<void>;
  modelOps?: UnifiedModelOperations;
  state: ChatUIState;
  debugSub: ChatUIDebugSubscription;
  onExitResolved: (result: { messageCount: number; duration: number }) => void;
}

function createStreamAdapter(args: {
  client: CodingAgentClient;
  state: ChatUIState;
  resolvedAgentType?: AgentType;
}): SDKStreamAdapter {
  if (args.resolvedAgentType === "opencode") {
    return new OpenCodeStreamAdapter(
      args.state.bus,
      args.state.session!.id,
      args.client,
    );
  }
  if (args.resolvedAgentType === "claude") {
    return new ClaudeStreamAdapter(
      args.state.bus,
      args.state.session!.id,
      args.client,
    );
  }
  return new CopilotStreamAdapter(args.state.bus, args.client);
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

  async function cleanup(): Promise<void> {
    state.currentRunId = null;
    state.isStreaming = false;

    await debugSub.unsubscribe();
    state.dispatcher.dispose();
    state.bus.clear();
    cleanupMcpBridgeScripts();

    for (const handler of state.cleanupHandlers) {
      handler();
    }
    state.cleanupHandlers = [];

    if (state.session) {
      try {
        await state.session.destroy();
      } catch {
      }
      state.session = null;
    }

    if (state.root) {
      try {
        state.root.unmount();
      } catch {
      }
      state.root = null;
    }

    if (state.renderer) {
      try {
        if (process.stdout.isTTY) {
          try {
            process.stdout.write("\x1b[>4;0m");
          } catch {
          }
        }
        state.renderer.destroy();
      } catch {
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

          if (resolvedAgentType === "copilot") {
            const pendingEffort = modelOps.getPendingReasoningEffort();
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
      } catch {
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
        "[System: All background agents were terminated by the user (Ctrl+F). "
        + "Do not reference or wait for any previously running background agents.]\n\n"
        + content;
    }

    state.streamAbortController = new AbortController();
    state.currentRunId = ++state.runCounter;
    state.isStreaming = true;

    const adapter = createStreamAdapter({ client, state, resolvedAgentType });
    const runId = state.currentRunId;
    const messageId = crypto.randomUUID();
    debugSub.writeRawLine(`❯ ${content}`, {
      sessionId: state.session?.id,
      runId,
      component: "prompt",
    });

    const knownAgentNames = client.getKnownAgentNames?.() ?? [];
    if (knownAgentNames.length > 0) {
      registerAgentToolNames(knownAgentNames);
    }

    try {
      await adapter.startStreaming(state.session!, effectiveContent, {
        runId,
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
        state.currentRunId = null;
        return;
      }
      state.currentRunId = null;
    } finally {
      adapter.dispose();
      state.streamAbortController = null;
      state.isStreaming = false;
      state.currentRunId = null;
    }
  }

  async function handleExit(): Promise<void> {
    await cleanup();
  }

  function handleInterrupt(sourceType: "ui" | "signal"): void {
    if (state.isStreaming) {
      if (state.streamAbortController?.signal.aborted) return;

      state.isStreaming = false;
      state.currentRunId = null;

      if (!state.pendingAbortPromise) {
        const abortPromise = (async () => {
          if (
            state.streamAbortController
            && !state.streamAbortController.signal.aborted
          ) {
            state.streamAbortController.abort();
          }
          if (state.session?.abort) {
            await state.session.abort();
          }
        })();

        state.pendingAbortPromise = abortPromise;
        void abortPromise
          .finally(() => {
            if (state.pendingAbortPromise === abortPromise) {
              state.pendingAbortPromise = null;
            }
          })
          .catch(() => {});
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
    };

  const getSession = () => state.session;

  const resetSession = async () => {
    state.currentRunId = null;
    state.isStreaming = false;
    if (state.session) {
      try {
        await state.session.destroy();
      } catch {
      }
      state.session = null;
    }
    modelOps?.invalidateModelCache?.();
    state.ownedSessionIds.clear();
  };

  const createSubagentSession = async (config?: SessionConfig) => {
    const session = await client.createSession(config);
    state.ownedSessionIds.add(session.id);
    return session;
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
    handleModelChange,
    handleSessionMcpServersChange,
    handleCommandTelemetry,
    handleMessageTelemetry,
  };
}
