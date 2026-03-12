import type { Query, Options, SDKMessage, HookEvent, HookCallback, HookCallbackMatcher, McpSdkServerConfigWithInstance, ThinkingConfig } from "@anthropic-ai/claude-agent-sdk";
import type { CodingAgentClient, Session, SessionConfig, EventType, EventHandler, ToolDefinition } from "@/services/agents/types.ts";
import { loadClaudeAgents } from "@/services/config/claude-config.ts";
import { getBundledClaudeCodePath, resolveClaudeCodeExecutablePath, type ClaudeExecutablePathResolutionOptions } from "@/services/agents/clients/claude/executable-path.ts";
import type { ClaudeHookConfig, ClaudeSessionState, ReasoningEffort, StreamIntegrityCounters } from "@/services/agents/clients/claude/internal-types.ts";
import { buildClaudeNativeHooks } from "@/services/agents/clients/claude/internal-types.ts";
import { buildClaudeSdkOptions, buildClaudeMcpServers, getClaudeReasoningEffort, getClaudeThinkingBudget, handleClaudeAskUserQuestion, resolveClaudeToolPermission } from "@/services/agents/clients/claude/options-builder.ts";
import { processClaudeMessage } from "@/services/agents/clients/claude/message-processor.ts";
import { emitClaudeProviderEvent, registerClaudeProviderEventBridges } from "@/services/agents/clients/claude/provider-bridge.ts";
import { getClaudeMainSdkSessionId, registerClaudeHookHandler, resolveClaudeFallbackHookSessionId, resolveClaudeHookParentToolUseId, resolveClaudeHookSessionId, resolveClaudeHookToolUseId, resolveClaudeSubagentParentId } from "@/services/agents/clients/claude/hook-bridge.ts";
import { wrapClaudeQuerySession } from "@/services/agents/clients/claude/session-wrapper.ts";
import { emitClaudeEvent } from "@/services/agents/clients/claude/event-emitter.ts";
import { registerClaudeTool } from "@/services/agents/clients/claude/tool-registry.ts";
import { fetchFreshClaudeSupportedModels, getClaudeModelDisplayInfo, getClaudeSystemToolsTokens, listClaudeSupportedModels, setClaudeActiveSessionModel, stopClaudeClient } from "@/services/agents/clients/claude/model-management.ts";
import { createClaudeSession, resumeClaudeSession } from "@/services/agents/clients/claude/lifecycle.ts";
import type { ClaudeProviderEventHandler, ClaudeNativeEvent, ProviderStreamEventDataMap, ProviderStreamEventType } from "@/services/agents/provider-events.ts";

export { extractMessageContent } from "@/services/agents/clients/claude/message-normalization.ts";
export {
    getBundledClaudeCodePath,
    resolveClaudeCodeExecutablePath,
    type ClaudeExecutablePathResolutionOptions,
} from "@/services/agents/clients/claude/executable-path.ts";
export type { ClaudeHookConfig } from "@/services/agents/clients/claude/internal-types.ts";
export class ClaudeAgentClient implements CodingAgentClient {
    readonly agentType = "claude" as const;
    private static readonly BUILTIN_ALLOWED_TOOLS = ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "Task", "Skill", "MultiEdit", "TodoRead", "TodoWrite", "NotebookEdit", "NotebookRead"] as const;
    private static readonly SUPPORTS_ADAPTIVE_THINKING = new Set<string>(["opus", "sonnet"]);
    private static readonly SUPPORTED_REASONING_EFFORTS = new Set<ReasoningEffort>(["low", "medium", "high", "max"]);

    private eventHandlers: Map<EventType, Set<EventHandler<EventType>>> = new Map();
    private providerEventHandlers = new Set<ClaudeProviderEventHandler>();
    private providerEventBridgeInitialized = false;
    private sessions: Map<string, ClaudeSessionState> = new Map();
    private registeredHooks: Record<string, HookCallback[]> = {};
    private registeredTools: Map<string, McpSdkServerConfigWithInstance> = new Map();
    private isRunning = false;
    private detectedModel: string | null = null;
    public capturedModelContextWindows: Map<string, number> = new Map();
    private probeContextWindow: number | null = null;
    private probeSystemToolsBaseline: number | null = null;
    private streamIntegrity: StreamIntegrityCounters = {
        missingTerminalEvents: 0,
        unmatchedToolStarts: 0,
        unmatchedToolCompletes: 0,
        unmatchedSubagentStarts: 0,
        unmatchedSubagentCompletes: 0,
    };
    private pendingToolBySession = new Map<string, number>();
    private pendingSubagentBySession = new Map<string, number>();
    private modelListReadsBySession = new Map<string, number>();
    private pendingHookSessionBindings: string[] = [];
    private toolUseIdToAgentId = new Map<string, string>();
    private toolUseIdToSessionId = new Map<string, string>();
    private taskDescriptionByToolUseId = new Map<string, string>();
    private subagentSdkSessionIdToAgentId = new Map<string, string>();
    private unmappedSubagentIds: string[] = [];

    protected async loadConfiguredAgents(projectRoot: string): Promise<Awaited<ReturnType<typeof loadClaudeAgents>>> {
        return loadClaudeAgents({ projectRoot });
    }

    registerHooks(config: ClaudeHookConfig): void {
        this.registeredHooks = { ...this.registeredHooks, ...config };
    }

    private buildNativeHooks(): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
        return buildClaudeNativeHooks(this.registeredHooks);
    }

    private getReasoningEffort(effort?: string): ReasoningEffort {
        return getClaudeReasoningEffort(
            effort,
            ClaudeAgentClient.SUPPORTED_REASONING_EFFORTS,
        );
    }

    private getThinkingBudget(model: string | undefined, maxThinkingTokens: number = 16000): ThinkingConfig | undefined {
        return getClaudeThinkingBudget(
            model,
            maxThinkingTokens,
            ClaudeAgentClient.SUPPORTS_ADAPTIVE_THINKING,
        );
    }

    private async handleAskUserQuestion(sessionId: string, toolInput: Record<string, unknown>): Promise<{ behavior: "allow"; updatedInput: Record<string, unknown> } | null> {
        return handleClaudeAskUserQuestion({
            sessionId,
            toolInput,
            emitEvent: (eventType, targetSessionId, data) => {
                this.emitEvent(
                    eventType,
                    targetSessionId,
                    data as unknown as Record<string, unknown>,
                );
            },
            emitProviderEvent: (eventType, targetSessionId, data, options) => {
                this.emitProviderEvent(
                    eventType,
                    targetSessionId,
                    data,
                    options,
                );
            },
        });
    }

    private async resolveToolPermission(sessionId: string, toolName: string, toolInput: Record<string, unknown>): Promise<{ behavior: "allow"; updatedInput: Record<string, unknown> }> {
        return resolveClaudeToolPermission({
            sessionId,
            toolName,
            toolInput,
            handleAskUserQuestion: (targetSessionId, input) =>
                this.handleAskUserQuestion(targetSessionId, input),
        });
    }

    private buildMcpServers(config: SessionConfig): NonNullable<Options["mcpServers"]> | undefined {
        return buildClaudeMcpServers(config, this.registeredTools);
    }

    private buildSdkOptions(config: SessionConfig, sessionId?: string): Options {
        return buildClaudeSdkOptions({
            config,
            sessionId,
            registeredHooks: this.registeredHooks,
            registeredTools: this.registeredTools,
            supportedReasoningEfforts:
                ClaudeAgentClient.SUPPORTED_REASONING_EFFORTS,
            adaptiveThinkingModels:
                ClaudeAgentClient.SUPPORTS_ADAPTIVE_THINKING,
            allowedTools: ClaudeAgentClient.BUILTIN_ALLOWED_TOOLS,
            executablePath: getBundledClaudeCodePath(),
            resolveToolPermission: (targetSessionId, toolName, toolInput) =>
                this.resolveToolPermission(
                    targetSessionId,
                    toolName,
                    toolInput,
                ),
        });
    }

    private emitRuntimeMarker(sessionId: string, marker: string, data: Record<string, unknown>): void {
        this.emitEvent("usage", sessionId, {
            provider: "claude",
            marker,
            ...data,
        });
    }

    private bumpStreamIntegrityCounter(sessionId: string, counter: keyof StreamIntegrityCounters, amount = 1): number {
        this.streamIntegrity[counter] += amount;
        const value = this.streamIntegrity[counter];
        this.emitRuntimeMarker(sessionId, "claude.stream.integrity", {
            [counter]: value,
        });
        return value;
    }

    private emitRuntimeSelection(sessionId: string, operation: "create" | "resume" | "send" | "stream" | "summarize"): void {
        this.emitRuntimeMarker(sessionId, "claude.runtime.selected", {
            runtimeMode: "v1",
            operation,
        });
    }

    private wrapQuery(
        queryInstance: Query | null,
        sessionId: string,
        config: SessionConfig,
        persisted?: Partial<
            Pick<
                ClaudeSessionState,
                | "sdkSessionId"
                | "inputTokens"
                | "outputTokens"
                | "contextWindow"
                | "systemToolsBaseline"
            >
        >,
    ): Session {
        return wrapClaudeQuerySession({
            queryInstance,
            sessionId,
            config,
            persisted,
            probeContextWindow: this.probeContextWindow,
            probeSystemToolsBaseline: this.probeSystemToolsBaseline,
            sessions: this.sessions,
            pendingToolBySession: this.pendingToolBySession,
            pendingSubagentBySession: this.pendingSubagentBySession,
            modelListReadsBySession: this.modelListReadsBySession,
            toolUseIdToSessionId: this.toolUseIdToSessionId,
            taskDescriptionByToolUseId: this.taskDescriptionByToolUseId,
            subagentSdkSessionIdToAgentId: this.subagentSdkSessionIdToAgentId,
            unmappedSubagentIds: this.unmappedSubagentIds,
            buildSdkOptions: (sessionConfig, targetSessionId) =>
                this.buildSdkOptions(sessionConfig, targetSessionId),
            processMessage: (sdkMessage, targetSessionId, state) =>
                this.processMessage(sdkMessage, targetSessionId, state),
            emitRuntimeSelection: (targetSessionId, operation) =>
                this.emitRuntimeSelection(targetSessionId, operation),
            bumpStreamIntegrityCounter: (targetSessionId, counter, amount) =>
                this.bumpStreamIntegrityCounter(
                    targetSessionId,
                    counter,
                    amount,
                ),
            emitEvent: (eventType, targetSessionId, data) =>
                this.emitEvent(eventType, targetSessionId, data),
            emitProviderEvent: (eventType, targetSessionId, data, options) =>
                this.emitProviderEvent(
                    eventType,
                    targetSessionId,
                    data,
                    options,
                ),
            getDetectedModel: () => this.detectedModel,
        });
    }

    private processMessage(sdkMessage: SDKMessage, sessionId: string, state: ClaudeSessionState): void {
        processClaudeMessage({
            sdkMessage,
            sessionId,
            state,
            detectedModel: this.detectedModel,
            setDetectedModel: (model) => {
                this.detectedModel = model;
            },
            emitEvent: (eventType, targetSessionId, data) => {
                this.emitEvent(eventType, targetSessionId, data);
            },
            toolUseIdToAgentId: this.toolUseIdToAgentId,
            toolUseIdToSessionId: this.toolUseIdToSessionId,
            taskDescriptionByToolUseId: this.taskDescriptionByToolUseId,
            subagentSdkSessionIdToAgentId: this.subagentSdkSessionIdToAgentId,
            capturedModelContextWindows: this.capturedModelContextWindows,
        });
    }

    private emitEvent<T extends EventType>(eventType: T, sessionId: string, data: Record<string, unknown>): void {
        emitClaudeEvent({
            eventHandlers: this.eventHandlers,
            pendingToolBySession: this.pendingToolBySession,
            pendingSubagentBySession: this.pendingSubagentBySession,
            bumpStreamIntegrityCounter: (targetSessionId, counter, amount) =>
                this.bumpStreamIntegrityCounter(
                    targetSessionId,
                    counter,
                    amount,
                ),
            eventType,
            sessionId,
            data,
        });
    }

    onProviderEvent(handler: ClaudeProviderEventHandler): () => void {
        this.ensureProviderEventBridges();
        this.providerEventHandlers.add(handler);
        return () => {
            this.providerEventHandlers.delete(handler);
        };
    }

    private ensureProviderEventBridges(): void {
        if (this.providerEventBridgeInitialized) {
            return;
        }
        this.providerEventBridgeInitialized = true;
        registerClaudeProviderEventBridges({
            on: (eventType, handler) => this.on(eventType, handler),
            emitProviderEvent: (eventType, sessionId, data, options) =>
                this.emitProviderEvent(eventType, sessionId, data, options),
        });
    }

    private emitProviderEvent<T extends ProviderStreamEventType>(eventType: T, sessionId: string, data: ProviderStreamEventDataMap[T], options?: {
        native?: ClaudeNativeEvent;
        nativeEventId?: string;
        nativeSessionId?: string;
        timestamp?: number;
    }): void {
        emitClaudeProviderEvent({
            providerEventHandlers: this.providerEventHandlers,
            eventType,
            sessionId,
            data,
            options,
        });
    }

    private resolveHookSessionId(sdkSessionId: string): string {
        return resolveClaudeHookSessionId({
            sdkSessionId,
            sessions: this.sessions,
            pendingHookSessionBindings: this.pendingHookSessionBindings,
        });
    }

    private resolveHookToolUseId(toolUseID: string | undefined, hookInput: Record<string, unknown>): string | undefined {
        return resolveClaudeHookToolUseId(toolUseID, hookInput);
    }

    private resolveHookParentToolUseId(hookInput: Record<string, unknown>): string | undefined {
        return resolveClaudeHookParentToolUseId(hookInput);
    }

    private resolveFallbackHookSessionId(toolUseId?: string): string {
        return resolveClaudeFallbackHookSessionId({
            toolUseId,
            toolUseIdToSessionId: this.toolUseIdToSessionId,
            sessions: this.sessions,
        });
    }

    private getMainSdkSessionId(wrappedSessionId: string): string | null {
        return getClaudeMainSdkSessionId(wrappedSessionId, this.sessions);
    }

    private resolveSubagentParentId(hookSdkSessionId: string, wrappedSessionId: string): string | undefined {
        return resolveClaudeSubagentParentId({
            hookSdkSessionId,
            wrappedSessionId,
            sessions: this.sessions,
            subagentSdkSessionIdToAgentId: this.subagentSdkSessionIdToAgentId,
            unmappedSubagentIds: this.unmappedSubagentIds,
        });
    }

    async createSession(config: SessionConfig = {}): Promise<Session> {
        return createClaudeSession({
            config,
            isRunning: this.isRunning,
            loadConfiguredAgents: (projectRoot) =>
                this.loadConfiguredAgents(projectRoot),
            emitEvent: (eventType, sessionId, data) =>
                this.emitEvent(eventType, sessionId, data),
            emitProviderEvent: (eventType, sessionId, data, options) =>
                this.emitProviderEvent(eventType, sessionId, data, options),
            emitRuntimeSelection: (sessionId, operation) =>
                this.emitRuntimeSelection(sessionId, operation),
            pendingHookSessionBindings: this.pendingHookSessionBindings,
            wrapQuery: (queryInstance, sessionId, sessionConfig) =>
                this.wrapQuery(queryInstance, sessionId, sessionConfig),
        });
    }

    async resumeSession(sessionId: string): Promise<Session | null> {
        return resumeClaudeSession({
            sessionId,
            isRunning: this.isRunning,
            sessions: this.sessions,
            emitRuntimeSelection: (targetSessionId, operation) =>
                this.emitRuntimeSelection(targetSessionId, operation),
            buildSdkOptions: (config, targetSessionId) =>
                this.buildSdkOptions(config, targetSessionId),
            wrapQuery: (queryInstance, targetSessionId, config, persisted) =>
                this.wrapQuery(
                    queryInstance,
                    targetSessionId,
                    config,
                    persisted,
                ),
        });
    }

    on<T extends EventType>(eventType: T, handler: EventHandler<T>): () => void {
        return registerClaudeHookHandler({
            eventType,
            handler,
            eventHandlers: this.eventHandlers,
            registeredHooks: this.registeredHooks,
            sessions: this.sessions,
            pendingHookSessionBindings: this.pendingHookSessionBindings,
            toolUseIdToAgentId: this.toolUseIdToAgentId,
            toolUseIdToSessionId: this.toolUseIdToSessionId,
            taskDescriptionByToolUseId: this.taskDescriptionByToolUseId,
            subagentSdkSessionIdToAgentId: this.subagentSdkSessionIdToAgentId,
            unmappedSubagentIds: this.unmappedSubagentIds,
        });
    }

    registerTool(tool: ToolDefinition): void {
        registerClaudeTool({
            tool,
            sessions: this.sessions,
            registeredTools: this.registeredTools,
        });
    }

    async listSupportedModels(): Promise<Array<{ value: string; displayName: string; description: string }>> {
        return listClaudeSupportedModels({
            isRunning: this.isRunning,
            sessions: this.sessions,
            modelListReadsBySession: this.modelListReadsBySession,
            fetchFreshSupportedModels: () => this.fetchFreshSupportedModels(),
        });
    }

    private async fetchFreshSupportedModels(): Promise<Array<{ value: string; displayName: string; description: string }>> {
        return fetchFreshClaudeSupportedModels();
    }

    async setActiveSessionModel(model: string): Promise<void> {
        setClaudeActiveSessionModel({
            model,
            sessions: this.sessions,
        });
    }

    async start(): Promise<void> {
        if (this.isRunning) {
            return;
        }
        this.isRunning = true;
    }

    async stop(): Promise<void> {
        stopClaudeClient({
            isRunning: this.isRunning,
            setIsRunning: (value) => {
                this.isRunning = value;
            },
            sessions: this.sessions,
            pendingToolBySession: this.pendingToolBySession,
            pendingSubagentBySession: this.pendingSubagentBySession,
            modelListReadsBySession: this.modelListReadsBySession,
            eventHandlers: this.eventHandlers,
        });
    }

    async getModelDisplayInfo(modelHint?: string): Promise<{ model: string; tier: string; contextWindow?: number }> {
        return getClaudeModelDisplayInfo({
            modelHint,
            detectedModel: this.detectedModel,
            capturedModelContextWindows: this.capturedModelContextWindows,
            probeContextWindow: this.probeContextWindow,
        });
    }

    getSystemToolsTokens(): number | null {
        return getClaudeSystemToolsTokens(this.probeSystemToolsBaseline);
    }
}
export function createClaudeAgentClient(): ClaudeAgentClient {
    return new ClaudeAgentClient();
}
