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

      const eventStream = await this.sdkClient.event.subscribe({
        directory: this.clientOptions.directory,
      });

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
    eventStream: AsyncIterable<unknown>
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
        if (part?.type === "text" && delta) {
          this.emitEvent("message.delta", (part?.sessionID as string) ?? "", {
            delta,
            contentType: "text",
          });
        } else if (part?.type === "tool") {
          const toolState = part?.state as Record<string, unknown> | undefined;
          if (toolState?.status === "pending") {
            this.emitEvent("tool.start", (part?.sessionID as string) ?? "", {
              toolName: (part?.tool as string) ?? "",
              toolInput: toolState?.input,
            });
          } else if (
            toolState?.status === "completed" ||
            toolState?.status === "error"
          ) {
            this.emitEvent("tool.complete", (part?.sessionID as string) ?? "", {
              toolName: (part?.tool as string) ?? "",
              toolResult: toolState?.output,
              success: toolState?.status === "completed",
            });
          }
        }
        break;
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

    const session: Session = {
      id: sessionId,

      send: async (message: string): Promise<AgentMessage> => {
        if (!client.sdkClient) {
          throw new Error("Client not connected");
        }

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
          (p): p is { type: "text"; text: string } =>
            (p as Record<string, unknown>).type === "text"
        );
        const content = textParts
          .map((p) => (p as { text: string }).text)
          .join("");

        // Check for tool calls
        const toolParts = parts.filter(
          (p): p is { type: "tool"; tool: string; state: unknown } =>
            (p as Record<string, unknown>).type === "tool"
        );

        if (toolParts.length > 0) {
          return {
            type: "tool_use",
            content: {
              toolCalls: toolParts.map((t) => ({
                id: ((t as Record<string, unknown>).id as string) ?? "",
                name: t.tool,
                input: (((t.state as Record<string, unknown>)?.input ??
                  {}) as Record<string, unknown>),
              })),
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
            if (!client.sdkClient) {
              throw new Error("Client not connected");
            }

            // Send async prompt - SSE events will stream back
            const result = await client.sdkClient.session.promptAsync({
              sessionID: sessionId,
              directory: client.clientOptions.directory,
              agent: agentMode,
              parts: [{ type: "text", text: message }],
            });

            if (result.error) {
              throw new Error(`Failed to send message: ${result.error}`);
            }

            // Yield initial response
            // Note: Actual streaming comes through SSE events
            yield {
              type: "text",
              content: "",
              role: "assistant",
            };
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
        // OpenCode SDK doesn't expose direct token usage API
        // Return placeholder values
        return {
          inputTokens: 0,
          outputTokens: 0,
          maxTokens: 200000,
          usagePercentage: 0,
        };
      },

      destroy: async (): Promise<void> => {
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
   * Start the client and connect to OpenCode server
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    // Connect to OpenCode server
    await this.connect();

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
