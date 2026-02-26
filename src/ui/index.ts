/**
 * CLI Integration for Chat UI
 *
 * Entry point for starting the terminal chat interface.
 * Connects ChatApp component to a coding agent client.
 *
 * Reference: Feature 20 - Implement CLI integration for chat UI
 */

import React from "react";
import { createCliRenderer, type CliRenderer } from "@opentui/core";
import { createRoot, type Root } from "@opentui/react";
import {
  ChatApp,
  type StreamingMeta,
  type OnToolStart,
  type OnToolComplete,
  type OnSkillInvoked,
  type OnPermissionRequest as ChatOnPermissionRequest,
  type OnInterrupt,
  type OnTerminateBackgroundAgents,
  type OnAskUserQuestion,
  type CommandExecutionTelemetry,
  type MessageSubmitTelemetry,
  traceThinkingSourceLifecycle,
} from "./chat.tsx";
import type { ParallelAgent } from "./components/parallel-agents-tree.tsx";
import { ThemeProvider, darkTheme, type Theme } from "./theme.tsx";
import { AppErrorBoundary } from "./components/error-exit-screen.tsx";
import { initializeCommandsAsync, globalRegistry } from "./commands/index.ts";
import type {
  CodingAgentClient,
  SessionConfig,
  Session,
  AgentMessage,
} from "../sdk/types.ts";
import { UnifiedModelOperations } from "../models/model-operations.ts";
import { parseTaskToolResult } from "./tools/registry.ts";
import { normalizeMarkdownNewlines } from "./utils/format.ts";
import {
  createTuiTelemetrySessionTracker,
  type TuiTelemetrySessionTracker,
} from "../telemetry/index.ts";
import { shouldFinalizeOnToolComplete } from "./parts/index.ts";
import { getActiveBackgroundAgents, isBackgroundAgent } from "./utils/background-agent-footer.ts";

/**
 * Build a system prompt section describing all registered capabilities.
 * Includes slash commands, skills, and sub-agents so the model is aware
 * of them and they count toward the system/tools token baseline.
 */
function buildCapabilitiesSystemPrompt(): string {
  const allCommands = globalRegistry.all();
  if (allCommands.length === 0) return "";

  const sections: string[] = [];

  const builtins = allCommands.filter((c) => c.category === "builtin");
  if (builtins.length > 0) {
    const lines = builtins.map((c) => {
      const hint = c.argumentHint ? ` ${c.argumentHint}` : "";
      return `  /${c.name}${hint} - ${c.description}`;
    });
    sections.push(`Slash Commands:\n${lines.join("\n")}`);
  }

  const skills = allCommands.filter((c) => c.category === "skill");
  if (skills.length > 0) {
    const lines = skills.map((c) => {
      const hint = c.argumentHint ? ` ${c.argumentHint}` : "";
      return `  /${c.name}${hint} - ${c.description}`;
    });
    sections.push(
      `Skills (invoke with /skill-name):\n${lines.join("\n")}\n\n` +
        `Note: Skills listed above are user-invocable via slash commands. ` +
        `To load a skill yourself, use the Skill tool instead of outputting a slash command.`,
    );
  }

  const agents = allCommands.filter((c) => c.category === "agent");
  if (agents.length > 0) {
    const lines = agents.map((c) => {
      const hint = c.argumentHint ? ` ${c.argumentHint}` : "";
      return `  /${c.name}${hint} - ${c.description}`;
    });
    sections.push(`Sub-Agents (invoke with /agent-name):\n${lines.join("\n")}`);
  }

  const workflows = allCommands.filter((c) => c.category === "workflow");
  if (workflows.length > 0) {
    const lines = workflows.map((c) => `  /${c.name} - ${c.description}`);
    sections.push(`Workflows:\n${lines.join("\n")}`);
  }

  return sections.join("\n\n");
}

// ============================================================================
// TYPES
// ============================================================================

/**
 * Configuration for starting the chat UI.
 */
export interface ChatUIConfig {
  /** Session configuration for the agent */
  sessionConfig?: SessionConfig;
  /** Initial theme (defaults to dark) */
  theme?: Theme;
  /** Title for the chat window */
  title?: string;
  /** Placeholder text for the input */
  placeholder?: string;
  /** Application version for header */
  version?: string;
  /** Model name for header */
  model?: string;
  /** Model tier/plan for header */
  tier?: string;
  /** Working directory for header */
  workingDir?: string;
  /** Suggestion text for header */
  suggestion?: string;
  /** Agent type for model operations */
  agentType?: import("../models").AgentType;
  /** Initial prompt to auto-submit on session start */
  initialPrompt?: string;
  /** Whether workflow mode was requested for this chat session */
  workflowEnabled?: boolean;
}

/**
 * Result returned when the chat UI exits.
 */
export interface ChatUIResult {
  /** Session that was active during the chat */
  session: Session | null;
  /** Number of messages exchanged */
  messageCount: number;
  /** Duration of the chat session in milliseconds */
  duration: number;
}

/**
 * Handler for permission/HITL requests
 */
export type OnPermissionRequest = (
  requestId: string,
  toolName: string,
  question: string,
  options: Array<{ label: string; value: string; description?: string }>,
  respond: (answer: string | string[]) => void,
  header?: string,
  toolCallId?: string
) => void;

/**
 * Internal state for managing the chat UI lifecycle.
 */
interface ChatUIState {
  renderer: CliRenderer | null;
  root: Root | null;
  session: Session | null;
  startTime: number;
  messageCount: number;
  cleanupHandlers: (() => void)[];
  /** Registered handler for tool start events */
  toolStartHandler: OnToolStart | null;
  /** Registered handler for tool complete events */
  toolCompleteHandler: OnToolComplete | null;
  /** Registered handler for skill invoked events */
  skillInvokedHandler: OnSkillInvoked | null;
  /** Registered handler for permission/HITL requests */
  permissionRequestHandler: OnPermissionRequest | null;
  /** Registered handler for askUserQuestion events from workflow graphs */
  askUserQuestionHandler: OnAskUserQuestion | null;
  /** Tool ID counter for generating unique IDs */
  toolIdCounter: number;
  /** Interrupt counter for double-press exit (shared between signal and UI) */
  interruptCount: number;
  /** Interrupt timeout ID */
  interruptTimeout: ReturnType<typeof setTimeout> | null;
  /** Ctrl+C press state for double-press exit (deprecated, kept for signal handler compat) */
  ctrlCPressed: boolean;
  /** Ctrl+C timeout ID (deprecated, kept for signal handler compat) */
  ctrlCTimeout: ReturnType<typeof setTimeout> | null;
  /** Callback to show Ctrl+C warning in UI */
  showCtrlCWarning: ((show: boolean) => void) | null;
  /** Set of active tool IDs (for deduplication of duplicate events) */
  activeToolIds: Set<string>;
  /** AbortController for the current stream (to interrupt on Escape/Ctrl+C) */
  streamAbortController: AbortController | null;
  /** Whether streaming is currently active */
  isStreaming: boolean;
  /** Registered handler for parallel agent updates (from ChatApp's setParallelAgents) */
  parallelAgentHandler: ((agents: ParallelAgent[]) => void) | null;
  /** Current list of parallel agents tracked from SDK events */
  parallelAgents: ParallelAgent[];
  /** Session IDs owned by this TUI instance (main + spawned subagent sessions) */
  ownedSessionIds: Set<string>;
  /** Promise lock to prevent concurrent session creation */
  sessionCreationPromise: Promise<void> | null;
  /** Monotonic run counter used to assign ownership to each active stream */
  runCounter: number;
  /** Active stream run owner ID. Null means no run currently owns hook events. */
  currentRunId: number | null;
  /**
   * Suppress streaming text that is a raw JSON echo of the Task tool result.
   * Holds a short FIFO of recent Task result texts so suppression stays
   * correct when multiple Task tools complete in parallel.
   */
  suppressPostTaskResults: Array<{ text: string; addedAt: number }>;
  /** Native TUI telemetry tracker (null when telemetry is disabled or agent type is unknown) */
  telemetryTracker: TuiTelemetrySessionTracker | null;
}

function clearParallelAgents(state: ChatUIState) {
  state.parallelAgents = [];
  state.parallelAgentHandler?.(state.parallelAgents);
}

function hasActiveParallelAgentWork(parallelAgents: readonly ParallelAgent[]): boolean {
  return parallelAgents.some(
    (agent) => agent.status === "running" || agent.status === "pending" || agent.status === "background"
  );
}

function hasOpenStreamLifecycleWork(state: ChatUIState): boolean {
  return hasActiveParallelAgentWork(state.parallelAgents) || state.activeToolIds.size > 0;
}

/**
 * Wraps an AsyncIterable so that each `iterator.next()` call races against an
 * AbortSignal. This ensures that abort takes effect immediately even while the
 * iterator is blocked waiting on the network (e.g. Claude extended thinking,
 * OpenCode 30s timeout, Copilot infinite wait).
 */
async function* abortableAsyncIterable<T>(
  iterable: AsyncIterable<T>,
  signal: AbortSignal
): AsyncGenerator<T> {
  const iterator = iterable[Symbol.asyncIterator]();
  const abortPromise = new Promise<never>((_, reject) => {
    if (signal.aborted) {
      reject(new DOMException("The operation was aborted", "AbortError"));
      return;
    }
    signal.addEventListener(
      "abort",
      () => {
        reject(new DOMException("The operation was aborted", "AbortError"));
      },
      { once: true }
    );
  });
  try {
    while (true) {
      const result = await Promise.race([iterator.next(), abortPromise]);
      if (result.done) break;
      yield result.value;
    }
  } finally {
    // Fire-and-forget: don't block abort propagation on iterator cleanup
    // (SDK stream teardown may involve network I/O)
    void iterator.return?.();
  }
}

// ============================================================================
// CHAT UI IMPLEMENTATION
// ============================================================================

/**
 * Start the terminal chat UI with a coding agent client.
 *
 * Creates a full-screen terminal interface for chatting with an AI agent.
 * Handles message sending, streaming responses, and graceful cleanup.
 *
 * @param client - The coding agent client to use
 * @param config - Optional configuration for the chat UI
 * @returns Promise that resolves when the chat UI exits
 *
 * @example
 * ```typescript
 * import { startChatUI } from "./ui";
 * import { ClaudeAgentClient } from "./sdk/clients/claude";
 *
 * const client = new ClaudeAgentClient();
 * await client.start();
 *
 * const result = await startChatUI(client, {
 *   title: "Claude Chat",
 *   sessionConfig: { model: "claude-3-opus" },
 * });
 *
 * console.log(`Chat ended after ${result.messageCount} messages`);
 * ```
 */
export async function startChatUI(
  client: CodingAgentClient,
  config: ChatUIConfig = {}
): Promise<ChatUIResult> {
  const {
    sessionConfig,
    theme = darkTheme,
    title = "Atomic Chat",
    placeholder = "Type a message...",
    version,
    model,
    tier,
    workingDir,
    suggestion,
    agentType,
    initialPrompt,
    workflowEnabled = false,
  } = config;

  // Create model operations for the agent
  const sdkListModels = agentType === 'claude' && 'listSupportedModels' in client
    ? () => (client as import('../sdk/clients/index.ts').ClaudeAgentClient).listSupportedModels()
    : undefined;
  const sdkSetModel = agentType === "opencode" && "setActivePromptModel" in client
    ? async (selectedModel: string) => {
        await (client as import("../sdk/clients/index.ts").OpenCodeClient).setActivePromptModel(selectedModel);
      }
    : agentType && "setActiveSessionModel" in client
      ? async (selectedModel: string, options?: { reasoningEffort?: string }) => {
          await client.setActiveSessionModel?.(selectedModel, options);
        }
      : undefined;
  const modelOps = agentType ? new UnifiedModelOperations(agentType, sdkSetModel, sdkListModels, sessionConfig?.model) : undefined;

  // Initialize state
  const state: ChatUIState = {
    renderer: null,
    root: null,
    session: null,
    startTime: Date.now(),
    messageCount: 0,
    cleanupHandlers: [],
    toolStartHandler: null,
    toolCompleteHandler: null,
    skillInvokedHandler: null,
    permissionRequestHandler: null,
    askUserQuestionHandler: null,
    toolIdCounter: 0,
    interruptCount: 0,
    interruptTimeout: null,
    ctrlCPressed: false,
    ctrlCTimeout: null,
    showCtrlCWarning: null,
    activeToolIds: new Set(),
    streamAbortController: null,
    isStreaming: false,
    parallelAgentHandler: null,
    parallelAgents: [],
    ownedSessionIds: new Set(),
    sessionCreationPromise: null,
    runCounter: 0,
    currentRunId: null,
    suppressPostTaskResults: [],
    telemetryTracker: agentType
      ? createTuiTelemetrySessionTracker({
        agentType,
        workflowEnabled,
        hasInitialPrompt: !!initialPrompt,
      })
      : null,
  };

  // Create a promise that resolves when the UI exits
  let resolveExit: (result: ChatUIResult) => void;
  const exitPromise = new Promise<ChatUIResult>((resolve) => {
    resolveExit = resolve;
  });

  /**
   * Clean up resources and exit.
   */
  async function cleanup(): Promise<void> {
    state.currentRunId = null;
    state.isStreaming = false;

    // Remove signal handlers
    for (const handler of state.cleanupHandlers) {
      handler();
    }
    state.cleanupHandlers = [];

    // Destroy session if active
    if (state.session) {
      try {
        await state.session.destroy();
      } catch {
        // Ignore errors during cleanup
      }
      state.session = null;
    }

    // Unmount React tree before destroying renderer
    // IMPORTANT: Must unmount before destroy to avoid Yoga crash
    if (state.root) {
      try {
        state.root.unmount();
      } catch {
        // Ignore errors during cleanup
      }
      state.root = null;
    }

    // Destroy the CLI renderer
    if (state.renderer) {
      try {
        if (process.stdout.isTTY) {
          try {
            process.stdout.write("\x1b[>4;0m");
          } catch {
            // Ignore errors during cleanup
          }
        }
        state.renderer.destroy();
      } catch {
        // Ignore errors during cleanup
      }
      state.renderer = null;
    }

    // Resolve the exit promise
    const duration = Date.now() - state.startTime;
    state.telemetryTracker?.end({
      durationMs: duration,
      messageCount: state.messageCount,
    });

    const result: ChatUIResult = {
      session: null, // Session already destroyed
      messageCount: state.messageCount,
      duration,
    };

    resolveExit(result);
  }

  /**
   * Handle sending a message to the agent.
   * Note: The actual message sending is handled by handleStreamMessage.
   * This callback is for session initialization and message tracking.
   */
  async function handleSendMessage(_content: string): Promise<void> {
    // Create session if needed (content is used by handleStreamMessage)
    try {
      await ensureSession();
    } catch (error) {
      console.error("Failed to create session:", error);
      return;
    }

    state.messageCount++;
  }


  /**
   * Ensure a session exists, creating one if needed.
   * Uses a promise lock to prevent concurrent session creation
   * when both handleSendMessage and handleStreamMessage fire together.
   */
  async function ensureSession(): Promise<void> {
    if (state.session) return;
    if (state.sessionCreationPromise) {
      await state.sessionCreationPromise;
      return;
    }
    state.sessionCreationPromise = (async () => {
      try {
        // Clear stale tool tracking from any previous session
        state.currentRunId = null;
        state.activeToolIds.clear();

        // Apply the actively selected model for ALL agent types
        if (modelOps && sessionConfig) {
          const pendingModel = modelOps.getPendingModel();
          const currentModel = await modelOps.getCurrentModel();
          if (pendingModel) {
            sessionConfig.model = pendingModel;
          } else if (currentModel) {
            sessionConfig.model = currentModel;
          }
          // Apply pending reasoning effort (Copilot-specific)
          if (agentType === 'copilot') {
            const pendingEffort = modelOps.getPendingReasoningEffort();
            if (pendingEffort !== undefined) {
              sessionConfig.reasoningEffort = pendingEffort;
            }
          }
        }
        state.session = await client.createSession(sessionConfig);
        state.ownedSessionIds.add(state.session.id);
      } finally {
        state.sessionCreationPromise = null;
      }
    })();
    await state.sessionCreationPromise;
  }

  /**
   * Handle streaming a message response from the agent.
   * Handles text, tool_use, and tool_result messages from the stream.
   * Supports interruption via AbortController (Escape/Ctrl+C during streaming).
   */
  async function handleStreamMessage(
    content: string,
    onChunk: (chunk: string) => void,
    onComplete: () => void,
    onMeta?: (meta: StreamingMeta) => void,
    options?: { agent?: string }
  ): Promise<void> {
    // Single-owner stream model: any new stream handoff resets previous
    // run-owned hook state before creating the next owner.
    state.currentRunId = null;
    state.resetParallelTracking?.("stream_start");

    // Create session if needed (uses shared lock to prevent dual creation)
    try {
      await ensureSession();
    } catch (error) {
      console.error("Failed to create session:", error);
      onComplete();
      return;
    }

    // Create AbortController for this stream so it can be interrupted
    state.streamAbortController = new AbortController();
    state.currentRunId = ++state.runCounter;
    state.isStreaming = true;
    const thinkingTextBySourceMap = new Map<string, string>();
    const thinkingGenerationBySourceMap = new Map<string, number>();
    const thinkingMessageBySourceMap = new Map<string, string>();
    const activeThinkingSources = new Set<string>();
    const closedThinkingSources = new Set<string>();

    const closeThinkingSourcesAndClearMaps = (): void => {
      const finalizedSources = new Set<string>();
      for (const sourceKey of thinkingTextBySourceMap.keys()) {
        finalizedSources.add(sourceKey);
      }
      for (const sourceKey of thinkingGenerationBySourceMap.keys()) {
        finalizedSources.add(sourceKey);
      }
      for (const sourceKey of thinkingMessageBySourceMap.keys()) {
        finalizedSources.add(sourceKey);
      }
      for (const sourceKey of activeThinkingSources) {
        finalizedSources.add(sourceKey);
      }
      for (const sourceKey of finalizedSources) {
        if (!closedThinkingSources.has(sourceKey)) {
          traceThinkingSourceLifecycle("finalize", sourceKey, "stream finalize");
        }
        closedThinkingSources.add(sourceKey);
      }

      thinkingTextBySourceMap.clear();
      thinkingGenerationBySourceMap.clear();
      thinkingMessageBySourceMap.clear();
      activeThinkingSources.clear();
    };

    try {
      // Stream the response, wrapped so abort takes effect immediately
      // even while iterator.next() is blocked on the network
      const stream = state.session!.stream(content, options);
      const abortableStream = abortableAsyncIterable(
        stream,
        state.streamAbortController.signal
      );

      let sdkOutputTokens = 0;
      let thinkingMs = 0;
      let thinkingStartLocal: number | null = null;
      // Map SDK tool use IDs to internal tool IDs for stream-path deduplication
      const streamToolIdMap = new Map<string, string>();
      const allowStreamToolEvents = !state.toolEventsViaHooks || agentType === "opencode";

      // Reset the suppress state at the start of each stream
      state.suppressPostTaskResults = [];

      // Prefix-based accumulator for post-task text suppression.
      // Tracks accumulated text so we can check if the model is echoing the
      // sub-agent result (text arrives sequentially matching from the start)
      // vs. generating genuine follow-up content.
      let suppressAccumulator = "";
      let suppressTarget: string | null = null;
      // Tracks the leading whitespace accumulated before any text started
      // matching the echo prefix. This whitespace is recovered (emitted via
      // onChunk) when suppression clears, since it likely represents genuine
      // formatting (paragraph breaks / newlines) from the model's output.
      let suppressWhitespacePrefix = "";
      let suppressHasTextMatch = false;

      const resetSuppressMatcher = (): void => {
        suppressAccumulator = "";
        suppressTarget = null;
        suppressWhitespacePrefix = "";
        suppressHasTextMatch = false;
      };

      const removeSuppressTarget = (target: string): void => {
        const idx = state.suppressPostTaskResults.findIndex(e => e.text === target);
        if (idx !== -1) {
          state.suppressPostTaskResults.splice(idx, 1);
        }
      };

      const pickSuppressTarget = (candidate: string): string | null => {
        const entry = state.suppressPostTaskResults.find((e) => e.text.startsWith(candidate));
        return entry?.text ?? null;
      };

      const toStringRecord = (sourceMap: Map<string, string>): Record<string, string> => {
        const record: Record<string, string> = {};
        for (const [source, value] of sourceMap) {
          record[source] = value;
        }
        return record;
      };

      const toNumberRecord = (sourceMap: Map<string, number>): Record<string, number> => {
        const record: Record<string, number> = {};
        for (const [source, value] of sourceMap) {
          record[source] = value;
        }
        return record;
      };

      const resolveThinkingSourceKey = (message: AgentMessage): string => {
        const metadata = message.metadata as Record<string, unknown> | undefined;
        const sourceFromMetadata = typeof metadata?.thinkingSourceKey === "string"
          ? metadata.thinkingSourceKey.trim()
          : "";
        if (sourceFromMetadata.length > 0) {
          return sourceFromMetadata;
        }
        const contractError = new Error(
          "Contract violation: thinking stream message is missing required metadata.thinkingSourceKey"
        );
        contractError.name = "ThinkingSourceContractViolationError";
        throw contractError;
      };

      const bindThinkingSource = (sourceKey: string, message: AgentMessage): void => {
        const metadata = message.metadata as Record<string, unknown> | undefined;
        const generationFromMetadata = metadata?.streamGeneration;
        const resolvedGeneration = typeof generationFromMetadata === "number"
          && Number.isFinite(generationFromMetadata)
          ? generationFromMetadata
          : (state.currentRunId ?? state.runCounter);
        thinkingGenerationBySourceMap.set(sourceKey, resolvedGeneration);

        const targetMessageId = typeof metadata?.targetMessageId === "string"
          ? metadata.targetMessageId
          : (typeof metadata?.messageId === "string" ? metadata.messageId : undefined);
        if (targetMessageId && targetMessageId.length > 0) {
          thinkingMessageBySourceMap.set(sourceKey, targetMessageId);
        }
      };

      const getThinkingTextSnapshot = (): string => {
        let combined = "";
        for (const text of thinkingTextBySourceMap.values()) {
          combined += text;
        }
        return combined;
      };

      const createStreamingMetaSnapshot = (thinkingSourceKey?: string): StreamingMeta => ({
        outputTokens: sdkOutputTokens,
        thinkingMs,
        thinkingText: getThinkingTextSnapshot(),
        thinkingSourceKey,
        thinkingTextBySource: toStringRecord(thinkingTextBySourceMap),
        thinkingGenerationBySource: toNumberRecord(thinkingGenerationBySourceMap),
        thinkingMessageBySource: toStringRecord(thinkingMessageBySourceMap),
      });

      for await (const message of abortableStream) {
        // Handle text content
        if (message.type === "text" && typeof message.content === "string") {
          // Accumulate thinking duration when transitioning away from thinking
          if (thinkingStartLocal !== null) {
            thinkingMs = thinkingMs + (Date.now() - thinkingStartLocal);
            thinkingStartLocal = null;
          }

          // After Task tools complete, some SDKs echo raw tool results back as
          // streaming text. Suppress content that is likely this echo while
          // allowing genuine follow-up response text to flow through.
          let chunkToEmit = message.content;
          if (state.suppressPostTaskResults.length > 0 || suppressTarget !== null) {
            let shouldReprocess = true;
            let suppressionIterations = 0;
            // Defensive bound: suppression is best-effort and must never
            // block the UI thread if state unexpectedly stops making progress.
            while (shouldReprocess && suppressionIterations < 16) {
              suppressionIterations += 1;
              shouldReprocess = false;

              if (suppressTarget !== null && !state.suppressPostTaskResults.some(e => e.text === suppressTarget)) {
                resetSuppressMatcher();
              }

              const hasSuppressionTargets = state.suppressPostTaskResults.length > 0 || suppressTarget !== null;
              if (!hasSuppressionTargets) {
                break;
              }

              const trimmed = chunkToEmit.trim();
              if (trimmed.length === 0) {
                suppressAccumulator += chunkToEmit;
                if (!suppressHasTextMatch) {
                  suppressWhitespacePrefix += chunkToEmit;
                }
                chunkToEmit = "";
                break;
              }

              const isJsonEcho = trimmed.startsWith("{") || trimmed.startsWith("[");
              if (isJsonEcho) {
                chunkToEmit = "";
                break;
              }

              const candidate = (suppressAccumulator + chunkToEmit).trimStart();
              const matchedTarget: string | null = suppressTarget !== null && suppressTarget.startsWith(candidate)
                ? suppressTarget
                : pickSuppressTarget(candidate);
              if (matchedTarget !== null) {
                suppressTarget = matchedTarget;
                suppressAccumulator += chunkToEmit;
                suppressHasTextMatch = true;
                chunkToEmit = "";
                break;
              }

              const recoveredWhitespace = suppressWhitespacePrefix;
              const matchedEchoTarget = suppressHasTextMatch ? suppressTarget : null;
              resetSuppressMatcher();
              if (matchedEchoTarget !== null) {
                removeSuppressTarget(matchedEchoTarget);
              }
              if (recoveredWhitespace.length > 0) {
                onChunk(recoveredWhitespace);
              }
              // Only retry when we consumed a previously matched echo target.
              // If there was no match, reprocessing the same chunk would spin.
              if (matchedEchoTarget !== null && state.suppressPostTaskResults.length > 0) {
                shouldReprocess = true;
              }
            }
            if (suppressionIterations >= 16) {
              resetSuppressMatcher();
            }
          }

          if (chunkToEmit.length > 0) {
            onChunk(chunkToEmit);
          }

          // Use SDK-reported token counts when present
          const stats = message.metadata?.streamingStats as
            | { outputTokens?: number; thinkingMs?: number }
            | undefined;
          if (stats?.thinkingMs != null) {
            thinkingMs = stats.thinkingMs;
          }
          if (stats?.outputTokens && stats.outputTokens > 0) {
            sdkOutputTokens = stats.outputTokens;
          }

          onMeta?.(createStreamingMetaSnapshot());
        }
        // Handle thinking metadata from SDK
        else if (message.type === "thinking") {
          const thinkingSourceKey = resolveThinkingSourceKey(message);
          if (closedThinkingSources.has(thinkingSourceKey)) {
            traceThinkingSourceLifecycle("drop", thinkingSourceKey, "index closed-source rejection");
            continue;
          }
          const isNewSource = !activeThinkingSources.has(thinkingSourceKey);
          if (isNewSource) {
            activeThinkingSources.add(thinkingSourceKey);
            traceThinkingSourceLifecycle("create", thinkingSourceKey, "index first-seen thinking event");
          } else {
            traceThinkingSourceLifecycle("update", thinkingSourceKey, "index thinking event update");
          }
          bindThinkingSource(thinkingSourceKey, message);

          // Start local wall-clock timer on first thinking message
          if (thinkingStartLocal === null) {
            thinkingStartLocal = Date.now();
          }

          // Capture thinking text content
          if (typeof message.content === "string") {
            const previous = thinkingTextBySourceMap.get(thinkingSourceKey) ?? "";
            thinkingTextBySourceMap.set(thinkingSourceKey, previous + message.content);
          }

          const stats = message.metadata?.streamingStats as
            | { thinkingMs?: number; outputTokens?: number }
            | undefined;

          if (stats?.thinkingMs != null) {
            // Authoritative value from SDK — use it and reset local timer
            thinkingMs = stats.thinkingMs;
            thinkingStartLocal = null;
          } else {
            // Live estimation: accumulated + current block duration
            thinkingMs = thinkingMs + (Date.now() - thinkingStartLocal);
            // Don't reset thinkingStartLocal — keep accumulating
          }

          if (stats?.outputTokens && stats.outputTokens > 0) {
            sdkOutputTokens = stats.outputTokens;
          }
          onMeta?.(createStreamingMetaSnapshot(thinkingSourceKey));
        }
        // Handle tool_use content - notify UI of tool invocation
        // OpenCode can complete the stream before hook events flush; keep a
        // stream-path fallback for it while preserving hook-first behavior elsewhere.
        else if (message.type === "tool_use" && message.content && allowStreamToolEvents) {
          const toolContent = message.content as { name?: string; input?: Record<string, unknown>; toolUseId?: string };
          if (state.toolStartHandler && toolContent.name) {
            state.telemetryTracker?.trackToolStart(toolContent.name);
            // Deduplicate using SDK tool use ID (e.g., Claude's includePartialMessages
            // emits multiple assistant messages for the same tool_use block)
            const sdkId = toolContent.toolUseId
              ?? (message.metadata as Record<string, unknown> | undefined)?.toolId as string | undefined;
            let toolId: string;
            if (sdkId && streamToolIdMap.has(sdkId)) {
              toolId = streamToolIdMap.get(sdkId)!;
            } else {
              toolId = agentType === "opencode" && sdkId
                ? `tool_${sdkId}`
                : `tool_${++state.toolIdCounter}`;
              if (sdkId) streamToolIdMap.set(sdkId, toolId);
            }
            state.toolStartHandler(
              toolId,
              toolContent.name,
              toolContent.input ?? {}
            );
          }
        }
        // Handle tool_result content - notify UI of tool completion
        else if (message.type === "tool_result" && allowStreamToolEvents) {
          if (state.toolCompleteHandler) {
            const metadata = message.metadata as Record<string, unknown> | undefined;
            const toolNameFromMeta = typeof message.metadata?.toolName === "string"
              ? message.metadata.toolName
              : "unknown";
            const sdkId = typeof metadata?.toolId === "string" ? metadata.toolId : undefined;
            state.telemetryTracker?.trackToolComplete(toolNameFromMeta, true);
            const toolId = sdkId
              ? (streamToolIdMap.get(sdkId) ?? (agentType === "opencode" ? `tool_${sdkId}` : `tool_${state.toolIdCounter}`))
              : `tool_${state.toolIdCounter}`;
            if (sdkId && !streamToolIdMap.has(sdkId)) {
              streamToolIdMap.set(sdkId, toolId);
            }
            state.toolCompleteHandler(
              toolId,
              message.content,
              true
            );
          }
        }
      }

      closeThinkingSourcesAndClearMaps();
      state.messageCount++;
      onComplete();
    } catch (error) {
      closeThinkingSourcesAndClearMaps();
      // AbortError is expected when user interrupts — finalize cleanly
      if (error instanceof Error && error.name === "AbortError") {
        state.currentRunId = null;
        state.resetParallelTracking?.("stream_abort");
        onComplete();
        return;
      } else if (error instanceof Error && error.name === "ThinkingSourceContractViolationError") {
        state.currentRunId = null;
        state.resetParallelTracking?.("stream_error");
        onComplete();
        throw error;
      }
      state.currentRunId = null;
      state.resetParallelTracking?.("stream_error");
      onComplete();
    } finally {
      // Clear streaming state
      state.streamAbortController = null;
      // Keep isStreaming true if sub-agents are still actively running so
      // subagent.complete events continue to be processed.
      // Only match agents that are actually active (running/pending/background),
      // not completed background agents that happen to have background=true.
      if (!hasOpenStreamLifecycleWork(state)) {
        state.isStreaming = false;
        state.currentRunId = null;
      }
    }
  }

  /**
   * Handle exit request from the chat UI.
   */
  async function handleExit(): Promise<void> {
    await cleanup();
  }

  /**
   * Handle interrupt request (from signal or UI).
   * If streaming, abort the stream. If idle, use double-press to exit.
   */
  function handleInterrupt(sourceType: "ui" | "signal"): void {
    // If streaming, abort the current operation
    if (state.isStreaming) {
      // Skip duplicate signal interrupts for an already-aborted foreground stream.
      if (state.streamAbortController?.signal.aborted) return;
      // Clear streaming state immediately so tool events from SDK
      // don't flow through and overwrite React state after interrupt
      state.isStreaming = false;
      state.currentRunId = null;

      // Preserve background agents across the reset — resetParallelTracking
      // calls clearParallelAgents() which wipes ALL agents from state.
      const backgroundAgents = state.parallelAgents.filter(isBackgroundAgent);
      state.resetParallelTracking?.("interrupt");
      // Restore background agents that were cleared by resetParallelTracking
      if (backgroundAgents.length > 0) {
        state.parallelAgents = backgroundAgents;
        state.parallelAgentHandler?.(state.parallelAgents);
      }

      state.streamAbortController?.abort();
      // Call session.abort() to fully cancel the in-flight SDK request,
      // but only when no background agents are running (session.abort()
      // kills ALL agents in the session including background ones).
      if (backgroundAgents.length === 0 && state.session?.abort) {
        void state.session.abort().catch(() => {});
      }
      state.telemetryTracker?.trackInterrupt(sourceType);
      // Reset interrupt state
      state.interruptCount = 0;
      if (state.interruptTimeout) {
        clearTimeout(state.interruptTimeout);
        state.interruptTimeout = null;
      }
      if (state.showCtrlCWarning) {
        state.showCtrlCWarning(false);
      }
      return;
    }

    // Not streaming: use double-press logic to exit
    state.interruptCount++;
    if (state.interruptCount >= 2) {
      // Double press - exit
      state.interruptCount = 0;
      if (state.interruptTimeout) {
        clearTimeout(state.interruptTimeout);
        state.interruptTimeout = null;
      }
      if (state.showCtrlCWarning) {
        state.showCtrlCWarning(false);
      }
      void cleanup();
      return;
    }

    // First press - show warning and set timeout
    if (state.showCtrlCWarning) {
      state.showCtrlCWarning(true);
    }
    if (state.interruptTimeout) {
      clearTimeout(state.interruptTimeout);
    }
    state.interruptTimeout = setTimeout(() => {
      state.interruptCount = 0;
      state.interruptTimeout = null;
      if (state.showCtrlCWarning) {
        state.showCtrlCWarning(false);
      }
    }, 1000);
  }

  // Set up signal handlers for cleanup
  // Ctrl+C (SIGINT) uses the unified interrupt handler
  const sigintHandler = () => {
    handleInterrupt("signal");
  };

  const sigtermHandler = () => {
    void cleanup();
  };

  process.on("SIGINT", sigintHandler);
  process.on("SIGTERM", sigtermHandler);

  // Store cleanup handlers for later removal
  state.cleanupHandlers.push(() => {
    process.off("SIGINT", sigintHandler);
    process.off("SIGTERM", sigtermHandler);
    if (state.ctrlCTimeout) {
      clearTimeout(state.ctrlCTimeout);
    }
    if (state.interruptTimeout) {
      clearTimeout(state.interruptTimeout);
    }
    // Abort any ongoing stream
    if (state.streamAbortController) {
      state.streamAbortController.abort();
    }
  });

  try {
    // Initialize commands registry before rendering
    // This ensures all slash commands are available when ChatApp mounts
    // Uses async version to support loading workflows from disk
    await initializeCommandsAsync();

    // Enhance session config with capabilities system prompt so the model
    // knows about all available slash commands, skills, and sub-agents.
    // This also ensures they count toward the system/tools token baseline.
    const capabilitiesPrompt = buildCapabilitiesSystemPrompt();
    if (capabilitiesPrompt) {
      const existing = sessionConfig?.systemPrompt ?? "";
      if (sessionConfig) {
        sessionConfig.systemPrompt = existing
          ? `${existing}\n\n${capabilitiesPrompt}`
          : capabilitiesPrompt;
      }
    }

    // Create the CLI renderer with:
    // - mouse mode enabled for scroll wheel support (text selection via OpenTUI Selection API + Ctrl+Shift+C)
    // - useAlternateScreen: true to prevent scrollbox from corrupting terminal output
    // - exitOnCtrlC: false to allow double-press Ctrl+C behavior
    // - useKittyKeyboard: with disambiguate so Ctrl+C is received as keyboard event
    state.renderer = await createCliRenderer({
      useMouse: true,
      enableMouseMovement: false,
      openConsoleOnError: false,
      useAlternateScreen: true,
      exitOnCtrlC: false,
      useKittyKeyboard: { disambiguate: true },
    });

    if (process.stdout.isTTY) {
      process.stdout.write("\x1b[>4;2m");
    }

    // Create React root
    state.root = createRoot(state.renderer);

    // Render the chat application
    // Handler registration callbacks - ChatApp will call these with its internal handlers
    const registerToolStartHandler = (handler: OnToolStart) => {
      state.toolStartHandler = handler;
    };

    const registerToolCompleteHandler = (handler: OnToolComplete) => {
      state.toolCompleteHandler = handler;
    };

    const registerSkillInvokedHandler = (handler: OnSkillInvoked) => {
      state.skillInvokedHandler = handler;
    };

    const registerPermissionRequestHandler = (handler: ChatOnPermissionRequest) => {
      state.permissionRequestHandler = handler;
    };

    const registerAskUserQuestionHandler = (handler: OnAskUserQuestion) => {
      state.askUserQuestionHandler = handler;
    };

    const registerParallelAgentHandler = (handler: (agents: ParallelAgent[]) => void) => {
      state.parallelAgentHandler = handler;
    };

    const registerCtrlCWarningHandler = (handler: (show: boolean) => void) => {
      state.showCtrlCWarning = handler;
    };

    /**
     * Set the streaming state from the UI layer.
     * Used by spawnSubagentParallel to flag that sub-agent sessions are
     * streaming even though the main session is idle.
     */
    const setStreamingState = (isStreaming: boolean) => {
      if (isStreaming) {
        state.isStreaming = true;
        // Bridge-driven sub-agent execution does not go through handleStreamMessage,
        // so we must establish a run owner here to allow hook events.
        if (state.currentRunId === null) {
          state.currentRunId = ++state.runCounter;
        }
        return;
      }

      // Keep ownership active if late lifecycle work is still draining.
      if (hasOpenStreamLifecycleWork(state)) {
        state.isStreaming = true;
        return;
      }

      state.isStreaming = false;
      state.currentRunId = null;
    };

    /**
     * Handle interrupt request from the UI (Escape/Ctrl+C during streaming).
     * This is called by ChatApp when user presses interrupt keys.
     */
    const handleInterruptFromUI = () => {
      handleInterrupt("ui");
    };

    const handleTerminateBackgroundAgentsFromUI: OnTerminateBackgroundAgents = () => {
      const activeAgents = getActiveBackgroundAgents(state.parallelAgents);
      if (activeAgents.length === 0) {
        state.telemetryTracker?.trackBackgroundTermination("noop", 0);
        return;
      }

      const activeCount = activeAgents.length;

      // Clear background agents from state tracking
      state.parallelAgents = state.parallelAgents.filter(a => !isBackgroundAgent(a));
      state.parallelAgentHandler?.(state.parallelAgents);

      // Abort the SDK session to actually kill background agent processes.
      // This is safe because ctrl+f only fires when NOT streaming (guarded
      // by isStreamingRef.current check in chat.tsx), so no foreground work
      // will be affected.
      if (state.session?.abort) {
        void state.session.abort().catch((error) => {
          console.error("Failed to abort session during background-agent termination:", error);
        });
      }

      state.telemetryTracker?.trackBackgroundTermination("execute", activeCount, activeCount);
    };

    /**
     * Get the current session for slash commands like /compact.
     */
    const getSession = () => state.session;

    /**
     * Reset the current session (destroy and nullify).
     * A new session will be created automatically on the next message.
     */
    const resetSession = async () => {
      state.currentRunId = null;
      state.isStreaming = false;
      state.resetParallelTracking?.("reset_session");
      if (state.session) {
        try {
          await state.session.destroy();
        } catch {
          // Session may already be destroyed
        }
        state.session = null;
      }
      state.ownedSessionIds.clear();
    };

    /**
     * Factory for creating independent sub-agent sessions.
     * Delegates to client.createSession() to give each sub-agent its own context.
     */
    const createSubagentSession = async (config?: SessionConfig) => {
      const session = await client.createSession(config);
      state.ownedSessionIds.add(session.id);
      return session;
    };

    /**
     * Handle model change from ChatApp (via /model command or model selector).
     * Updates sessionConfig so that new sessions (e.g., after /clear) use the correct model.
     */
    const handleModelChange = (newModel: string) => {
      if (sessionConfig) {
        sessionConfig.model = newModel;
      }
    };

    /**
     * Update MCP servers for future session creation.
     * Toggle changes from /mcp apply on the next session reset/reconnect.
     */
    const handleSessionMcpServersChange = (servers: SessionConfig["mcpServers"]) => {
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

    state.root.render(
      React.createElement(
        ThemeProvider,
        {
          initialTheme: theme,
          children: React.createElement(
            AppErrorBoundary,
            {
              onExit: () => { void cleanup(); },
              isDark: theme.isDark,
              children: React.createElement(ChatApp, {
                title,
                placeholder,
                version,
                model,
                tier,
                workingDir,
                suggestion,
                agentType,
                modelOps,
                initialModelId: sessionConfig?.model,
                getModelDisplayInfo: (hint?: string) => client.getModelDisplayInfo(hint),
                onSendMessage: handleSendMessage,
                onStreamMessage: handleStreamMessage,
                onExit: handleExit,
                onResetSession: resetSession,
                onInterrupt: handleInterruptFromUI,
                onTerminateBackgroundAgents: handleTerminateBackgroundAgentsFromUI,
                setStreamingState,
                registerToolStartHandler,
                registerToolCompleteHandler,
                registerSkillInvokedHandler,
                registerPermissionRequestHandler,
                registerAskUserQuestionHandler,
                registerParallelAgentHandler,
                registerCtrlCWarningHandler,
                getSession,
                createSubagentSession,
                initialPrompt,
                onModelChange: handleModelChange,
                onSessionMcpServersChange: handleSessionMcpServersChange,
                onCommandExecutionTelemetry: handleCommandTelemetry,
                onMessageSubmitTelemetry: handleMessageTelemetry,
              }),
            }
          ),
        }
      )
    );
  } catch (error) {
    // Cleanup on initialization error
    await cleanup();
    throw error;
  }

  return exitPromise;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create a chat UI with a mock client for testing/demo purposes.
 * The mock client echoes back messages after a short delay.
 *
 * @param config - Optional configuration for the chat UI
 * @returns Promise that resolves when the chat UI exits
 */
export async function startMockChatUI(
  config: Omit<ChatUIConfig, "sessionConfig"> = {}
): Promise<ChatUIResult> {
  // Create a mock client that echoes messages
  const mockClient: CodingAgentClient = {
    agentType: "claude",

    async createSession(): Promise<Session> {
      const sessionId = `mock_${Date.now()}`;

      return {
        id: sessionId,

        async send(message: string): Promise<AgentMessage> {
          // Simulate a small delay
          await new Promise((resolve) => setTimeout(resolve, 100));

          return {
            type: "text",
            content: `Echo: ${message}`,
            role: "assistant",
          };
        },

        async *stream(message: string): AsyncIterable<AgentMessage> {
          // Simulate streaming by yielding chunks
          const response = `I received your message: "${message}". This is a mock response for testing purposes.`;
          const words = response.split(" ");

          for (const word of words) {
            await new Promise((resolve) => setTimeout(resolve, 50));
            yield {
              type: "text",
              content: word + " ",
              role: "assistant",
            };
          }
        },

        async summarize(): Promise<void> {
          // No-op for mock
        },

        async getContextUsage() {
          return {
            inputTokens: 0,
            outputTokens: 0,
            maxTokens: 100000,
            usagePercentage: 0,
          };
        },

        getSystemToolsTokens(): number {
          return 0;
        },

        async destroy(): Promise<void> {
          // No-op for mock
        },
      };
    },

    async resumeSession(): Promise<Session | null> {
      return null;
    },

    on() {
      return () => {};
    },

    registerTool() {
      // No-op for mock
    },

    async start(): Promise<void> {
      // No-op for mock
    },

    async stop(): Promise<void> {
      // No-op for mock
    },

    async getModelDisplayInfo() {
      return { model: "Mock Model", tier: "Mock Tier" };
    },

    getSystemToolsTokens() {
      return null;
    },
  };

  return startChatUI(mockClient, config);
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  ChatApp,
  CompletionSummary,
  LoadingIndicator,
  StreamingBullet,
  type ChatAppProps,
  type ChatMessage,
  type MessageToolCall,
  type WorkflowChatState,
  type OnToolStart,
  type OnToolComplete,
  type OnInterrupt,
  type OnTerminateBackgroundAgents,
  type OnAskUserQuestion,
  defaultWorkflowChatState,
} from "./chat.tsx";
export {
  ThemeProvider,
  useTheme,
  useThemeColors,
  darkTheme,
  lightTheme,
  type Theme,
  type ThemeColors,
} from "./theme.tsx";
export {
  default as CodeBlock,
  type CodeBlockProps,
  type ParsedCodeBlock,
  normalizeLanguage,
  extractCodeBlocks,
  hasCodeBlocks,
  extractInlineCode,
} from "./code-block.tsx";

// Parts module - type exports for rendering system
export { type ToolExecutionStatus } from "./parts/types.ts";

// Tools module
export {
  type ToolRenderProps,
  type ToolRenderResult,
  type ToolRenderer,
  readToolRenderer,
  editToolRenderer,
  bashToolRenderer,
  writeToolRenderer,
  globToolRenderer,
  grepToolRenderer,
  defaultToolRenderer,
  TOOL_RENDERERS,
  getToolRenderer,
  getRegisteredToolNames,
  hasCustomRenderer,
  getLanguageFromExtension,
} from "./tools/index.ts";

// Commands module
export {
  // Registry
  CommandRegistry,
  globalRegistry,
  type CommandDefinition,
  type CommandContext,
  type CommandContextState,
  type CommandResult,
  type FeatureProgressState,

  // Built-in commands
  registerBuiltinCommands,

  // Workflow commands
  registerWorkflowCommands,
  type WorkflowMetadata,
  getWorkflowMetadata,

  // Initialization and helpers
  initializeCommandsAsync,
  parseSlashCommand,
  isSlashCommand,
  getCommandPrefix,
} from "./commands/index.ts";

// Components
export {
  Autocomplete,
  navigateUp,
  navigateDown,
  useAutocompleteKeyboard,
  type AutocompleteProps,
  type KeyboardHandlerResult,
  type UseAutocompleteKeyboardOptions,
} from "./components/autocomplete.tsx";

export {
  UserQuestionDialog,
  toggleSelection,
  type UserQuestionDialogProps,
  type UserQuestion,
  type QuestionOption,
  type QuestionAnswer,
} from "./components/user-question-dialog.tsx";

export {
  ToolResult,
  shouldCollapse,
  type ToolResultProps,
} from "./components/tool-result.tsx";
