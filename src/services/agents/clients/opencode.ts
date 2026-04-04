import { type CodingAgentClient, type EventHandler, type EventType, type McpRuntimeSnapshot, type Session, type SessionConfig, type SessionMessageWithParts, type ToolDefinition } from "@/services/agents/types.ts";
import { AUTO_COMPACTION_THRESHOLD, COMPACTION_TERMINAL_ERROR_MESSAGE, OpenCodeCompactionError, transitionOpenCodeCompactionControl, type OpenCodeCompactionControlState, type OpenCodeCompactionErrorCode } from "@/services/agents/clients/opencode/compaction.ts";
import { connectOpenCode, disconnectOpenCode, healthCheckOpenCode } from "@/services/agents/clients/opencode/connection.ts";
import type { OpenCodeClientOptions, OpenCodeHealthStatus, OpenCodeListableProvider } from "@/services/agents/clients/opencode/client-types.ts";
import { addOpenCodeProviderEventHandler, emitOpenCodeEvent, emitOpenCodeProviderEvent, maybeEmitOpenCodeSkillInvokedEvent } from "@/services/agents/clients/opencode/event-dispatch.ts";
import { handleOpenCodeMessagePartRemoved, handleOpenCodePermissionAsked, handleOpenCodeQuestionAsked, handleOpenCodeSdkEvent } from "@/services/agents/clients/opencode/event-mapper.ts";
import type { OpenCodeSseAbortReason, OpenCodeSseDiagnosticsCounter } from "@/services/agents/clients/opencode/event-stream.ts";
import { emitOpenCodeSseAbortDiagnostics, emitOpenCodeSseDiagnosticsCounter, processOpenCodeLifecycleEventStream, reconcileOpenCodeLifecycleState, runOpenCodeSdkLifecycleLoop, startOpenCodeClientLifecycle, stopOpenCodeClientLifecycle, subscribeToOpenCodeSdkEvents } from "@/services/agents/clients/opencode/lifecycle.ts";
import { buildOpenCodeMcpSnapshot } from "@/services/agents/clients/opencode/mcp.ts";
import { getOpenCodeModelDisplayInfo, lookupOpenCodeRawModelIdFromProviders, resolveOpenCodeModelContextWindow, resolveOpenCodeModelForPrompt, type OpenCodeResolvedPromptModel } from "@/services/agents/clients/opencode/model.ts";
import { releaseAtomicManagedOpenCodeServerLease, spawnAtomicManagedOpenCodeServer } from "@/services/agents/clients/opencode/server.ts";
import { createWrappedOpenCodeSession, type OpenCodeSessionRuntimeArgs } from "@/services/agents/clients/opencode/session-runtime.ts";
import { createManagedOpenCodeSession, getOpenCodeSessionMessagesWithParts, listOpenCodeProviderModels, listOpenCodeSessions, registerOpenCodeMcpServers, resumeManagedOpenCodeSession } from "@/services/agents/clients/opencode/session-management.ts";
import { OpenCodeSessionStateSupport, type OpenCodeSubagentSessionState } from "@/services/agents/clients/opencode/session-state.ts";
import { type OpenCodeSessionState } from "@/services/agents/clients/opencode/shared.ts";
import type { OpenCodeProviderEventHandler, ProviderStreamEventDataMap, ProviderStreamEventType } from "@/services/agents/provider-events.ts";
import { loadOpenCodeAgents } from "@/services/config/opencode-config.ts";
import {
  isToolDisabledBySubagentPolicy,
  resolveSubagentToolPolicy,
  type SubagentToolPolicy,
} from "@/services/agents/subagent-tool-policy.ts";
import { createOpencodeClient as createSdkClient, type Event as OpenCodeEvent, type EventMessagePartRemoved, type EventPermissionAsked, type EventQuestionAsked, type OpencodeClient as SdkClient } from "@opencode-ai/sdk/v2/client";
import { createOpenCodeKeepalive, type OpenCodeKeepaliveHandle } from "@/services/agents/clients/opencode/keepalive.ts";
import { isPipelineDebug } from "@/services/events/pipeline-logger.ts";

const DEFAULT_OPENCODE_BASE_URL = "http://127.0.0.1:4096";
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY = 1000;
const COMPACTION_COMPLETE_DEDUPE_WINDOW_MS = 1000;
const OPENCODE_SSE_DIAGNOSTICS_MARKER = "opencode.sse.diagnostics";
const debugLog = isPipelineDebug()
  ? (label: string, data: Record<string, unknown>) => console.debug(`[opencode:${label}]`, JSON.stringify(data, null, 2))
  : () => {};

export { buildOpenCodeMcpSnapshot };
export { AUTO_COMPACTION_THRESHOLD, COMPACTION_TERMINAL_ERROR_MESSAGE, OpenCodeCompactionError, transitionOpenCodeCompactionControl, type OpenCodeCompactionControlState, type OpenCodeCompactionErrorCode } from "@/services/agents/clients/opencode/compaction.ts";
export type { OpenCodeClientOptions, OpenCodeHealthStatus, OpenCodeListableProvider } from "@/services/agents/clients/opencode/client-types.ts";
export { isContextOverflowError } from "@/services/agents/clients/opencode/shared.ts";

export class OpenCodeClient implements CodingAgentClient {
  readonly agentType = "opencode" as const;

  private sdkClient: SdkClient | null = null;
  private clientOptions: OpenCodeClientOptions;
  private eventHandlers = new Map<EventType, Set<EventHandler<EventType>>>();
  private providerEventHandlers = new Set<OpenCodeProviderEventHandler>();
  private activeNativeProviderEvent: OpenCodeEvent | null = null;
  private activeSessions = new Set<string>();
  private sessionStateById = new Map<string, OpenCodeSessionState>();
  private isRunning = false;
  private isConnected = false;
  private currentSessionId: string | null = null;
  private eventSubscriptionController: AbortController | null = null;
  private isServerSpawned = false;
  private readonly sseDiagnosticsCounters: Record<OpenCodeSseDiagnosticsCounter, number> = {
    "sse.watchdog.timeout.count": 0,
    "sse.event.filtered.count": 0,
    "sse.abort.watchdog.count": 0,
    "sse.abort.global.count": 0,
    "sse.abort.unknown.count": 0,
  };
  private activePromptModel: OpenCodeResolvedPromptModel | undefined;
  private activeReasoningEffort: string | undefined;
  private activeContextWindow: number | null = null;
  private subagentStateByParentSession = new Map<string, OpenCodeSubagentSessionState>();
  private childSessionToParentSession = new Map<string, string>();
  private reasoningPartIds = new Set<string>();
  private messageRolesBySession = new Map<string, Map<string, "user" | "assistant">>();
  private sessionTitlesById = new Map<string, string>();
  private skillInvocationsBySession = new Map<string, Set<string>>();
  private subagentToolPoliciesBySession = new Map<string, Record<string, SubagentToolPolicy>>();
  private sessionStateSupport: OpenCodeSessionStateSupport;
  private keepalive: OpenCodeKeepaliveHandle | null = null;
  private isReconnecting = false;

  constructor(options: OpenCodeClientOptions = {}) {
    this.clientOptions = { baseUrl: DEFAULT_OPENCODE_BASE_URL, maxRetries: DEFAULT_MAX_RETRIES, retryDelay: DEFAULT_RETRY_DELAY, ...options, directory: options.directory ?? process.cwd() };
    this.sessionStateSupport = new OpenCodeSessionStateSupport({
      activeSessions: this.activeSessions,
      sessionStateById: this.sessionStateById as Map<string, unknown>,
      sessionTitlesById: this.sessionTitlesById,
      messageRolesBySession: this.messageRolesBySession,
      skillInvocationsBySession: this.skillInvocationsBySession,
      subagentStateByParentSession: this.subagentStateByParentSession,
      childSessionToParentSession: this.childSessionToParentSession,
      reasoningPartIds: this.reasoningPartIds,
      getCurrentSessionId: () => this.currentSessionId,
      setCurrentSessionId: (sessionId) => {
        this.currentSessionId = sessionId;
      },
    });
  }

  async healthCheck(): Promise<OpenCodeHealthStatus> {
    return healthCheckOpenCode({ sdkClient: this.sdkClient, clientOptions: this.clientOptions });
  }

  async connect(): Promise<boolean> {
    return connectOpenCode({
      isConnected: this.isConnected,
      clientOptions: this.clientOptions,
      defaultMaxRetries: DEFAULT_MAX_RETRIES,
      defaultRetryDelay: DEFAULT_RETRY_DELAY,
      setSdkClient: (client) => {
        this.sdkClient = client;
      },
      setIsConnected: (value) => {
        this.isConnected = value;
      },
      healthCheck: () => this.healthCheck(),
      emitEvent: (eventType, sessionId, data) => this.emitEvent(eventType, sessionId, data),
    });
  }

  async disconnect(): Promise<void> {
    return disconnectOpenCode({
      eventSubscriptionController: this.eventSubscriptionController,
      clearEventSubscriptionController: () => {
        this.eventSubscriptionController = null;
      },
      activeSessions: this.activeSessions,
      sdkClient: this.sdkClient,
      directory: this.clientOptions.directory,
      sessionStateById: this.sessionStateById,
      resetConnectionState: () => {
        this.isConnected = false;
        this.sdkClient = null;
        this.currentSessionId = null;
      },
      clearStreamingState: () => {
        this.subagentStateByParentSession.clear();
        this.childSessionToParentSession.clear();
        this.reasoningPartIds.clear();
        this.messageRolesBySession.clear();
        this.skillInvocationsBySession.clear();
        this.activeReasoningEffort = undefined;
      },
      emitEvent: (eventType, sessionId, data) => this.emitEvent(eventType, sessionId, data),
    });
  }

  getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }

  async listSessions(): Promise<Array<{ id: string; title?: string; createdAt?: number }>> {
    return listOpenCodeSessions({ sdkClient: this.sdkClient, directory: this.clientOptions.directory });
  }

  async listProviderModels(): Promise<OpenCodeListableProvider[]> {
    return listOpenCodeProviderModels({
      sdkClient: this.sdkClient as never,
      createProviderClient: () => createSdkClient({ baseUrl: this.clientOptions.baseUrl, directory: this.clientOptions.directory }) as never,
      directory: this.clientOptions.directory,
    });
  }

  private async subscribeToSdkEvents(): Promise<void> {
    return subscribeToOpenCodeSdkEvents({
      hasSdkClient: !!this.sdkClient,
      setEventSubscriptionController: (controller) => {
        this.eventSubscriptionController = controller;
      },
      runEventLoop: () => this.runEventLoop(),
    });
  }

  private async runEventLoop(): Promise<void> {
    return runOpenCodeSdkLifecycleLoop({
      sdkClient: this.sdkClient,
      directory: this.clientOptions.directory,
      isRunning: () => this.isRunning,
      getEventSubscriptionController: () => this.eventSubscriptionController,
      reconcileStateOnReconnect: () => this.reconcileStateOnReconnect(),
      processEventStream: (eventStream, watchdogAbort) => this.processEventStream(eventStream, watchdogAbort),
    });
  }

  private async reconcileStateOnReconnect(): Promise<void> {
    return reconcileOpenCodeLifecycleState({
      listSessions: () => this.listSessions(),
      registerActiveSession: (sessionId) => this.sessionStateSupport.registerActiveSession(sessionId),
      emitSessionStart: (sessionId, title) => this.emitEvent("session.start", sessionId, { title }),
    });
  }

  private async processEventStream(eventStream: AsyncGenerator<unknown, unknown, unknown>, watchdogAbort: AbortController): Promise<void> {
    return processOpenCodeLifecycleEventStream({
      eventStream,
      watchdogAbort,
      getGlobalAbortSignal: () => this.eventSubscriptionController?.signal ?? null,
      shouldProcessSseEvent: (event) => this.sessionStateSupport.shouldProcessSseEvent(event),
      handleSdkEvent: (event) => this.handleSdkEvent(event),
      getActiveSessionCount: () => this.activeSessions.size,
      emitSseDiagnosticsCounter: (counter, amount) => this.emitSseDiagnosticsCounter(counter, amount),
      emitSseAbortDiagnostics: (reason) => this.emitSseAbortDiagnostics(reason),
      debugLog,
    });
  }

  private emitSseDiagnosticsCounter(counter: OpenCodeSseDiagnosticsCounter, amount = 1): number {
    return emitOpenCodeSseDiagnosticsCounter({
      counters: this.sseDiagnosticsCounters,
      counter,
      amount,
      emitEvent: (eventType, sessionId, data) => this.emitEvent(eventType, sessionId, data),
      marker: OPENCODE_SSE_DIAGNOSTICS_MARKER,
    });
  }

  private emitSseAbortDiagnostics(reason: OpenCodeSseAbortReason): number {
    return emitOpenCodeSseAbortDiagnostics({ reason, emitSseDiagnosticsCounter: (counter, amount) => this.emitSseDiagnosticsCounter(counter, amount) });
  }

  private registerActiveSession(sessionId: string): void {
    this.sessionStateSupport.registerActiveSession(sessionId);
  }

  private maybeEmitSkillInvokedEvent(args: { sessionId: string; toolName: string; toolInput: unknown; toolUseId?: string; toolCallId?: string }): void {
    maybeEmitOpenCodeSkillInvokedEvent({
      sessionStateSupport: this.sessionStateSupport,
      ...args,
      emitEvent: (eventType, sessionId, data) => this.emitEvent(eventType, sessionId, data),
      emitProviderEvent: (eventType, sessionId, data, options) => this.emitProviderEvent(eventType, sessionId, data, options),
    });
  }

  private handleSdkEvent(event: OpenCodeEvent): void {
    this.activeNativeProviderEvent = event;
    try {
      handleOpenCodeSdkEvent(event, {
        sdkClient: this.sdkClient,
        directory: this.clientOptions.directory,
        sessionStateSupport: this.sessionStateSupport,
        sessionTitlesById: this.sessionTitlesById,
        sessionStateById: this.sessionStateById,
        childSessionToParentSession: this.childSessionToParentSession,
        reasoningPartIds: this.reasoningPartIds,
        compactionCompleteDedupeWindowMs: COMPACTION_COMPLETE_DEDUPE_WINDOW_MS,
        debugLog,
        resolveAutoDenyForPermission: (sessionId: string, toolName: string) =>
          this.resolveAutoDenyForPermission(sessionId, toolName),
        maybeEmitSkillInvokedEvent: (skillArgs) => this.maybeEmitSkillInvokedEvent(skillArgs),
        emitEvent: (eventType, sessionId, data) => this.emitEvent(eventType, sessionId, data),
        emitProviderEvent: (eventType, sessionId, data, options) => this.emitProviderEvent(eventType, sessionId, data, options),
      });
    } finally {
      this.activeNativeProviderEvent = null;
    }
  }

  private resolveAutoDenyForPermission(
    sessionId: string,
    toolName: string,
  ): { parentSessionId: string; subagentName: string } | null {
    const parentSessionId = this.sessionStateSupport.resolveParentSessionId(sessionId);
    const subagentName = this.sessionStateSupport.resolveSubagentNameForSession(sessionId);
    if (!subagentName) {
      return null;
    }

    const policy = resolveSubagentToolPolicy(
      this.subagentToolPoliciesBySession.get(parentSessionId),
      subagentName,
    );
    if (!isToolDisabledBySubagentPolicy(policy, toolName)) {
      return null;
    }

    return { parentSessionId, subagentName };
  }

  private handlePermissionAsked(event: EventPermissionAsked): void {
    handleOpenCodePermissionAsked(event, {
      sdkClient: this.sdkClient,
      directory: this.clientOptions.directory,
      sessionStateSupport: this.sessionStateSupport,
      resolveAutoDenyForPermission: (sessionId: string, toolName: string) =>
        this.resolveAutoDenyForPermission(sessionId, toolName),
      emitEvent: (eventType, sessionId, data) => this.emitEvent(eventType, sessionId, data),
      emitProviderEvent: (eventType, sessionId, data, options) => this.emitProviderEvent(eventType, sessionId, data, options),
    });
  }

  private handleQuestionAsked(event: EventQuestionAsked): void {
    handleOpenCodeQuestionAsked(event, {
      sdkClient: this.sdkClient,
      directory: this.clientOptions.directory,
      emitEvent: (eventType, sessionId, data) => this.emitEvent(eventType, sessionId, data),
      emitProviderEvent: (eventType, sessionId, data, options) => this.emitProviderEvent(eventType, sessionId, data, options),
    });
  }

  private handleMessagePartRemoved(event: EventMessagePartRemoved): void {
    handleOpenCodeMessagePartRemoved(event, { sessionStateSupport: this.sessionStateSupport });
  }

  private emitEvent<T extends EventType>(eventType: T, sessionId: string, data: Record<string, unknown>): void {
    emitOpenCodeEvent({ eventHandlers: this.eventHandlers, eventType, sessionId, data });
  }

  onProviderEvent(handler: OpenCodeProviderEventHandler): () => void {
    return addOpenCodeProviderEventHandler({ providerEventHandlers: this.providerEventHandlers, handler });
  }

  private emitProviderEvent<T extends ProviderStreamEventType>(
    eventType: T,
    sessionId: string,
    data: ProviderStreamEventDataMap[T],
    options?: { native?: OpenCodeEvent; nativeEventId?: string; nativeSessionId?: string; timestamp?: number },
  ): void {
    emitOpenCodeProviderEvent({
      providerEventHandlers: this.providerEventHandlers,
      eventType,
      sessionId,
      data,
      activeNativeProviderEvent: this.activeNativeProviderEvent,
      options,
    });
  }

  private async registerMcpServers(servers: NonNullable<SessionConfig["mcpServers"]>): Promise<void> {
    return registerOpenCodeMcpServers({ sdkClient: this.sdkClient as never, directory: this.clientOptions.directory, servers });
  }

  async createSession(config: SessionConfig = {}): Promise<Session> {
    const configuredAgents = await loadOpenCodeAgents({
      projectRoot: this.clientOptions.directory,
    });

    return createManagedOpenCodeSession({
      isRunning: this.isRunning,
      sdkClient: this.sdkClient as never,
      directory: this.clientOptions.directory,
      config,
      registerMcpServers: (servers) => this.registerMcpServers(servers),
      setCurrentSessionId: (sessionId) => {
        this.currentSessionId = sessionId;
      },
      onSessionCreated: (sessionId: string) => {
        this.subagentToolPoliciesBySession.set(
          sessionId,
          Object.fromEntries(
            configuredAgents.map((agent) => [agent.name, {
              disallowedTools: Object.entries(agent.tools ?? {})
                .filter(([, enabled]) => enabled === false)
                .map(([toolName]) => toolName),
            }]),
          ),
        );
      },
      registerActiveSession: (sessionId) => this.sessionStateSupport.registerActiveSession(sessionId),
      emitEvent: (eventType, sessionId, data) => this.emitEvent(eventType, sessionId, data),
      wrapSession: (sessionId, sessionConfig) => this.wrapSession(sessionId, sessionConfig),
    });
  }

  async resumeSession(sessionId: string): Promise<Session | null> {
    return resumeManagedOpenCodeSession({
      isRunning: this.isRunning,
      sdkClient: this.sdkClient as never,
      directory: this.clientOptions.directory,
      sessionId,
      setCurrentSessionId: (targetSessionId) => {
        this.currentSessionId = targetSessionId;
      },
      registerActiveSession: (targetSessionId) => this.sessionStateSupport.registerActiveSession(targetSessionId),
      wrapSession: (targetSessionId, sessionConfig) => this.wrapSession(targetSessionId, sessionConfig),
    });
  }

  async getSessionMessagesWithParts(sessionId: string): Promise<SessionMessageWithParts[]> {
    return getOpenCodeSessionMessagesWithParts({ isRunning: this.isRunning, sdkClient: this.sdkClient as never, sessionId });
  }

  private resolveModelForPrompt(model?: string): { providerID: string; modelID: string } | undefined {
    return resolveOpenCodeModelForPrompt(model);
  }

  private async buildOpenCodeMcpSnapshot(): Promise<McpRuntimeSnapshot | null> {
    return !this.sdkClient || !this.clientOptions.directory
      ? null
      : buildOpenCodeMcpSnapshot(this.sdkClient, this.clientOptions.directory);
  }

  private async wrapSession(sessionId: string, config: SessionConfig): Promise<Session> {
    return createWrappedOpenCodeSession({
      sessionId,
      config,
      directory: this.clientOptions.directory,
      defaultAgentMode: this.clientOptions.defaultAgentMode,
      getSdkClient: () => this.sdkClient as ReturnType<OpenCodeSessionRuntimeArgs["getSdkClient"]>,
      getActivePromptModel: () => this.activePromptModel,
      getActiveReasoningEffort: () => this.activeReasoningEffort,
      setActivePromptModelIfMissing: (model) => {
        if (!this.activePromptModel && model) this.activePromptModel = model;
      },
      setActiveReasoningEffortIfMissing: (effort) => {
        if (this.activeReasoningEffort === undefined && effort !== undefined) {
          this.activeReasoningEffort = effort;
        }
      },
      getActiveContextWindow: () => this.activeContextWindow,
      resolveModelForPrompt: (model) => this.resolveModelForPrompt(model),
      resolveModelContextWindow: (modelHint) => this.resolveModelContextWindow(modelHint),
      setSessionState: (targetSessionId, state) => {
        this.sessionStateById.set(targetSessionId, state);
      },
      buildOpenCodeMcpSnapshot: () => this.buildOpenCodeMcpSnapshot(),
      getChildSessionIds: (targetSessionId) => {
        const parentState = this.subagentStateByParentSession.get(targetSessionId);
        return parentState ? Array.from(parentState.childSessionToAgentPart.keys()) : [];
      },
      on: (eventType, handler) => this.on(eventType, handler),
      emitEvent: (eventType, targetSessionId, data) => this.emitEvent(eventType, targetSessionId, data),
      emitProviderEvent: (eventType, targetSessionId, data, options) => this.emitProviderEvent(eventType, targetSessionId, data, options),
      onDestroySession: (targetSessionId) => {
        this.subagentToolPoliciesBySession.delete(targetSessionId);
        this.sessionStateSupport.unregisterActiveSession(targetSessionId);
      },
      debugLog,
    });
  }

  on<T extends EventType>(eventType: T, handler: EventHandler<T>): () => void {
    let handlers = this.eventHandlers.get(eventType);
    if (!handlers) {
      handlers = new Set();
      this.eventHandlers.set(eventType, handlers);
    }
    handlers.add(handler as EventHandler<EventType>);
    return () => {
      handlers?.delete(handler as EventHandler<EventType>);
      if (handlers && handlers.size === 0) this.eventHandlers.delete(eventType);
    };
  }

  registerTool(_tool: ToolDefinition): void {
    // No-op for OpenCode: custom tools are auto-discovered from .opencode/tools/
  }

  private async spawnServer(): Promise<boolean> {
    const result = await spawnAtomicManagedOpenCodeServer({
      clientOptions: this.clientOptions,
      defaultBaseUrl: DEFAULT_OPENCODE_BASE_URL,
      isServerSpawned: this.isServerSpawned,
    });
    if (result.baseUrl) this.clientOptions.baseUrl = result.baseUrl;
    this.isServerSpawned = result.isServerSpawned;
    return result.ok;
  }

  async start(): Promise<void> {
    await startOpenCodeClientLifecycle({
      isRunning: this.isRunning,
      autoStart: this.clientOptions.autoStart !== false,
      reuseExistingServer: this.clientOptions.reuseExistingServer === true,
      spawnServer: () => this.spawnServer(),
      connect: () => this.connect(),
      releaseServerLease: () => this.releaseServerLease(),
      setRunning: (value) => {
        this.isRunning = value;
      },
      subscribeToSdkEvents: () => this.subscribeToSdkEvents(),
    });

    this.keepalive = createOpenCodeKeepalive({
      getSdkClient: () => this.sdkClient,
      isRunning: () => this.isRunning,
      onConnectionLost: () => void this.reconnect(),
      debugLog,
    });
    this.keepalive.start();
  }

  async stop(): Promise<void> {
    this.keepalive?.stop();
    this.keepalive = null;

    return stopOpenCodeClientLifecycle({
      isRunning: this.isRunning,
      disconnect: () => this.disconnect(),
      releaseServerLease: () => this.releaseServerLease(),
      clearEventHandlers: () => {
        this.eventHandlers.clear();
      },
      setRunning: (value) => {
        this.isRunning = value;
      },
    });
  }

  /**
   * Tears down the current connection and starts a fresh one.
   *
   * All existing sessions are marked closed — the next user interaction
   * will trigger the TUI's session-recovery flow which calls
   * `resumeSession()` to re-attach to persisted conversation history.
   */
  private async reconnect(): Promise<void> {
    if (this.isReconnecting || !this.isRunning) {
      return;
    }
    this.isReconnecting = true;

    try {
      // Stop keepalive first to prevent re-entrant reconnect calls.
      this.keepalive?.stop();
      this.keepalive = null;

      // Mark every tracked session as closed so the next send()
      // surfaces a recoverable error which the adapter handles
      // via its existing retry/resume path.
      for (const state of this.sessionStateById.values()) {
        state.isClosed = true;
      }

      // Abort the SSE subscription and tear down the connection.
      await this.disconnect();

      // Release and re-acquire the server lease — this also
      // health-checks the existing server and respawns it if needed.
      this.releaseServerLease();
      this.isRunning = false;

      // Start a fresh client + keepalive.
      await this.start();
    } finally {
      this.isReconnecting = false;
    }
  }

  private releaseServerLease(): void {
    this.isServerSpawned = releaseAtomicManagedOpenCodeServerLease(this.isServerSpawned);
  }

  isConnectedToServer(): boolean {
    return this.isConnected;
  }

  getBaseUrl(): string {
    return this.clientOptions.baseUrl ?? DEFAULT_OPENCODE_BASE_URL;
  }

  async setActivePromptModel(
    model?: string,
    options?: { reasoningEffort?: string },
  ): Promise<void> {
    this.activePromptModel = this.resolveModelForPrompt(model);
    this.activeReasoningEffort = options?.reasoningEffort;
    try {
      this.activeContextWindow = await this.resolveModelContextWindow(model);
    } catch {
      // keep previous cached window
    }
  }

  getActiveContextWindow(): number | null {
    return this.activeContextWindow;
  }

  async getModelDisplayInfo(modelHint?: string): Promise<{
    model: string;
    tier: string;
    supportsReasoning?: boolean;
    supportedReasoningEfforts?: string[];
    contextWindow?: number;
  }> {
    return getOpenCodeModelDisplayInfo({
      modelHint,
      activeContextWindow: this.activeContextWindow,
      isRunning: this.isRunning,
      sdkClient: this.sdkClient,
      resolveModelContextWindow: (hint) => this.resolveModelContextWindow(hint),
      lookupRawModelIdFromProviders: () => this.lookupRawModelIdFromProviders(),
      listProviderModels: () => this.listProviderModels(),
    });
  }

  private async resolveModelContextWindow(modelHint?: string): Promise<number> {
    return resolveOpenCodeModelContextWindow(this.sdkClient, modelHint);
  }

  private async lookupRawModelIdFromProviders(): Promise<string | undefined> {
    return lookupOpenCodeRawModelIdFromProviders(this.sdkClient);
  }

  getSystemToolsTokens(): number | null {
    return null;
  }
}

export function createOpenCodeClient(options?: OpenCodeClientOptions): OpenCodeClient {
  return new OpenCodeClient(options);
}
