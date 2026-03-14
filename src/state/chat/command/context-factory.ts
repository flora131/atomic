import { flushSync } from "@opentui/react";
import type { CommandContext, CommandContextState } from "@/commands/tui/index.ts";
import type { SpawnSubagentOptions, StreamMessageOptions } from "@/commands/tui/registry.ts";
import { sortTasksTopologically } from "@/components/task-order.ts";
import { normalizeTodoItems } from "@/state/parts/helpers/task-status.ts";
import {
  createStartedStreamControlState,
  shouldDeferComposerSubmit,
} from "@/state/chat/shared/helpers/stream-continuation.ts";
import {
  createMessage,
  getSpinnerVerbForCommand,
  reconcilePreviousStreamingPlaceholder,
} from "@/state/chat/helpers.ts";
import type { ChatMessage, WorkflowChatState } from "@/state/chat/types.ts";
import { SubagentStreamAdapter } from "@/services/events/adapters/subagent-adapter.ts";
import type { Session, SessionConfig } from "@/services/agents/types.ts";
import type { StreamRunHandle } from "@/state/runtime/stream-run-runtime.ts";
import type {
  SubagentSpawnOptions,
  SubagentStreamResult,
} from "@/services/workflows/graph/types.ts";
import type { UseCommandExecutorArgs } from "@/state/chat/command/executor-types.ts";

export function createCommandContextState(
  isStreaming: boolean,
  messages: readonly ChatMessage[],
  workflowState: WorkflowChatState,
): CommandContextState {
  return {
    isStreaming,
    messageCount: messages.length,
    workflowActive: workflowState.workflowActive,
    workflowType: workflowState.workflowType,
    initialPrompt: workflowState.initialPrompt,
    currentNode: workflowState.currentNode,
    iteration: workflowState.iteration,
    maxIterations: workflowState.maxIterations,
    featureProgress: workflowState.featureProgress,
    pendingApproval: workflowState.pendingApproval,
    specApproved: workflowState.specApproved,
    feedback: workflowState.feedback,
  };
}

function createSilentAssistantRunDispatcher(args: UseCommandExecutorArgs) {
  return (content: string, options?: StreamMessageOptions): StreamRunHandle | null => {
    if (args.onSendMessage) {
      void Promise.resolve(args.onSendMessage(content));
    }
    const previousStreamingId = args.streamingMessageIdRef.current;
    if (previousStreamingId) {
      args.setMessagesWindowed((previousMessages: ChatMessage[]) =>
        reconcilePreviousStreamingPlaceholder(previousMessages, previousStreamingId),
      );
    }
    return args.startAssistantStream(content, options);
  };
}

/** Default stale timeout: abort agent if no stream chunks arrive within 5 minutes */
const DEFAULT_STALE_TIMEOUT_MS = 5 * 60 * 1000;

/** Maximum retries per agent after stall detection */
const MAX_STALE_RETRIES = 3;

/** Error marker for stall-aborted agents (used by retry logic) */
const STALL_ERROR_MARKER = "[stalled]";

async function spawnParallelSubagents(
  args: UseCommandExecutorArgs,
  agents: SubagentSpawnOptions[],
  externalAbortSignal?: AbortSignal,
  onAgentComplete?: (result: SubagentStreamResult) => void,
): Promise<SubagentStreamResult[]> {
  if (!args.createSubagentSession) {
    throw new Error("createSubagentSession not available. Cannot spawn parallel sub-agents.");
  }

  const parallelAbortController = new AbortController();
  args.isStreamingRef.current = true;
  args.setIsStreaming(true);
  args.setStreamingState?.(true);

  if (externalAbortSignal) {
    if (externalAbortSignal.aborted) {
      parallelAbortController.abort();
    } else {
      externalAbortSignal.addEventListener(
        "abort",
        () => parallelAbortController.abort(),
        { once: true },
      );
    }
  }

  args.parallelInterruptHandlerRef.current = () => {
    parallelAbortController.abort();
  };

  const parentSessionId = args.getSession?.()?.id ?? "workflow";
  const subagentRunId = crypto.getRandomValues(new Uint32Array(1))[0]!;
  const outerCorrelationService = args.getCorrelationService();
  outerCorrelationService?.addOwnedSession(parentSessionId);

  const spawnOne = async (options: SubagentSpawnOptions): Promise<SubagentStreamResult> => {
    let session: Session | null = null;
    const correlationService = args.getCorrelationService();
    const startTime = Date.now();

    try {
      const sessionConfig: SessionConfig = {};
      if (options.model) sessionConfig.model = options.model;
      if (options.tools) sessionConfig.tools = options.tools;

      session = await args.createSubagentSession!(sessionConfig);

      const agentAbort = new AbortController();
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      if (options.timeout) {
        timeoutId = setTimeout(() => agentAbort.abort(), options.timeout);
      }

      // Stall detection: abort if no stream chunks arrive within stallTimeoutMs
      const stallTimeoutMs = options.staleTimeoutMs ?? DEFAULT_STALE_TIMEOUT_MS;
      let stalledAbort = false;
      let staleTimerId: ReturnType<typeof setTimeout> | undefined;
      const resetStaleTimer = stallTimeoutMs > 0
        ? () => {
          if (staleTimerId) clearTimeout(staleTimerId);
          staleTimerId = setTimeout(() => {
            stalledAbort = true;
            agentAbort.abort();
          }, stallTimeoutMs);
        }
        : undefined;

      const parentSignal = options.abortSignal ?? parallelAbortController.signal;
      if (parentSignal.aborted) {
        agentAbort.abort();
      } else {
        parentSignal.addEventListener("abort", () => agentAbort.abort(), { once: true });
      }

      if (session.abort) {
        const abortSession = () => {
          void session?.abort?.().catch(() => {});
        };
        if (agentAbort.signal.aborted) {
          abortSession();
        } else {
          agentAbort.signal.addEventListener("abort", abortSession, { once: true });
        }
      }

      const adapter = new SubagentStreamAdapter({
        bus: args.eventBus,
        sessionId: parentSessionId,
        agentId: options.agentId,
        parentAgentId: parentSessionId,
        runId: subagentRunId,
        agentType: options.agentName,
        task: options.task,
      });

      correlationService?.registerSubagent(options.agentId, {
        parentAgentId: parentSessionId,
        workflowRunId: String(subagentRunId),
      });

      try {
        const stream = session.stream(options.task, {
          agent: options.agentName,
          abortSignal: agentAbort.signal,
        });

        // Start stale timer before consuming stream
        resetStaleTimer?.();

        const result = await adapter.consumeStream(stream, agentAbort.signal, resetStaleTimer);

        // Clear stale timer on completion
        if (staleTimerId) clearTimeout(staleTimerId);

        if (agentAbort.signal.aborted) {
          if (session.abort) {
            await session.abort().catch(() => {});
          }
          const wasExternalAbort = options.abortSignal?.aborted || parallelAbortController.signal.aborted;
          const error = wasExternalAbort
            ? `Sub-agent "${options.agentName}" was cancelled`
            : stalledAbort
              ? `Sub-agent "${options.agentName}" stalled (no activity for ${stallTimeoutMs / 1000}s) ${STALL_ERROR_MARKER}`
              : `Sub-agent "${options.agentName}" timed out after ${options.timeout}ms`;
          return {
            ...result,
            success: false,
            error,
          };
        }

        return result;
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
        if (staleTimerId) clearTimeout(staleTimerId);
        correlationService?.unregisterSubagent(options.agentId);
      }
    } catch (error) {
      return {
        agentId: options.agentId,
        success: false,
        output: "",
        error: error instanceof Error ? error.message : String(error ?? "Unknown error"),
        toolUses: 0,
        durationMs: Date.now() - startTime,
      };
    } finally {
      if (session) {
        try {
          await session.destroy();
        } catch {
        }
      }
    }
  };

  try {
    // Retry wrapper: retries stalled agents up to MAX_STALE_RETRIES times.
    // If any agent exceeds the retry limit, the entire batch is aborted.
    const executeWithRetry = async (
      agent: SubagentSpawnOptions,
    ): Promise<SubagentStreamResult> => {
      let retryCount = 0;

      for (;;) {
        const result = await spawnOne(agent);

        // If stalled and retries remain, resubmit
        if (
          !result.success &&
          result.error?.includes(STALL_ERROR_MARKER) &&
          retryCount < MAX_STALE_RETRIES
        ) {
          retryCount++;
          continue;
        }

        // Circuit breaker: stall persisted after max retries — abort entire batch
        if (
          !result.success &&
          result.error?.includes(STALL_ERROR_MARKER) &&
          retryCount >= MAX_STALE_RETRIES
        ) {
          parallelAbortController.abort();
        }

        // Notify caller of completion (progressive result)
        onAgentComplete?.(result);
        return result;
      }
    };

    const results = await Promise.allSettled(
      agents.map((agent) => executeWithRetry(agent)),
    );
    return results.map((result, index) => {
      if (result.status === "fulfilled") {
        return result.value;
      }
      const agent = agents[index];
      return {
        agentId: agent?.agentId ?? `unknown-${index}`,
        success: false,
        output: "",
        error: result.reason instanceof Error
          ? result.reason.message
          : String(result.reason ?? "Unknown error"),
        toolUses: 0,
        durationMs: 0,
      };
    });
  } finally {
    args.parallelInterruptHandlerRef.current = null;
    if (!args.workflowActiveRef.current) {
      args.setStreamingWithFinalize(false);
      args.setStreamingState?.(false);
    }
  }
}

export function createCommandContext(args: UseCommandExecutorArgs): CommandContext {
  const dispatchSilentAssistantRun = createSilentAssistantRunDispatcher(args);

  return {
    session: args.getSession?.() ?? null,
    ensureSession: args.ensureSession,
    state: createCommandContextState(
      args.isStreaming,
      args.messages,
      args.workflowState,
    ),
    addMessage: args.addMessage,
    setStreaming: args.setStreamingWithFinalize,
    sendMessage: (content: string) => {
      const trimmedContent = content.trim();
      if (!trimmedContent) {
        return;
      }
      if (shouldDeferComposerSubmit({
        isStreaming: args.isStreamingRef.current,
        runningAskQuestionToolCount: args.runningAskQuestionToolIdsRef.current.size,
      })) {
        args.deferredCommandQueueRef.current.push({ content: trimmedContent });
        return;
      }
      args.sendMessageRef.current?.(trimmedContent);
    },
    sendSilentMessage: (content: string, options?: StreamMessageOptions) => {
      dispatchSilentAssistantRun(content, options);
    },
    startStreamRun: (content: string, options?: StreamMessageOptions) => {
      return dispatchSilentAssistantRun(content, options);
    },
    spawnSubagent: async (options: SpawnSubagentOptions) => {
      const agentName = options.name ?? options.model ?? "general-purpose";
      const task = options.message;

      let instruction: string;
      let silentOptions: StreamMessageOptions | undefined;
      if (args.agentType === "opencode") {
        instruction = task;
        silentOptions = { agent: agentName };
      } else if (args.agentType === "claude") {
        instruction = `Invoke the "${agentName}" sub-agent with the following task:\n${task}`;
        silentOptions = { agent: agentName };
      } else {
        instruction = `Invoke the "${agentName}" sub-agent with the following task:\n${task}`;
      }

      const handle = args.trackAwaitedRun(
        dispatchSilentAssistantRun(instruction, {
          ...silentOptions,
          runKind: "subagent",
        }),
      );
      if (!handle) {
        return {
          success: false,
          output: "",
          error: "Failed to start sub-agent stream.",
        };
      }

      const result = await handle.result;
      return {
        success: !result.wasInterrupted,
        output: result.content,
      };
    },
    spawnSubagentParallel: async (agents, externalAbortSignal, onAgentComplete) => {
      return spawnParallelSubagents(args, agents, externalAbortSignal, onAgentComplete);
    },
    streamAndWait: (prompt: string, options?: { hideContent?: boolean }) => {
      const handle = args.trackAwaitedRun(
        dispatchSilentAssistantRun(prompt, {
          visibility: options?.hideContent ? "hidden" : "visible",
          runKind: options?.hideContent ? "workflow-hidden" : "foreground",
        }),
      );
      if (!handle) {
        return Promise.resolve({
          content: "",
          wasInterrupted: true,
        });
      }
      return handle.result;
    },
    waitForUserInput: () => {
      return new Promise<string>((resolve, reject) => {
        args.waitForUserInputResolverRef.current = { resolve, reject };
      });
    },
    clearContext: async () => {
      if (args.onResetSession) {
        await args.onResetSession();
      }
      args.resetLoadedSkillTracking({ resetSessionBinding: true });
      args.setMessagesWindowed((previousMessages) => {
        args.appendHistoryBufferAndSync(previousMessages);
        return [];
      });
      args.setCompactionSummary(null);
      args.setShowCompactionHistory(false);
      args.setParallelAgents([]);
      const savedTodos = args.todoItemsRef.current;
      args.setTodoItems(savedTodos);
      args.setWorkflowSessionDir(args.workflowSessionDirRef.current);
      args.setWorkflowSessionId(args.workflowSessionIdRef.current);
    },
    setTodoItems: (items) => {
      const nextTodos = sortTasksTopologically(normalizeTodoItems(items));
      args.todoItemsRef.current = nextTodos;
      args.setTodoItems(nextTodos);
    },
    setWorkflowSessionDir: (dir: string | null) => {
      args.workflowSessionDirRef.current = dir;
      args.setWorkflowSessionDir(dir);
    },
    setWorkflowSessionId: (id: string | null) => {
      args.workflowSessionIdRef.current = id;
      args.setWorkflowSessionId(id);
    },
    setWorkflowTaskIds: (ids: Set<string>) => {
      args.workflowTaskIdsRef.current = ids;
    },
    updateWorkflowState: (update) => {
      args.updateWorkflowState(update);
    },
    agentType: args.agentType,
    modelOps: args.modelOps,
    getModelDisplayInfo: args.getModelDisplayInfo
      ? async () => {
        const currentModel = args.modelOps?.getPendingModel?.()
          ?? await args.modelOps?.getCurrentModel()
          ?? args.currentModelRef.current;
        return args.getModelDisplayInfo!(currentModel);
      }
      : undefined,
    getMcpServerToggles: () => args.mcpServerToggles,
    setMcpServerEnabled: (name: string, enabled: boolean) => {
      args.setMcpServerToggles((previous) => ({
        ...previous,
        [name]: enabled,
      }));
    },
    setSessionMcpServers: (servers) => {
      args.onSessionMcpServersChange?.(servers);
    },
    eventBus: args.eventBus,
  };
}

export function startCommandSpinner(
  args: UseCommandExecutorArgs,
  commandName: string,
): {
  cancelTimer: () => void;
  finalizeWithResult: (result: { message?: string; clearMessages?: boolean; mcpSnapshot?: unknown; skillLoaded?: string }) => void;
  clearSpinner: () => void;
  wasShown: () => boolean;
} {
  let commandSpinnerShown = false;
  let commandSpinnerMessageId: string | null = null;

  const commandSpinnerTimer = setTimeout(() => {
    if (!args.isStreamingRef.current) {
      commandSpinnerShown = true;
      const message = createMessage("assistant", "", true);
      message.spinnerVerb = getSpinnerVerbForCommand(commandName);
      commandSpinnerMessageId = message.id;
      const next = createStartedStreamControlState(
        {
          isStreaming: args.isStreamingRef.current,
          streamingMessageId: args.streamingMessageIdRef.current,
          streamingStart: args.streamingStartRef.current,
          hasStreamingMeta: args.streamingMetaRef.current !== null,
          hasRunningTool: args.hasRunningToolRef.current,
          isAgentOnlyStream: args.isAgentOnlyStreamRef.current,
          hasPendingCompletion: args.pendingCompleteRef.current !== null,
          hasPendingBackgroundWork: false,
        },
        { messageId: message.id, startedAt: Date.now() },
      );

      args.setStreamingMessageId(next.streamingMessageId);
      args.streamingStartRef.current = next.streamingStart;
      args.streamingMetaRef.current = null;
      args.pendingCompleteRef.current = null;
      args.isAgentOnlyStreamRef.current = next.isAgentOnlyStream;
      args.isStreamingRef.current = next.isStreaming;
      args.hasRunningToolRef.current = next.hasRunningTool;
      args.runningAskQuestionToolIdsRef.current.clear();

      flushSync(() => {
        args.setIsStreaming(next.isStreaming);
        args.setStreamingMeta(null);
        args.setMessagesWindowed((previousMessages) => [...previousMessages, message]);
      });
    }
  }, 250);

  const clearSpinner = () => {
    if (!commandSpinnerShown || !commandSpinnerMessageId) {
      return;
    }
    const messageId = commandSpinnerMessageId;
    args.setMessagesWindowed((previousMessages) =>
      previousMessages.filter((message) => message.id !== messageId),
    );
    if (args.streamingMessageIdRef.current === messageId) {
      args.stopSharedStreamState();
    }
  };

  return {
    cancelTimer: () => {
      clearTimeout(commandSpinnerTimer);
    },
    finalizeWithResult: (result) => {
      clearTimeout(commandSpinnerTimer);
      if (!commandSpinnerShown || !commandSpinnerMessageId) {
        return;
      }

      const messageId = commandSpinnerMessageId;
      const hasStructuredPayload = Boolean(result.mcpSnapshot || result.skillLoaded);
      if ((result.message || hasStructuredPayload) && !result.clearMessages) {
        args.setMessagesWindowed((previousMessages) =>
          previousMessages.map((message) =>
            message.id === messageId
              ? { ...message, content: result.message ?? message.content, streaming: false }
              : message,
          ),
        );
      } else {
        clearSpinner();
      }

      if (args.streamingMessageIdRef.current === messageId) {
        args.stopSharedStreamState();
      }
    },
    clearSpinner,
    wasShown: () => commandSpinnerShown,
  };
}
