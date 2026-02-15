/**
 * ClaudeAgentClient - Implementation of CodingAgentClient for Claude Agent SDK
 *
 * This module implements the unified CodingAgentClient interface using the
 * @anthropic-ai/claude-agent-sdk package. It supports:
 * - Session creation and resumption via the query() API
 * - Streaming message responses
 * - Native SDK hooks for event handling
 * - Custom tool registration via createSdkMcpServer
 *
 * AGENT-SPECIFIC LOGIC (why this module exists):
 * - Claude SDK uses query() function instead of session objects
 * - Claude SDK has unique HookEvent system (PreToolUse, PostToolUse, etc.)
 * - Claude SDK uses MCP servers for tool registration (via createSdkMcpServer)
 * - Claude SDK permission model uses canUseTool callback and permissionMode
 * - Claude SDK event types (SDKMessage) require custom mapping to unified EventType
 * - Claude SDK uses Zod schemas internally (requires 'any' casting for compatibility)
 *
 * Common patterns (see base-client.ts) are duplicated here because:
 * - on() method extends base behavior with Claude-specific hook registration
 * - emitEvent() is tightly coupled with internal session state
 */

import {
  query,
  createSdkMcpServer,
  type Query,
  type Options,
  type SDKMessage,
  type SDKAssistantMessage,
  type SDKResultMessage,
  type SDKSystemMessage,
  type HookEvent,
  type HookCallback,
  type HookCallbackMatcher,
  type HookInput,
  type HookJSONOutput,
  type McpSdkServerConfigWithInstance,
  type McpServerStatus,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  CodingAgentClient,
  Session,
  SessionConfig,
  AgentMessage,
  ContextUsage,
  McpAuthStatus,
  McpRuntimeSnapshot,
  EventType,
  EventHandler,
  AgentEvent,
  ToolDefinition,
  ToolContext,
  MessageContentType,
} from "./types.ts";
import { stripProviderPrefix } from "./types.ts";
import { initClaudeOptions } from "./init.ts";

/**
 * Configuration for Claude SDK native hooks
 */
export interface ClaudeHookConfig {
  PreToolUse?: HookCallback[];
  PostToolUse?: HookCallback[];
  PostToolUseFailure?: HookCallback[];
  SessionStart?: HookCallback[];
  SessionEnd?: HookCallback[];
  SubagentStart?: HookCallback[];
  SubagentStop?: HookCallback[];
  Notification?: HookCallback[];
  UserPromptSubmit?: HookCallback[];
  Stop?: HookCallback[];
  PreCompact?: HookCallback[];
  PermissionRequest?: HookCallback[];
  Setup?: HookCallback[];
}

/**
 * Internal session state for tracking active queries
 */
interface ClaudeSessionState {
  query: Query | null;
  sessionId: string;
  /** SDK's session ID for resuming conversations (captured from first message) */
  sdkSessionId: string | null;
  config: SessionConfig;
  inputTokens: number;
  outputTokens: number;
  isClosed: boolean;
  /** Context window size captured from SDKResultMessage.modelUsage */
  contextWindow: number | null;
  /** System tools baseline tokens captured from cache tokens */
  systemToolsBaseline: number | null;
}

/**
 * Maps SDK event types to unified EventType
 */
function mapSdkEventToEventType(sdkMessageType: string): EventType | null {
  const mapping: Record<string, EventType> = {
    assistant: "message.complete",
    stream_event: "message.delta",
    result: "session.idle",
    system: "session.start",
  };
  return mapping[sdkMessageType] ?? null;
}

/**
 * Maps unified EventType to SDK HookEvent
 */
function mapEventTypeToHookEvent(eventType: EventType): HookEvent | null {
  const mapping: Partial<Record<EventType, HookEvent>> = {
    "session.start": "SessionStart",
    "session.idle": "SessionEnd",
    "session.error": "Stop",
    "tool.start": "PreToolUse",
    "tool.complete": "PostToolUse",
    "subagent.start": "SubagentStart",
    "subagent.complete": "SubagentStop",
  };
  return mapping[eventType] ?? null;
}

/**
 * Extracts content from SDK message.
 *
 * Handles multi-block assistant messages by scanning all content blocks.
 * Priority: tool_use > text > thinking (tool_use is prioritized so the
 * streaming layer can accurately count tool invocations even when the
 * model emits thinking or text blocks before the tool_use block).
 */
function extractMessageContent(message: SDKAssistantMessage): {
  type: MessageContentType;
  content: string | unknown;
} {
  const betaMessage = message.message;
  if (betaMessage.content.length === 0) {
    return { type: "text", content: "" };
  }

  // Scan all blocks — prioritize tool_use, then text, then thinking
  let textContent: string | null = null;
  let thinkingContent: string | null = null;

  for (const block of betaMessage.content) {
    if (block.type === "tool_use") {
      // Return immediately — tool_use has highest priority.
      // Include toolUseId so the UI can deduplicate partial messages
      // emitted by includePartialMessages (empty input → populated input).
      return {
        type: "tool_use",
        content: { name: block.name, input: block.input, toolUseId: block.id },
      };
    }
    if (block.type === "text" && textContent === null) {
      textContent = block.text;
    }
    if (block.type === "thinking" && thinkingContent === null) {
      thinkingContent = (block as { thinking: string }).thinking;
    }
  }

  if (textContent !== null) {
    return { type: "text", content: textContent };
  }

  if (thinkingContent !== null) {
    return { type: "thinking", content: thinkingContent };
  }

  return { type: "text", content: "" };
}

function mapAuthStatusFromMcpServerStatus(status: McpServerStatus["status"]): McpAuthStatus | undefined {
  if (status === "needs-auth") {
    return "Not logged in";
  }
  return undefined;
}

function normalizeClaudeModelLabel(model: string): string {
  const stripped = stripProviderPrefix(model);
  const lower = stripped.toLowerCase();

  if (
    lower === "default" ||
    lower === "opus" ||
    /(^|[-_])opus([-_]|$)/.test(lower)
  ) {
    return "opus";
  }

  if (lower === "sonnet" || /(^|[-_])sonnet([-_]|$)/.test(lower)) {
    return "sonnet";
  }

  if (lower === "haiku" || /(^|[-_])haiku([-_]|$)/.test(lower)) {
    return "haiku";
  }

  return stripped;
}

/**
 * ClaudeAgentClient implements CodingAgentClient for the Claude Agent SDK.
 *
 * Uses the query() function from the SDK to create sessions that stream
 * messages via AsyncGenerator. Supports native hooks for event handling
 * and custom tool registration via MCP servers.
 */
export class ClaudeAgentClient implements CodingAgentClient {
  readonly agentType = "claude" as const;

  private eventHandlers: Map<EventType, Set<EventHandler<EventType>>> =
    new Map();
  private sessions: Map<string, ClaudeSessionState> = new Map();
  private registeredHooks: Record<string, HookCallback[]> = {};
  private registeredTools: Map<string, McpSdkServerConfigWithInstance> =
    new Map();
  private isRunning = false;
  /** Model detected from the SDK system init message */
  private detectedModel: string | null = null;
  /** Captured context window sizes per model from SDKResultMessage.modelUsage */
  public capturedModelContextWindows: Map<string, number> = new Map();
  /** Context window captured from the start() probe query */
  private probeContextWindow: number | null = null;
  /** System tools baseline captured from the start() probe query */
  private probeSystemToolsBaseline: number | null = null;

  /**
   * Register native SDK hooks for event handling.
   * Should be called before start() to ensure hooks are active.
   */
  registerHooks(config: ClaudeHookConfig): void {
    this.registeredHooks = { ...this.registeredHooks, ...config };
  }

  /**
   * Build SDK hook configuration from registered hooks
   */
  private buildNativeHooks(): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
    const hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {};

    for (const [event, callbacks] of Object.entries(this.registeredHooks)) {
      if (callbacks && callbacks.length > 0) {
        hooks[event as HookEvent] = [{ hooks: callbacks }];
      }
    }

    return hooks;
  }

  /**
   * Build SDK options from session config
   */
  private buildSdkOptions(config: SessionConfig, sessionId?: string): Options {
    const options: Options = {
      ...initClaudeOptions(),
      model: config.model,
      maxTurns: config.maxTurns,
      maxBudgetUsd: config.maxBudgetUsd,
      maxThinkingTokens: 16384,
      hooks: this.buildNativeHooks(),
      includePartialMessages: true,
      // Use Claude Code's built-in system prompt, appending custom instructions if provided
      systemPrompt: config.systemPrompt
        ? { type: "preset", preset: "claude_code", append: config.systemPrompt }
        : { type: "preset", preset: "claude_code" },
    };

    // Add canUseTool callback for HITL (Human-in-the-loop) interactions
    // This handles AskUserQuestion and other tools requiring user approval
    options.canUseTool = async (
      toolName: string,
      toolInput: Record<string, unknown>,
      _options: { signal: AbortSignal }
    ) => {
      // Handle AskUserQuestion tool - this is the primary HITL mechanism
      if (toolName === "AskUserQuestion") {
        const input = toolInput as {
          questions?: Array<{
            header?: string;
            question: string;
            options?: Array<{ label: string; description?: string }>;
            multiSelect?: boolean;
          }>;
        };

        if (input.questions && input.questions.length > 0) {
          // Process each question and collect answers
          const answers: Record<string, string> = {};

          for (const q of input.questions) {
            // Create a promise that will be resolved when user responds
            const responsePromise = new Promise<string | string[]>((resolve) => {
              // Emit permission.requested event with question data
              this.emitEvent("permission.requested", sessionId ?? "", {
                requestId: `ask_${Date.now()}`,
                toolName: "AskUserQuestion",
                toolInput: q,
                question: q.question,
                header: q.header,
                options: q.options?.map((opt) => ({
                  label: opt.label,
                  value: opt.label,
                  description: opt.description,
                })) ?? [
                  { label: "Yes", value: "yes", description: "Approve" },
                  { label: "No", value: "no", description: "Deny" },
                ],
                multiSelect: q.multiSelect ?? false,
                respond: resolve,
              });
            });

            // Wait for user response
            const response = await responsePromise;
            answers[q.question] = Array.isArray(response) ? response.join(", ") : response;
          }

          // Return allow with updated input including answers
          return {
            behavior: "allow" as const,
            updatedInput: { ...input, answers },
          };
        }
      }

      // For other tools, allow by default (they'll use the SDK's permission system)
      return { behavior: "allow" as const, updatedInput: toolInput };
    };

    // Add MCP servers if configured
    if (config.mcpServers && config.mcpServers.length > 0) {
      options.mcpServers = {};
      for (const server of config.mcpServers) {
        if (server.url && server.type === "sse") {
          options.mcpServers[server.name] = {
            type: "sse" as const,
            url: server.url,
            headers: server.headers,
          };
        } else if (server.url) {
          options.mcpServers[server.name] = {
            type: "http" as const,
            url: server.url,
            headers: server.headers,
          };
        } else if (server.command) {
          options.mcpServers[server.name] = {
            type: "stdio" as const,
            command: server.command,
            args: server.args,
            env: server.env,
          };
        }
      }
    }

    // Add registered tools as SDK MCP servers
    for (const [name, server] of this.registeredTools) {
      if (!options.mcpServers) {
        options.mcpServers = {};
      }
      options.mcpServers[name] = server;
    }

    // Forward tool restrictions to the SDK so sub-agents only have access
    // to the tools specified in their agent definition (e.g. ["Glob", "Grep", "Read"]).
    // When config.tools is undefined, no restriction is applied (default tools).
    if (config.tools && config.tools.length > 0) {
      options.tools = config.tools;
    }

    // Always bypass permissions - Atomic handles its own permission flow
    // via canUseTool/HITL callbacks above. The initClaudeOptions() defaults
    // already set bypassPermissions, so no mapping from config is needed.
    options.permissionMode = "bypassPermissions";
    options.allowDangerouslySkipPermissions = true;

    // Defense-in-depth: explicitly allow all built-in tools so they are
    // auto-approved even if the SDK's Statsig gate
    // (tengu_disable_bypass_permissions_mode) silently downgrades
    // bypassPermissions to "default" mode at runtime.  allowedTools are
    // checked BEFORE the permission mode in the SDK's resolution chain,
    // which also prevents the sub-agent auto-deny path
    // (shouldAvoidPermissionPrompts) from rejecting tools.
    options.allowedTools = [
      "Bash",
      "Read",
      "Write",
      "Edit",
      "Glob",
      "Grep",
      "Task",
      "TodoRead",
      "TodoWrite",
      "WebFetch",
      "WebSearch",
      "NotebookEdit",
      "NotebookRead",
    ];

    // Resume session if sessionId provided
    if (config.sessionId) {
      options.resume = config.sessionId;
    }

    return options;
  }

  /**
   * Wrap a Query into a unified Session interface
   */
  private wrapQuery(
    queryInstance: Query | null,
    sessionId: string,
    config: SessionConfig
  ): Session {
    const state: ClaudeSessionState = {
      query: queryInstance,
      sessionId,
      sdkSessionId: null,
      config,
      inputTokens: 0,
      outputTokens: 0,
      isClosed: false,
      contextWindow: this.probeContextWindow,
      systemToolsBaseline: this.probeSystemToolsBaseline,
    };

    this.sessions.set(sessionId, state);

    const session: Session = {
      id: sessionId,

      send: async (message: string): Promise<AgentMessage> => {
        if (state.isClosed) {
          throw new Error("Session is closed");
        }

        // Build options with resume if we have an SDK session ID
        const options = this.buildSdkOptions(config, sessionId);
        if (state.sdkSessionId) {
          options.resume = state.sdkSessionId;
        }

        // Create a new query with the message, resuming the conversation if possible
        const newQuery = query({
          prompt: message,
          options,
        });
        state.query = newQuery;

        // Consume all messages and return the final assistant message
        let lastAssistantMessage: AgentMessage | null = null;

        for await (const sdkMessage of newQuery) {
          this.processMessage(sdkMessage, sessionId, state);

          if (sdkMessage.type === "assistant") {
            const { type, content } = extractMessageContent(sdkMessage);
            lastAssistantMessage = {
              type,
              content,
              role: "assistant",
              metadata: {
                tokenUsage: {
                  inputTokens: sdkMessage.message.usage?.input_tokens ?? 0,
                  outputTokens: sdkMessage.message.usage?.output_tokens ?? 0,
                },
                model: sdkMessage.message.model,
                stopReason: sdkMessage.message.stop_reason ?? undefined,
              },
            };
          }
        }

        return (
          lastAssistantMessage ?? {
            type: "text",
            content: "",
            role: "assistant",
          }
        );
      },

      stream: (message: string): AsyncIterable<AgentMessage> => {
        // Capture references for the async generator
        const buildOptions = () => this.buildSdkOptions(config, sessionId);
        const processMsg = (msg: SDKMessage) =>
          this.processMessage(msg, sessionId, state);
        // Capture SDK session ID for resume
        const getSdkSessionId = () => state.sdkSessionId;

        return {
          [Symbol.asyncIterator]: async function* () {
            if (state.isClosed) {
              throw new Error("Session is closed");
            }

            // Build options with resume if we have an SDK session ID
            const options = {
              ...buildOptions(),
              includePartialMessages: true,
            };
            const sdkSessionId = getSdkSessionId();
            if (sdkSessionId) {
              options.resume = sdkSessionId;
            }

            const newQuery = query({
              prompt: message,
              options,
            });
            state.query = newQuery;

            // Track if we've yielded streaming deltas to avoid duplicating content
            let hasYieldedDeltas = false;

            // Thinking block duration tracking
            let thinkingStartMs: number | null = null;
            let thinkingDurationMs = 0;
            let currentBlockIsThinking = false;
            // Output token tracking from message_delta events
            let outputTokens = 0;

            for await (const sdkMessage of newQuery) {
              processMsg(sdkMessage);

              if (sdkMessage.type === "stream_event") {
                const event = sdkMessage.event;

                // Track thinking block boundaries
                if (event.type === "content_block_start") {
                  const blockType = (event as Record<string, unknown>).content_block
                    ? ((event as Record<string, unknown>).content_block as Record<string, unknown>).type
                    : undefined;
                  currentBlockIsThinking = blockType === "thinking";
                  if (currentBlockIsThinking) {
                    thinkingStartMs = Date.now();
                  }
                }
                if (event.type === "content_block_stop" && currentBlockIsThinking) {
                  if (thinkingStartMs !== null) {
                    thinkingDurationMs += Date.now() - thinkingStartMs;
                    thinkingStartMs = null;
                  }
                  currentBlockIsThinking = false;
                  yield {
                    type: "thinking" as MessageContentType,
                    content: "",
                    role: "assistant",
                    metadata: { streamingStats: { thinkingMs: thinkingDurationMs, outputTokens } },
                  };
                }

                // Track output tokens from message_delta usage
                if (event.type === "message_delta") {
                  const usage = (event as Record<string, unknown>).usage as
                    | { output_tokens?: number }
                    | undefined;
                  if (usage?.output_tokens) {
                    outputTokens += usage.output_tokens;
                  }
                }

                if (event.type === "content_block_delta") {
                  if (event.delta.type === "text_delta") {
                    hasYieldedDeltas = true;
                    yield {
                      type: "text",
                      content: event.delta.text,
                      role: "assistant",
                    };
                  } else if (event.delta.type === "thinking_delta") {
                    hasYieldedDeltas = true;
                    const currentThinkingMs = thinkingDurationMs +
                      (thinkingStartMs !== null ? Date.now() - thinkingStartMs : 0);
                    yield {
                      type: "thinking" as MessageContentType,
                      content: (event.delta as Record<string, unknown>).thinking as string,
                      role: "assistant",
                      metadata: {
                        streamingStats: {
                          thinkingMs: currentThinkingMs,
                          outputTokens,
                        },
                      },
                    };
                  }
                }
              } else if (sdkMessage.type === "assistant") {
                const { type, content } = extractMessageContent(sdkMessage);

                // Always yield tool_use messages so callers can track tool
                // invocations (e.g. SubagentGraphBridge counts them for
                // the tree view).  Text messages are only yielded when we
                // haven't already streamed text deltas to avoid duplication.
                if (type === "tool_use") {
                  yield {
                    type,
                    content,
                    role: "assistant",
                    metadata: {
                      toolName: typeof content === "object" && content !== null
                        ? (content as Record<string, unknown>).name as string
                        : undefined,
                    },
                  };
                } else if (!hasYieldedDeltas) {
                  yield {
                    type,
                    content,
                    role: "assistant",
                    metadata: {
                      tokenUsage: {
                        inputTokens: sdkMessage.message.usage?.input_tokens ?? 0,
                        outputTokens: sdkMessage.message.usage?.output_tokens ?? 0,
                      },
                      model: sdkMessage.message.model,
                      stopReason: sdkMessage.message.stop_reason ?? undefined,
                    },
                  };
                }
              }
            }

            // Yield final metadata with actual token count and thinking duration
            if (outputTokens > 0 || thinkingDurationMs > 0) {
              yield {
                type: "text" as const,
                content: "",
                role: "assistant" as const,
                metadata: {
                  streamingStats: {
                    outputTokens,
                    thinkingMs: thinkingDurationMs,
                  },
                },
              };
            }
          },
        };
      },

      summarize: async (): Promise<void> => {
        if (state.isClosed) {
          throw new Error("Session is closed");
        }

        // Send /compact as a prompt to the Claude Agents SDK
        const options = this.buildSdkOptions(config, sessionId);
        if (state.sdkSessionId) {
          options.resume = state.sdkSessionId;
        }

        const newQuery = query({
          prompt: "/compact",
          options,
        });
        state.query = newQuery;

        // Consume all messages to complete the compaction
        for await (const sdkMessage of newQuery) {
          this.processMessage(sdkMessage, sessionId, state);
        }
      },

      getContextUsage: async (): Promise<ContextUsage> => {
        if (state.contextWindow === null) {
          throw new Error("Context window size unavailable: no query has completed. Send a message before calling getContextUsage().");
        }
        const maxTokens = state.contextWindow;
        const totalTokens = state.inputTokens + state.outputTokens;
        return {
          inputTokens: state.inputTokens,
          outputTokens: state.outputTokens,
          maxTokens,
          usagePercentage: (totalTokens / maxTokens) * 100,
        };
      },

      getSystemToolsTokens: (): number => {
        if (state.systemToolsBaseline === null) {
          throw new Error("System tools baseline unavailable: no query has completed. Send a message first.");
        }
        return state.systemToolsBaseline;
      },

      getMcpSnapshot: async (): Promise<McpRuntimeSnapshot | null> => {
        if (state.isClosed) {
          return null;
        }

        let statusQuery: Query | null = null;
        let shouldClose = false;

        try {
          if (state.sdkSessionId) {
            const options = this.buildSdkOptions(config, sessionId);
            options.resume = state.sdkSessionId;
            options.maxTurns = 0;
            statusQuery = query({ prompt: "", options });
            shouldClose = true;
          } else if (state.query) {
            statusQuery = state.query;
          } else {
            return null;
          }

          const statusList = await statusQuery.mcpServerStatus();
          const servers: McpRuntimeSnapshot["servers"] = {};
          for (const status of statusList) {
            const authStatus = mapAuthStatusFromMcpServerStatus(status.status);
            servers[status.name] = {
              ...(authStatus ? { authStatus } : {}),
              tools: status.tools?.map((tool) => tool.name).filter((name) => name.length > 0) ?? [],
            };
          }
          return { servers };
        } catch {
          return null;
        } finally {
          if (shouldClose) {
            statusQuery?.close();
          }
        }
      },

      destroy: async (): Promise<void> => {
        if (!state.isClosed) {
          state.isClosed = true;
          state.query?.close();
          this.sessions.delete(sessionId);
          this.emitEvent("session.idle", sessionId, { reason: "destroyed" });
        }
      },
    };

    return session;
  }

  /**
   * Process an SDK message and emit corresponding events
   */
  private processMessage(
    sdkMessage: SDKMessage,
    sessionId: string,
    state: ClaudeSessionState
  ): void {
    // Capture SDK session ID from any message that has it
    // This is needed to resume the conversation in subsequent queries
    if (!state.sdkSessionId && "session_id" in sdkMessage) {
      const msgWithSessionId = sdkMessage as { session_id?: string };
      if (msgWithSessionId.session_id) {
        state.sdkSessionId = msgWithSessionId.session_id;
      }
    }

    // Capture model from system init message
    if (sdkMessage.type === "system" && sdkMessage.subtype === "init") {
      const systemMsg = sdkMessage as SDKSystemMessage;
      if (systemMsg.model && !this.detectedModel) {
        this.detectedModel = systemMsg.model;
      }
    }

    // Track token usage
    if (sdkMessage.type === "assistant") {
      const usage = sdkMessage.message.usage;
      if (usage) {
        state.inputTokens = usage.input_tokens;
        state.outputTokens = usage.output_tokens;
      }
    }

    // Map and emit events
    const eventType = mapSdkEventToEventType(sdkMessage.type);
    if (eventType) {
      this.emitEvent(eventType, sessionId, { sdkMessage });
    }

    // Handle specific message types
    if (sdkMessage.type === "result") {
      const result = sdkMessage as SDKResultMessage;
      if (result.subtype === "error_max_turns") {
        this.emitEvent("session.error", sessionId, {
          error: "Maximum turns exceeded",
          code: "MAX_TURNS",
        });
      } else if (result.subtype === "error_max_budget_usd") {
        this.emitEvent("session.error", sessionId, {
          error: "Budget exceeded",
          code: "MAX_BUDGET",
        });
      }

      // Extract contextWindow and systemToolsBaseline from modelUsage
      if (result.modelUsage) {
        const modelKey = this.detectedModel ?? Object.keys(result.modelUsage)[0];
        if (modelKey && result.modelUsage[modelKey]) {
          const mu = result.modelUsage[modelKey];
          if (mu.contextWindow != null) {
            state.contextWindow = mu.contextWindow;
            this.capturedModelContextWindows.set(modelKey, mu.contextWindow);
          }
          state.systemToolsBaseline = mu.cacheCreationInputTokens > 0
            ? mu.cacheCreationInputTokens
            : mu.cacheReadInputTokens;
        }
        // Populate capturedModelContextWindows for all models in usage
        for (const [key, mu] of Object.entries(result.modelUsage)) {
          if (mu.contextWindow != null) {
            this.capturedModelContextWindows.set(key, mu.contextWindow);
          }
        }
      }
    }
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
    if (!handlers) return;

    const event: AgentEvent<T> = {
      type: eventType,
      sessionId,
      timestamp: new Date().toISOString(),
      data: data as AgentEvent<T>["data"],
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
   * Create a new agent session
   */
  async createSession(config: SessionConfig = {}): Promise<Session> {
    if (!this.isRunning) {
      throw new Error("Client not started. Call start() first.");
    }

    const sessionId =
      config.sessionId ?? `claude-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Don't create an initial query here — send()/stream() each create
    // their own query with the actual user message.  Previously an empty-prompt
    // query was spawned here, which leaked a Claude Code subprocess that was
    // never consumed.

    // Emit session start event
    this.emitEvent("session.start", sessionId, { config });

    return this.wrapQuery(null, sessionId, config);
  }

  /**
   * Resume an existing session by ID
   */
  async resumeSession(sessionId: string): Promise<Session | null> {
    if (!this.isRunning) {
      throw new Error("Client not started. Call start() first.");
    }

    // Check if session is already active
    const existingState = this.sessions.get(sessionId);
    if (existingState && !existingState.isClosed) {
      return this.wrapQuery(
        existingState.query,
        sessionId,
        existingState.config
      );
    }

    // Try to resume from SDK — use buildSdkOptions() so that
    // permissionMode, allowedTools, canUseTool, and settingSources are
    // all present (a bare Options object would fall back to "default"
    // mode which causes sub-agent tool denials).
    try {
      const options = this.buildSdkOptions({}, sessionId);
      options.resume = sessionId;

      const queryInstance = query({ prompt: "", options });

      return this.wrapQuery(queryInstance, sessionId, {});
    } catch (error) {
      console.warn(`Failed to resume session ${sessionId}:`, error);
      return null;
    }
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

    // Track all hook callbacks added by this on() call so they can be
    // removed on unsubscribe (prevents hook accumulation across session resets)
    const addedHooks: Array<{ event: string; callback: HookCallback }> = [];

    // Also register as native hook if applicable
    const hookEvent = mapEventTypeToHookEvent(eventType);
    if (hookEvent) {
      // Factory: creates a hook callback that maps SDK HookInput to a unified
      // AgentEvent and forwards it to the registered handler.
      // `targetHookEvent` controls the `success` flag — "PostToolUseFailure"
      // sets success=false so the UI knows the tool errored.
      const createHookCallback = (targetHookEvent: string): HookCallback => {
        return async (
          input: HookInput,
          toolUseID: string | undefined,
          _options: { signal: AbortSignal }
        ): Promise<HookJSONOutput> => {
          // Map hook input to the expected event data format
          // The HookInput has fields like tool_name, tool_input, tool_result
          // but the UI expects toolName, toolInput, toolResult
          const hookInput = input as Record<string, unknown>;
          const eventData: Record<string, unknown> = {
            hookInput: input,
            toolUseID,
          };

          // Map tool-related fields for tool.start and tool.complete events
          if (hookInput.tool_name) {
            eventData.toolName = hookInput.tool_name;
          }
          if (hookInput.tool_input !== undefined) {
            eventData.toolInput = hookInput.tool_input;
          }
          // PostToolUse hook provides tool_response (not tool_result)
          if (hookInput.tool_response !== undefined) {
            eventData.toolResult = hookInput.tool_response;
          }
          // PostToolUse hook means success, PostToolUseFailure means failure
          eventData.success = targetHookEvent !== "PostToolUseFailure";
          if (hookInput.error) {
            eventData.error = hookInput.error;
          }

          // Map subagent-specific fields for subagent.start and subagent.complete events
          // SubagentStartHookInput: { agent_id, agent_type }
          // SubagentStopHookInput: { agent_id, agent_transcript_path }
          if (hookInput.agent_id) {
            eventData.subagentId = hookInput.agent_id;
          }
          if (hookInput.agent_type) {
            eventData.subagentType = hookInput.agent_type;
          }
          if (targetHookEvent === "SubagentStop") {
            // SubagentStop implies successful completion
            eventData.success = true;
          }

          const event: AgentEvent<T> = {
            type: eventType,
            sessionId: input.session_id,
            timestamp: new Date().toISOString(),
            data: eventData as AgentEvent<T>["data"],
          };

          try {
            await handler(event);
          } catch (error) {
            console.error(`Error in hook handler for ${eventType}:`, error);
          }

          return { continue: true };
        };
      };

      const hookCallback = createHookCallback(hookEvent);
      if (!this.registeredHooks[hookEvent]) {
        this.registeredHooks[hookEvent] = [];
      }
      this.registeredHooks[hookEvent]!.push(hookCallback);
      addedHooks.push({ event: hookEvent, callback: hookCallback });

      // For tool.complete events, also register a PostToolUseFailure hook
      // so that failed tools are properly reported as completed with an error
      // instead of remaining stuck in "running" status forever.
      if (hookEvent === "PostToolUse") {
        const failureCallback = createHookCallback("PostToolUseFailure");
        if (!this.registeredHooks["PostToolUseFailure"]) {
          this.registeredHooks["PostToolUseFailure"] = [];
        }
        this.registeredHooks["PostToolUseFailure"]!.push(failureCallback);
        addedHooks.push({ event: "PostToolUseFailure", callback: failureCallback });
      }
    }

    return () => {
      handlers?.delete(handler as EventHandler<EventType>);
      // Remove all hook callbacks added by this on() call to prevent
      // accumulation across session resets (e.g., after /clear)
      for (const { event, callback } of addedHooks) {
        const hooks = this.registeredHooks[event];
        if (hooks) {
          const idx = hooks.indexOf(callback);
          if (idx !== -1) {
            hooks.splice(idx, 1);
          }
        }
      }
    };
  }

  /**
   * Register a custom tool
   *
   * Note: The Claude SDK uses Zod schemas for type validation. This method
   * accepts a JSON schema-like inputSchema for interface compatibility, but
   * internally the tool is registered without strict schema validation.
   * For full Zod schema support, use registerHooks with custom PreToolUse hooks.
   */
  registerTool(tool: ToolDefinition): void {
    // Create an SDK-compatible tool definition
    // The SDK expects Zod schemas, but we use 'any' for interface compatibility
    const sdkToolDef = {
      name: tool.name,
      description: tool.description,
      // Use empty Zod schema - actual validation happens in handler
      inputSchema: {},
      handler: async (args: unknown, _extra: unknown) => {
        try {
          const context: ToolContext = {
            sessionID: this.sessions.keys().next().value ?? "",
            messageID: "",
            agent: "claude",
            directory: process.cwd(),
            abort: new AbortController().signal,
          };
          const result = await tool.handler(args as Record<string, unknown>, context);
          return {
            content: [
              {
                type: "text" as const,
                text:
                  typeof result === "string" ? result : JSON.stringify(result),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      },
    };

    const mcpServer = createSdkMcpServer({
      name: `tool-${tool.name}`,
      // Use 'any' to bypass strict Zod type checking
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: [sdkToolDef as any],
    });

    this.registeredTools.set(tool.name, mcpServer);
  }

  /**
   * List supported models via the Claude SDK's supportedModels() API.
   * Uses an existing active session's query if available, otherwise creates a temporary one.
   */
  async listSupportedModels(): Promise<Array<{ value: string; displayName: string; description: string }>> {
    if (!this.isRunning) {
      throw new Error("Client not started. Call start() first.");
    }

    // Reuse an existing active session's query if available
    for (const state of this.sessions.values()) {
      if (!state.isClosed && state.query) {
        return await state.query.supportedModels();
      }
    }

    // No active session — create a temporary query for model listing
    const tempQuery = query({ prompt: '', options: { maxTurns: 0 } });
    try {
      return await tempQuery.supportedModels();
    } finally {
      tempQuery.close();
    }
  }

  /**
   * Switch model for the active Claude session while preserving history.
   *
   * This client uses turn-scoped queries (send/stream each create a new Query),
   * so persisting the model on session config is sufficient for future turns.
   * Calling query.setModel() on the previous Query instance is unsafe because
   * its underlying transport may already be closed between turns.
   */
  async setActiveSessionModel(model: string): Promise<void> {
    const targetModel = stripProviderPrefix(model).trim();
    if (!targetModel) {
      throw new Error("Model ID cannot be empty.");
    }
    if (targetModel.toLowerCase() === "default") {
      throw new Error("Model 'default' is not supported for Claude. Use one of: opus, sonnet, haiku.");
    }

    // Use the most recently created active session as the primary chat session.
    const activeSessions = Array.from(this.sessions.values()).filter((state) => !state.isClosed);
    const activeSession = activeSessions[activeSessions.length - 1];

    if (!activeSession) {
      return;
    }

    activeSession.config.model = targetModel;
  }

  /**
   * Start the client
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      return; // Already running
    }
    this.isRunning = true;

    // Probe the SDK to detect the default model from the system init message
    // This makes a lightweight query that doesn't require actual user input
    try {
      const probeQuery = query({
        prompt: "",
        options: {
          maxTurns: 0, // Don't allow any turns - just get init message
        },
      });

      // Read the first message (should be system init)
      for await (const msg of probeQuery) {
        if (msg.type === "system" && msg.subtype === "init") {
          const systemMsg = msg as SDKSystemMessage;
          if (systemMsg.model) {
            this.detectedModel = systemMsg.model;
          }
        }

        // Capture contextWindow and systemToolsBaseline from result
        if (msg.type === "result") {
          const result = msg as SDKResultMessage;
          if (result.modelUsage) {
            const modelKey = this.detectedModel ?? Object.keys(result.modelUsage)[0];
            if (modelKey && result.modelUsage[modelKey]) {
              const mu = result.modelUsage[modelKey];
              if (mu.contextWindow != null) {
                this.probeContextWindow = mu.contextWindow;
                this.capturedModelContextWindows.set(modelKey, mu.contextWindow);
              }
              this.probeSystemToolsBaseline = mu.cacheCreationInputTokens > 0
                ? mu.cacheCreationInputTokens
                : mu.cacheReadInputTokens;
            }
            for (const [key, mu] of Object.entries(result.modelUsage)) {
              if (mu.contextWindow != null) {
                this.capturedModelContextWindows.set(key, mu.contextWindow);
              }
            }
          }
          break;
        }
      }
      probeQuery.close();
    } catch {
      // Probe failed - will fall back to "Claude" in getModelDisplayInfo
    }
  }

  /**
   * Stop the client and clean up resources
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return; // Already stopped
    }
    this.isRunning = false;

    // Close all active sessions
    for (const [_sessionId, state] of this.sessions) {
      if (!state.isClosed) {
        state.isClosed = true;
        state.query?.close();
      }
    }

    this.sessions.clear();
    this.eventHandlers.clear();
  }

  /**
   * Get model display information for UI rendering.
   * Uses the model detected from the SDK system init message as the
   * authoritative source. Falls back to modelHint (raw, unformatted).
   * @param modelHint - Optional model ID from saved preferences
   */
  async getModelDisplayInfo(
    modelHint?: string
  ): Promise<{ model: string; tier: string; contextWindow?: number }> {
    // Prefer explicit hint (user's /model choice), then detected model from SDK probe, then raw fallback
    const raw = (modelHint ? stripProviderPrefix(modelHint) : null)
      ?? this.detectedModel;
    const modelKey = raw ?? "Claude";
    const displayModel = normalizeClaudeModelLabel(modelKey);
    const contextWindow =
      this.capturedModelContextWindows.get(modelKey)
      ?? this.capturedModelContextWindows.get(displayModel)
      ?? this.probeContextWindow
      ?? undefined;

    return {
      model: displayModel,
      tier: "Claude Code",
      contextWindow,
    };
  }

  /**
   * Get the system tools token baseline captured during start() probe.
   */
  getSystemToolsTokens(): number | null {
    return this.probeSystemToolsBaseline;
  }
}

/**
 * Factory function to create a ClaudeAgentClient instance
 */
export function createClaudeAgentClient(): ClaudeAgentClient {
  return new ClaudeAgentClient();
}
