/**
 * CopilotClient - Implementation of CodingAgentClient for GitHub Copilot SDK
 *
 * This module implements the unified CodingAgentClient interface for the
 * GitHub Copilot CLI coding agent. It supports:
 * - Multiple connection modes (stdio, port, cliUrl)
 * - Session creation and resumption
 * - Streaming message responses
 * - All 31 Copilot SDK event types
 * - Permission handler for approval flows
 *
 * Note: This implementation is designed to work with the @github/copilot-sdk
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
 * All 31 Copilot SDK event types
 */
export type CopilotSdkEventType =
  // Session events
  | "session.start"
  | "session.ready"
  | "session.idle"
  | "session.busy"
  | "session.end"
  | "session.error"
  // Message events
  | "message.start"
  | "message.delta"
  | "message.complete"
  | "message.error"
  // Assistant events
  | "assistant.thinking"
  | "assistant.message"
  | "assistant.tool_use"
  | "assistant.tool_result"
  // Tool events
  | "tool.start"
  | "tool.progress"
  | "tool.complete"
  | "tool.error"
  | "tool.cancelled"
  // Permission events
  | "permission.request"
  | "permission.granted"
  | "permission.denied"
  | "permission.timeout"
  // Subagent events
  | "subagent.start"
  | "subagent.message"
  | "subagent.complete"
  | "subagent.error"
  // Context events
  | "context.update"
  | "context.compact"
  // Connection events
  | "connection.open"
  | "connection.close"
  | "connection.error";

/**
 * Copilot SDK Event interface
 */
export interface CopilotSdkEvent {
  type: CopilotSdkEventType;
  sessionId: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

/**
 * Copilot SDK Session interface
 */
export interface CopilotSdkSession {
  id: string;
  send(message: string): Promise<CopilotSdkMessage>;
  stream(message: string): AsyncIterable<CopilotSdkStreamEvent>;
  on(eventType: CopilotSdkEventType, handler: (event: CopilotSdkEvent) => void): () => void;
  getUsage(): Promise<CopilotSdkUsage>;
  destroy(): Promise<void>;
}

/**
 * Copilot SDK Message interface
 */
export interface CopilotSdkMessage {
  id: string;
  role: "assistant" | "user" | "system";
  content: string;
  toolCalls?: CopilotSdkToolCall[];
  usage?: CopilotSdkUsage;
}

/**
 * Copilot SDK Tool Call interface
 */
export interface CopilotSdkToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: unknown;
  status: "pending" | "running" | "complete" | "error" | "cancelled";
}

/**
 * Copilot SDK Stream Event interface
 */
export interface CopilotSdkStreamEvent {
  type: "delta" | "complete" | "tool_start" | "tool_progress" | "tool_end" | "error" | "thinking";
  content?: string;
  message?: CopilotSdkMessage;
  toolCall?: CopilotSdkToolCall;
  error?: Error;
  progress?: number;
}

/**
 * Copilot SDK Usage interface
 */
export interface CopilotSdkUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextLimit: number;
}

/**
 * Copilot SDK Tool Definition interface
 */
export interface CopilotSdkToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: (input: unknown) => Promise<unknown>;
}

/**
 * Copilot SDK Permission Request interface
 */
export interface CopilotSdkPermissionRequest {
  id: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  reason?: string;
  timeout?: number;
}

/**
 * Permission handler function type
 */
export type CopilotPermissionHandler = (
  request: CopilotSdkPermissionRequest
) => Promise<"granted" | "denied">;

/**
 * Connection mode options
 */
export type CopilotConnectionMode =
  | { type: "stdio" }
  | { type: "port"; port: number }
  | { type: "cliUrl"; url: string };

/**
 * Copilot SDK Client interface
 */
export interface CopilotSdkClient {
  session: {
    create(config: CopilotSdkSessionConfig): Promise<CopilotSdkSession>;
    get(sessionId: string): Promise<CopilotSdkSession | null>;
    list(): Promise<CopilotSdkSession[]>;
  };
  on(eventType: CopilotSdkEventType, handler: (event: CopilotSdkEvent) => void): () => void;
  tools: {
    register(tool: CopilotSdkToolDefinition): void;
    list(): CopilotSdkToolDefinition[];
  };
  setPermissionHandler(handler: CopilotPermissionHandler): void;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

/**
 * Copilot SDK Session Config interface
 */
export interface CopilotSdkSessionConfig {
  model?: string;
  systemPrompt?: string;
  tools?: string[];
  maxTokens?: number;
  temperature?: number;
}

/**
 * Options for creating a Copilot client
 */
export interface CopilotClientOptions {
  connectionMode?: CopilotConnectionMode;
  timeout?: number;
}

/**
 * Factory function type for creating Copilot SDK client
 */
export type CreateCopilotClientFn = (options?: CopilotClientOptions) => CopilotSdkClient;

/**
 * Internal session state for tracking active sessions
 */
interface CopilotSessionState {
  sdkSession: CopilotSdkSession;
  sessionId: string;
  config: SessionConfig;
  inputTokens: number;
  outputTokens: number;
  isClosed: boolean;
  eventUnsubscribers: Array<() => void>;
}

/**
 * Maps Copilot SDK event types to unified EventType
 */
function mapSdkEventToEventType(sdkEventType: CopilotSdkEventType): EventType | null {
  const mapping: Partial<Record<CopilotSdkEventType, EventType>> = {
    "session.start": "session.start",
    "session.ready": "session.start",
    "session.idle": "session.idle",
    "session.end": "session.idle",
    "session.error": "session.error",
    "message.delta": "message.delta",
    "message.complete": "message.complete",
    "assistant.message": "message.complete",
    "tool.start": "tool.start",
    "tool.complete": "tool.complete",
    "tool.error": "session.error",
    "subagent.start": "subagent.start",
    "subagent.complete": "subagent.complete",
    "subagent.error": "session.error",
  };
  return mapping[sdkEventType] ?? null;
}

/**
 * CopilotClient implements CodingAgentClient for the GitHub Copilot SDK.
 *
 * This client wraps the Copilot SDK to provide a unified interface
 * for session management, message streaming, and event handling.
 * Supports all 31 Copilot event types and permission handling.
 */
export class CopilotClient implements CodingAgentClient {
  readonly agentType = "copilot" as const;

  private sdkClient: CopilotSdkClient | null = null;
  private createClientFn: CreateCopilotClientFn | null = null;
  private clientOptions: CopilotClientOptions;
  private eventHandlers: Map<EventType, Set<EventHandler<EventType>>> = new Map();
  private sessions: Map<string, CopilotSessionState> = new Map();
  private sdkEventUnsubscribers: Array<() => void> = [];
  private registeredTools: Map<string, ToolDefinition> = new Map();
  private permissionHandler: CopilotPermissionHandler | null = null;
  private isRunning = false;

  /**
   * Create a new CopilotClient
   * @param createClientFn - Factory function to create SDK client (injected for testing)
   * @param options - Client options including connection mode
   */
  constructor(createClientFn?: CreateCopilotClientFn, options: CopilotClientOptions = {}) {
    this.createClientFn = createClientFn ?? null;
    this.clientOptions = options;
  }

  /**
   * Set the SDK client factory function
   */
  setClientFactory(createClientFn: CreateCopilotClientFn): void {
    this.createClientFn = createClientFn;
  }

  /**
   * Set the permission handler for approval flows
   */
  setPermissionHandler(handler: CopilotPermissionHandler): void {
    this.permissionHandler = handler;
    if (this.sdkClient) {
      this.sdkClient.setPermissionHandler(handler);
    }
  }

  /**
   * Wrap a Copilot SDK session into a unified Session interface
   */
  private wrapSession(
    sdkSession: CopilotSdkSession,
    sessionId: string,
    config: SessionConfig
  ): Session {
    const state: CopilotSessionState = {
      sdkSession,
      sessionId,
      config,
      inputTokens: 0,
      outputTokens: 0,
      isClosed: false,
      eventUnsubscribers: [],
    };

    this.sessions.set(sessionId, state);

    // Subscribe to session-level events
    this.subscribeToSessionEvents(sdkSession, sessionId, state);

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
        const emitEvent = (type: EventType, data: Record<string, unknown>) =>
          this.emitEvent(type, sessionId, data);

        return {
          [Symbol.asyncIterator]: async function* () {
            if (state.isClosed) {
              throw new Error("Session is closed");
            }

            for await (const event of state.sdkSession.stream(message)) {
              switch (event.type) {
                case "thinking":
                  yield {
                    type: "thinking",
                    content: event.content ?? "",
                    role: "assistant",
                  };
                  break;

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

                case "tool_progress":
                  // Progress events are internal, not mapped to unified type
                  break;

                case "tool_end":
                  if (event.toolCall) {
                    emitEvent("tool.complete", {
                      toolName: event.toolCall.name,
                      toolResult: event.toolCall.output,
                      success: event.toolCall.status === "complete",
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
        // Copilot SDK doesn't have a direct summarize method
        // Context compaction is handled automatically
        console.warn(
          "CopilotClient.summarize(): Context compaction is handled automatically by the SDK"
        );
      },

      getContextUsage: async (): Promise<ContextUsage> => {
        if (state.isClosed) {
          return {
            inputTokens: state.inputTokens,
            outputTokens: state.outputTokens,
            maxTokens: 200000,
            usagePercentage: ((state.inputTokens + state.outputTokens) / 200000) * 100,
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

          // Unsubscribe from session events
          for (const unsub of state.eventUnsubscribers) {
            unsub();
          }
          state.eventUnsubscribers = [];

          await state.sdkSession.destroy();
          this.sessions.delete(sessionId);
          this.emitEvent("session.idle", sessionId, { reason: "destroyed" });
        }
      },
    };

    return session;
  }

  /**
   * Subscribe to all SDK events for a session
   */
  private subscribeToSessionEvents(
    sdkSession: CopilotSdkSession,
    sessionId: string,
    state: CopilotSessionState
  ): void {
    const eventTypes: CopilotSdkEventType[] = [
      "session.start",
      "session.ready",
      "session.idle",
      "session.busy",
      "session.end",
      "session.error",
      "message.start",
      "message.delta",
      "message.complete",
      "message.error",
      "assistant.thinking",
      "assistant.message",
      "assistant.tool_use",
      "assistant.tool_result",
      "tool.start",
      "tool.progress",
      "tool.complete",
      "tool.error",
      "tool.cancelled",
      "permission.request",
      "permission.granted",
      "permission.denied",
      "permission.timeout",
      "subagent.start",
      "subagent.message",
      "subagent.complete",
      "subagent.error",
      "context.update",
      "context.compact",
    ];

    for (const sdkEventType of eventTypes) {
      const unsub = sdkSession.on(sdkEventType, (sdkEvent) => {
        const eventType = mapSdkEventToEventType(sdkEventType);
        if (eventType) {
          this.emitEvent(eventType, sessionId, sdkEvent.data ?? {});
        }
      });
      state.eventUnsubscribers.push(unsub);
    }
  }

  /**
   * Subscribe to global SDK events
   */
  private subscribeToSdkEvents(): void {
    if (!this.sdkClient) return;

    const globalEventTypes: CopilotSdkEventType[] = [
      "connection.open",
      "connection.close",
      "connection.error",
    ];

    for (const sdkEventType of globalEventTypes) {
      const unsub = this.sdkClient.on(sdkEventType, (sdkEvent) => {
        if (sdkEventType === "connection.error") {
          this.emitEvent("session.error", sdkEvent.sessionId, sdkEvent.data ?? {});
        }
      });
      this.sdkEventUnsubscribers.push(unsub);
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

    const sdkConfig: CopilotSdkSessionConfig = {
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
      return this.wrapSession(existingState.sdkSession, sessionId, existingState.config);
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
          "Either pass createCopilotClient to constructor or call setClientFactory()."
      );
    }

    // Create SDK client
    this.sdkClient = this.createClientFn(this.clientOptions);

    // Set permission handler if configured
    if (this.permissionHandler) {
      this.sdkClient.setPermissionHandler(this.permissionHandler);
    }

    // Register any tools that were added before start
    for (const tool of this.registeredTools.values()) {
      this.sdkClient.tools.register({
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
        handler: async (input) => tool.handler(input),
      });
    }

    // Subscribe to global SDK events
    this.subscribeToSdkEvents();

    // Connect to the CLI
    await this.sdkClient.connect();
    this.isRunning = true;
  }

  /**
   * Stop the client and clean up resources
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    // Unsubscribe from global SDK events
    for (const unsub of this.sdkEventUnsubscribers) {
      unsub();
    }
    this.sdkEventUnsubscribers = [];

    // Close all active sessions
    for (const [_sessionId, state] of this.sessions) {
      if (!state.isClosed) {
        state.isClosed = true;
        for (const unsub of state.eventUnsubscribers) {
          unsub();
        }
        try {
          await state.sdkSession.destroy();
        } catch {
          // Ignore errors during cleanup
        }
      }
    }
    this.sessions.clear();

    // Disconnect SDK client
    if (this.sdkClient) {
      await this.sdkClient.disconnect();
      this.sdkClient = null;
    }

    this.eventHandlers.clear();
    this.isRunning = false;
  }
}

/**
 * Create a permission handler that auto-approves all requests
 */
export function createAutoApprovePermissionHandler(): CopilotPermissionHandler {
  return async () => "granted";
}

/**
 * Create a permission handler that denies all requests
 */
export function createDenyAllPermissionHandler(): CopilotPermissionHandler {
  return async () => "denied";
}

/**
 * Factory function to create a CopilotClient instance
 * @param createClientFn - Optional SDK client factory (for dependency injection)
 * @param options - Client options including connection mode
 */
export function createCopilotClient(
  createClientFn?: CreateCopilotClientFn,
  options?: CopilotClientOptions
): CopilotClient {
  return new CopilotClient(createClientFn, options);
}
