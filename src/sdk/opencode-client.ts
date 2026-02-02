/**
 * OpenCodeClient - Implementation of CodingAgentClient for OpenCode SDK
 *
 * This module implements the unified CodingAgentClient interface for the
 * OpenCode AI coding agent using the @opencode-ai/sdk package.
 *
 * Features:
 * - Session creation and resumption
 * - Streaming message responses via SSE
 * - Context compaction via summarize()
 * - Event subscription
 * - Health checks and connection management
 *
 * Permission Configuration:
 * OpenCode permissions are configured via opencode.json files, not SDK options.
 * To bypass all permission prompts (all tools auto-execute), create an opencode.json:
 *
 * ```json
 * {
 *   "$schema": "https://opencode.ai/config.json",
 *   "permission": "allow"
 * }
 * ```
 *
 * Config locations (in order of precedence):
 * - Project root: opencode.json
 * - Global: ~/.config/opencode/opencode.json
 * - Env var: OPENCODE_CONFIG path
 *
 * Note: When running in non-interactive/CLI mode, OpenCode auto-approves all
 * permissions by default. The question.asked events are still emitted for
 * user-initiated questions (like AskUserQuestion tool).
 */

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
  OpenCodeAgentMode,
} from "./types.ts";

// Import the real SDK
import {
  createOpencodeClient as createSdkClient,
  type OpencodeClient as SdkClient,
  type OpencodeClientConfig,
} from "@opencode-ai/sdk/v2/client";
import {
  createOpencodeServer,
  type ServerOptions as SdkServerOptions,
} from "@opencode-ai/sdk/v2/server";

/**
 * Type alias for OpenCode SDK event type
 * Used by opencode-hooks.ts for event handlers
 *
 * This is a simplified type covering the events we care about.
 * The full SDK Event type is a union of 40+ event types.
 */
export interface OpenCodeSdkEvent {
  type: string;
  properties?: {
    sessionID?: string;
    info?: {
      id?: string;
      title?: string;
    };
    status?: "idle" | "busy" | "retry";
    error?: string;
    part?: {
      type: string;
      content?: string;
      tool?: string;
      state?: unknown;
    };
    delta?: string;
    [key: string]: unknown;
  };
}

/**
 * Default OpenCode server configuration
 */
const DEFAULT_OPENCODE_BASE_URL = "http://localhost:4096";
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY = 1000;

/**
 * Options for creating an OpenCode client
 */
export interface OpenCodeClientOptions {
  /** Base URL for OpenCode server (default: http://localhost:4096) */
  baseUrl?: string;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Working directory for the OpenCode server */
  directory?: string;
  /** Maximum retry attempts for connection */
  maxRetries?: number;
  /** Delay between retries in milliseconds */
  retryDelay?: number;
  /** Default agent mode for new sessions (default: "build") */
  defaultAgentMode?: OpenCodeAgentMode;
  /** Auto-start OpenCode server if not running (default: true) */
  autoStart?: boolean;
  /** Port for server when auto-starting (default: 4096) */
  port?: number;
  /** Hostname for server when auto-starting (default: localhost) */
  hostname?: string;
}

/**
 * Health check response from OpenCode server
 */
export interface OpenCodeHealthStatus {
  healthy: boolean;
  version?: string;
  uptime?: number;
  error?: string;
}

/**
 * OpenCodeClient implements CodingAgentClient for the OpenCode SDK.
 *
 * This client wraps the @opencode-ai/sdk to provide a unified interface
 * for session management, message streaming, and event handling.
 */
export class OpenCodeClient implements CodingAgentClient {
  readonly agentType = "opencode" as const;

  private sdkClient: SdkClient | null = null;
  private clientOptions: OpenCodeClientOptions;
  private eventHandlers: Map<EventType, Set<EventHandler<EventType>>> =
    new Map();
  private activeSessions: Set<string> = new Set();
  private registeredTools: Map<string, ToolDefinition> = new Map();
  private isRunning = false;
  private isConnected = false;
  private currentSessionId: string | null = null;
  private eventSubscriptionController: AbortController | null = null;
  private serverCloseCallback: (() => void) | null = null;
  private isServerSpawned = false;

  /**
   * Create a new OpenCodeClient
   * @param options - Client options
   */
  constructor(options: OpenCodeClientOptions = {}) {
    this.clientOptions = {
      baseUrl: DEFAULT_OPENCODE_BASE_URL,
      maxRetries: DEFAULT_MAX_RETRIES,
      retryDelay: DEFAULT_RETRY_DELAY,
      ...options,
    };
  }

  /**
   * Check if the OpenCode server is healthy and reachable
   * @returns Health status of the OpenCode server
   */
  async healthCheck(): Promise<OpenCodeHealthStatus> {
    try {
      if (!this.sdkClient) {
        // Create temporary client for health check
        const tempClient = createSdkClient({
          baseUrl: this.clientOptions.baseUrl,
          directory: this.clientOptions.directory,
        });
        const result = await tempClient.global.health();
        if (result.error) {
          return {
            healthy: false,
            error: String(result.error),
          };
        }
        return {
          healthy: true,
          version: result.data?.version,
        };
      }

      const result = await this.sdkClient.global.health();
      if (result.error) {
        return {
          healthy: false,
          error: String(result.error),
        };
      }
      return {
        healthy: true,
        version: result.data?.version,
      };
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Connect to the OpenCode server with retry logic
   * @returns True if connection successful
   * @throws Error if connection fails after all retries
   */
  async connect(): Promise<boolean> {
    if (this.isConnected) {
      return true;
    }

    const maxRetries = this.clientOptions.maxRetries ?? DEFAULT_MAX_RETRIES;
    const retryDelay = this.clientOptions.retryDelay ?? DEFAULT_RETRY_DELAY;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Create the SDK client
        this.sdkClient = createSdkClient({
          baseUrl: this.clientOptions.baseUrl,
          directory: this.clientOptions.directory,
        });

        // Verify connection with health check
        const health = await this.healthCheck();
        if (health.healthy) {
          this.isConnected = true;
          this.emitEvent("session.start", "connection", {
            config: { baseUrl: this.clientOptions.baseUrl },
          });
          return true;
        }

        throw new Error(health.error ?? "Health check failed");
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        if (attempt === maxRetries) {
          this.emitEvent("session.error", "connection", {
            error: `Failed to connect after ${maxRetries} attempts: ${errorMsg}`,
          });
          throw new Error(
            `Failed to connect to OpenCode server at ${this.clientOptions.baseUrl}: ${errorMsg}`
          );
        }

        // Wait before retry
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }
    }

    return false;
  }

  /**
   * Disconnect from the OpenCode server
   */
  async disconnect(): Promise<void> {
    if (this.eventSubscriptionController) {
      this.eventSubscriptionController.abort();
      this.eventSubscriptionController = null;
    }

    // Close all active sessions
    for (const sessionId of this.activeSessions) {
      try {
        if (this.sdkClient) {
          await this.sdkClient.session.delete({
            sessionID: sessionId,
            directory: this.clientOptions.directory,
          });
        }
      } catch {
        // Ignore errors during cleanup
      }
    }
    this.activeSessions.clear();

    this.isConnected = false;
    this.sdkClient = null;
    this.currentSessionId = null;

    this.emitEvent("session.idle", "connection", { reason: "disconnected" });
  }

  /**
   * Get current session ID
   */
  getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }

  /**
   * List all sessions from the OpenCode server
   */
  async listSessions(): Promise<
    Array<{ id: string; title?: string; createdAt?: number }>
  > {
    if (!this.sdkClient) {
      return [];
    }

    const result = await this.sdkClient.session.list({
      directory: this.clientOptions.directory,
    });

    if (result.error || !result.data) {
      return [];
    }

    return (
      result.data as Array<{
        id: string;
        title?: string;
        time?: { created?: number };
      }>
    ).map((session) => ({
      id: session.id,
      title: session.title,
      createdAt: session.time?.created,
    }));
  }

  /**
   * Subscribe to SSE events from OpenCode server
   */
  private async subscribeToSdkEvents(): Promise<void> {
    if (!this.sdkClient) return;

    try {
      this.eventSubscriptionController = new AbortController();

      const result = await this.sdkClient.event.subscribe({
        directory: this.clientOptions.directory,
      });

      // The SDK returns { stream: AsyncGenerator } - extract the stream
      const eventStream = result.stream;

      // Process events in background
      this.processEventStream(eventStream).catch((error) => {
        // Only log if not aborted
        if (error?.name !== "AbortError") {
          console.error("SSE event stream error:", error);
        }
      });
    } catch (error) {
      console.error("Failed to subscribe to events:", error);
    }
  }

  /**
   * Process SSE event stream
   */
  private async processEventStream(
    eventStream: AsyncGenerator<unknown, unknown, unknown>
  ): Promise<void> {
    try {
      for await (const event of eventStream) {
        if (this.eventSubscriptionController?.signal.aborted) {
          break;
        }
        this.handleSdkEvent(event as Record<string, unknown>);
      }
    } catch (error) {
      if ((error as Error)?.name !== "AbortError") {
        throw error;
      }
    }
  }

  /**
   * Handle events from SDK and map to unified event types
   */
  private handleSdkEvent(event: Record<string, unknown>): void {
    const eventType = event.type as string;
    const properties = event.properties as Record<string, unknown> | undefined;

    // Map SDK events to unified events
    switch (eventType) {
      case "session.created":
        this.emitEvent(
          "session.start",
          (properties?.sessionID as string) ?? "",
          {
            config: {},
          }
        );
        break;

      case "session.idle":
        this.emitEvent(
          "session.idle",
          (properties?.sessionID as string) ?? "",
          {
            reason: "idle",
          }
        );
        break;

      case "session.error":
        this.emitEvent(
          "session.error",
          (properties?.sessionID as string) ?? "",
          {
            error: properties?.error ?? "Unknown error",
          }
        );
        break;

      case "message.updated": {
        // Handle message updates (info contains the message)
        const info = properties?.info as Record<string, unknown> | undefined;
        if (info?.role === "assistant") {
          this.emitEvent(
            "message.complete",
            (info?.sessionID as string) ?? "",
            {
              message: info,
            }
          );
        }
        break;
      }

      case "message.part.updated": {
        // Handle streaming text parts
        const part = properties?.part as Record<string, unknown> | undefined;
        const delta = properties?.delta as string | undefined;
        // Session ID is in properties, not in part
        const partSessionId = (properties?.sessionID as string) ?? (part?.sessionID as string) ?? "";
        if (part?.type === "text" && delta) {
          this.emitEvent("message.delta", partSessionId, {
            delta,
            contentType: "text",
          });
        } else if (part?.type === "tool") {
          const toolState = part?.state as Record<string, unknown> | undefined;
          const toolName = (part?.tool as string) ?? "";
          const toolInput = (toolState?.input as Record<string, unknown>) ?? {};

          // Emit tool.start for pending or running status
          // OpenCode sends "pending" first, then "running" with more complete input
          if (toolState?.status === "pending" || toolState?.status === "running") {
            this.emitEvent("tool.start", partSessionId, {
              toolName,
              toolInput,
            });
          } else if (
            toolState?.status === "completed" ||
            toolState?.status === "error"
          ) {
            this.emitEvent("tool.complete", partSessionId, {
              toolName,
              toolResult: toolState?.output,
              toolInput, // Also include input in complete event for UI update
              success: toolState?.status === "completed",
            });
          }
        }
        break;
      }

      case "question.asked": {
        // Handle HITL (Human-in-the-Loop) question requests from OpenCode
        // Map OpenCode's question format to our unified permission.requested event
        this.handleQuestionAsked(properties);
        break;
      }
    }
  }

  /**
   * Handle OpenCode's question.asked event (HITL)
   * Maps the OpenCode question format to our unified permission.requested event
   */
  private handleQuestionAsked(properties: Record<string, unknown> | undefined): void {
    if (!properties) return;

    const requestId = properties.id as string;
    const sessionId = properties.sessionID as string;
    const questions = properties.questions as Array<{
      question: string;
      header?: string;
      options: Array<{ label: string; description?: string }>;
      multiple?: boolean;
      custom?: boolean;
    }> | undefined;

    if (!requestId || !questions || questions.length === 0) return;

    // OpenCode can ask multiple questions at once, but our UI handles one at a time
    // For now, we'll process the first question and queue any additional ones
    const firstQuestion = questions[0];
    if (!firstQuestion) return;

    // Map OpenCode question format to our unified format
    const options = firstQuestion.options.map((opt) => ({
      label: opt.label,
      value: opt.label, // OpenCode uses labels as values
      description: opt.description,
    }));

    // Create a respond callback that calls the OpenCode SDK
    const respond = (answer: string | string[]) => {
      // Convert answer to the format expected by OpenCode SDK
      // OpenCode expects Array<QuestionAnswer> where QuestionAnswer = Array<string>
      const answers = Array.isArray(answer) ? [answer] : [[answer]];

      if (this.sdkClient) {
        // Check if the answer indicates rejection (user cancelled)
        if (answer === "deny" || (Array.isArray(answer) && answer.includes("deny"))) {
          this.sdkClient.question.reject({
            requestID: requestId,
            directory: this.clientOptions.directory,
          }).catch((error) => {
            console.error("Failed to reject question:", error);
          });
        } else {
          this.sdkClient.question.reply({
            requestID: requestId,
            directory: this.clientOptions.directory,
            answers,
          }).catch((error) => {
            console.error("Failed to reply to question:", error);
          });
        }
      }
    };

    // Emit permission.requested event to show the dialog
    this.emitEvent("permission.requested", sessionId ?? "", {
      requestId,
      toolName: "question",
      question: firstQuestion.question,
      header: firstQuestion.header,
      options,
      multiSelect: firstQuestion.multiple ?? false,
      respond,
    });
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
   * Create a new agent session
   */
  async createSession(config: SessionConfig = {}): Promise<Session> {
    if (!this.isRunning || !this.sdkClient) {
      throw new Error("Client not started. Call start() first.");
    }

    const result = await this.sdkClient.session.create({
      directory: this.clientOptions.directory,
      title: config.sessionId ?? undefined,
    });

    if (result.error || !result.data) {
      throw new Error(
        `Failed to create session: ${result.error ?? "Unknown error"}`
      );
    }

    const sessionId = result.data.id;
    this.currentSessionId = sessionId;
    this.activeSessions.add(sessionId);

    // Emit session start event
    this.emitEvent("session.start", sessionId, { config });

    return this.wrapSession(sessionId, config);
  }

  /**
   * Resume an existing session by ID
   */
  async resumeSession(sessionId: string): Promise<Session | null> {
    if (!this.isRunning || !this.sdkClient) {
      throw new Error("Client not started. Call start() first.");
    }

    const result = await this.sdkClient.session.get({
      sessionID: sessionId,
      directory: this.clientOptions.directory,
    });

    if (result.error || !result.data) {
      return null;
    }

    this.currentSessionId = sessionId;
    this.activeSessions.add(sessionId);
    return this.wrapSession(sessionId, {});
  }

  /**
   * Wrap a session ID into a unified Session interface
   */
  private wrapSession(sessionId: string, config: SessionConfig): Session {
    const client = this;
    // Use agent mode from session config, falling back to client default, then "build"
    const agentMode =
      config.agentMode ??
      client.clientOptions.defaultAgentMode ??
      "build";

    // Track session state for token usage and lifecycle
    const sessionState = {
      inputTokens: 0,
      outputTokens: 0,
      isClosed: false,
    };

    const session: Session = {
      id: sessionId,

      send: async (message: string): Promise<AgentMessage> => {
        if (sessionState.isClosed) {
          throw new Error("Session is closed");
        }
        if (!client.sdkClient) {
          throw new Error("Client not connected");
        }

        // Estimate input tokens (approximately 4 chars per token)
        sessionState.inputTokens += Math.ceil(message.length / 4);

        const result = await client.sdkClient.session.prompt({
          sessionID: sessionId,
          directory: client.clientOptions.directory,
          agent: agentMode,
          parts: [{ type: "text", text: message }],
        });

        if (result.error) {
          throw new Error(`Failed to send message: ${result.error}`);
        }

        // Extract text content from parts
        const parts = result.data?.parts ?? [];
        const textParts = parts.filter(
          (p) => (p as Record<string, unknown>).type === "text"
        );
        const content = textParts
          .map((p) => ((p as Record<string, unknown>).text as string) ?? "")
          .join("");

        // Estimate output tokens
        sessionState.outputTokens += Math.ceil(content.length / 4);

        // Check for tool calls
        const toolParts = parts.filter(
          (p) => (p as Record<string, unknown>).type === "tool"
        );

        if (toolParts.length > 0) {
          return {
            type: "tool_use",
            content: {
              toolCalls: toolParts.map((t) => {
                const part = t as Record<string, unknown>;
                const state = (part.state as Record<string, unknown>) ?? {};
                return {
                  id: (part.id as string) ?? "",
                  name: (part.tool as string) ?? "",
                  input: ((state.input ?? {}) as Record<string, unknown>),
                };
              }),
            },
            role: "assistant",
          };
        }

        return {
          type: "text",
          content,
          role: "assistant",
        };
      },

      stream: (message: string): AsyncIterable<AgentMessage> => {
        return {
          async *[Symbol.asyncIterator]() {
            if (sessionState.isClosed) {
              throw new Error("Session is closed");
            }
            if (!client.sdkClient) {
              throw new Error("Client not connected");
            }

            // Estimate input tokens (approximately 4 chars per token)
            sessionState.inputTokens += Math.ceil(message.length / 4);

            // Set up streaming via SSE events
            // OpenCode streams text deltas via message.part.updated events
            const deltaQueue: AgentMessage[] = [];
            let resolveNext: (() => void) | null = null;
            let streamDone = false;
            let streamError: Error | null = null;
            let totalOutputChars = 0;

            // Handler for delta events from SSE
            const handleDelta = (event: AgentEvent<"message.delta">) => {
              // Only handle events for our session
              if (event.sessionId !== sessionId) return;

              const delta = event.data?.delta as string | undefined;
              if (delta) {
                totalOutputChars += delta.length;
                deltaQueue.push({
                  type: "text" as const,
                  content: delta,
                  role: "assistant" as const,
                });
                resolveNext?.();
              }
            };

            // Handler for session idle (stream complete)
            const handleIdle = (event: AgentEvent<"session.idle">) => {
              if (event.sessionId !== sessionId) return;
              streamDone = true;
              resolveNext?.();
            };

            // Handler for session error
            const handleError = (event: AgentEvent<"session.error">) => {
              if (event.sessionId !== sessionId) return;
              streamError = new Error(String(event.data?.error ?? "Stream error"));
              streamDone = true;
              resolveNext?.();
            };

            // Subscribe to events
            const unsubDelta = client.on("message.delta", handleDelta);
            const unsubIdle = client.on("session.idle", handleIdle);
            const unsubError = client.on("session.error", handleError);

            try {
              // Start the prompt (this initiates the agentic loop)
              // The response will come through SSE events
              const result = await client.sdkClient.session.prompt({
                sessionID: sessionId,
                directory: client.clientOptions.directory,
                agent: agentMode,
                parts: [{ type: "text", text: message }],
              });

              if (result.error) {
                throw new Error(`Failed to send message: ${result.error}`);
              }

              // Track if we already yielded text content from direct response
              // to avoid duplicating with SSE deltas
              let yieldedTextFromResponse = false;

              // If we got a direct response (no SSE streaming), yield it
              // This handles cases where the SDK returns immediately
              if (result.data?.parts) {
                const parts = result.data.parts;
                for (const part of parts) {
                  if (part.type === "text" && part.text) {
                    totalOutputChars += part.text.length;
                    yieldedTextFromResponse = true;
                    yield {
                      type: "text" as const,
                      content: part.text,
                      role: "assistant" as const,
                    };
                  } else if (part.type === "reasoning" && part.text) {
                    yield {
                      type: "thinking" as const,
                      content: part.text,
                      role: "assistant" as const,
                    };
                  } else if (part.type === "tool") {
                    const toolPart = part as Record<string, unknown>;
                    const toolState = toolPart.state as Record<string, unknown> | undefined;
                    const toolName = toolPart.tool as string;

                    // Yield tool_use message for pending/running tools
                    if (toolState?.status === "pending" || toolState?.status === "running") {
                      yield {
                        type: "tool_use" as const,
                        content: {
                          name: toolName,
                          input: toolState?.input ?? {},
                        },
                        role: "assistant" as const,
                        metadata: {
                          toolId: toolPart.id as string,
                        },
                      };
                    }

                    // Yield tool_result message for completed tools
                    if (toolState?.status === "completed" && toolState?.output) {
                      yield {
                        type: "tool_result" as const,
                        content: toolState.output,
                        role: "assistant" as const,
                        metadata: {
                          toolName,
                        },
                      };
                    }

                    // Yield error message for failed tools
                    if (toolState?.status === "error") {
                      yield {
                        type: "tool_result" as const,
                        content: { error: toolState?.error ?? "Tool execution failed" },
                        role: "assistant" as const,
                        metadata: {
                          toolName,
                          error: true,
                        },
                      };
                    }
                  }
                }

                // Update token counts from response
                const tokens = result.data.info?.tokens;
                if (tokens) {
                  sessionState.inputTokens = tokens.input ?? sessionState.inputTokens;
                  sessionState.outputTokens = tokens.output ?? 0;
                }
              }

              // Yield any SSE deltas that arrived, but skip if we already yielded text from direct response
              // This prevents duplication when OpenCode returns content both in direct response AND via SSE
              if (!yieldedTextFromResponse) {
                while (!streamDone || deltaQueue.length > 0) {
                  if (deltaQueue.length > 0) {
                    yield deltaQueue.shift()!;
                  } else if (!streamDone) {
                    // Wait for next delta or completion
                    await new Promise<void>((resolve) => {
                      resolveNext = resolve;
                      // Add a timeout to prevent infinite waiting
                      setTimeout(resolve, 30000);
                    });
                    resolveNext = null;
                  }
                }
              } else {
                // Clear the delta queue since we already have the response
                deltaQueue.length = 0;
                streamDone = true;
              }

              // Check for stream error
              if (streamError) {
                throw streamError;
              }

              // Estimate output tokens if not already set
              if (sessionState.outputTokens === 0) {
                sessionState.outputTokens = Math.ceil(totalOutputChars / 4);
              }
            } catch (error) {
              yield {
                type: "text" as const,
                content: `Error: ${error instanceof Error ? error.message : String(error)}`,
                role: "assistant" as const,
              };
            } finally {
              // Unsubscribe from events
              unsubDelta();
              unsubIdle();
              unsubError();
            }
          },
        };
      },

      summarize: async (): Promise<void> => {
        if (!client.sdkClient) {
          throw new Error("Client not connected");
        }

        await client.sdkClient.session.summarize({
          sessionID: sessionId,
          directory: client.clientOptions.directory,
        });

        client.emitEvent("session.idle", sessionId, {
          reason: "context_compacted",
        });
      },

      getContextUsage: async (): Promise<ContextUsage> => {
        // Return tracked token usage from session state
        // Note: OpenCode SDK doesn't expose direct token usage API,
        // so values may be estimated based on message lengths
        const totalTokens = sessionState.inputTokens + sessionState.outputTokens;
        const maxTokens = 200000; // Default context window
        return {
          inputTokens: sessionState.inputTokens,
          outputTokens: sessionState.outputTokens,
          maxTokens,
          usagePercentage: (totalTokens / maxTokens) * 100,
        };
      },

      destroy: async (): Promise<void> => {
        if (sessionState.isClosed) {
          return;
        }
        sessionState.isClosed = true;

        if (!client.sdkClient) {
          return;
        }

        await client.sdkClient.session.delete({
          sessionID: sessionId,
          directory: client.clientOptions.directory,
        });

        client.activeSessions.delete(sessionId);
        if (client.currentSessionId === sessionId) {
          client.currentSessionId = null;
        }

        client.emitEvent("session.idle", sessionId, { reason: "destroyed" });
      },
    };

    return session;
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
   * Note: OpenCode tools are configured server-side, this is a no-op
   */
  registerTool(tool: ToolDefinition): void {
    this.registeredTools.set(tool.name, tool);
    // OpenCode tools are registered server-side via MCP or config
    // This method stores tools for potential future use
  }

  /**
   * Try to spawn a local OpenCode server
   * @returns True if server was spawned successfully
   */
  private async spawnServer(): Promise<boolean> {
    // Parse port from baseUrl
    const url = new URL(this.clientOptions.baseUrl ?? DEFAULT_OPENCODE_BASE_URL);
    const port = this.clientOptions.port ?? parseInt(url.port || "4096", 10);
    const hostname = this.clientOptions.hostname ?? url.hostname ?? "localhost";

    try {
      const serverOptions: SdkServerOptions = {
        hostname,
        port,
        timeout: this.clientOptions.timeout ?? 30000,
      };

      const { url: serverUrl, close } = await createOpencodeServer(serverOptions);
      this.serverCloseCallback = close;
      this.isServerSpawned = true;

      // Update baseUrl to the actual server URL
      this.clientOptions.baseUrl = serverUrl;

      return true;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`Failed to spawn OpenCode server: ${errorMsg}`);
      return false;
    }
  }

  /**
   * Start the client and connect to OpenCode server
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    const autoStart = this.clientOptions.autoStart !== false;

    // First, try to connect to existing server
    try {
      await this.connect();
    } catch (connectionError) {
      // If autoStart is enabled, try spawning a server
      if (autoStart) {
        const spawned = await this.spawnServer();
        if (spawned) {
          // Try connecting again
          await this.connect();
        } else {
          throw connectionError;
        }
      } else {
        throw connectionError;
      }
    }

    // Start SSE event subscription
    await this.subscribeToSdkEvents();

    this.isRunning = true;
  }

  /**
   * Stop the client and clean up resources
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    // Disconnect from server
    await this.disconnect();

    // Close spawned server if we started it
    if (this.serverCloseCallback && this.isServerSpawned) {
      try {
        this.serverCloseCallback();
      } catch {
        // Ignore errors during cleanup
      }
      this.serverCloseCallback = null;
      this.isServerSpawned = false;
    }

    this.eventHandlers.clear();
    this.isRunning = false;
  }

  /**
   * Check if the client is currently connected to OpenCode server
   */
  isConnectedToServer(): boolean {
    return this.isConnected;
  }

  /**
   * Get the configured base URL
   */
  getBaseUrl(): string {
    return this.clientOptions.baseUrl ?? DEFAULT_OPENCODE_BASE_URL;
  }

  /**
   * Get model display information for UI rendering.
   * Queries config.providers() from the OpenCode SDK to get the default model.
   * @param _modelHint - Optional model hint (unused, queries SDK config instead)
   */
  async getModelDisplayInfo(
    _modelHint?: string
  ): Promise<{ model: string; tier: string }> {
    if (!this.isRunning || !this.sdkClient) {
      return {
        model: "Claude",
        tier: "OpenCode",
      };
    }

    try {
      // Try to get providers config which includes default model info
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const configClient = this.sdkClient as any;
      if (configClient.config && typeof configClient.config.providers === "function") {
        const result = await configClient.config.providers();
        const defaults = result.data?.default as Record<string, string> | undefined;
        if (defaults) {
          // Get the first default model (format: providerID -> modelID)
          const providerKeys = Object.keys(defaults);
          const firstProvider = providerKeys[0];
          if (firstProvider) {
            const modelId = defaults[firstProvider];
            if (modelId) {
              // Format model ID for display (e.g., "claude-sonnet-4-20250514" -> "Claude Sonnet 4")
              const displayModel = modelId
                .replace(/-\d+$/, "") // Remove trailing date
                .split("-")
                .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
                .join(" ");
              return {
                model: displayModel,
                tier: "OpenCode",
              };
            }
          }
        }
      }
    } catch {
      // Fall back to default if config.providers fails
    }

    return {
      model: "Claude",
      tier: "OpenCode",
    };
  }
}

/**
 * Factory function to create an OpenCodeClient instance
 * @param options - Client options
 */
export function createOpenCodeClient(
  options?: OpenCodeClientOptions
): OpenCodeClient {
  return new OpenCodeClient(options);
}
