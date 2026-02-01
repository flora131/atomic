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
 */

import {
  CopilotClient as SdkCopilotClient,
  CopilotSession as SdkCopilotSession,
  type CopilotClientOptions as SdkClientOptions,
  type SessionConfig as SdkSessionConfig,
  type SessionEvent as SdkSessionEvent,
  type SessionEventType as SdkSessionEventType,
  type PermissionHandler as SdkPermissionHandler,
  type PermissionRequest as SdkPermissionRequest,
  type PermissionRequestResult as SdkPermissionResult,
  type Tool as SdkTool,
  type ResumeSessionConfig as SdkResumeSessionConfig,
} from "@github/copilot-sdk";

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
}

/**
 * Maps SDK event types to unified EventType
 */
function mapSdkEventToEventType(sdkEventType: SdkSessionEventType): EventType | null {
  const mapping: Partial<Record<SdkSessionEventType, EventType>> = {
    "session.start": "session.start",
    "session.resume": "session.start",
    "session.idle": "session.idle",
    "session.error": "session.error",
    "assistant.message_delta": "message.delta",
    "assistant.message": "message.complete",
    "tool.execution_start": "tool.start",
    "tool.execution_complete": "tool.complete",
    "subagent.started": "subagent.start",
    "subagent.completed": "subagent.complete",
    "subagent.failed": "session.error",
  };
  return mapping[sdkEventType] ?? null;
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
   * Build SDK client options from our client options
   */
  private buildSdkOptions(): SdkClientOptions {
    const opts: SdkClientOptions = {
      cliPath: this.clientOptions.cliPath,
      cliArgs: this.clientOptions.cliArgs,
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

      stream: (message: string): AsyncIterable<AgentMessage> => {
        const self = this;
        return {
          [Symbol.asyncIterator]: async function* () {
            if (state.isClosed) {
              throw new Error("Session is closed");
            }

            // Set up event handler to collect streaming events
            const chunks: AgentMessage[] = [];
            let resolveChunk: (() => void) | null = null;
            let done = false;

            // Track if we've yielded streaming deltas to avoid duplicating content
            let hasYieldedDeltas = false;

            const eventHandler = (event: SdkSessionEvent) => {
              if (event.type === "assistant.message_delta") {
                hasYieldedDeltas = true;
                chunks.push({
                  type: "text",
                  content: event.data.deltaContent,
                  role: "assistant",
                });
                resolveChunk?.();
              } else if (event.type === "assistant.reasoning_delta") {
                hasYieldedDeltas = true;
                chunks.push({
                  type: "thinking",
                  content: event.data.deltaContent,
                  role: "assistant",
                });
                resolveChunk?.();
              } else if (event.type === "assistant.message") {
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
                }
                done = true;
                resolveChunk?.();
              } else if (event.type === "session.idle") {
                done = true;
                resolveChunk?.();
              } else if (event.type === "tool.execution_start") {
                self.emitEvent("tool.start", sessionId, {
                  toolName: event.data.toolName,
                  toolInput: event.data.arguments,
                });
              } else if (event.type === "tool.execution_complete") {
                self.emitEvent("tool.complete", sessionId, {
                  toolName: event.data.toolCallId,
                  success: event.data.success,
                  error: event.data.error?.message,
                });
              }
            };

            const unsub = state.sdkSession.on(eventHandler);

            try {
              // Send the message (non-blocking)
              await state.sdkSession.send({ prompt: message });

              // Yield chunks as they arrive
              while (!done) {
                if (chunks.length > 0) {
                  yield chunks.shift()!;
                } else {
                  // Wait for next chunk
                  await new Promise<void>((resolve) => {
                    resolveChunk = resolve;
                  });
                }
              }

              // Yield any remaining chunks
              while (chunks.length > 0) {
                yield chunks.shift()!;
              }
            } finally {
              unsub();
            }
          },
        };
      },

      summarize: async (): Promise<void> => {
        // Copilot SDK handles context compaction automatically
        // via infinite sessions configuration
        console.warn(
          "CopilotClient.summarize(): Context compaction is handled automatically by the SDK"
        );
      },

      getContextUsage: async (): Promise<ContextUsage> => {
        // Token usage is tracked via session.usage_info events
        // Return cached values
        return {
          inputTokens: state.inputTokens,
          outputTokens: state.outputTokens,
          maxTokens: 200000, // Default context window
          usagePercentage: ((state.inputTokens + state.outputTokens) / 200000) * 100,
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
    };

    return session;
  }

  /**
   * Handle SDK session events and map to unified events
   */
  private handleSdkEvent(sessionId: string, event: SdkSessionEvent): void {
    const state = this.sessions.get(sessionId);

    // Track token usage from usage events
    if (event.type === "assistant.usage" && state) {
      state.inputTokens += event.data.inputTokens ?? 0;
      state.outputTokens += event.data.outputTokens ?? 0;
    }

    // Map to unified event type
    const eventType = mapSdkEventToEventType(event.type);
    if (eventType) {
      let eventData: Record<string, unknown> = {};

      switch (event.type) {
        case "session.start":
          eventData = { config: state?.config };
          break;
        case "session.idle":
          eventData = { reason: "idle" };
          break;
        case "session.error":
          eventData = { error: event.data.message };
          break;
        case "assistant.message_delta":
          eventData = { delta: event.data.deltaContent };
          break;
        case "assistant.message":
          eventData = {
            message: {
              type: "text",
              content: event.data.content,
              role: "assistant",
            },
          };
          break;
        case "tool.execution_start":
          eventData = {
            toolName: event.data.toolName,
            toolInput: event.data.arguments,
          };
          break;
        case "tool.execution_complete":
          eventData = {
            toolName: event.data.toolCallId,
            success: event.data.success,
            toolResult: event.data.result?.content,
            error: event.data.error?.message,
          };
          break;
        case "subagent.started":
          eventData = {
            subagentId: event.data.toolCallId,
            subagentType: event.data.agentName,
          };
          break;
        case "subagent.completed":
          eventData = {
            subagentId: event.data.toolCallId,
            success: true,
          };
          break;
        case "subagent.failed":
          eventData = {
            error: event.data.error,
          };
          break;
      }

      this.emitEvent(eventType, sessionId, eventData);
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
   * Convert unified tool definition to SDK tool format
   */
  private convertTool(tool: ToolDefinition): SdkTool {
    return {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
      handler: async (args) => tool.handler(args),
    };
  }

  /**
   * Create a new agent session
   */
  async createSession(config: SessionConfig = {}): Promise<Session> {
    if (!this.isRunning || !this.sdkClient) {
      throw new Error("Client not started. Call start() first.");
    }

    const sdkConfig: SdkSessionConfig = {
      sessionId: config.sessionId,
      model: config.model,
      systemMessage: config.systemPrompt
        ? { mode: "append", content: config.systemPrompt }
        : undefined,
      availableTools: config.tools,
      streaming: true,
      tools: this.registeredTools.map((t) => this.convertTool(t)),
      onPermissionRequest: this.permissionHandler || undefined,
    };

    const sdkSession = await this.sdkClient.createSession(sdkConfig);
    return this.wrapSession(sdkSession, config);
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
      return this.wrapSession(existingState.sdkSession, existingState.config);
    }

    // Try to resume session from SDK
    try {
      const resumeConfig: SdkResumeSessionConfig = {
        streaming: true,
        tools: this.registeredTools.map((t) => this.convertTool(t)),
        onPermissionRequest: this.permissionHandler || undefined,
      };
      const sdkSession = await this.sdkClient.resumeSession(sessionId, resumeConfig);
      return this.wrapSession(sdkSession, {});
    } catch {
      // Session not found or cannot be resumed
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
  }

  /**
   * Stop the client and clean up resources
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
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
   * Queries available models from the Copilot SDK and returns the first one.
   * @param _modelHint - Optional model hint (unused, queries SDK instead)
   */
  async getModelDisplayInfo(
    _modelHint?: string
  ): Promise<{ model: string; tier: string }> {
    if (!this.isRunning || !this.sdkClient) {
      return {
        model: "Copilot",
        tier: "GitHub Copilot",
      };
    }

    try {
      const models = await this.sdkClient.listModels();
      const firstModel = models?.[0];
      if (firstModel) {
        // Return the first available model's display name or ID
        return {
          model: firstModel.name ?? firstModel.id ?? "Copilot",
          tier: "GitHub Copilot",
        };
      }
    } catch {
      // Fall back to default if listModels fails
    }

    return {
      model: "Copilot",
      tier: "GitHub Copilot",
    };
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
