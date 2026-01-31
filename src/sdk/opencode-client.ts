/**
 * OpenCodeClient - Implementation of CodingAgentClient for OpenCode SDK
 *
 * This module implements the unified CodingAgentClient interface for the
 * OpenCode AI coding agent. It supports:
 * - Session creation and resumption
 * - Streaming message responses
 * - Context compaction via summarize()
 * - Event subscription
 *
 * Note: This implementation is designed to work with the @opencode-ai/sdk/v2/client
 * package when it becomes available. Currently uses typed stubs that define the
 * expected SDK interface.
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
} from "./types.ts";

/**
 * OpenCode SDK Session interface (expected from @opencode-ai/sdk/v2/client)
 * This defines what we expect from the OpenCode SDK session API.
 */
export interface OpenCodeSdkSession {
  id: string;
  send(message: string): Promise<OpenCodeSdkMessage>;
  stream(message: string): AsyncIterable<OpenCodeSdkStreamEvent>;
  summarize(): Promise<void>;
  getUsage(): Promise<OpenCodeSdkUsage>;
  destroy(): Promise<void>;
}

/**
 * OpenCode SDK Message interface
 */
export interface OpenCodeSdkMessage {
  id: string;
  role: "assistant" | "user" | "system";
  content: string;
  toolCalls?: OpenCodeSdkToolCall[];
  usage?: OpenCodeSdkUsage;
}

/**
 * OpenCode SDK Tool Call interface
 */
export interface OpenCodeSdkToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: unknown;
}

/**
 * OpenCode SDK Stream Event interface
 */
export interface OpenCodeSdkStreamEvent {
  type: "delta" | "complete" | "tool_start" | "tool_end" | "error";
  content?: string;
  message?: OpenCodeSdkMessage;
  toolCall?: OpenCodeSdkToolCall;
  error?: Error;
}

/**
 * OpenCode SDK Usage interface
 */
export interface OpenCodeSdkUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextLimit: number;
}

/**
 * OpenCode SDK Event types
 */
export type OpenCodeSdkEventType =
  | "session.created"
  | "session.resumed"
  | "session.idle"
  | "session.error"
  | "message.start"
  | "message.delta"
  | "message.complete"
  | "tool.start"
  | "tool.complete"
  | "tool.error"
  | "compact.start"
  | "compact.complete";

/**
 * OpenCode SDK Event interface
 */
export interface OpenCodeSdkEvent {
  type: OpenCodeSdkEventType;
  sessionId: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

/**
 * OpenCode SDK Client interface (expected from @opencode-ai/sdk/v2/client)
 */
export interface OpenCodeSdkClient {
  session: {
    create(config: OpenCodeSdkSessionConfig): Promise<OpenCodeSdkSession>;
    get(sessionId: string): Promise<OpenCodeSdkSession | null>;
    list(): Promise<OpenCodeSdkSession[]>;
  };
  on(
    eventType: OpenCodeSdkEventType,
    handler: (event: OpenCodeSdkEvent) => void
  ): () => void;
  tools: {
    register(tool: OpenCodeSdkToolDefinition): void;
    list(): OpenCodeSdkToolDefinition[];
  };
  start(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * OpenCode SDK Session Config interface
 */
export interface OpenCodeSdkSessionConfig {
  model?: string;
  systemPrompt?: string;
  tools?: string[];
  maxTokens?: number;
  temperature?: number;
}

/**
 * OpenCode SDK Tool Definition interface
 */
export interface OpenCodeSdkToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: (input: unknown) => Promise<unknown>;
}

/**
 * Factory function type for creating OpenCode SDK client
 * This is what we expect from: import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
 */
export type CreateOpenCodeClientFn = (
  options?: OpenCodeClientOptions
) => OpenCodeSdkClient;

/**
 * Options for creating an OpenCode client
 */
export interface OpenCodeClientOptions {
  apiKey?: string;
  baseUrl?: string;
  timeout?: number;
}

/**
 * Internal session state for tracking active sessions
 */
interface OpenCodeSessionState {
  sdkSession: OpenCodeSdkSession;
  sessionId: string;
  config: SessionConfig;
  inputTokens: number;
  outputTokens: number;
  isClosed: boolean;
}

/**
 * Maps OpenCode SDK event types to unified EventType
 */
function mapSdkEventToEventType(
  sdkEventType: OpenCodeSdkEventType
): EventType | null {
  const mapping: Record<OpenCodeSdkEventType, EventType | null> = {
    "session.created": "session.start",
    "session.resumed": "session.start",
    "session.idle": "session.idle",
    "session.error": "session.error",
    "message.start": null,
    "message.delta": "message.delta",
    "message.complete": "message.complete",
    "tool.start": "tool.start",
    "tool.complete": "tool.complete",
    "tool.error": "session.error",
    "compact.start": null,
    "compact.complete": null,
  };
  return mapping[sdkEventType];
}

/**
 * OpenCodeClient implements CodingAgentClient for the OpenCode SDK.
 *
 * This client wraps the OpenCode SDK to provide a unified interface
 * for session management, message streaming, and event handling.
 */
export class OpenCodeClient implements CodingAgentClient {
  readonly agentType = "opencode" as const;

  private sdkClient: OpenCodeSdkClient | null = null;
  private createClientFn: CreateOpenCodeClientFn | null = null;
  private clientOptions: OpenCodeClientOptions;
  private eventHandlers: Map<EventType, Set<EventHandler<EventType>>> =
    new Map();
  private sessions: Map<string, OpenCodeSessionState> = new Map();
  private sdkEventUnsubscribers: Array<() => void> = [];
  private registeredTools: Map<string, ToolDefinition> = new Map();
  private isRunning = false;

  /**
   * Create a new OpenCodeClient
   * @param createClientFn - Factory function to create SDK client (injected for testing)
   * @param options - Client options
   */
  constructor(
    createClientFn?: CreateOpenCodeClientFn,
    options: OpenCodeClientOptions = {}
  ) {
    this.createClientFn = createClientFn ?? null;
    this.clientOptions = options;
  }

  /**
   * Set the SDK client factory function
   * Used for dependency injection in production
   */
  setClientFactory(createClientFn: CreateOpenCodeClientFn): void {
    this.createClientFn = createClientFn;
  }

  /**
   * Wrap an OpenCode SDK session into a unified Session interface
   */
  private wrapSession(
    sdkSession: OpenCodeSdkSession,
    sessionId: string,
    config: SessionConfig
  ): Session {
    const state: OpenCodeSessionState = {
      sdkSession,
      sessionId,
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

        const sdkMessage = await state.sdkSession.send(message);

        // Track token usage
        if (sdkMessage.usage) {
          state.inputTokens += sdkMessage.usage.inputTokens;
          state.outputTokens += sdkMessage.usage.outputTokens;
        }

        // Emit message complete event
        this.emitEvent("message.complete", sessionId, { message: sdkMessage });

        return {
          type: sdkMessage.toolCalls ? "tool_use" : "text",
          content: sdkMessage.toolCalls
            ? { toolCalls: sdkMessage.toolCalls }
            : sdkMessage.content,
          role: "assistant",
          metadata: {
            tokenUsage: sdkMessage.usage
              ? {
                  inputTokens: sdkMessage.usage.inputTokens,
                  outputTokens: sdkMessage.usage.outputTokens,
                }
              : undefined,
          },
        };
      },

      stream: (message: string): AsyncIterable<AgentMessage> => {
        const emitEvent = (
          type: EventType,
          data: Record<string, unknown>
        ) => this.emitEvent(type, sessionId, data);

        return {
          [Symbol.asyncIterator]: async function* () {
            if (state.isClosed) {
              throw new Error("Session is closed");
            }

            for await (const event of state.sdkSession.stream(message)) {
              switch (event.type) {
                case "delta":
                  emitEvent("message.delta", { delta: event.content });
                  yield {
                    type: "text",
                    content: event.content ?? "",
                    role: "assistant",
                  };
                  break;

                case "complete":
                  if (event.message) {
                    // Track token usage
                    if (event.message.usage) {
                      state.inputTokens += event.message.usage.inputTokens;
                      state.outputTokens += event.message.usage.outputTokens;
                    }

                    emitEvent("message.complete", { message: event.message });

                    yield {
                      type: event.message.toolCalls ? "tool_use" : "text",
                      content: event.message.toolCalls
                        ? { toolCalls: event.message.toolCalls }
                        : event.message.content,
                      role: "assistant",
                      metadata: {
                        tokenUsage: event.message.usage
                          ? {
                              inputTokens: event.message.usage.inputTokens,
                              outputTokens: event.message.usage.outputTokens,
                            }
                          : undefined,
                      },
                    };
                  }
                  break;

                case "tool_start":
                  if (event.toolCall) {
                    emitEvent("tool.start", {
                      toolName: event.toolCall.name,
                      toolInput: event.toolCall.input,
                    });
                  }
                  break;

                case "tool_end":
                  if (event.toolCall) {
                    emitEvent("tool.complete", {
                      toolName: event.toolCall.name,
                      toolResult: event.toolCall.output,
                      success: true,
                    });
                  }
                  break;

                case "error":
                  emitEvent("session.error", {
                    error: event.error?.message ?? "Unknown error",
                  });
                  break;
              }
            }
          },
        };
      },

      summarize: async (): Promise<void> => {
        if (state.isClosed) {
          throw new Error("Session is closed");
        }

        // OpenCode SDK supports context compaction via summarize()
        await state.sdkSession.summarize();

        // Emit event for tracking
        this.emitEvent("session.idle", sessionId, {
          reason: "context_compacted",
        });
      },

      getContextUsage: async (): Promise<ContextUsage> => {
        if (state.isClosed) {
          return {
            inputTokens: state.inputTokens,
            outputTokens: state.outputTokens,
            maxTokens: 200000,
            usagePercentage:
              ((state.inputTokens + state.outputTokens) / 200000) * 100,
          };
        }

        const usage = await state.sdkSession.getUsage();
        return {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          maxTokens: usage.contextLimit,
          usagePercentage: (usage.totalTokens / usage.contextLimit) * 100,
        };
      },

      destroy: async (): Promise<void> => {
        if (!state.isClosed) {
          state.isClosed = true;
          await state.sdkSession.destroy();
          this.sessions.delete(sessionId);
          this.emitEvent("session.idle", sessionId, { reason: "destroyed" });
        }
      },
    };

    return session;
  }

  /**
   * Subscribe to SDK events and forward to unified event handlers
   */
  private subscribeToSdkEvents(): void {
    if (!this.sdkClient) return;

    const sdkEventTypes: OpenCodeSdkEventType[] = [
      "session.created",
      "session.resumed",
      "session.idle",
      "session.error",
      "message.delta",
      "message.complete",
      "tool.start",
      "tool.complete",
      "tool.error",
    ];

    for (const sdkEventType of sdkEventTypes) {
      const unsubscribe = this.sdkClient.on(sdkEventType, (sdkEvent) => {
        const eventType = mapSdkEventToEventType(sdkEventType);
        if (eventType) {
          this.emitEvent(eventType, sdkEvent.sessionId, sdkEvent.data ?? {});
        }
      });
      this.sdkEventUnsubscribers.push(unsubscribe);
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

    const sdkConfig: OpenCodeSdkSessionConfig = {
      model: config.model,
      systemPrompt: config.systemPrompt,
      tools: config.tools,
    };

    const sdkSession = await this.sdkClient.session.create(sdkConfig);
    const sessionId = config.sessionId ?? sdkSession.id;

    // Emit session start event
    this.emitEvent("session.start", sessionId, { config });

    return this.wrapSession(sdkSession, sessionId, config);
  }

  /**
   * Resume an existing session by ID
   */
  async resumeSession(sessionId: string): Promise<Session | null> {
    if (!this.isRunning || !this.sdkClient) {
      throw new Error("Client not started. Call start() first.");
    }

    // Check if session is already active locally
    const existingState = this.sessions.get(sessionId);
    if (existingState && !existingState.isClosed) {
      return this.wrapSession(
        existingState.sdkSession,
        sessionId,
        existingState.config
      );
    }

    // Try to get session from SDK
    const sdkSession = await this.sdkClient.session.get(sessionId);
    if (!sdkSession) {
      return null;
    }

    return this.wrapSession(sdkSession, sessionId, {});
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
    this.registeredTools.set(tool.name, tool);

    // If client is running, register with SDK
    if (this.sdkClient) {
      this.sdkClient.tools.register({
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
        handler: async (input) => tool.handler(input),
      });
    }
  }

  /**
   * Start the client
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    if (!this.createClientFn) {
      throw new Error(
        "No SDK client factory provided. " +
          "Either pass createOpencodeClient to constructor or call setClientFactory()."
      );
    }

    // Create SDK client
    this.sdkClient = this.createClientFn(this.clientOptions);

    // Register any tools that were added before start
    for (const tool of this.registeredTools.values()) {
      this.sdkClient.tools.register({
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
        handler: async (input) => tool.handler(input),
      });
    }

    // Subscribe to SDK events
    this.subscribeToSdkEvents();

    // Start SDK client
    await this.sdkClient.start();
    this.isRunning = true;
  }

  /**
   * Stop the client and clean up resources
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    // Unsubscribe from SDK events
    for (const unsubscribe of this.sdkEventUnsubscribers) {
      unsubscribe();
    }
    this.sdkEventUnsubscribers = [];

    // Close all active sessions
    for (const [_sessionId, state] of this.sessions) {
      if (!state.isClosed) {
        state.isClosed = true;
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
}

/**
 * Factory function to create an OpenCodeClient instance
 * @param createClientFn - Optional SDK client factory (for dependency injection)
 * @param options - Client options
 */
export function createOpenCodeClient(
  createClientFn?: CreateOpenCodeClientFn,
  options?: OpenCodeClientOptions
): OpenCodeClient {
  return new OpenCodeClient(createClientFn, options);
}
