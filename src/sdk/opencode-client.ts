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
 *
 * AGENT-SPECIFIC LOGIC (why this module exists):
 * - OpenCode SDK uses SSE (Server-Sent Events) for real-time updates
 * - OpenCode SDK may require spawning a local server (auto-start feature)
 * - OpenCode SDK has unique agent modes (build, plan, general, explore)
 * - OpenCode SDK permission model uses opencode.json config files
 * - OpenCode SDK events (via SSE) require custom mapping to unified EventType
 * - OpenCode SDK uses message parts with different types (text, tool-invocation)
 * - OpenCode SDK has question.asked events for HITL workflows
 *
 * Common patterns (see base-client.ts) are duplicated here because:
 * - SSE event stream requires async generator processing
 * - Server lifecycle management (spawn/health check) is unique
 * - Session wrapping involves complex async iteration for streaming
 */

import {
  stripProviderPrefix,
  type CodingAgentClient,
  type Session,
  type SessionConfig,
  type AgentMessage,
  type ContextUsage,
  type McpRuntimeSnapshot,
  type EventType,
  type EventHandler,
  type AgentEvent,
  type ToolDefinition,
  type ToolContext,
  type OpenCodeAgentMode,
} from "./types.ts";

import { initOpenCodeConfigOverrides } from "./init.ts";
import { createToolMcpServerScript, cleanupMcpBridgeScripts } from "./tools/opencode-mcp-bridge.ts";

// Import the real SDK
import {
  createOpencodeClient as createSdkClient,
  type OpencodeClient as SdkClient,
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

function parseOpenCodeMcpToolId(toolId: string): { server: string; tool: string } | null {
  const match = toolId.match(/^mcp__(.+?)__(.+)$/);
  if (!match) return null;
  const server = match[1]?.trim();
  const tool = match[2]?.trim();
  if (!server || !tool) return null;
  return { server, tool };
}

function mapOpenCodeMcpStatusToAuth(status: string | undefined): "Not logged in" | undefined {
  if (status === "needs_auth") {
    return "Not logged in";
  }
  return undefined;
}

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

  /** Mutable model preference updated by /model command at runtime */
  private activePromptModel: { providerID: string; modelID: string } | undefined;

  /** Mutable context window updated when activePromptModel changes */
  private activeContextWindow: number | null = null;


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
        } else if (part?.type === "reasoning" && delta) {
          this.emitEvent("message.delta", partSessionId, {
            delta,
            contentType: "reasoning",
          });
        } else if (part?.type === "tool") {
          const toolState = part?.state as Record<string, unknown> | undefined;
          const toolName = (part?.tool as string) ?? "";
          const toolInput = (toolState?.input as Record<string, unknown>) ?? {};

          // Emit tool.start for pending or running status
          // OpenCode sends "pending" first, then "running" with more complete input.
          // Include the tool part ID so the UI can deduplicate events for
          // the same logical tool call (pending → running transitions).
          if (toolState?.status === "pending" || toolState?.status === "running") {
            this.emitEvent("tool.start", partSessionId, {
              toolName,
              toolInput,
              toolUseId: part?.id as string,
            });
          } else if (toolState?.status === "completed") {
            // Only emit complete if output is available
            // The output field contains the formatted file content
            const output = toolState?.output;
            if (output !== undefined) {
              this.emitEvent("tool.complete", partSessionId, {
                toolName,
                toolResult: output,
                toolInput,
                success: true,
                toolUseId: part?.id as string,
              });
            }
          } else if (toolState?.status === "error") {
            this.emitEvent("tool.complete", partSessionId, {
              toolName,
              toolResult: toolState?.error ?? "Tool execution failed",
              toolInput,
              success: false,
              toolUseId: part?.id as string,
            });
          }
        } else if (part?.type === "agent") {
          // AgentPart: { type: "agent", name, id, sessionID, messageID }
          // Map agent parts to subagent.start events
          this.emitEvent("subagent.start", partSessionId, {
            subagentId: (part?.id as string) ?? "",
            subagentType: (part?.name as string) ?? "",
          });
        } else if (part?.type === "step-finish") {
          // StepFinishPart signals the end of a sub-agent step
          // Map to subagent.complete with success based on reason
          const reason = (part?.reason as string) ?? "";
          this.emitEvent("subagent.complete", partSessionId, {
            subagentId: (part?.id as string) ?? "",
            success: reason !== "error",
            result: reason,
          });
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
   * Register MCP servers with the OpenCode server via client.mcp.add().
   * Converts unified McpServerConfig[] to OpenCode's McpLocalConfig | McpRemoteConfig format.
   */
  private async registerMcpServers(servers: NonNullable<SessionConfig["mcpServers"]>): Promise<void> {
    if (!this.sdkClient) return;

    for (const server of servers) {
      try {
        if (server.url) {
          // Remote MCP server (http/sse)
          await this.sdkClient.mcp.add({
            directory: this.clientOptions.directory,
            name: server.name,
            config: {
              type: "remote" as const,
              url: server.url,
              headers: server.headers,
              enabled: server.enabled !== false,
              timeout: server.timeout,
            },
          });
        } else if (server.command) {
          // Local MCP server (stdio)
          const command = [server.command, ...(server.args ?? [])];
          await this.sdkClient.mcp.add({
            directory: this.clientOptions.directory,
            name: server.name,
            config: {
              type: "local" as const,
              command,
              environment: server.env,
              enabled: server.enabled !== false,
              timeout: server.timeout,
            },
          });
        }
      } catch (error) {
        // Log but don't fail session creation if an MCP server fails to register
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`Failed to register MCP server '${server.name}': ${errorMsg}`);
      }
    }
  }

  /**
   * Register custom tools as a single MCP stdio server.
   * Bundles all registered tools into a temporary script and registers it via mcp.add().
   */
  private async registerToolsMcpServer(): Promise<void> {
    if (!this.sdkClient) return;

    const tools = Array.from(this.registeredTools.values());
    const scriptPath = await createToolMcpServerScript(tools);

    try {
      await this.sdkClient.mcp.add({
        directory: this.clientOptions.directory,
        name: "atomic-custom-tools",
        config: {
          type: "local" as const,
          command: ["bun", "run", scriptPath],
          enabled: true,
        },
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`Failed to register custom tools MCP server: ${errorMsg}`);
    }
  }

  /**
   * Create a new agent session
   */
  async createSession(config: SessionConfig = {}): Promise<Session> {
    if (!this.isRunning || !this.sdkClient) {
      throw new Error("Client not started. Call start() first.");
    }

    // Register MCP servers via client.mcp.add() before creating the session
    // OpenCode SDK uses server-level MCP (not per-session), so we add them here
    if (config.mcpServers && config.mcpServers.length > 0) {
      await this.registerMcpServers(config.mcpServers);
    }

    // Register custom tools as an MCP server if any are registered
    if (this.registeredTools.size > 0) {
      await this.registerToolsMcpServer();
    }

    const result = await this.sdkClient.session.create({
      directory: this.clientOptions.directory,
      title: config.sessionId ?? undefined,
      permission: initOpenCodeConfigOverrides(),
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

    // Re-register custom tools on resume (tools may have changed on disk)
    if (this.registeredTools.size > 0) {
      await this.registerToolsMcpServer();
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
  /**
   * Resolve a model string into OpenCode SDK's { providerID, modelID } format.
   * Strictly requires "providerID/modelID" format (e.g., "anthropic/claude-sonnet-4").
   * Bare model names without a provider prefix are rejected.
   */
  private resolveModelForPrompt(model?: string): { providerID: string; modelID: string } | undefined {
    if (!model) return undefined;
    if (model.includes("/")) {
      const [providerID, ...rest] = model.split("/");
      const modelID = rest.join("/");
      if (!providerID || !modelID) {
        throw new Error(
          `Invalid model format: '${model}'. Must be 'providerID/modelID' (e.g., 'anthropic/claude-sonnet-4').`
        );
      }
      return { providerID, modelID };
    }
    throw new Error(
      `Model '${model}' is missing a provider prefix. Use 'providerID/modelID' format (e.g., 'anthropic/${model}').`
    );
  }

  private async buildOpenCodeMcpSnapshot(): Promise<McpRuntimeSnapshot | null> {
    if (!this.sdkClient) {
      return null;
    }

    const directory = this.clientOptions.directory;
    const [statusResult, toolIdsResult, resourcesResult] = await Promise.allSettled([
      this.sdkClient.mcp.status({ directory }),
      this.sdkClient.tool.ids({ directory }),
      this.sdkClient.experimental.resource.list({ directory }),
    ]);

    let hasSuccessfulSource = false;
    const servers: McpRuntimeSnapshot["servers"] = {};

    const ensureServer = (name: string) => {
      if (!servers[name]) {
        servers[name] = {};
      }
      return servers[name]!;
    };

    if (statusResult.status === "fulfilled" && !statusResult.value.error && statusResult.value.data) {
      hasSuccessfulSource = true;
      const statuses = statusResult.value.data as Record<string, { status?: string }>;
      for (const [serverName, status] of Object.entries(statuses)) {
        const server = ensureServer(serverName);
        const authStatus = mapOpenCodeMcpStatusToAuth(status.status);
        if (authStatus) {
          server.authStatus = authStatus;
        }
      }
    }

    if (toolIdsResult.status === "fulfilled" && !toolIdsResult.value.error && Array.isArray(toolIdsResult.value.data)) {
      hasSuccessfulSource = true;
      for (const toolId of toolIdsResult.value.data) {
        if (typeof toolId !== "string") continue;
        const parsed = parseOpenCodeMcpToolId(toolId);
        if (!parsed) continue;
        const server = ensureServer(parsed.server);
        const toolNames = server.tools ?? [];
        toolNames.push(toolId);
        server.tools = toolNames;
      }
    }

    if (resourcesResult.status === "fulfilled" && !resourcesResult.value.error && resourcesResult.value.data) {
      hasSuccessfulSource = true;
      const resourceMap = resourcesResult.value.data as Record<string, {
        name?: string;
        uri?: string;
        client?: string;
      }>;
      for (const resource of Object.values(resourceMap)) {
        if (!resource.client || !resource.name || !resource.uri) continue;
        const server = ensureServer(resource.client);
        const serverResources = server.resources ?? [];
        serverResources.push({
          name: resource.name,
          uri: resource.uri,
        });
        server.resources = serverResources;
      }
    }

    if (!hasSuccessfulSource) {
      return null;
    }

    for (const server of Object.values(servers)) {
      if (server.tools && server.tools.length > 0) {
        server.tools = [...new Set(server.tools)].sort((a, b) => a.localeCompare(b));
      }

      if (server.resources && server.resources.length > 0) {
        const deduped: typeof server.resources = [];
        const seen = new Set<string>();
        for (const resource of server.resources) {
          const key = `${resource.name}\u0000${resource.uri}`;
          if (seen.has(key)) continue;
          seen.add(key);
          deduped.push(resource);
        }
        server.resources = deduped.sort((a, b) => {
          const byName = a.name.localeCompare(b.name);
          if (byName !== 0) return byName;
          return a.uri.localeCompare(b.uri);
        });
      }
    }

    return { servers };
  }

  private async wrapSession(sessionId: string, config: SessionConfig): Promise<Session> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const client = this;
    // Use agent mode from session config, falling back to client default, then "build"
    const agentMode =
      config.agentMode ??
      client.clientOptions.defaultAgentMode ??
      "build";
    // Parse initial model preference as fallback; runtime switches use client.activePromptModel
    const initialPromptModel = client.resolveModelForPrompt(config.model);
    if (!client.activePromptModel && initialPromptModel) {
      client.activePromptModel = initialPromptModel;
    }

    // Track session state for token usage and lifecycle
    const sessionState = {
      inputTokens: 0,
      outputTokens: 0,
      isClosed: false,
      contextWindow: null as number | null,
      systemToolsBaseline: null as number | null,
    };

    // Eagerly resolve contextWindow from provider metadata
    const modelId = config.model;
    sessionState.contextWindow = await client.resolveModelContextWindow(modelId);

    const session: Session = {
      id: sessionId,

      send: async (message: string): Promise<AgentMessage> => {
        if (sessionState.isClosed) {
          throw new Error("Session is closed");
        }
        if (!client.sdkClient) {
          throw new Error("Client not connected");
        }

        const result = await client.sdkClient.session.prompt({
          sessionID: sessionId,
          directory: client.clientOptions.directory,
          agent: agentMode,
          model: client.activePromptModel ?? initialPromptModel,
          system: config.systemPrompt || undefined,
          parts: [{ type: "text", text: message }],
        });

        if (result.error) {
          const err = result.error as Record<string, unknown>;
          const errorDetail = typeof err === "string" ? err : JSON.stringify(err);
          throw new Error(`Failed to send message: ${errorDetail}`);
        }

        // Update token counts from SDK response
        const tokens = result.data?.info?.tokens;
        if (tokens) {
          sessionState.inputTokens = tokens.input ?? sessionState.inputTokens;
          sessionState.outputTokens = tokens.output ?? sessionState.outputTokens;
        }

        // Extract text content from parts
        const parts = result.data?.parts ?? [];
        const textParts = parts.filter(
          (p) => (p as Record<string, unknown>).type === "text"
        );
        const content = textParts
          .map((p) => ((p as Record<string, unknown>).text as string) ?? "")
          .join("");

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

            // Note: input tokens are updated from result.data.info?.tokens after prompt resolves

            // Set up streaming via SSE events
            // OpenCode streams text deltas via message.part.updated events
            const deltaQueue: AgentMessage[] = [];
            let resolveNext: (() => void) | null = null;
            let streamDone = false;
            let streamError: Error | null = null;

            // Handler for delta events from SSE
            const handleDelta = (event: AgentEvent<"message.delta">) => {
              // Only handle events for our session
              if (event.sessionId !== sessionId) return;

              const delta = event.data?.delta as string | undefined;
              const contentType = event.data?.contentType as string | undefined;
              if (delta) {
                deltaQueue.push({
                  type: contentType === "reasoning" ? "thinking" as const : "text" as const,
                  content: delta,
                  role: "assistant" as const,
                  ...(contentType === "reasoning" ? {
                    metadata: {
                      streamingStats: {
                        thinkingMs: 0,
                        outputTokens: 0,
                      },
                    },
                  } : {}),
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
                model: client.activePromptModel ?? initialPromptModel,
                system: config.systemPrompt || undefined,
                parts: [{ type: "text", text: message }],
              });

              if (result.error) {
                throw new Error(`Failed to send message: ${result.error}`);
              }

              // Track if we already yielded text content from direct response
              // to avoid duplicating with SSE deltas
              let yieldedTextFromResponse = false;

              // Wall-clock thinking timing
              let reasoningStartMs: number | null = null;
              let reasoningDurationMs = 0;

              // If we got a direct response (no SSE streaming), yield it
              // This handles cases where the SDK returns immediately
              if (result.data?.parts) {
                const parts = result.data.parts;
                for (const part of parts) {
                  if (part.type === "text" && part.text) {
                    yieldedTextFromResponse = true;
                    yield {
                      type: "text" as const,
                      content: part.text,
                      role: "assistant" as const,
                    };
                  } else if (part.type === "reasoning" && part.text) {
                    if (reasoningStartMs === null) {
                      reasoningStartMs = Date.now();
                    }
                    yield {
                      type: "thinking" as const,
                      content: part.text,
                      role: "assistant" as const,
                      metadata: {
                        streamingStats: {
                          thinkingMs: reasoningDurationMs + (Date.now() - reasoningStartMs),
                          outputTokens: 0,
                        },
                      },
                    };
                  } else if (part.type === "tool") {
                    // Accumulate reasoning duration when transitioning away from reasoning
                    if (reasoningStartMs !== null) {
                      reasoningDurationMs += Date.now() - reasoningStartMs;
                      reasoningStartMs = null;
                    }
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

                  // Capture system/tools baseline from cache tokens
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const cacheTokens = (((tokens as any).cache?.write ?? 0) + ((tokens as any).cache?.read ?? 0));
                  if (cacheTokens > 0) {
                    sessionState.systemToolsBaseline = cacheTokens;
                  }
                }

                // Yield actual token counts to UI
                if (sessionState.outputTokens > 0 || reasoningDurationMs > 0) {
                  yield {
                    type: "text" as const,
                    content: "",
                    role: "assistant" as const,
                    metadata: {
                      streamingStats: {
                        outputTokens: sessionState.outputTokens,
                        thinkingMs: reasoningDurationMs,
                      },
                    },
                  };
                }
              }

              // Yield any SSE deltas that arrived, but skip if we already yielded text from direct response
              // This prevents duplication when OpenCode returns content both in direct response AND via SSE
              if (!yieldedTextFromResponse) {
                while (!streamDone || deltaQueue.length > 0) {
                  if (deltaQueue.length > 0) {
                    const msg = deltaQueue.shift()!;
                    // Track reasoning duration from SSE deltas
                    if (msg.type === "thinking") {
                      if (reasoningStartMs === null) {
                        reasoningStartMs = Date.now();
                      }
                      const currentMs = reasoningDurationMs + (Date.now() - reasoningStartMs);
                      msg.metadata = {
                        streamingStats: { thinkingMs: currentMs, outputTokens: 0 },
                      };
                    } else if (reasoningStartMs !== null) {
                      reasoningDurationMs += Date.now() - reasoningStartMs;
                      reasoningStartMs = null;
                    }
                    yield msg;
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

              // Actual token counts come from result.data.info?.tokens (yielded above).
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

        // Query actual post-compaction token counts from the SDK.
        // session.messages() returns each message with its token snapshot,
        // so the last assistant message reflects the post-compaction state.
        try {
          const messagesResult = await client.sdkClient.session.messages({
            sessionID: sessionId,
          });
          const messages = messagesResult.data ?? [];
          for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i]!.info;
            if (msg.role === "assistant" && "tokens" in msg) {
              sessionState.inputTokens = msg.tokens.input ?? sessionState.inputTokens;
              sessionState.outputTokens = msg.tokens.output ?? 0;
              const cacheTokens = (msg.tokens.cache?.write ?? 0) + (msg.tokens.cache?.read ?? 0);
              if (cacheTokens > 0) {
                sessionState.systemToolsBaseline = cacheTokens;
              }
              break;
            }
          }
        } catch {
          // If messages() fails, token counts remain at pre-compaction values.
          // They will self-correct on the next message (snapshot tracking).
        }

        client.emitEvent("session.idle", sessionId, {
          reason: "context_compacted",
        });
      },

      getContextUsage: async (): Promise<ContextUsage> => {
        // Prefer runtime context window (updated by setActivePromptModel) over initial
        const maxTokens = client.activeContextWindow ?? sessionState.contextWindow;
        if (maxTokens === null) {
          throw new Error("Context window size unavailable: provider.list() did not return model limits.");
        }
        const totalTokens = sessionState.inputTokens + sessionState.outputTokens;
        return {
          inputTokens: sessionState.inputTokens,
          outputTokens: sessionState.outputTokens,
          maxTokens,
          usagePercentage: (totalTokens / maxTokens) * 100,
        };
      },

      getSystemToolsTokens: (): number => {
        if (sessionState.systemToolsBaseline === null) {
          throw new Error("System tools baseline unavailable: no query has completed. Send a message first.");
        }
        return sessionState.systemToolsBaseline;
      },

      getMcpSnapshot: async (): Promise<McpRuntimeSnapshot | null> => {
        if (sessionState.isClosed) {
          return null;
        }
        return client.buildOpenCodeMcpSnapshot();
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
   * Set the active prompt model at runtime (e.g., after /model switch).
   * Updates both the model used for send()/stream() and the cached context window.
   * @param model - Model string in "providerID/modelID" or short alias form
   */
  async setActivePromptModel(model?: string): Promise<void> {
    this.activePromptModel = this.resolveModelForPrompt(model);
    // Update cached context window for getContextUsage()
    try {
      this.activeContextWindow = await this.resolveModelContextWindow(model);
    } catch {
      // If resolution fails, keep old value — will self-correct on next message
    }
  }

  /**
   * Get the active context window size (updated when model changes at runtime).
   * Returns null if no runtime model switch has occurred.
   */
  getActiveContextWindow(): number | null {
    return this.activeContextWindow;
  }

  /**
   * Get model display information for UI rendering.
   * Uses the raw model ID (stripped of provider prefix) for display.
   * @param modelHint - Optional model hint from saved preferences
   */
  async getModelDisplayInfo(
    modelHint?: string
  ): Promise<{ model: string; tier: string; contextWindow?: number }> {
    let contextWindow = this.activeContextWindow ?? undefined;
    if (this.isRunning && this.sdkClient) {
      try {
        contextWindow = await this.resolveModelContextWindow(modelHint);
      } catch {
        // Keep cached value when provider metadata is temporarily unavailable.
      }
    }

    // Use raw model ID (strip provider prefix) for display
    if (modelHint) {
      return {
        model: stripProviderPrefix(modelHint),
        tier: "OpenCode",
        contextWindow,
      };
    }

    // No hint - try to get the default model ID from SDK providers
    if (this.isRunning && this.sdkClient) {
      const rawId = await this.lookupRawModelIdFromProviders();
      if (rawId) {
        return { model: rawId, tier: "OpenCode", contextWindow };
      }
    }

    return {
      model: "OpenCode",
      tier: "OpenCode",
      contextWindow,
    };
  }

  /**
   * Resolve a model's context window size from SDK provider metadata.
   * @param modelHint - Optional model ID (e.g., "anthropic/claude-sonnet-4")
   * @returns The model's context window size in tokens
   * @throws If provider metadata cannot be fetched or model is not found
   */
  private async resolveModelContextWindow(modelHint?: string): Promise<number> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const configClient = this.sdkClient as any;
    if (!configClient.config || typeof configClient.config.providers !== "function") {
      throw new Error(
        `Failed to resolve context window size from OpenCode provider.list() for model '${modelHint ?? "unknown"}'`
      );
    }

    const result = await configClient.config.providers();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = result.data as any;
    if (!data) {
      throw new Error(
        `Failed to resolve context window size from OpenCode provider.list() for model '${modelHint ?? "unknown"}'`
      );
    }

    const providerList: Array<{ id: string; models?: Record<string, { limit?: { context: number } }> }> =
      data.providers ?? data.all ?? [];

    // If we have a model hint, try to find it in provider models
    if (modelHint) {
      const parsed = this.resolveModelForPrompt(modelHint);
      if (parsed) {
        const provider = providerList.find(p => p.id === parsed.providerID);
        const model = provider?.models?.[parsed.modelID];
        if (model?.limit?.context) return model.limit.context;
      }
    }

    // Fall back to the first default model
    const defaults: Record<string, string> | undefined = data.default;
    if (defaults) {
      const firstProvider = Object.keys(defaults)[0];
      if (firstProvider) {
        const defaultModelId = defaults[firstProvider];
        if (defaultModelId) {
          const provider = providerList.find(p => p.id === firstProvider);
          const model = provider?.models?.[defaultModelId];
          if (model?.limit?.context) return model.limit.context;
        }
      }
    }

    throw new Error(
      `Failed to resolve context window size from OpenCode provider.list() for model '${modelHint ?? "unknown"}'`
    );
  }

  /**
   * Look up a model's display name from SDK provider metadata.
   * Queries config.providers() and matches by provider/model ID.
   * @param modelHint - Optional model ID to look up (e.g., "anthropic/claude-sonnet-4")
   * @returns The model's name from SDK metadata, or undefined if not found
   */
  private async lookupRawModelIdFromProviders(): Promise<string | undefined> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const configClient = this.sdkClient as any;
      if (!configClient.config || typeof configClient.config.providers !== "function") {
        return undefined;
      }

      const result = await configClient.config.providers();
      const data = result.data as {
        default?: Record<string, string>;
      } | undefined;
      if (!data) return undefined;

      // Return the first default model's raw ID
      const defaults = data.default;
      if (defaults) {
        const firstProvider = Object.keys(defaults)[0];
        if (firstProvider) {
          const modelId = defaults[firstProvider];
          if (modelId) return modelId;
        }
      }
    } catch {
      // Silently fail - caller handles fallback
    }
    return undefined;
  }

  /**
   * Get the system tools token baseline.
   * OpenCode SDK does not provide a lightweight probe mechanism;
   * the baseline is only available after the first message completes.
   */
  getSystemToolsTokens(): number | null {
    return null;
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
