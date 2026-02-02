/**
 * ClaudeAgentClient - Implementation of CodingAgentClient for Claude Agent SDK
 *
 * This module implements the unified CodingAgentClient interface using the
 * @anthropic-ai/claude-agent-sdk package. It supports:
 * - Session creation and resumption via the query() API
 * - Streaming message responses
 * - Native SDK hooks for event handling
 * - Custom tool registration via createSdkMcpServer
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
} from "@anthropic-ai/claude-agent-sdk";
import type {
  CodingAgentClient,
  Session,
  SessionConfig,
  AgentMessage,
  ContextUsage,
  EventType,
  EventHandler,
  AgentEvent,
  ToolDefinition,
  MessageContentType,
} from "./types.ts";
import { formatModelDisplayName } from "./types.ts";

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
  query: Query;
  sessionId: string;
  /** SDK's session ID for resuming conversations (captured from first message) */
  sdkSessionId: string | null;
  config: SessionConfig;
  inputTokens: number;
  outputTokens: number;
  isClosed: boolean;
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
 * Extracts content from SDK message
 */
function extractMessageContent(message: SDKAssistantMessage): {
  type: MessageContentType;
  content: string | unknown;
} {
  const betaMessage = message.message;
  if (betaMessage.content.length === 0) {
    return { type: "text", content: "" };
  }

  const firstBlock = betaMessage.content[0];
  if (!firstBlock) {
    return { type: "text", content: "" };
  }

  if (firstBlock.type === "text") {
    return { type: "text", content: firstBlock.text };
  }

  if (firstBlock.type === "tool_use") {
    return {
      type: "tool_use",
      content: { name: firstBlock.name, input: firstBlock.input },
    };
  }

  if (firstBlock.type === "thinking") {
    return { type: "thinking", content: firstBlock.thinking };
  }

  return { type: "text", content: "" };
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
  private registeredHooks: ClaudeHookConfig = {};
  private registeredTools: Map<string, McpSdkServerConfigWithInstance> =
    new Map();
  private isRunning = false;
  /** Model detected from the SDK system init message */
  private detectedModel: string | null = null;

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
      model: config.model,
      maxTurns: config.maxTurns,
      maxBudgetUsd: config.maxBudgetUsd,
      hooks: this.buildNativeHooks(),
      includePartialMessages: true,
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
        options.mcpServers[server.name] = {
          type: "stdio",
          command: server.command,
          args: server.args,
          env: server.env,
        };
      }
    }

    // Add registered tools as SDK MCP servers
    for (const [name, server] of this.registeredTools) {
      if (!options.mcpServers) {
        options.mcpServers = {};
      }
      options.mcpServers[name] = server;
    }

    // Map permission mode
    if (config.permissionMode) {
      const permissionMap: Record<string, Options["permissionMode"]> = {
        auto: "acceptEdits",
        prompt: "default",
        deny: "dontAsk",
      };
      options.permissionMode = permissionMap[config.permissionMode];
    }

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
    queryInstance: Query,
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

            // Track if we've yielded streaming deltas to avoid duplicating content
            let hasYieldedDeltas = false;

            for await (const sdkMessage of newQuery) {
              processMsg(sdkMessage);

              if (sdkMessage.type === "stream_event") {
                const event = sdkMessage.event;
                if (
                  event.type === "content_block_delta" &&
                  event.delta.type === "text_delta"
                ) {
                  hasYieldedDeltas = true;
                  yield {
                    type: "text",
                    content: event.delta.text,
                    role: "assistant",
                  };
                }
              } else if (sdkMessage.type === "assistant") {
                // Only yield the complete message if we haven't streamed deltas
                // (deltas already contain the full content incrementally)
                if (!hasYieldedDeltas) {
                  const { type, content } = extractMessageContent(sdkMessage);
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
          },
        };
      },

      summarize: async (): Promise<void> => {
        // Claude SDK doesn't have a direct summarize method
        // Context compaction happens automatically or via hooks
        // We emit a PreCompact hook trigger if registered
        console.warn(
          "ClaudeAgentClient.summarize(): Context compaction is handled automatically by the SDK"
        );
      },

      getContextUsage: async (): Promise<ContextUsage> => {
        // Calculate from tracked usage
        const totalTokens = state.inputTokens + state.outputTokens;
        const maxTokens = 200000; // Default context window
        return {
          inputTokens: state.inputTokens,
          outputTokens: state.outputTokens,
          maxTokens,
          usagePercentage: (totalTokens / maxTokens) * 100,
        };
      },

      destroy: async (): Promise<void> => {
        if (!state.isClosed) {
          state.isClosed = true;
          state.query.close();
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
        state.inputTokens += usage.input_tokens;
        state.outputTokens += usage.output_tokens;
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

    // Create initial query with system prompt if provided
    const prompt = config.systemPrompt ?? "";
    const options = this.buildSdkOptions({ ...config, sessionId }, sessionId);

    const queryInstance = query({ prompt, options });

    // Emit session start event
    this.emitEvent("session.start", sessionId, { config });

    return this.wrapQuery(queryInstance, sessionId, config);
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

    // Try to resume from SDK
    try {
      const options: Options = {
        resume: sessionId,
        hooks: this.buildNativeHooks(),
        includePartialMessages: true,
      };

      // Add registered tools
      if (this.registeredTools.size > 0) {
        options.mcpServers = {};
        for (const [name, server] of this.registeredTools) {
          options.mcpServers[name] = server;
        }
      }

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

    // Also register as native hook if applicable
    const hookEvent = mapEventTypeToHookEvent(eventType);
    if (hookEvent) {
      const hookCallback: HookCallback = async (
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
        eventData.success = hookEvent !== "PostToolUseFailure";
        if (hookInput.error) {
          eventData.error = hookInput.error;
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

      if (!this.registeredHooks[hookEvent]) {
        this.registeredHooks[hookEvent] = [];
      }
      this.registeredHooks[hookEvent]!.push(hookCallback);
    }

    return () => {
      handlers?.delete(handler as EventHandler<EventType>);
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
          const result = await tool.handler(args);
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
          // Got what we need, stop reading
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
        state.query.close();
      }
    }

    this.sessions.clear();
    this.eventHandlers.clear();
  }

  /**
   * Get model display information for UI rendering.
   * Uses the model hint if provided, otherwise uses the model detected from
   * the SDK system init message, or falls back to "Claude".
   * @param modelHint - Optional model ID to format for display
   */
  async getModelDisplayInfo(
    modelHint?: string
  ): Promise<{ model: string; tier: string }> {
    // Priority: modelHint > detectedModel > default "Claude"
    const modelId = modelHint || this.detectedModel;
    const model = modelId ? formatModelDisplayName(modelId) : "Claude";
    return {
      model,
      tier: "Claude Code",
    };
  }
}

/**
 * Factory function to create a ClaudeAgentClient instance
 */
export function createClaudeAgentClient(): ClaudeAgentClient {
  return new ClaudeAgentClient();
}
