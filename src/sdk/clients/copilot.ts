/**
 * CopilotClient - Implementation of CodingAgentClient for GitHub Copilot SDK
 *
 * This module implements the unified CodingAgentClient interface for the
 * GitHub Copilot CLI coding agent. It supports:
 * - Multiple connection modes (stdio, port, cliUrl)
 * - Session creation and resumption
 * - Streaming message responses
 * - All Copilot SDK event types
 * - Permission handler for approval flows
 *
 * Uses the official @github/copilot-sdk package for communication with
 * the GitHub Copilot CLI server via JSON-RPC.
 *
 * Permission Configuration:
 * By default, CopilotClient auto-approves all tool operations (bypass mode).
 * All tools execute without prompts - file edits, bash commands, etc.
 * This is equivalent to Copilot CLI's --allow-all mode.
 *
 * To implement custom permission handling, call setPermissionHandler()
 * with a custom CopilotPermissionHandler before creating sessions.
 *
 * AGENT-SPECIFIC LOGIC (why this module exists):
 * - Copilot SDK uses CopilotClient class with start/stop lifecycle
 * - Copilot SDK requires connection mode configuration (stdio, port, cliUrl)
 * - Copilot SDK has custom agent support loaded from .github/agents/
 * - Copilot SDK permission model uses onPermissionRequest callback
 * - Copilot SDK events (SessionEvent) require custom mapping to unified EventType
 * - Copilot SDK tracks toolCallId for mapping tool.start to tool.complete
 *
 * Common patterns (see base-client.ts) are duplicated here because:
 * - Tighter integration with Copilot session state tracking
 * - Event subscription tied to SDK session lifecycle
 */

import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

import {
  CopilotClient as SdkCopilotClient,
  CopilotSession as SdkCopilotSession,
  type CopilotClientOptions as SdkClientOptions,
  type SessionConfig as SdkSessionConfig,
  type SessionEvent as SdkSessionEvent,
  type SessionEventType as SdkSessionEventType,
  type PermissionHandler as SdkPermissionHandler,
  type PermissionRequest as SdkPermissionRequest,
  type Tool as SdkTool,
  type ResumeSessionConfig as SdkResumeSessionConfig,
  type CustomAgentConfig as SdkCustomAgentConfig,
} from "@github/copilot-sdk";

import { initCopilotSessionOptions } from "../init.ts";
import { loadCopilotAgents } from "../../config/copilot-manual.ts";
import {
  BACKGROUND_COMPACTION_THRESHOLD,
  BUFFER_EXHAUSTION_THRESHOLD,
} from "../../workflows/graph/types.ts";

import {
  stripProviderPrefix,
  type CodingAgentClient,
  type Session,
  type SessionConfig,
  type AgentMessage,
  type ContextUsage,
  type EventType,
  type EventHandler,
  type AgentEvent,
  type ToolDefinition,
  type ToolContext,
} from "../types.ts";

/**
 * Permission handler function type (unified interface)
 */
export type CopilotPermissionHandler = SdkPermissionHandler;

/**
 * Connection mode options (backwards compatibility)
 */
export type CopilotConnectionMode =
  | { type: "stdio" }
  | { type: "port"; port: number }
  | { type: "cliUrl"; url: string };

/**
 * Options for creating a Copilot client
 */
export interface CopilotClientOptions {
  /** Connection mode configuration */
  connectionMode?: CopilotConnectionMode;
  /** Timeout for operations in milliseconds */
  timeout?: number;
  /** Path to the Copilot CLI executable */
  cliPath?: string;
  /** Extra arguments to pass to the CLI */
  cliArgs?: string[];
  /** Working directory for the CLI process */
  cwd?: string;
  /** Log level for the CLI server */
  logLevel?: "none" | "error" | "warning" | "info" | "debug" | "all";
  /** Auto-start the CLI server on first use */
  autoStart?: boolean;
  /** Auto-restart the CLI server if it crashes */
  autoRestart?: boolean;
  /** GitHub token for authentication */
  githubToken?: string;
}

/**
 * Internal session state for tracking active sessions
 */
interface CopilotSessionState {
  sdkSession: SdkCopilotSession;
  sessionId: string;
  config: SessionConfig;
  inputTokens: number;
  outputTokens: number;
  isClosed: boolean;
  unsubscribe: () => void;
  /** Maps toolCallId to toolName for tool.execution_complete events */
  toolCallIdToName: Map<string, string>;
  /** Context window size resolved from listModels() */
  contextWindow: number | null;
  /** Token count for system prompt + tools baseline */
  systemToolsBaseline: number | null;
}

/**
 * Resolve the session ID used for user-input (HITL) events.
 *
 * Copilot can emit user-input requests after createSession() returns an SDK-
 * assigned session ID that differs from our tentative pre-create ID.
 * Use the active session when the preferred ID is not yet known locally.
 */
export function resolveCopilotUserInputSessionId(
  preferredSessionId: string,
  activeSessionIds: string[]
): string {
  if (preferredSessionId.length > 0 && activeSessionIds.includes(preferredSessionId)) {
    return preferredSessionId;
  }
  const latestActive = activeSessionIds[activeSessionIds.length - 1];
  return latestActive ?? preferredSessionId;
}

/**
 * Maps SDK event types to unified EventType.
 * Uses string key type to accommodate SDK event types that may not be in the type definition.
 */
function mapSdkEventToEventType(sdkEventType: SdkSessionEventType | string): EventType | null {
  const mapping: Record<string, EventType> = {
    "session.start": "session.start",
    "session.resume": "session.start",
    "session.idle": "session.idle",
    "session.error": "session.error",
    "session.info": "session.info",
    "session.warning": "session.warning",
    "session.title_changed": "session.title_changed",
    "session.truncation": "session.truncation",
    "session.compaction_start": "session.compaction",
    "session.compaction_complete": "session.compaction",
    "assistant.message_delta": "message.delta",
    "assistant.message": "message.complete",
    "assistant.reasoning_delta": "reasoning.delta",
    "assistant.reasoning": "reasoning.complete",
    "assistant.turn_start": "turn.start",
    "assistant.turn_end": "turn.end",
    "assistant.usage": "usage",
    "tool.execution_start": "tool.start",
    "tool.execution_complete": "tool.complete",
    "tool.execution_partial_result": "tool.partial_result",
    "skill.invoked": "skill.invoked",
    "subagent.started": "subagent.start",
    "subagent.completed": "subagent.complete",
    "subagent.failed": "subagent.complete",
    // session.usage_info is NOT mapped to "usage" — it carries context-window
    // metadata (currentTokens, tokenLimit), not per-turn token counts. Mapping
    // it to "usage" would cause the adapter to publish stream.usage with
    // { inputTokens: 0, outputTokens: 0 }, zeroing out the real counts from
    // assistant.usage events.
    // "session.usage_info": handled separately in handleSdkEvent (state only)
  };
  return mapping[sdkEventType] ?? null;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function extractCopilotToolResult(result: unknown): unknown {
  const resultRecord = asRecord(result);
  if (!resultRecord) {
    return result;
  }

  const content = resultRecord.content;
  if (typeof content === "string" && content.trim().length > 0) {
    return content;
  }

  const detailedContent = resultRecord.detailedContent;
  if (typeof detailedContent === "string" && detailedContent.trim().length > 0) {
    return detailedContent;
  }

  if ("contents" in resultRecord) {
    return resultRecord.contents;
  }

  return result;
}

/**
 * CopilotClient implements CodingAgentClient for the GitHub Copilot SDK.
 *
 * This client wraps the official @github/copilot-sdk to provide a unified interface
 * for session management, message streaming, and event handling.
 */
export class CopilotClient implements CodingAgentClient {
  readonly agentType = "copilot" as const;

  private sdkClient: SdkCopilotClient | null = null;
  private clientOptions: CopilotClientOptions;
  private eventHandlers: Map<EventType, Set<EventHandler<EventType>>> = new Map();
  private sessions: Map<string, CopilotSessionState> = new Map();
  private registeredTools: ToolDefinition[] = [];
  private permissionHandler: CopilotPermissionHandler | null = null;
  private isRunning = false;
  private probeSystemToolsBaseline: number | null = null;
  private probePromise: Promise<void> | null = null;
  private knownAgentNames: string[] = [];

  /**
   * Create a new CopilotClient
   * @param options - Client options including connection mode
   */
  constructor(options: CopilotClientOptions = {}) {
    this.clientOptions = options;
  }

  /**
   * Set the permission handler for approval flows
   */
  setPermissionHandler(handler: CopilotPermissionHandler): void {
    this.permissionHandler = handler;
  }

  /**
   * Build SDK client options from our client options.
   *
   * The Copilot SDK spawns its CLI subprocess using process.execPath when
   * cliPath ends in ".js". Under Bun, this fails because @github/copilot
   * depends on node:sqlite which Bun does not support. Work around this by
   * setting cliPath to the Node.js binary and prepending the copilot CLI
   * index.js path to cliArgs so the SDK spawns Node (not Bun) as the
   * subprocess host.
   */
  private buildSdkOptions(): SdkClientOptions {
    let cliPath = this.clientOptions.cliPath;
    const cliArgs = [...(this.clientOptions.cliArgs ?? [])];

    // When no explicit cliPath is provided, resolve the Node.js binary and
    // the bundled Copilot CLI index.js so the subprocess runs under Node
    // (required for node:sqlite support). --no-warnings suppresses the
    // ExperimentalWarning about SQLite.
    if (!cliPath) {
      const copilotCliPath = getBundledCopilotCliPath();
      const nodePath = resolveNodePath();
      if (nodePath && copilotCliPath.endsWith(".js")) {
        cliPath = nodePath;
        cliArgs.unshift("--no-warnings", copilotCliPath);
      } else {
        cliPath = copilotCliPath;
      }
    }

    const opts: SdkClientOptions = {
      cliPath,
      cliArgs,
      cwd: this.clientOptions.cwd,
      logLevel: this.clientOptions.logLevel,
      autoStart: this.clientOptions.autoStart ?? true,
      autoRestart: this.clientOptions.autoRestart ?? true,
      githubToken: this.clientOptions.githubToken,
    };

    // Handle connection mode
    if (this.clientOptions.connectionMode) {
      switch (this.clientOptions.connectionMode.type) {
        case "stdio":
          opts.useStdio = true;
          break;
        case "port":
          opts.port = this.clientOptions.connectionMode.port;
          opts.useStdio = false;
          break;
        case "cliUrl":
          opts.cliUrl = this.clientOptions.connectionMode.url;
          break;
      }
    }

    return opts;
  }

  /**
   * Wrap a Copilot SDK session into a unified Session interface
   */
  private wrapSession(
    sdkSession: SdkCopilotSession,
    config: SessionConfig
  ): Session {
    const sessionId = sdkSession.sessionId;

    // Subscribe to all session events
    const unsubscribe = sdkSession.on((event: SdkSessionEvent) => {
      this.handleSdkEvent(sessionId, event);
    });

    const state: CopilotSessionState = {
      sdkSession,
      sessionId,
      config,
      inputTokens: 0,
      outputTokens: 0,
      isClosed: false,
      unsubscribe,
      toolCallIdToName: new Map(),
      contextWindow: null,
      systemToolsBaseline: null,
    };

    this.sessions.set(sessionId, state);

    // Emit session start event
    this.emitEvent("session.start", sessionId, { config });

    const session: Session = {
      id: sessionId,

      send: async (message: string): Promise<AgentMessage> => {
        if (state.isClosed) {
          throw new Error("Session is closed");
        }

        // Use sendAndWait for blocking send
        const response = await state.sdkSession.sendAndWait({ prompt: message });

        // Track token usage from usage events
        if (response) {
          const content = response.data.content;
          return {
            type: "text",
            content: content,
            role: "assistant",
          };
        }

        return {
          type: "text",
          content: "",
          role: "assistant",
        };
      },

      stream: (message: string, _options?: { agent?: string }): AsyncIterable<AgentMessage> => {
        return {
          [Symbol.asyncIterator]: async function* () {
            if (state.isClosed) {
              throw new Error("Session is closed");
            }

            // Set up event handler to collect streaming events
            // Use a queue-based approach to handle race conditions:
            // - Events may fire before we're ready to consume them
            // - We need to ensure no events are lost between send() and the while loop
            const chunks: AgentMessage[] = [];
            let resolveChunk: (() => void) | null = null;
            let done = false;

            // Track if we've yielded streaming deltas to avoid duplicating content
            let hasYieldedDeltas = false;

            // Helper to notify the consumer that new data is available
            const notifyConsumer = () => {
              if (resolveChunk) {
                const resolve = resolveChunk;
                resolveChunk = null;
                resolve();
              }
            };

            // Wall-clock thinking timing
            let reasoningStartMs: number | null = null;
            let reasoningDurationMs = 0;
            // Accumulated output tokens for streaming display (resets per stream call)
            let streamingOutputTokens = 0;

            const eventHandler = (event: SdkSessionEvent) => {
              if (event.type === "assistant.message_delta") {
                // Skip sub-agent deltas: they have parentToolCallId and are
                // handled separately by the event bus adapter. Mixing them
                // into the main stream garbles text.
                const deltaData = event.data as Record<string, unknown>;
                if (deltaData.parentToolCallId) return;

                // Accumulate reasoning duration when transitioning away from reasoning
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
              } else if (event.type === "assistant.reasoning_delta") {
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
              } else if (event.type === "assistant.usage") {
                // Accumulate reasoning duration if still in reasoning
                if (reasoningStartMs !== null) {
                  reasoningDurationMs += Date.now() - reasoningStartMs;
                  reasoningStartMs = null;
                }
                // Accumulate output tokens across multi-turn API calls for display
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
              } else if (event.type === "assistant.message") {
                // Skip sub-agent complete messages
                const msgData = event.data as Record<string, unknown>;
                if (msgData.parentToolCallId) return;

                // Only yield the complete message if we haven't streamed deltas
                // (deltas already contain the full content incrementally)
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
                // NOTE: Do NOT reset hasYieldedDeltas here. In multi-turn agentic
                // flows (tool call → agent responds again), resetting would allow
                // a subsequent assistant.message to push full accumulated text into
                // chunks[], duplicating all previously streamed delta content.
                // hasYieldedDeltas will be set to true naturally when new deltas arrive.
                // Don't set done = true here - wait for session.idle
                // Tool execution may cause multiple assistant.message events
              } else if (event.type === "session.idle") {
                done = true;
                notifyConsumer();
              }
              // NOTE: tool.execution_start and tool.execution_complete are handled
              // by handleSdkEvent (via the wrapSession subscription). Do NOT emit
              // unified tool events here to avoid duplicate event delivery.
            };

            const unsub = state.sdkSession.on(eventHandler);

            try {
              // Send the message (non-blocking - returns immediately)
              // Events will start arriving via eventHandler
              await state.sdkSession.send({ prompt: message });

              // Yield chunks as they arrive
              // The loop continues until done is true AND all chunks are consumed
              while (!done || chunks.length > 0) {
                if (chunks.length > 0) {
                  yield chunks.shift()!;
                } else if (!done) {
                  // Wait for next chunk or completion
                  // Set up the resolver BEFORE checking the condition again
                  // to avoid race conditions where events fire between check and wait
                  await new Promise<void>((resolve) => {
                    resolveChunk = resolve;
                    // If done became true or chunks arrived while we were setting up,
                    // resolve immediately to re-check the condition
                    if (done || chunks.length > 0) {
                      resolveChunk = null;
                      resolve();
                    }
                  });
                }
              }
            } finally {
              unsub();
            }
          },
        };
      },

      summarize: async (): Promise<void> => {
        if (state.isClosed) {
          throw new Error("Session is closed");
        }

        // Send /compact as a prompt to the Copilot SDK
        await state.sdkSession.sendAndWait({ prompt: "/compact" });
      },

      getContextUsage: async (): Promise<ContextUsage> => {
        // Token usage is tracked via session.usage_info events
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
          this.sessions.delete(sessionId);
          this.emitEvent("session.idle", sessionId, { reason: "destroyed" });
        }
      },

      abort: async (): Promise<void> => {
        // Abort any ongoing work in the session (including sub-agent invocations)
        await state.sdkSession.abort();
      },

      abortBackgroundAgents: async (): Promise<void> => {
        // Abort background agents by terminating all in-flight SDK work.
        // The Copilot SDK does not expose individual sub-agent session
        // handles, so we abort the entire session. This is safe because
        // Ctrl+F only fires when NOT streaming (no foreground to preserve).
        await state.sdkSession.abort();
      },

      getSystemToolsTokens: (): number => {
        if (state.systemToolsBaseline === null) {
          throw new Error("System tools baseline unavailable: no session.usage_info received yet.");
        }
        return state.systemToolsBaseline;
      },
    };

    return session;
  }

  /**
   * Handle SDK session events and map to unified events
   */
  private handleSdkEvent(sessionId: string, event: SdkSessionEvent): void {
    const state = this.sessions.get(sessionId);

    // Track token usage from usage events (per-API-call totals, not deltas)
    if (event.type === "assistant.usage" && state) {
      state.inputTokens = event.data.inputTokens ?? state.inputTokens;
      state.outputTokens = event.data.outputTokens ?? state.outputTokens;
      const cache = (event.data as Record<string, unknown>).cacheWriteTokens as number | undefined
        ?? (event.data as Record<string, unknown>).cacheReadTokens as number | undefined
        ?? 0;
      if (cache > 0) {
        state.systemToolsBaseline = cache;
      }
    }

    // Track context window and system tools baseline from usage_info events
    if (event.type === "session.usage_info" && state) {
      const data = event.data as Record<string, unknown>;
      const currentTokens = typeof data.currentTokens === "number"
        ? data.currentTokens
        : null;
      if (
        currentTokens !== null
        && currentTokens > 0
        && (state.systemToolsBaseline === null || state.systemToolsBaseline <= 0)
      ) {
        state.systemToolsBaseline = currentTokens;
      }
      if (typeof data.tokenLimit === "number") {
        state.contextWindow = data.tokenLimit;
      }
      // currentTokens reflects the actual tokens in the context window,
      // replacing any accumulated values from assistant.usage events
      if (currentTokens !== null) {
        state.inputTokens = currentTokens;
        state.outputTokens = 0;
      }
    }

    // Map to unified event type
    const eventType = mapSdkEventToEventType(event.type);
    if (!eventType) {
      // DEBUG: Log unmapped event types for Copilot debugging
      if (event.type.startsWith("tool.")) {
        console.warn(`[CopilotClient] Unmapped tool event: ${event.type}`);
      }
      return;
    }

    let eventData: Record<string, unknown> = {};

      // Cast event.data to access properties (type narrowing doesn't work after casting event.type)
      const data = event.data as Record<string, unknown>;
      switch (event.type as string) {
        case "session.start":
          eventData = { config: state?.config };
          break;
        case "session.idle":
          eventData = { reason: "idle" };
          break;
        case "session.error":
          eventData = { error: data.message };
          break;
        case "assistant.message_delta":
          eventData = {
            delta: data.deltaContent,
            messageId: asNonEmptyString(data.messageId),
            parentToolCallId: asNonEmptyString(data.parentToolCallId),
          };
          break;
        case "assistant.message": {
          const toolRequests = Array.isArray(data.toolRequests)
            ? (data.toolRequests as Array<Record<string, unknown>>).map((tr) => ({
              toolCallId: String(tr.toolCallId ?? ""),
              name: String(tr.name ?? ""),
              arguments: tr.arguments,
            }))
            : undefined;
          eventData = {
            message: {
              type: "text",
              content: data.content,
              role: "assistant",
            },
            toolRequests,
            parentToolCallId: asNonEmptyString(data.parentToolCallId),
          };
          break;
        }
        case "tool.execution_start": {
          // Track toolCallId -> toolName mapping for the complete event
          const toolCallId = asNonEmptyString(data.toolCallId);
          const toolName = asNonEmptyString(data.toolName)
            ?? asNonEmptyString(data.mcpToolName)
            ?? "unknown";
          if (state && toolCallId) {
            state.toolCallIdToName.set(toolCallId, toolName);
          }
          // Extract parentToolCallId to link tool calls to their parent sub-agent
          const parentToolCallId = asNonEmptyString(data.parentToolCallId);
          eventData = {
            toolName,
            toolInput: data.arguments,
            toolCallId,
            parentId: parentToolCallId,
          };
          break;
        }
        case "tool.execution_complete": {
          // Look up the actual tool name from the toolCallId
          const toolCallId = asNonEmptyString(data.toolCallId);
          const mappedToolName = toolCallId ? state?.toolCallIdToName.get(toolCallId) : undefined;
          const toolName = mappedToolName
            ?? asNonEmptyString(data.toolName)
            ?? asNonEmptyString(data.mcpToolName)
            ?? "unknown";
          // Clean up the mapping
          if (toolCallId) {
            state?.toolCallIdToName.delete(toolCallId);
          }
          const errorData = asRecord(data.error);
          const success = typeof data.success === "boolean" ? data.success : true;
          // Extract parentToolCallId to link tool calls to their parent sub-agent
          const parentToolCallId = asNonEmptyString(data.parentToolCallId);
          eventData = {
            toolName,
            success,
            toolResult: extractCopilotToolResult(data.result),
            error: asNonEmptyString(errorData?.message),
            toolCallId,
            parentId: parentToolCallId,
          };
          break;
        }
        case "subagent.started":
          eventData = {
            subagentId: data.toolCallId,
            subagentType: data.agentName,
            toolCallId: data.toolCallId,
            task: data.agentDescription || "",
          };
          break;
        case "skill.invoked":
          eventData = {
            skillName: data.name,
            skillPath: data.path,
          };
          break;
        case "subagent.completed":
          eventData = {
            subagentId: data.toolCallId,
            success: true,
          };
          break;
        case "subagent.failed":
          eventData = {
            subagentId: data.toolCallId,
            success: false,
            error: data.error,
          };
          break;
        case "assistant.reasoning_delta":
          eventData = {
            delta: data.deltaContent,
            reasoningId: data.reasoningId,
          };
          break;
        case "assistant.reasoning":
          eventData = {
            reasoningId: data.reasoningId,
            content: data.content,
          };
          break;
        case "assistant.turn_start":
          eventData = {
            turnId: data.turnId,
          };
          break;
        case "assistant.turn_end":
          eventData = {
            turnId: data.turnId,
          };
          break;
        case "assistant.usage":
          eventData = {
            inputTokens: data.inputTokens ?? 0,
            outputTokens: data.outputTokens ?? 0,
            model: data.model,
          };
          break;
        case "tool.execution_partial_result":
          eventData = {
            toolCallId: data.toolCallId,
            partialOutput: data.partialOutput,
          };
          break;
        case "session.info":
          eventData = {
            infoType: data.infoType ?? "general",
            message: data.message ?? "",
          };
          break;
        case "session.warning":
          eventData = {
            warningType: data.warningType ?? "general",
            message: data.message ?? "",
          };
          break;
        case "session.title_changed":
          eventData = {
            title: data.title ?? "",
          };
          break;
        case "session.truncation":
          eventData = {
            tokenLimit: data.tokenLimit ?? 0,
            tokensRemoved: data.tokensRemovedDuringTruncation ?? 0,
            messagesRemoved: data.messagesRemovedDuringTruncation ?? 0,
          };
          break;
        case "session.compaction_start":
          eventData = {
            phase: "start",
          };
          break;
        case "session.compaction_complete":
          eventData = {
            phase: "complete",
            success: typeof data.success === "boolean" ? data.success : true,
            error: asNonEmptyString(data.error),
          };
          break;
        // session.usage_info is no longer mapped to a unified event type —
        // it is handled above for state tracking only (context window metadata).
      }

      this.emitEvent(eventType, sessionId, eventData);
  }

  /**
   * Emit an event to all registered handlers
   */
  private emitEvent<T extends EventType>(
    eventType: T,
    sessionId: string,
    data: Record<string, unknown>
  ): void {
    const handlers = this.eventHandlers.get(eventType);
    if (!handlers || handlers.size === 0) {
      return;
    }

    const event: AgentEvent<T> = {
      type: eventType,
      sessionId,
      timestamp: new Date().toISOString(),
      data: data as unknown as AgentEvent<T>["data"],
    };

    for (const handler of handlers) {
      try {
        handler(event as AgentEvent<EventType>);
      } catch (error) {
        console.error(`Error in event handler for ${eventType}:`, error);
      }
    }
  }

  /**
   * Convert unified tool definition to SDK tool format
   */
  private convertTool(tool: ToolDefinition): SdkTool {
    return {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
      handler: async (args) => {
        const activeSessionId = this.sessions.keys().next().value ?? "";
        const context: ToolContext = {
          sessionID: activeSessionId,
          messageID: "",
          agent: "copilot",
          directory: this.clientOptions.cwd ?? process.cwd(),
          abort: new AbortController().signal,
        };
        return tool.handler(args as Record<string, unknown>, context);
      },
    };
  }

  /**
   * Create a permission handler that auto-approves all operations (bypass mode).
   * All tools execute without prompts, similar to Claude Code's bypass permission mode.
   *
   * Note: This enables full autonomous agent execution. All file edits, bash
   * commands, and other tool operations are automatically approved without
   * user confirmation. Only AskUserQuestion-style tools that explicitly
   * request user input will pause for response.
   *
   * To implement HITL (Human-in-the-Loop) approval prompts for specific tools:
   * 1. Call setPermissionHandler() with a custom handler
   * 2. Check request.toolName for specific tools (e.g., "write", "bash")
   * 3. Emit permission.requested event and await response
   * 4. Return { kind: "approved" } or { kind: "denied-interactively-by-user" }
   */
  private createHITLPermissionHandler(_sessionId: string): CopilotPermissionHandler {
    return async (_request: SdkPermissionRequest) => {
      // Auto-approve all operations - all tools execute without prompts
      return { kind: "approved" };
    };
  }

  /**
   * Create an onUserInputRequest handler that enables the ask_user tool.
   * Maps Copilot SDK's UserInputRequest directly into the shared
   * `permission.requested` event used by the TUI.
   */
  private createUserInputHandler(sessionId: string): SdkSessionConfig["onUserInputRequest"] {
    return async (request) => {
      const activeSessionIds = Array.from(this.sessions.values())
        .filter((session) => !session.isClosed)
        .map((session) => session.sessionId);
      const resolvedSessionId = resolveCopilotUserInputSessionId(sessionId, activeSessionIds);
      const requestRecord = request as unknown as Record<string, unknown>;
      const toolCallId = typeof requestRecord.toolCallId === "string"
        ? requestRecord.toolCallId
        : undefined;

      // Keep Copilot request payload semantics: one line option string per choice.
      const options = request.choices
        ? request.choices.map((choice: string) => ({
          label: choice,
          value: choice,
        }))
        : [];

      // Create a promise that resolves when the user responds via the UI
      const response = await new Promise<string | string[]>((resolve) => {
        this.emitEvent("permission.requested", resolvedSessionId, {
          requestId: `ask_user_${Date.now()}`,
          toolName: "ask_user",
          question: request.question,
          options,
          toolCallId,
          respond: resolve,
        });
      });

      const answer = Array.isArray(response) ? response.join(", ") : response;
      return {
        answer,
        wasFreeform: !request.choices?.includes(answer),
      };
    };
  }

  /**
   * Create a new agent session
   */
  async createSession(config: SessionConfig = {}): Promise<Session> {
    if (!this.isRunning || !this.sdkClient) {
      throw new Error("Client not started. Call start() first.");
    }

    // Generate a session ID for permission handler events
    const tentativeSessionId = config.sessionId ?? `copilot_${Date.now()}`;

    // Get default session options (auto-approve permissions)
    const defaultOptions = initCopilotSessionOptions();

    // Use provided permission handler, or default from initCopilotSessionOptions, or create HITL handler
    const permissionHandler = this.permissionHandler ?? defaultOptions.OnPermissionRequest ?? this.createHITLPermissionHandler(tentativeSessionId);

    // Load custom agents from project and global directories
    const projectRoot = this.clientOptions.cwd ?? process.cwd();
    const loadedAgents = await loadCopilotAgents(projectRoot);
    this.knownAgentNames = [
      "general-purpose",
      ...loadedAgents.map(a => a.name),
    ];
    const customAgents: SdkCustomAgentConfig[] = loadedAgents.map((agent) => ({
      name: agent.name,
      description: agent.description,
      tools: agent.tools ?? null,
      prompt: agent.systemPrompt,
    }));

    const HOME = homedir();
    const skillDirs = [
      join(projectRoot, ".github", "skills"),
      join(projectRoot, ".claude", "skills"),
      join(projectRoot, ".opencode", "skills"),
      join(HOME, ".copilot", "skills"),
      join(HOME, ".claude", "skills"),
      join(HOME, ".opencode", "skills"),
      join(HOME, ".atomic", ".copilot", "skills"),
      join(HOME, ".atomic", ".claude", "skills"),
      join(HOME, ".atomic", ".opencode", "skills"),
    ].filter((dir) => existsSync(dir));

    // Strip provider prefix from model ID (e.g. "github-copilot/claude-opus-4.6-fast" → "claude-opus-4.6-fast")
    const resolvedModel = config.model ? stripProviderPrefix(config.model) : undefined;

    // Resolve context window and reasoning effort support from listModels() BEFORE session creation
    let contextWindow: number | null = null;
    let modelSupportsReasoning = false;
    try {
      const models = await this.sdkClient.listModels();
      if (models?.length) {
        const matched = resolvedModel
          ? models.find((m: { id?: string }) => m.id === resolvedModel)
          : null;
        const targetModel = matched ?? models[0];
        const caps = (targetModel as unknown as Record<string, unknown>).capabilities as Record<string, unknown> | undefined;
        const limits = caps?.limits as Record<string, unknown> | undefined;
        const maxCtx = limits?.max_context_window_tokens as number | undefined;
        if (maxCtx) {
          contextWindow = maxCtx;
        }
        // Check if model supports reasoning effort
        const supports = caps?.supports as Record<string, unknown> | undefined;
        modelSupportsReasoning = supports?.reasoningEffort === true;
      }
    } catch {
      // Fall through - contextWindow stays null
    }
    if (contextWindow === null) {
      throw new Error("Failed to resolve context window size from Copilot SDK listModels()");
    }

    // Build SDK config - use type assertion to handle reasoningEffort which may not be in SDK types
    const sdkConfig = {
      sessionId: config.sessionId,
      model: resolvedModel,
      ...(modelSupportsReasoning && config.reasoningEffort
        ? { reasoningEffort: config.reasoningEffort }
        : {}),
      systemMessage: config.systemPrompt
        ? { mode: "append", content: config.systemPrompt }
        : undefined,
      availableTools: config.tools,
      streaming: true,
      tools: this.registeredTools.map((t) => this.convertTool(t)),
      onPermissionRequest: permissionHandler,
      onUserInputRequest: this.createUserInputHandler(tentativeSessionId),
      skillDirectories: skillDirs.length > 0 ? skillDirs : undefined,
      customAgents: customAgents.length > 0 ? customAgents : undefined,
      infiniteSessions: {
        enabled: true,
        backgroundCompactionThreshold: BACKGROUND_COMPACTION_THRESHOLD,
        bufferExhaustionThreshold: BUFFER_EXHAUSTION_THRESHOLD,
      },
      mcpServers: config.mcpServers
        ? Object.fromEntries(
            config.mcpServers.map((s) => {
              if (s.url) {
                return [s.name, {
                  type: (s.type === "sse" ? "sse" : "http") as "http" | "sse",
                  url: s.url,
                  headers: s.headers,
                  tools: s.tools ?? ["*"],
                  timeout: s.timeout,
                }];
              }
              return [s.name, {
                type: "stdio" as const,
                command: s.command ?? "",
                args: s.args ?? [],
                env: s.env,
                cwd: s.cwd,
                tools: s.tools ?? ["*"],
                timeout: s.timeout,
              }];
            })
          )
        : undefined,
    } as SdkSessionConfig;

    const sdkSession = await this.sdkClient.createSession(sdkConfig);

    const session = this.wrapSession(sdkSession, config);

    // Set the resolved context window on the session state
    const sessionState = this.sessions.get(sdkSession.sessionId);
    if (sessionState) {
      sessionState.contextWindow = contextWindow;
    }

    return session;
  }

  /**
   * Resume an existing session by ID
   */
  async resumeSession(sessionId: string): Promise<Session | null> {
    if (!this.isRunning || !this.sdkClient) {
      throw new Error("Client not started. Call start() first.");
    }

    // Check if session is already active locally — reuse without re-wrapping
    // to avoid adding duplicate sdkSession.on() subscriptions
    const existingState = this.sessions.get(sessionId);
    if (existingState && !existingState.isClosed) {
      // Unsubscribe old handler before re-wrapping to prevent subscription accumulation
      existingState.unsubscribe();
      return this.wrapSession(existingState.sdkSession, existingState.config);
    }

    // Try to resume session from SDK
    try {
      // Use provided permission handler or create HITL handler that emits events
      const permissionHandler = this.permissionHandler ?? this.createHITLPermissionHandler(sessionId);

      const resumeConfig: SdkResumeSessionConfig = {
        streaming: true,
        tools: this.registeredTools.map((t) => this.convertTool(t)),
        onPermissionRequest: permissionHandler,
        onUserInputRequest: this.createUserInputHandler(sessionId),
      };
      const sdkSession = await this.sdkClient.resumeSession(sessionId, resumeConfig);
      return this.wrapSession(sdkSession, {});
    } catch {
      // Session not found or cannot be resumed
      return null;
    }
  }

  /**
   * Switch model for the active Copilot session while preserving history.
   * Rebinds the same session ID with updated model config.
   */
  async setActiveSessionModel(
    model: string,
    options?: { reasoningEffort?: string }
  ): Promise<void> {
    if (!this.isRunning || !this.sdkClient) {
      throw new Error("Client not started. Call start() first.");
    }

    const activeStates = Array.from(this.sessions.values()).filter((state) => !state.isClosed);
    const activeState = activeStates[activeStates.length - 1];
    if (!activeState) {
      return;
    }

    const resolvedModel = stripProviderPrefix(model).trim();
    if (!resolvedModel) {
      throw new Error("Model ID cannot be empty.");
    }

    const defaultOptions = initCopilotSessionOptions();
    const permissionHandler =
      this.permissionHandler
      ?? defaultOptions.OnPermissionRequest
      ?? this.createHITLPermissionHandler(activeState.sessionId);

    const resumeConfig: SdkResumeSessionConfig = {
      model: resolvedModel,
      ...(options?.reasoningEffort ? { reasoningEffort: options.reasoningEffort as SdkSessionConfig["reasoningEffort"] } : {}),
      streaming: true,
      tools: this.registeredTools.map((t) => this.convertTool(t)),
      onPermissionRequest: permissionHandler,
      onUserInputRequest: this.createUserInputHandler(activeState.sessionId),
    };

    const resumedSession = await this.sdkClient.resumeSession(activeState.sessionId, resumeConfig);

    activeState.unsubscribe();
    activeState.sdkSession = resumedSession;
    activeState.config = {
      ...activeState.config,
      model: resolvedModel,
      ...(options?.reasoningEffort !== undefined
        ? { reasoningEffort: options.reasoningEffort }
        : {}),
    };
    activeState.unsubscribe = resumedSession.on((event: SdkSessionEvent) => {
      this.handleSdkEvent(activeState.sessionId, event);
    });
  }

  /**
   * Register an event handler
   */
  on<T extends EventType>(eventType: T, handler: EventHandler<T>): () => void {
    let handlers = this.eventHandlers.get(eventType);
    if (!handlers) {
      handlers = new Set();
      this.eventHandlers.set(eventType, handlers);
    }

    handlers.add(handler as EventHandler<EventType>);

    return () => {
      handlers?.delete(handler as EventHandler<EventType>);
    };
  }

  /**
   * Register a custom tool
   */
  registerTool(tool: ToolDefinition): void {
    this.registeredTools.push(tool);
  }

  /**
   * Start the client
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    // Create SDK client with options
    const sdkOptions = this.buildSdkOptions();
    this.sdkClient = new SdkCopilotClient(sdkOptions);

    // Start the client
    await this.sdkClient.start();
    this.isRunning = true;

    // Probe for system tools baseline in the background (non-blocking).
    // The baseline is only needed for the /context command, so there's no
    // reason to block startup on it.
    this.probePromise = (async () => {
      try {
        const probeSession = await this.sdkClient!.createSession({});
        const baseline = await new Promise<number | null>((resolve) => {
          let unsub: (() => void) | null = null;
          const timeout = setTimeout(() => {
            unsub?.();
            resolve(null);
          }, 3000);
          unsub = probeSession.on("session.usage_info", (event) => {
            const data = event.data as Record<string, unknown>;
            const currentTokens = data.currentTokens;
            if (typeof currentTokens !== "number" || currentTokens <= 0) {
              return;
            }
            unsub?.();
            clearTimeout(timeout);
            resolve(currentTokens);
          });
        });
        this.probeSystemToolsBaseline = baseline;
        await probeSession.destroy();
      } catch {
        // Probe failed - baseline will be populated on first message
      }
    })();
  }

  /**
   * Stop the client and clean up resources
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    // Wait for background probe to finish before tearing down
    if (this.probePromise) {
      await this.probePromise;
      this.probePromise = null;
    }

    // Close all active sessions
    for (const [_sessionId, state] of this.sessions) {
      if (!state.isClosed) {
        state.isClosed = true;
        state.unsubscribe();
        try {
          await state.sdkSession.destroy();
        } catch {
          // Ignore errors during cleanup
        }
      }
    }
    this.sessions.clear();

    // Stop SDK client
    if (this.sdkClient) {
      await this.sdkClient.stop();
      this.sdkClient = null;
    }

    this.eventHandlers.clear();
    this.isRunning = false;
  }

  /**
   * Get the current connection state
   */
  getState(): "disconnected" | "connecting" | "connected" | "error" {
    if (!this.sdkClient) {
      return "disconnected";
    }
    return this.sdkClient.getState();
  }

  /**
   * List all available sessions
   */
  async listSessions(): Promise<Array<{ sessionId: string; summary?: string }>> {
    if (!this.isRunning || !this.sdkClient) {
      return [];
    }
    const sessions = await this.sdkClient.listSessions();
    return sessions.map((s) => ({
      sessionId: s.sessionId,
      summary: s.summary,
    }));
  }

  /**
   * Delete a session by ID
   */
  async deleteSession(sessionId: string): Promise<void> {
    if (!this.isRunning || !this.sdkClient) {
      return;
    }

    // Close local state if exists
    const state = this.sessions.get(sessionId);
    if (state) {
      state.isClosed = true;
      state.unsubscribe();
      this.sessions.delete(sessionId);
    }

    await this.sdkClient.deleteSession(sessionId);
  }

  /**
   * Get model display information for UI rendering.
   * Queries the SDK's listModels() for authoritative model names.
   * Falls back to the raw model ID (not formatted) if metadata is unavailable.
   * @param modelHint - Optional model hint from saved preferences
   */
  async getModelDisplayInfo(
    modelHint?: string
  ): Promise<{ model: string; tier: string; supportsReasoning?: boolean; contextWindow?: number }> {
    // Query SDK for model metadata - this is the authoritative source
    if (this.isRunning && this.sdkClient) {
      try {
        const models = await this.sdkClient.listModels();
        if (models?.length) {
          // If we have a hint, find the matching model by ID
          if (modelHint) {
            const hintModelId = stripProviderPrefix(modelHint);
            const matched = models.find((m: { id?: string }) => m.id === hintModelId || m.id === modelHint);
            if (matched) {
              const caps = (matched as unknown as Record<string, unknown>).capabilities as Record<string, unknown> | undefined;
              const supports = caps?.supports as Record<string, unknown> | undefined;
              const limits = caps?.limits as Record<string, unknown> | undefined;
              const ctxWindow = limits?.max_context_window_tokens as number | undefined;
              return {
                model: matched.id ?? "Copilot",
                tier: "GitHub Copilot",
                supportsReasoning: supports?.reasoningEffort === true,
                contextWindow: ctxWindow,
              };
            }
          }
          // No hint or hint not found - use the first model's raw ID
          const firstModel = models[0] as { name?: string; id?: string } | undefined;
          if (firstModel) {
            const caps = (firstModel as unknown as Record<string, unknown>).capabilities as Record<string, unknown> | undefined;
            const supports = caps?.supports as Record<string, unknown> | undefined;
            const limits = caps?.limits as Record<string, unknown> | undefined;
            const ctxWindow = limits?.max_context_window_tokens as number | undefined;
            return {
              model: firstModel.id ?? "Copilot",
              tier: "GitHub Copilot",
              supportsReasoning: supports?.reasoningEffort === true,
              contextWindow: ctxWindow,
            };
          }
        }
      } catch {
        // SDK listModels() failed - fall through to raw ID below
      }
    }

    // SDK not available - use raw model ID without lossy formatting
    if (modelHint) {
      return {
        model: stripProviderPrefix(modelHint),
        tier: "GitHub Copilot",
      };
    }

    return {
      model: "Copilot",
      tier: "GitHub Copilot",
    };
  }

  /**
   * Get the system tools token baseline captured during start() probe.
   */
  getSystemToolsTokens(): number | null {
    return this.probeSystemToolsBaseline;
  }

  getKnownAgentNames(): string[] {
    return this.knownAgentNames;
  }
}

/**
 * Create a permission handler that auto-approves all requests
 */
export function createAutoApprovePermissionHandler(): CopilotPermissionHandler {
  return async () => ({ kind: "approved" });
}

/**
 * Create a permission handler that denies all requests
 */
export function createDenyAllPermissionHandler(): CopilotPermissionHandler {
  return async () => ({ kind: "denied-interactively-by-user" });
}

/**
 * Resolve the path to the system Node.js binary.
 * Returns undefined if Node.js is not found.
 */
export function resolveNodePath(): string | undefined {
  try {
    const cmd = process.platform === "win32" ? "where node" : "which node";
    const nodePath = execSync(cmd, { encoding: "utf-8" }).trim().split(/\r?\n/)[0]?.replace(/\r$/, "");
    return nodePath || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Get the path to the Copilot CLI entry point.
 *
 * Returns either:
 * - A `.js` path (index.js) when @github/copilot is installed as an npm package
 * - A binary path when copilot is installed standalone (Homebrew, install script, winget)
 *
 * Resolution order:
 * 1. import.meta.resolve (works in dev when @github/copilot is hoisted)
 * 2. Resolve from @github/copilot-sdk's directory context (its direct dependency)
 * 3. Find globally-installed copilot CLI on $PATH
 */
export function getBundledCopilotCliPath(): string {
  // Strategy 1: import.meta.resolve (works in dev, fails in compiled binary)
  try {
    const sdkUrl = import.meta.resolve("@github/copilot/sdk");
    const sdkPath = fileURLToPath(sdkUrl);
    const indexPath = join(dirname(dirname(sdkPath)), "index.js");
    if (existsSync(indexPath)) return indexPath;
  } catch {
    // Falls through
  }

  // Strategy 2: Resolve relative to @github/copilot-sdk package location.
  // @github/copilot is a direct dependency of @github/copilot-sdk.
  try {
    const copilotSdkUrl = import.meta.resolve("@github/copilot-sdk");
    const copilotSdkDir = dirname(fileURLToPath(copilotSdkUrl));
    // Navigate from copilot-sdk's dist/ up to its package root's node_modules
    const copilotPkgPath = require.resolve("@github/copilot/sdk", {
      paths: [join(copilotSdkDir, "..")],
    });
    const indexPath = join(dirname(dirname(copilotPkgPath)), "index.js");
    if (existsSync(indexPath)) return indexPath;
  } catch {
    // Falls through
  }

  // Strategy 3: Find copilot CLI on $PATH and derive the package directory.
  // For npm global installs, the symlink resolves into the package with index.js.
  // For standalone installs (Homebrew, install script, winget), return the binary directly
  // — the SDK handles non-.js cliPaths by spawning them as executables.
  try {
    const cmd = process.platform === "win32" ? "where copilot" : "which copilot";
    const copilotBin = execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] })
      .trim()
      .split(/\r?\n/)[0]
      ?.replace(/\r$/, "");
    if (copilotBin) {
      const { realpathSync } = require("node:fs") as typeof import("node:fs");
      const realPath = realpathSync(copilotBin);
      const pkgDir = dirname(realPath);
      const indexPath = join(pkgDir, "index.js");
      if (existsSync(indexPath)) return indexPath;
      // Standalone binary (Homebrew, install script, winget) — no index.js
      if (existsSync(realPath)) return realPath;
    }
  } catch {
    // Falls through
  }

  throw new Error(
    "Cannot find @github/copilot CLI.\n\n" +
      "Install the Copilot CLI using one of:\n" +
      "  brew install copilot-cli          # macOS/Linux\n" +
      "  npm install -g @github/copilot    # macOS/Linux/Windows\n" +
      "  winget install GitHub.Copilot     # Windows\n" +
      "  curl -fsSL https://gh.io/copilot-install | bash  # macOS/Linux\n\n" +
      "Or set a custom cliPath in CopilotClientOptions.",
  );
}

/**
 * Factory function to create a CopilotClient instance
 * @param options - Client options including connection mode
 */
export function createCopilotClient(options?: CopilotClientOptions): CopilotClient {
  return new CopilotClient(options);
}

// Re-export types for backwards compatibility
export type {
  SdkSessionEvent as CopilotSdkEvent,
  SdkSessionEventType as CopilotSdkEventType,
  SdkPermissionRequest as CopilotSdkPermissionRequest,
};
