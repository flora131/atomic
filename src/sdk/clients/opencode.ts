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
  type OpenCodeAgentMode,
} from "../types.ts";

import { initOpenCodeConfigOverrides } from "../init.ts";
import {
  createToolMcpServerScript,
  startToolDispatchServer,
  stopToolDispatchServer,
} from "../tools/opencode-mcp-bridge.ts";

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

/**
 * Debug logging helper gated behind ATOMIC_DEBUG environment variable
 * Used to verify event emission at runtime during development
 */
const debugLog = process.env.ATOMIC_DEBUG
  ? (label: string, data: Record<string, unknown>) =>
      console.debug(`[opencode:${label}]`, JSON.stringify(data, null, 2))
  : () => {};

/**
 * Part types accepted by OpenCode SDK's session.prompt().
 * These mirror the SDK's TextPartInput and AgentPartInput types.
 */
type OpenCodeTextPart = { type: "text"; text: string };
type OpenCodeAgentPart = {
  type: "agent";
  name: string;
  source?: { value: string; start: number; end: number };
};
type OpenCodePromptPart = OpenCodeTextPart | OpenCodeAgentPart;

/**
 * Build an array of prompt parts for the OpenCode SDK's session.prompt() API.
 *
 * When an `agentName` is provided (from structured dispatch options), the
 * message is split into a TextPartInput + AgentPartInput. The AgentPartInput
 * triggers the OpenCode SDK's native sub-agent dispatch (which internally
 * creates a synthetic "task tool" invocation).
 *
 * Messages without an agent name are returned as a single TextPartInput.
 *
 * @param message - The message text to send
 * @param agentName - Optional sub-agent name for dispatch via AgentPartInput
 * @returns An array of prompt parts (text and/or agent) for the SDK
 */
function buildOpenCodePromptParts(message: string, agentName?: string): OpenCodePromptPart[] {
  if (!agentName) {
    return [{ type: "text", text: message }];
  }

  const parts: OpenCodePromptPart[] = [];

  // Add the task text first so the agent has context to work with
  if (message.trim()) {
    parts.push({ type: "text", text: message });
  }

  // AgentPartInput triggers the SDK's sub-agent dispatch
  parts.push({ type: "agent", name: agentName });

  return parts;
}

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
 * Builds an MCP runtime snapshot from OpenCode SDK client API calls.
 * 
 * This is a pure function that takes an SDK client and directory path,
 * queries the OpenCode MCP status/tools/resources, and returns a normalized
 * snapshot structure.
 * 
 * @param sdkClient - The OpenCode SDK client instance
 * @param directory - The project directory path
 * @returns A normalized MCP runtime snapshot, or null if all sources fail
 */
export async function buildOpenCodeMcpSnapshot(
  sdkClient: {
    mcp: {
      status: (params: { directory: string }) => Promise<{
        data?: Record<string, { status?: string }>;
        error?: unknown;
      }>;
    };
    tool: {
      ids: (params: { directory: string }) => Promise<{
        data?: string[];
        error?: unknown;
      }>;
    };
    experimental: {
      resource: {
        list: (params: { directory: string }) => Promise<{
          data?: Record<string, {
            name?: string;
            uri?: string;
            client?: string;
          }>;
          error?: unknown;
        }>;
      };
    };
  },
  directory: string
): Promise<McpRuntimeSnapshot | null> {
  const [statusResult, toolIdsResult, resourcesResult] = await Promise.allSettled([
    sdkClient.mcp.status({ directory }),
    sdkClient.tool.ids({ directory }),
    sdkClient.experimental.resource.list({ directory }),
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
  private dispatchServerStop: (() => void) | null = null;

  /** Mutable model preference updated by /model command at runtime */
  private activePromptModel: { providerID: string; modelID: string } | undefined;

  /** Mutable context window updated when activePromptModel changes */
  private activeContextWindow: number | null = null;

  /**
   * Sub-agent child session tracking.
   *
   * The OpenCode SDK's AgentPart/SubtaskPart carry `sessionID` referencing
   * the PARENT session (where the part was created), not the child session.
   * The actual child session ID only appears on ToolPart events emitted by
   * the sub-agent.  We track pending agents and lazily discover their child
   * sessions when the first tool event arrives from an unknown session.
   */
  private pendingAgentParts: Array<{ partId: string; agentName: string }> = [];
  private childSessionToAgentPart = new Map<string, string>();
  /** Tool use counts per sub-agent (agentPartId → count) for subagent.update events */
  private subagentToolCounts = new Map<string, number>();

  /**
   * Pending Task-tool ToolPart IDs.
   *
   * When a ToolPart for the "task" tool arrives (pending/running), we record
   * its `part.id` here.  When the corresponding AgentPart or SubtaskPart
   * arrives we shift the oldest entry and pass it as `toolCallId` on the
   * `subagent.start` event.  This ensures the UI's ToolPart.toolCallId and
   * ParallelAgent.taskToolCallId use the same value, enabling the suppression
   * logic in `getConsumedTaskToolCallIds` to hide the Task tool card.
   */
  private pendingTaskToolPartIds: string[] = [];
  private queuedTaskToolPartIds = new Set<string>();

  /**
   * Tracks Task ToolPart IDs for which we have already synthesized a
   * `subagent.start` event.  OpenCode does NOT emit `type: "agent"` parts
   * during task tool execution — it only emits `type: "tool"` parts.  We
   * detect Task tools transitioning to "running" and synthesize the
   * corresponding sub-agent events so the UI renders an agent tree instead
   * of a raw tool card.
   */
  private synthesizedTaskAgentIds = new Set<string>();
  private synthesizedTaskAgentTypes = new Map<string, string>();

  /**
   * Create a new OpenCodeClient
   * @param options - Client options
   */
  constructor(options: OpenCodeClientOptions = {}) {
    // Always pin the directory to the caller's cwd by default.
    // OpenCode resolves agent definitions from the provided directory context,
    // and leaving this undefined can make sub-agent lookup depend on an
    // unrelated server process working directory.
    const resolvedDirectory = options.directory ?? process.cwd();
    this.clientOptions = {
      baseUrl: DEFAULT_OPENCODE_BASE_URL,
      maxRetries: DEFAULT_MAX_RETRIES,
      retryDelay: DEFAULT_RETRY_DELAY,
      ...options,
      directory: resolvedDirectory,
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
    this.pendingAgentParts = [];
    this.childSessionToAgentPart.clear();
    this.subagentToolCounts.clear();
    this.pendingTaskToolPartIds = [];
    this.queuedTaskToolPartIds.clear();
    this.synthesizedTaskAgentIds.clear();
    this.synthesizedTaskAgentTypes.clear();

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

  private enqueuePendingTaskToolPartId(taskPartId: string): void {
    if (this.queuedTaskToolPartIds.has(taskPartId)) return;
    this.pendingTaskToolPartIds.push(taskPartId);
    this.queuedTaskToolPartIds.add(taskPartId);
  }

  private dequeuePendingTaskToolPartId(): string | undefined {
    const taskPartId = this.pendingTaskToolPartIds.shift();
    if (taskPartId) {
      this.queuedTaskToolPartIds.delete(taskPartId);
    }
    return taskPartId;
  }

  private removePendingTaskToolPartId(taskPartId: string): void {
    const idx = this.pendingTaskToolPartIds.indexOf(taskPartId);
    if (idx !== -1) {
      this.pendingTaskToolPartIds.splice(idx, 1);
    }
    this.queuedTaskToolPartIds.delete(taskPartId);
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
        // OpenCode emits session ID under properties.info.id (not properties.sessionID).
        // Fall back to sessionID for defensive compatibility with older payloads.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.emitEvent(
          "session.start",
          ((properties?.info as any)?.id as string) ?? (properties?.sessionID as string) ?? "",
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

      case "session.compacted":
        this.emitEvent(
          "session.compaction",
          (properties?.sessionID as string) ?? "",
          {
            phase: "complete",
            success: true,
          }
        );
        break;

      case "message.updated": {
        // Handle message updates (info contains the message)
        const info = properties?.info as Record<string, unknown> | undefined;
        if (info?.role === "assistant") {
          const msgSessionId = (info?.sessionID as string) ?? "";
          this.emitEvent("message.complete", msgSessionId, {
            message: info,
          });

          // Extract token usage from assistant message updates (carries
          // cumulative tokens at each step boundary, delivered via SSE)
          const msgTokens = info?.tokens as
            | { input?: number; output?: number; reasoning?: number }
            | undefined;
          if (msgTokens && (msgTokens.input || msgTokens.output)) {
            this.emitEvent("usage", msgSessionId, {
              inputTokens: msgTokens.input ?? 0,
              outputTokens: msgTokens.output ?? 0,
            });
          }
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
            thinkingSourceKey: (part?.id as string) ?? undefined,
          });
        } else if (part?.type === "tool") {
          const toolState = part?.state as Record<string, unknown> | undefined;
          const toolName = (part?.tool as string) ?? "";
          const toolInput = (toolState?.input as Record<string, unknown>) ?? {};

          // --- Child session discovery for sub-agent tools ---
          // When a ToolPart arrives from a session that is NOT the parent
          // session, it belongs to a sub-agent's child session.  On first
          // encounter we associate the child session with the oldest pending
          // agent part and re-emit subagent.start with the correct
          // subagentSessionId so the UI registers the child session in
          // ownedSessionIds before the tool.start event arrives.
          debugLog("tool-part-session-check", {
            toolName,
            partSessionId,
            currentSessionId: this.currentSessionId ?? "null",
            propertiesSessionID: (properties?.sessionID as string) ?? "undefined",
            partSessionID: (part?.sessionID as string) ?? "undefined",
            pendingAgentParts: this.pendingAgentParts.length,
            childSessionAlreadyKnown: this.childSessionToAgentPart.has(partSessionId),
            toolStatus: (toolState?.status as string) ?? "unknown",
          });
          if (
            partSessionId &&
            this.currentSessionId &&
            partSessionId !== this.currentSessionId &&
            !this.childSessionToAgentPart.has(partSessionId)
          ) {
            const pending = this.pendingAgentParts.shift();
            if (pending) {
              this.childSessionToAgentPart.set(partSessionId, pending.partId);
              debugLog("child-session-discovered", {
                childSessionId: partSessionId,
                agentPartId: pending.partId,
                agentName: pending.agentName,
              });
              // Re-emit subagent.start with the correct child session ID.
              // The UI handles duplicate subagent.start by updating in-place
              // and — critically — registers the subagentSessionId in
              // ownedSessionIds + subagentSessionToAgentId.
              this.emitEvent("subagent.start", this.currentSessionId, {
                subagentId: pending.partId,
                subagentType: pending.agentName,
                subagentSessionId: partSessionId,
              });
            }
          }

          // Emit tool.start for pending or running status
          // OpenCode sends "pending" first, then "running" with more complete input.
          // Include the tool part ID so the UI can deduplicate events for
          // the same logical tool call (pending → running transitions).
          if (toolState?.status === "pending" || toolState?.status === "running") {
            const isTaskTool = toolName === "task" || toolName === "Task";
            const isParentSessionTaskTool =
              !this.currentSessionId || partSessionId === this.currentSessionId;

            if (isTaskTool) {
              const taskPartId = part?.id as string;
              if (taskPartId && isParentSessionTaskTool) {
                this.enqueuePendingTaskToolPartId(taskPartId);
              }
            }

            // Emit tool.start for non-task tools and parent-session task tools.
            // Parent task tools provide an anchor so the sub-agent tree renders
            // inline with the task invocation instead of pinning at the bottom.
            if (!isTaskTool || isParentSessionTaskTool) {
              debugLog("tool.start", {
                toolName,
                toolId: part?.id as string,
                hasToolInput: !!toolInput && Object.keys(toolInput).length > 0,
              });
              this.emitEvent("tool.start", partSessionId, {
                toolName,
                toolInput,
                toolUseId: part?.id as string,
                toolCallId: part?.callID as string,
              });
            }

            // OpenCode does NOT emit "agent" parts for task tool execution —
            // it only emits "tool" parts.  Synthesize subagent.start so the
            // UI renders an agent tree instead of a raw tool card.
            // On the first "running" event, input may still be incomplete
            // (OpenCode streams input incrementally).  Subsequent "running"
            // events re-emit subagent.start to update the task label once
            // the full description/prompt is available.
            if (isTaskTool && isParentSessionTaskTool) {
              const taskPartId = part?.id as string;
              if (taskPartId) {
                const explicitAgentType =
                  (toolInput?.subagent_type as string) ||
                  (toolInput?.agent_type as string) ||
                  "";
                const knownAgentType = this.synthesizedTaskAgentTypes.get(taskPartId) ?? "";
                const agentType = explicitAgentType || knownAgentType || "task";
                const agentId = `task-agent-${taskPartId}`;
                const task =
                  (toolInput?.description as string) ||
                  (toolInput?.prompt as string) ||
                  "";

                if (!this.synthesizedTaskAgentIds.has(taskPartId)) {
                  // First event for this Task tool: create the agent.
                  this.synthesizedTaskAgentIds.add(taskPartId);
                  this.synthesizedTaskAgentTypes.set(taskPartId, agentType);

                  debugLog("synthesized-subagent-start", {
                    agentId,
                    agentType,
                    toolCallId: taskPartId,
                    task,
                  });

                  this.pendingAgentParts.push({ partId: agentId, agentName: agentType });
                  this.emitEvent("subagent.start", this.currentSessionId ?? partSessionId, {
                    subagentId: agentId,
                    subagentType: agentType,
                    toolCallId: taskPartId,
                    task,
                    toolInput: toolInput as Record<string, unknown>,
                  });
                } else if (task && toolState?.status === "running") {
                  if (explicitAgentType) {
                    this.synthesizedTaskAgentTypes.set(taskPartId, explicitAgentType);
                  }
                  const stableAgentType =
                    this.synthesizedTaskAgentTypes.get(taskPartId) ?? agentType;
                  // Subsequent "running" event with a real task description:
                  // re-emit to update the agent label (chat.tsx merges
                  // via data.task || agent.task so empty strings are safe).
                  this.emitEvent("subagent.start", this.currentSessionId ?? partSessionId, {
                    subagentId: agentId,
                    subagentType: stableAgentType,
                    toolCallId: taskPartId,
                    task,
                  });
                }
              }
            }

            // Emit subagent.update for child session tools
            const agentPartId = this.childSessionToAgentPart.get(partSessionId);
            if (agentPartId && toolState?.status === "running") {
              const count = (this.subagentToolCounts.get(agentPartId) ?? 0) + 1;
              this.subagentToolCounts.set(agentPartId, count);
              this.emitEvent("subagent.update", this.currentSessionId ?? partSessionId, {
                subagentId: agentPartId,
                currentTool: toolName,
                toolUses: count,
              });
            }
          } else if (toolState?.status === "completed") {
            const isTaskTool = toolName === "task" || toolName === "Task";
            const isParentSessionTaskTool =
              !this.currentSessionId || partSessionId === this.currentSessionId;

            // Emit tool.complete for non-task tools and parent-session task tools.
            if (!isTaskTool || isParentSessionTaskTool) {
              this.emitEvent("tool.complete", partSessionId, {
                toolName,
                toolResult: toolState?.output,
                toolInput,
                success: true,
                toolUseId: part?.id as string,
                toolCallId: part?.callID as string,
              });
            }

            // For synthesized Task agents, emit subagent.complete and
            // register the child session (discovered from tool metadata).
            if (isTaskTool) {
              const taskPartId = part?.id as string;
              if (taskPartId) {
                this.removePendingTaskToolPartId(taskPartId);
              }
              if (
                taskPartId &&
                isParentSessionTaskTool &&
                this.synthesizedTaskAgentIds.has(taskPartId)
              ) {
                const agentId = `task-agent-${taskPartId}`;
                const metadata = toolState?.metadata as Record<string, unknown> | undefined;
                const childSessionId = metadata?.sessionId as string | undefined;
                const agentType =
                  this.synthesizedTaskAgentTypes.get(taskPartId) ||
                  (toolInput?.subagent_type as string) ||
                  (toolInput?.agent_type as string) ||
                  "task";

                if (childSessionId) {
                  this.childSessionToAgentPart.set(childSessionId, agentId);
                  this.emitEvent("subagent.start", this.currentSessionId ?? partSessionId, {
                    subagentId: agentId,
                    subagentType: agentType,
                    subagentSessionId: childSessionId,
                  });
                }

                const output = toolState?.output;
                this.emitEvent("subagent.complete", this.currentSessionId ?? partSessionId, {
                  subagentId: agentId,
                  success: true,
                  result: typeof output === "string" ? output : undefined,
                });

                this.synthesizedTaskAgentIds.delete(taskPartId);
                this.synthesizedTaskAgentTypes.delete(taskPartId);
              }
            }
          } else if (toolState?.status === "error") {
            const isTaskTool = toolName === "task" || toolName === "Task";
            const isParentSessionTaskTool =
              !this.currentSessionId || partSessionId === this.currentSessionId;

            // Emit tool.complete for non-task tools and parent-session task tools.
            if (!isTaskTool || isParentSessionTaskTool) {
              this.emitEvent("tool.complete", partSessionId, {
                toolName,
                toolResult: toolState?.error ?? "Tool execution failed",
                toolInput,
                success: false,
                toolUseId: part?.id as string,
                toolCallId: part?.callID as string,
              });
            }

            // For synthesized Task agents, emit subagent.complete with failure.
            if (isTaskTool) {
              const taskPartId = part?.id as string;
              if (taskPartId) {
                this.removePendingTaskToolPartId(taskPartId);
              }
              if (
                taskPartId &&
                isParentSessionTaskTool &&
                this.synthesizedTaskAgentIds.has(taskPartId)
              ) {
                const agentId = `task-agent-${taskPartId}`;
                this.emitEvent("subagent.complete", this.currentSessionId ?? partSessionId, {
                  subagentId: agentId,
                  success: false,
                  result: (toolState?.error as string) ?? "Task execution failed",
                });
                this.synthesizedTaskAgentIds.delete(taskPartId);
                this.synthesizedTaskAgentTypes.delete(taskPartId);
              }
            }
          }
        } else if (part?.type === "agent") {
          // AgentPart: { type: "agent", name, id, sessionID, messageID }
          // Map agent parts to subagent.start events.
          //
          // NOTE: AgentPart.sessionID is the PARENT session (where the part
          // was created), NOT the child sub-agent session.  The child session
          // ID is only discoverable from subsequent ToolPart events emitted
          // by the sub-agent.  We enqueue this agent and will re-emit
          // subagent.start with the correct subagentSessionId once the first
          // child tool event reveals the child session.
          const agentPartId = (part?.id as string) ?? "";
          const agentName = (part?.name as string) ?? "";

          // Use the pending Task ToolPart ID as the correlation ID so the
          // UI can match the agent tree to the Task tool card and suppress
          // the redundant tool card display.  The ToolPart for "task" is
          // always emitted before the AgentPart it spawns.
          const taskToolPartId = this.dequeuePendingTaskToolPartId();
          const correlationId = taskToolPartId ?? (part?.callID as string) ?? agentPartId;
          debugLog("subagent.start", {
            partType: "agent",
            subagentId: agentPartId,
            subagentType: agentName,
            toolCallId: correlationId,
            taskToolPartId: taskToolPartId ?? "none",
          });
          this.pendingAgentParts.push({ partId: agentPartId, agentName });
          this.emitEvent("subagent.start", partSessionId, {
            subagentId: agentPartId,
            subagentType: agentName,
            toolCallId: correlationId,
            // subagentSessionId intentionally omitted — part.sessionID is
            // the parent session, not the child.  The correct child session
            // will be registered via a follow-up subagent.start when the
            // first child tool event arrives.
          });
        } else if (part?.type === "subtask") {
          // SubtaskPart: { type: "subtask", prompt, description, agent, ... }
          // Some OpenCode versions emit sub-agent dispatch as "subtask" parts
          // instead of "agent" parts. Normalize both to subagent.start.
          //
          // Same child-session caveat as AgentPart above: SubtaskPart.sessionID
          // is the parent session.  We enqueue and defer child session discovery.
          const subtaskPartId = (part?.id as string) ?? "";
          const subtaskPrompt = (part?.prompt as string) ?? "";
          const subtaskDescription = (part?.description as string) ?? "";
          const subtaskAgent = (part?.agent as string) ?? "";

          // Use the pending Task ToolPart ID for correlation (same as AgentPart above).
          const taskToolPartId = this.dequeuePendingTaskToolPartId();
          const correlationId = taskToolPartId ?? subtaskPartId;
          debugLog("subagent.start", {
            partType: "subtask",
            subagentId: subtaskPartId,
            subagentType: subtaskAgent,
            toolCallId: correlationId,
            taskToolPartId: taskToolPartId ?? "none",
          });
          this.pendingAgentParts.push({ partId: subtaskPartId, agentName: subtaskAgent });
          this.emitEvent("subagent.start", partSessionId, {
            subagentId: subtaskPartId,
            subagentType: subtaskAgent,
            task: subtaskDescription || subtaskPrompt,
            toolCallId: correlationId,
            toolInput: {
              prompt: subtaskPrompt,
              description: subtaskDescription,
              agent: subtaskAgent,
            },
            // subagentSessionId intentionally omitted — see AgentPart comment.
          });
        } else if (part?.type === "step-finish") {
          // StepFinishPart signals the end of a sub-agent step
          // Map to subagent.complete with success based on reason
          const reason = (part?.reason as string) ?? "";
          const finishedPartId = (part?.id as string) ?? "";
          this.emitEvent("subagent.complete", partSessionId, {
            subagentId: finishedPartId,
            success: reason !== "error",
            result: reason,
          });

          // Clean up child session tracking and tool counts for the completed agent.
          this.subagentToolCounts.delete(finishedPartId);
          for (const [childSid, agentPartId] of this.childSessionToAgentPart) {
            if (agentPartId === finishedPartId) {
              this.childSessionToAgentPart.delete(childSid);
              break;
            }
          }
          // Also remove from pending in case it never spawned child tools.
          const pendingIdx = this.pendingAgentParts.findIndex(
            (p) => p.partId === finishedPartId
          );
          if (pendingIdx !== -1) {
            this.pendingAgentParts.splice(pendingIdx, 1);
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
   * Starts a local HTTP dispatch server for tool handler IPC, generates a
   * temporary MCP script that forwards tool calls to it, and registers the
   * script with the OpenCode server via mcp.add().
   */
  private async registerToolsMcpServer(): Promise<void> {
    if (!this.sdkClient) return;

    // Start the in-process dispatch server so the MCP script can call handlers
    const contextFactory = () => ({
      sessionID: this.currentSessionId ?? "",
      messageID: "",
      agent: "opencode" as const,
      directory: this.clientOptions.directory ?? process.cwd(),
      abort: new AbortController().signal,
    });

    const { port, stop } = await startToolDispatchServer(
      this.registeredTools,
      contextFactory,
    );
    this.dispatchServerStop = stop;

    const tools = Array.from(this.registeredTools.values());
    const scriptPath = await createToolMcpServerScript(tools, port);

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
    if (!this.sdkClient || !this.clientOptions.directory) {
      return null;
    }
    return buildOpenCodeMcpSnapshot(this.sdkClient, this.clientOptions.directory);
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
          parts: buildOpenCodePromptParts(message),
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

      stream: (message: string, options?: { agent?: string }): AsyncIterable<AgentMessage> => {
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
              const thinkingSourceKey = event.data?.thinkingSourceKey as string | undefined;
              if (delta) {
                deltaQueue.push({
                  type: contentType === "reasoning" ? "thinking" as const : "text" as const,
                  content: delta,
                  role: "assistant" as const,
                  ...(contentType === "reasoning" ? {
                    metadata: {
                      provider: "opencode",
                      thinkingSourceKey,
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
                parts: buildOpenCodePromptParts(message, options?.agent),
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
                    const reasoningPartId = (part as { id?: string }).id;
                    yield {
                      type: "thinking" as const,
                      content: part.text,
                      role: "assistant" as const,
                      metadata: {
                        provider: "opencode",
                        thinkingSourceKey: reasoningPartId,
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
                          toolUseId: toolPart.id as string,
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
                          toolId: toolPart.id as string,
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
                          toolId: toolPart.id as string,
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
                      const existingMetadata = (msg.metadata ?? {}) as Record<string, unknown>;
                      msg.metadata = {
                        ...existingMetadata,
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

      abort: async (): Promise<void> => {
        if (sessionState.isClosed || !client.sdkClient) return;
        await client.sdkClient.session.abort({
          sessionID: sessionId,
          directory: client.clientOptions.directory,
        });
      },

      abortBackgroundAgents: async (): Promise<void> => {
        if (sessionState.isClosed || !client.sdkClient) return;
        // Abort tracked child sessions (background sub-agents).
        // OpenCode tracks child session IDs via childSessionToAgentPart.
        const childSessionIds = Array.from(client.childSessionToAgentPart.keys());
        if (childSessionIds.length > 0) {
          const abortPromises = childSessionIds.map((childSid) =>
            client.sdkClient!.session.abort({
              sessionID: childSid,
              directory: client.clientOptions.directory,
            }).catch((error: unknown) => {
              console.error(`Failed to abort child session ${childSid}:`, error);
            }),
          );
          await Promise.allSettled(abortPromises);
        }
        // Also abort the parent session to catch any remaining work
        await client.sdkClient.session.abort({
          sessionID: sessionId,
          directory: client.clientOptions.directory,
        });
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

    // Stop the tool dispatch HTTP server
    if (this.dispatchServerStop) {
      this.dispatchServerStop();
      this.dispatchServerStop = null;
    }
    stopToolDispatchServer();

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
