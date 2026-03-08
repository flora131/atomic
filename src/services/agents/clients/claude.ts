/**
 * ClaudeAgentClient - Implementation of CodingAgentClient for Claude Agent SDK
 *
 * This module implements the unified CodingAgentClient interface using the
 * @anthropic-ai/claude-agent-sdk package. It supports:
 * - Session creation and resumption via the query() API
 * - Streaming message responses
 * - Native SDK hooks for event handling
 * - Custom tool registration via createSdkMcpServer
 *
 * AGENT-SPECIFIC LOGIC (why this module exists):
 * - Claude SDK uses query() function instead of session objects
 * - Claude SDK has unique HookEvent system (PreToolUse, PostToolUse, etc.)
 * - Claude SDK uses MCP servers for tool registration (via createSdkMcpServer)
 * - Claude SDK permission model uses canUseTool callback and permissionMode
 * - Claude SDK event types (SDKMessage) require custom mapping to unified EventType
 * - Claude SDK uses Zod schemas internally (requires 'any' casting for compatibility)
 *
 * Common patterns (see base-client.ts) are duplicated here because:
 * - on() method extends base behavior with Claude-specific hook registration
 * - emitEvent() is tightly coupled with internal session state
 */

import {
    query,
    createSdkMcpServer,
    type Query,
    type Options,
    type SDKMessage,
    type SDKAssistantMessage,
    type SDKAuthStatusMessage,
    type SDKPromptSuggestionMessage,
    type SDKRateLimitEvent,
    type SDKResultMessage,
    type SDKStatusMessage,
    type SDKSystemMessage,
    type SDKTaskNotificationMessage,
    type SDKTaskProgressMessage,
    type SDKTaskStartedMessage,
    type SDKToolProgressMessage,
    type SDKToolUseSummaryMessage,
    type HookEvent,
    type HookCallback,
    type HookCallbackMatcher,
    type HookInput,
    type HookJSONOutput,
    type McpSdkServerConfigWithInstance,
    type McpServerStatus,
    type ThinkingConfig,
} from "@anthropic-ai/claude-agent-sdk";
import type {
    CodingAgentClient,
    Session,
    SessionConfig,
    AgentMessage,
    MessageCompleteEventData,
    ContextUsage,
    McpAuthStatus,
    McpRuntimeSnapshot,
    EventType,
    EventHandler,
    AgentEvent,
    ToolDefinition,
    ToolContext,
    MessageContentType,
} from "@/services/agents/types.ts";
import { stripProviderPrefix } from "@/services/agents/types.ts";
import { initClaudeOptions } from "@/services/agents/init.ts";
import { loadClaudeAgents } from "@/services/config/claude-config.ts";
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
    extractSkillInvocationFromToolInput,
    isSkillToolName,
} from "@/services/agents/clients/skill-invocation.ts";
import type {
    ClaudeProviderEvent,
    ClaudeProviderEventHandler,
    ClaudeNativeEvent,
    ProviderStreamEventDataMap,
    ProviderStreamEventType,
} from "@/services/agents/provider-events.ts";
import { createSyntheticProviderNativeEvent } from "@/services/agents/provider-events.ts";

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
    query: Query | null;
    sessionId: string;
    /** SDK's session ID for resuming conversations (captured from first message) */
    sdkSessionId: string | null;
    config: SessionConfig;
    inputTokens: number;
    outputTokens: number;
    isClosed: boolean;
    /** Context window size captured from SDKResultMessage.modelUsage */
    contextWindow: number | null;
    /** System tools baseline tokens captured from cache tokens */
    systemToolsBaseline: number | null;
    /** Whether per-turn usage events were emitted from message_delta during streaming */
    hasEmittedStreamingUsage: boolean;
    /** In-flight abort gate used to serialize new queries after interrupts */
    pendingAbortPromise: Promise<void> | null;
}

interface StreamIntegrityCounters {
    missingTerminalEvents: number;
    unmatchedToolStarts: number;
    unmatchedToolCompletes: number;
    unmatchedSubagentStarts: number;
    unmatchedSubagentCompletes: number;
}

/**
 * Maps SDK event types to unified EventType
 */
function mapSdkEventToEventType(sdkMessageType: string): EventType | null {
    const mapping: Record<string, EventType> = {
        assistant: "message.complete",
        stream_event: "message.delta",
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
        "tool.start": "PreToolUse",
        "skill.invoked": "PreToolUse",
        "tool.complete": "PostToolUse",
        "subagent.start": "SubagentStart",
        "subagent.complete": "SubagentStop",
    };
    return mapping[eventType] ?? null;
}

const DEFAULT_SUBAGENT_TASK_LABEL = "sub-agent task";

function isGenericSubagentTaskLabel(task: string | undefined): boolean {
    const normalized = task?.trim().toLowerCase() ?? "";
    return (
        normalized.length === 0 ||
        normalized === DEFAULT_SUBAGENT_TASK_LABEL ||
        normalized === "subagent task"
    );
}

function shouldPreferRecordedSubagentTask(args: {
    taskFromHook: string | undefined;
    agentType: string | undefined;
}): boolean {
    const hookTask = args.taskFromHook?.trim();
    if (!hookTask) {
        return true;
    }
    if (isGenericSubagentTaskLabel(hookTask)) {
        return true;
    }
    const normalizedAgentType = args.agentType?.trim().toLowerCase();
    return Boolean(normalizedAgentType && hookTask.toLowerCase() === normalizedAgentType);
}

function assertNeverClaudeMessage(value: never): never {
    throw new Error(`Unhandled Claude SDK message: ${JSON.stringify(value)}`);
}

function getClaudeNativeSubtype(
    native: ClaudeNativeEvent | undefined,
): string | undefined {
    if (!native || !("subtype" in native)) {
        return undefined;
    }
    const subtype = native.subtype;
    return typeof subtype === "string" ? subtype : undefined;
}

function getClaudeNativeMeta(
    native: ClaudeNativeEvent | undefined,
): Readonly<Record<string, string | number | boolean | null | undefined>> | undefined {
    if (!native) {
        return undefined;
    }

    const meta: Record<string, string | number | boolean | null | undefined> = {};
    if ("session_id" in native && typeof native.session_id === "string") {
        meta.nativeSessionId = native.session_id;
    }
    if ("uuid" in native && typeof native.uuid === "string") {
        meta.nativeMessageId = native.uuid;
    }
    if ("parent_tool_use_id" in native) {
        meta.parentToolUseId =
            native.parent_tool_use_id === null || typeof native.parent_tool_use_id === "string"
                ? native.parent_tool_use_id
                : undefined;
    }
    if ("tool_use_id" in native && typeof native.tool_use_id === "string") {
        meta.toolUseId = native.tool_use_id;
    }
    if ("task_id" in native && typeof native.task_id === "string") {
        meta.taskId = native.task_id;
    }
    if ("hook_id" in native && typeof native.hook_id === "string") {
        meta.hookId = native.hook_id;
    }

    return Object.keys(meta).length > 0 ? meta : undefined;
}

/**
 * Extracts content from SDK message.
 *
 * Handles multi-block assistant messages by scanning all content blocks.
 * Priority: tool_use > text > thinking (tool_use is prioritized so the
 * streaming layer can accurately count tool invocations even when the
 * model emits thinking or text blocks before the tool_use block).
 */
export function extractMessageContent(message: SDKAssistantMessage): {
    type: MessageContentType;
    content: string | unknown;
    thinkingSourceKey?: string;
} {
    const betaMessage = message.message;
    if (betaMessage.content.length === 0) {
        return { type: "text", content: "" };
    }

    // Scan all blocks — prioritize tool_use, then text, then thinking
    let textContent: string | null = null;
    let thinkingContent: string | null = null;
    let thinkingSourceKey: string | undefined;

    for (
        let blockIndex = 0;
        blockIndex < betaMessage.content.length;
        blockIndex++
    ) {
        const block = betaMessage.content[blockIndex]!;
        if (block.type === "tool_use") {
            // Return immediately — tool_use has highest priority.
            // Include toolUseId so the UI can deduplicate partial messages
            // emitted by includePartialMessages (empty input → populated input).
            return {
                type: "tool_use",
                content: {
                    name: block.name,
                    input: block.input,
                    toolUseId: block.id,
                },
            };
        }
        if (block.type === "text" && textContent === null) {
            textContent = block.text;
        }
        if (block.type === "thinking" && thinkingContent === null) {
            thinkingContent = (block as { thinking: string }).thinking;
            thinkingSourceKey = String(blockIndex);
        }
    }

    if (textContent !== null) {
        return { type: "text", content: textContent };
    }

    if (thinkingContent !== null) {
        return {
            type: "thinking",
            content: thinkingContent,
            thinkingSourceKey,
        };
    }

    return { type: "text", content: "" };
}

function extractToolRequestsFromAssistantMessage(
    message: SDKAssistantMessage,
): MessageCompleteEventData["toolRequests"] {
    const toolRequests = message.message.content.flatMap((block: SDKAssistantMessage["message"]["content"][number]) => {
        if (block.type !== "tool_use") {
            return [];
        }

        return [{
            toolCallId: block.id,
            name: block.name,
            arguments: block.input,
        }];
    });

    return toolRequests.length > 0 ? toolRequests : undefined;
}

function createMessageCompleteEventData(
    message: SDKAssistantMessage,
): MessageCompleteEventData {
    const { type, content } = extractMessageContent(message);
    const toolRequests = extractToolRequestsFromAssistantMessage(message);

    return {
        message: {
            type,
            content,
            role: "assistant",
        },
        ...(toolRequests ? { toolRequests } : {}),
        ...(typeof message.parent_tool_use_id === "string"
            ? { parentToolCallId: message.parent_tool_use_id }
            : {}),
    };
}

function getClaudeContentBlockIndex(
    event: Record<string, unknown>,
): number | null {
    const directIndex = event.index;
    if (typeof directIndex === "number") {
        return directIndex;
    }

    const contentBlock = event.content_block;
    if (contentBlock && typeof contentBlock === "object") {
        const blockIndex = (contentBlock as Record<string, unknown>).index;
        if (typeof blockIndex === "number") {
            return blockIndex;
        }
    }

    return null;
}

function mapAuthStatusFromMcpServerStatus(
    status: McpServerStatus["status"],
): McpAuthStatus | undefined {
    if (status === "needs-auth") {
        return "Not logged in";
    }
    return undefined;
}

function normalizeClaudeModelLabel(model: string): string {
    const stripped = stripProviderPrefix(model);
    const lower = stripped.toLowerCase();

    if (
        lower === "default" ||
        lower === "opus" ||
        /(^|[-_])opus([-_]|$)/.test(lower)
    ) {
        return "opus";
    }

    if (lower === "sonnet" || /(^|[-_])sonnet([-_]|$)/.test(lower)) {
        return "sonnet";
    }

    if (lower === "haiku" || /(^|[-_])haiku([-_]|$)/.test(lower)) {
        return "haiku";
    }

    return stripped;
}

type ReasoningEffort = "low" | "medium" | "high" | "max";

interface AskUserQuestionInput {
    questions?: Array<{
        header?: string;
        question: string;
        options?: Array<{
            label: string;
            description?: string;
        }>;
        multiSelect?: boolean;
    }>;
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
    private static readonly BUILTIN_ALLOWED_TOOLS = [
        "Bash",
        "Read",
        "Write",
        "Edit",
        "Glob",
        "Grep",
        "Task",
        "Skill",
        "MultiEdit",
        "TodoRead",
        "TodoWrite",
        "NotebookEdit",
        "NotebookRead",
    ] as const;
    private static readonly SUPPORTS_ADAPTIVE_THINKING = new Set([
        "opus",
        "sonnet",
    ]);
    private static readonly SUPPORTED_REASONING_EFFORTS = new Set([
        "low",
        "medium",
        "high",
        "max",
    ]);

    private eventHandlers: Map<EventType, Set<EventHandler<EventType>>> =
        new Map();
    private providerEventHandlers = new Set<ClaudeProviderEventHandler>();
    private providerEventBridgeInitialized = false;
    private sessions: Map<string, ClaudeSessionState> = new Map();
    private registeredHooks: Record<string, HookCallback[]> = {};
    private registeredTools: Map<string, McpSdkServerConfigWithInstance> =
        new Map();
    private isRunning = false;
    /** Model detected from the SDK system init message */
    private detectedModel: string | null = null;
    /** Captured context window sizes per model from SDKResultMessage.modelUsage */
    public capturedModelContextWindows: Map<string, number> = new Map();
    /** Context window captured from the start() probe query */
    private probeContextWindow: number | null = null;
    /** System tools baseline captured from the start() probe query */
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
    /**
     * FIFO of wrapped session IDs awaiting first hook-session binding.
     * Enables deterministic SDK->wrapped session mapping when multiple
     * sessions are opened concurrently (parallel sub-agents).
     */
    private pendingHookSessionBindings: string[] = [];

    /**
     * Maps tool_use_id (from SubagentStart hook) → agent_id.
     * Used to correlate SDKTaskProgressMessage/SDKTaskNotificationMessage
     * with the correct sub-agent for emitting subagent.update events.
     */
    private toolUseIdToAgentId = new Map<string, string>();
    /** Maps tool_use_id → wrapped session ID for terminal hook routing. */
    private toolUseIdToSessionId = new Map<string, string>();
    /** Maps tool_use_id → task description from task_started for subagent labels. */
    private taskDescriptionByToolUseId = new Map<string, string>();

    /**
     * Maps sub-agent SDK session ID → agent_id.
     * Populated reactively: when a tool hook fires with an unknown session_id
     * that differs from the main session's sdkSessionId, it gets bound to the
     * first unmapped sub-agent.
     */
    private subagentSdkSessionIdToAgentId = new Map<string, string>();
    /**
     * Agent IDs of sub-agents that have started but haven't yet had their
     * SDK session ID discovered via a tool hook.
     */
    private unmappedSubagentIds: string[] = [];

    protected async loadConfiguredAgents(
        projectRoot: string,
    ): Promise<Awaited<ReturnType<typeof loadClaudeAgents>>> {
        return loadClaudeAgents({ projectRoot });
    }

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
    private buildNativeHooks(): Partial<
        Record<HookEvent, HookCallbackMatcher[]>
    > {
        const hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {};

        for (const [event, callbacks] of Object.entries(this.registeredHooks)) {
            if (callbacks && callbacks.length > 0) {
                hooks[event as HookEvent] = [{ hooks: callbacks }];
            }
        }

        return hooks;
    }

    private getReasoningEffort(effort?: string): ReasoningEffort {
        return ClaudeAgentClient.SUPPORTED_REASONING_EFFORTS.has(
            effort as ReasoningEffort,
        )
            ? (effort as ReasoningEffort)
            : "high";
    }

    private getThinkingBudget(
        model: string | undefined,
        maxThinkingTokens: number = 16000,
    ): ThinkingConfig | undefined {
        return model &&
            ClaudeAgentClient.SUPPORTS_ADAPTIVE_THINKING.has(
                normalizeClaudeModelLabel(model),
            )
            ? { type: "adaptive" }
            : {
                  type: "enabled",
                  budgetTokens: maxThinkingTokens,
              };
    }

    private async handleAskUserQuestion(
        sessionId: string,
        toolInput: Record<string, unknown>,
    ): Promise<{
        behavior: "allow";
        updatedInput: Record<string, unknown>;
    } | null> {
        const input = toolInput as AskUserQuestionInput;

        if (!input.questions || input.questions.length === 0) {
            return null;
        }

        const answers: Record<string, string> = {};

        for (const q of input.questions) {
            const responsePromise = new Promise<string | string[]>(
                (resolve) => {
                    const requestId = `ask_${Date.now()}`;
                    const providerData = {
                        requestId,
                        toolName: "AskUserQuestion",
                        toolInput: q,
                        question: q.question,
                        header: q.header,
                        options: q.options?.map((opt) => ({
                            label: opt.label,
                            value: opt.label,
                            description: opt.description,
                        })) ?? [
                            {
                                label: "Yes",
                                value: "yes",
                                description: "Approve",
                            },
                            {
                                label: "No",
                                value: "no",
                                description: "Deny",
                            },
                        ],
                        multiSelect: q.multiSelect ?? false,
                        respond: resolve,
                    } satisfies ProviderStreamEventDataMap["permission.requested"];
                    this.emitEvent("permission.requested", sessionId, providerData);
                    this.emitProviderEvent("permission.requested", sessionId, providerData, {
                        nativeSessionId: sessionId,
                        nativeEventId: requestId,
                    });
                },
            );

            const response = await responsePromise;
            answers[q.question] = Array.isArray(response)
                ? response.join(", ")
                : response;
        }

        return {
            behavior: "allow",
            updatedInput: { ...input, answers },
        };
    }

    private async resolveToolPermission(
        sessionId: string,
        toolName: string,
        toolInput: Record<string, unknown>,
    ): Promise<{ behavior: "allow"; updatedInput: Record<string, unknown> }> {
        if (toolName === "AskUserQuestion") {
            const resolved = await this.handleAskUserQuestion(
                sessionId,
                toolInput,
            );
            if (resolved) {
                return resolved;
            }
        }

        return { behavior: "allow", updatedInput: toolInput };
    }

    private buildMcpServers(
        config: SessionConfig,
    ): NonNullable<Options["mcpServers"]> | undefined {
        const mcpServers: NonNullable<Options["mcpServers"]> = {};
        let hasMcpServers = false;

        if (config.mcpServers && config.mcpServers.length > 0) {
            for (const server of config.mcpServers) {
                if (server.url && server.type === "sse") {
                    mcpServers[server.name] = {
                        type: "sse" as const,
                        url: server.url,
                        headers: server.headers,
                    };
                    hasMcpServers = true;
                } else if (server.url) {
                    mcpServers[server.name] = {
                        type: "http" as const,
                        url: server.url,
                        headers: server.headers,
                    };
                    hasMcpServers = true;
                } else if (server.command) {
                    mcpServers[server.name] = {
                        type: "stdio" as const,
                        command: server.command,
                        args: server.args,
                        env: server.env,
                    };
                    hasMcpServers = true;
                }
            }
        }

        for (const [name, server] of this.registeredTools) {
            mcpServers[name] = server;
            hasMcpServers = true;
        }

        return hasMcpServers ? mcpServers : undefined;
    }

    /**
     * Build SDK options from session config
     */
    private buildSdkOptions(
        config: SessionConfig,
        sessionId?: string,
    ): Options {
        const options: Options = {
            ...initClaudeOptions(),
            model: config.model,
            maxTurns: config.maxTurns,
            maxBudgetUsd: config.maxBudgetUsd,
            effort: this.getReasoningEffort(config.reasoningEffort),
            thinking: this.getThinkingBudget(
                config.model,
                config.maxThinkingTokens,
            ),
            hooks: this.buildNativeHooks(),
            includePartialMessages: true,
            // Use Claude Code's built-in system prompt, appending custom instructions if provided
            systemPrompt: config.additionalInstructions
                ? {
                      type: "preset",
                      preset: "claude_code",
                      append: config.additionalInstructions,
                  }
                : { type: "preset", preset: "claude_code" },
            // Explicitly set the path to Claude Code executable to prevent it from
            // resolving to bundled paths (like /$bunfs/root/cli.js in Bun compiled binaries)
            pathToClaudeCodeExecutable: getBundledClaudeCodePath(),
        };

        // Add canUseTool callback for HITL (Human-in-the-loop) interactions
        // This handles AskUserQuestion and other tools requiring user approval
        options.canUseTool = async (
            toolName: string,
            toolInput: Record<string, unknown>,
            _options: { signal: AbortSignal },
        ) => {
            return this.resolveToolPermission(
                sessionId ?? "",
                toolName,
                toolInput,
            );
        };

        const mcpServers = this.buildMcpServers(config);
        if (mcpServers) {
            options.mcpServers = mcpServers;
        }

        // Forward tool restrictions to the SDK so sub-agents only have access
        // to the tools specified in their agent definition (e.g. ["Glob", "Grep", "Read"]).
        // When config.tools is undefined, no restriction is applied (default tools).
        if (config.tools && config.tools.length > 0) {
            options.tools = config.tools;
        }

        // Forward sub-agent definitions to the Claude SDK
        // This is what makes /subagent commands discoverable to the model
        if (config.agents && Object.keys(config.agents).length > 0) {
            options.agents = config.agents;
        }

        // Always bypass permissions - Atomic handles its own permission flow
        // via canUseTool/HITL callbacks above. The initClaudeOptions() defaults
        // already set bypassPermissions, so no mapping from config is needed.
        options.permissionMode = "bypassPermissions";
        options.allowDangerouslySkipPermissions = true;

        // Defense-in-depth: explicitly allow all built-in tools so they are
        // auto-approved even if the SDK's Statsig gate
        // (tengu_disable_bypass_permissions_mode) silently downgrades
        // bypassPermissions to "default" mode at runtime.  allowedTools are
        // checked BEFORE the permission mode in the SDK's resolution chain,
        // which also prevents the sub-agent auto-deny path
        // (shouldAvoidPermissionPrompts) from rejecting tools.
        options.allowedTools = [...ClaudeAgentClient.BUILTIN_ALLOWED_TOOLS];

        // Resume session if sessionId provided
        if (config.sessionId) {
            options.resume = config.sessionId;
        }

        return options;
    }

    private emitRuntimeMarker(
        sessionId: string,
        marker: string,
        data: Record<string, unknown>,
    ): void {
        this.emitEvent("usage", sessionId, {
            provider: "claude",
            marker,
            ...data,
        });
    }

    private bumpStreamIntegrityCounter(
        sessionId: string,
        counter: keyof StreamIntegrityCounters,
        amount = 1,
    ): number {
        this.streamIntegrity[counter] += amount;
        const value = this.streamIntegrity[counter];
        this.emitRuntimeMarker(sessionId, "claude.stream.integrity", {
            [counter]: value,
        });
        return value;
    }

    private emitRuntimeSelection(
        sessionId: string,
        operation: "create" | "resume" | "send" | "stream" | "summarize",
    ): void {
        this.emitRuntimeMarker(sessionId, "claude.runtime.selected", {
            runtimeMode: "v1",
            operation,
        });
    }

    /**
     * Wrap a Query into a unified Session interface
     */
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
        const state: ClaudeSessionState = {
            query: queryInstance,
            sessionId,
            sdkSessionId: persisted?.sdkSessionId ?? null,
            config,
            inputTokens: persisted?.inputTokens ?? 0,
            outputTokens: persisted?.outputTokens ?? 0,
            isClosed: false,
            contextWindow: persisted?.contextWindow ?? this.probeContextWindow,
            systemToolsBaseline:
                persisted?.systemToolsBaseline ?? this.probeSystemToolsBaseline,
            hasEmittedStreamingUsage: false,
            pendingAbortPromise: null,
        };

        const waitForPendingAbort = async (): Promise<void> => {
            const pendingAbort = state.pendingAbortPromise;
            if (!pendingAbort) {
                return;
            }
            try {
                await pendingAbort;
            } catch {
                // If abort fails, do not block subsequent user turns.
            }
        };

        const runAbortWithLock = (): Promise<void> => {
            if (state.pendingAbortPromise) {
                return state.pendingAbortPromise;
            }

            const abortPromise = (async () => {
                // Prefer graceful interruption so the underlying Claude Code
                // session remains reusable for the next turn. Force-close only
                // as a fallback for runtimes that do not expose interrupt().
                const activeQuery = state.query as
                    | (Query & {
                          interrupt?: () => Promise<void>;
                      })
                    | null;
                if (!activeQuery) {
                    return;
                }

                if (typeof activeQuery.interrupt === "function") {
                    try {
                        await activeQuery.interrupt();
                        return;
                    } catch {
                        // Fall through to force-close fallback.
                    }
                }

                activeQuery.close();
            })();

            state.pendingAbortPromise = abortPromise;
            void abortPromise.finally(() => {
                if (state.pendingAbortPromise === abortPromise) {
                    state.pendingAbortPromise = null;
                }
            });

            return abortPromise;
        };

        this.sessions.set(sessionId, state);

        const session: Session = {
            id: sessionId,

            send: async (message: string): Promise<AgentMessage> => {
                if (state.isClosed) {
                    throw new Error("Session is closed");
                }
                await waitForPendingAbort();
                this.emitRuntimeSelection(sessionId, "send");

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
                state.query = newQuery;

                // Consume all messages and return the final assistant message
                let lastAssistantMessage: AgentMessage | null = null;
                let sawTerminalEvent = false;

                try {
                    for await (const sdkMessage of newQuery) {
                        this.processMessage(sdkMessage, sessionId, state);
                        if (sdkMessage.type === "result") {
                            sawTerminalEvent = true;
                        }

                        if (sdkMessage.type === "assistant") {
                            // Skip sub-agent assistant messages — only
                            // the main agent's response should be returned.
                            const parentToolUseId = (
                                sdkMessage as Record<string, unknown>
                            ).parent_tool_use_id;
                            if (parentToolUseId) {
                                continue;
                            }

                            const { type, content, thinkingSourceKey } =
                                extractMessageContent(sdkMessage);
                            lastAssistantMessage = {
                                type,
                                content,
                                role: "assistant",
                                metadata: {
                                    tokenUsage: {
                                        inputTokens:
                                            sdkMessage.message.usage
                                                ?.input_tokens ?? 0,
                                        outputTokens:
                                            sdkMessage.message.usage
                                                ?.output_tokens ?? 0,
                                    },
                                    model: sdkMessage.message.model,
                                    stopReason:
                                        sdkMessage.message.stop_reason ??
                                        undefined,
                                    ...(type === "thinking"
                                        ? {
                                              provider: "claude",
                                              thinkingSourceKey,
                                          }
                                        : {}),
                                },
                            };
                        }
                    }
                } catch (error) {
                    throw error instanceof Error
                        ? error
                        : new Error(String(error));
                }

                if (!sawTerminalEvent) {
                    this.bumpStreamIntegrityCounter(
                        sessionId,
                        "missingTerminalEvents",
                    );
                }

                return (
                    lastAssistantMessage ?? {
                        type: "text",
                        content: "",
                        role: "assistant",
                    }
                );
            },

            stream: (
                message: string,
                optionsArg?: { agent?: string },
            ): AsyncIterable<AgentMessage> => {
                // Capture references for the async generator
                const buildOptions = () =>
                    this.buildSdkOptions(config, sessionId);
                const processMsg = (msg: SDKMessage) =>
                    this.processMessage(msg, sessionId, state);
                const emitRuntimeSelection = () =>
                    this.emitRuntimeSelection(sessionId, "stream");
                const getSubagentAgentId = (nativeSessionId: string) =>
                    this.subagentSdkSessionIdToAgentId.get(nativeSessionId);
                const bumpMissingTerminalEvents = () => {
                    return this.bumpStreamIntegrityCounter(
                        sessionId,
                        "missingTerminalEvents",
                    );
                };
                // Capture SDK session ID for resume
                const getSdkSessionId = () => state.sdkSessionId;
                const emitStreamingUsage = (outputTokens: number) => {
                    state.hasEmittedStreamingUsage = true;
                    this.emitEvent("usage", sessionId, {
                        inputTokens: 0,
                        outputTokens,
                        model: this.detectedModel,
                    });
                };
                const emitProviderStreamingEvent = <T extends ProviderStreamEventType>(
                    eventType: T,
                    data: ProviderStreamEventDataMap[T],
                    options?: {
                        native?: ClaudeNativeEvent;
                        nativeEventId?: string;
                        nativeSessionId?: string;
                        timestamp?: number;
                    },
                ) => {
                    this.emitProviderEvent(eventType, sessionId, data, options);
                };

                return {
                    [Symbol.asyncIterator]: async function* () {
                        if (state.isClosed) {
                            throw new Error("Session is closed");
                        }
                        await waitForPendingAbort();
                        state.hasEmittedStreamingUsage = false;
                        emitRuntimeSelection();
                        const options: Options = {
                            ...buildOptions(),
                            includePartialMessages: true,
                        };
                        const sdkSessionId = getSdkSessionId();
                        if (sdkSessionId) {
                            options.resume = sdkSessionId;
                        }
                        const streamSource = query({
                            prompt: message,
                            options,
                        });
                        state.query = streamSource;

                        // Track if we've yielded streaming deltas to avoid duplicating content
                        let hasYieldedDeltas = false;

                        // Thinking block duration tracking
                        let thinkingStartMs: number | null = null;
                        let thinkingDurationMs = 0;
                        let currentBlockIsThinking = false;
                        let activeThinkingSourceKey: string | null = null;
                        // Output token tracking from message_delta events
                        let outputTokens = 0;
                        let sawTerminalEvent = false;

                        try {
                            for await (const sdkMessage of streamSource) {
                                processMsg(sdkMessage);
                                if (sdkMessage.type === "result") {
                                    sawTerminalEvent = true;
                                }

                                if (sdkMessage.type === "stream_event") {
                                    const event = sdkMessage.event;
                                    const eventRecord = event as Record<
                                        string,
                                        unknown
                                    >;
                                    const nativeEventSessionId =
                                        typeof sdkMessage.session_id ===
                                            "string"
                                            ? sdkMessage.session_id
                                            : undefined;
                                    const parentToolUseId =
                                        typeof eventRecord.parent_tool_use_id ===
                                        "string"
                                            ? eventRecord.parent_tool_use_id
                                            : typeof eventRecord.parentToolUseId ===
                                                "string"
                                              ? eventRecord.parentToolUseId
                                              : undefined;
                                    const sessionScopedAgentId =
                                        nativeEventSessionId
                                            ? getSubagentAgentId(
                                                  nativeEventSessionId,
                                              )
                                            : undefined;
                                    const isChildSessionStream =
                                        typeof nativeEventSessionId ===
                                            "string" &&
                                        typeof state.sdkSessionId ===
                                            "string" &&
                                        nativeEventSessionId !==
                                            state.sdkSessionId;
                                    const suppressTopLevelYield =
                                        Boolean(parentToolUseId) ||
                                        Boolean(sessionScopedAgentId) ||
                                        isChildSessionStream;

                                    // Track thinking block boundaries
                                    if (event.type === "content_block_start") {
                                        const blockIndex =
                                            getClaudeContentBlockIndex(
                                                event as Record<
                                                    string,
                                                    unknown
                                                >,
                                            );
                                        const blockType = (
                                            event as Record<string, unknown>
                                        ).content_block
                                            ? (
                                                  (
                                                      event as Record<
                                                          string,
                                                          unknown
                                                      >
                                                  ).content_block as Record<
                                                      string,
                                                      unknown
                                                  >
                                              ).type
                                            : undefined;
                                        currentBlockIsThinking =
                                            blockType === "thinking";
                                        if (currentBlockIsThinking) {
                                            thinkingStartMs = Date.now();
                                            activeThinkingSourceKey =
                                                blockIndex !== null
                                                    ? String(blockIndex)
                                                    : null;
                                        }
                                    }
                                        if (
                                            event.type === "content_block_stop" &&
                                            currentBlockIsThinking
                                        ) {
                                        if (activeThinkingSourceKey === null) {
                                            const blockIndex =
                                                getClaudeContentBlockIndex(
                                                    event as Record<
                                                        string,
                                                        unknown
                                                    >,
                                                );
                                            if (blockIndex !== null) {
                                                activeThinkingSourceKey =
                                                    String(blockIndex);
                                            }
                                        }
                                        if (thinkingStartMs !== null) {
                                            thinkingDurationMs +=
                                                Date.now() - thinkingStartMs;
                                            thinkingStartMs = null;
                                        }
                                        currentBlockIsThinking = false;
                                        if (!suppressTopLevelYield) {
                                            yield {
                                                type: "thinking" as MessageContentType,
                                                content: "",
                                                role: "assistant",
                                                metadata: {
                                                    provider: "claude",
                                                    thinkingSourceKey:
                                                        activeThinkingSourceKey ??
                                                        undefined,
                                                    streamingStats: {
                                                        thinkingMs:
                                                            thinkingDurationMs,
                                                        outputTokens,
                                                    },
                                                },
                                            };
                                        }
                                        emitProviderStreamingEvent(
                                            "reasoning.complete",
                                            {
                                                reasoningId:
                                                    activeThinkingSourceKey ??
                                                    "thinking",
                                                durationMs: thinkingDurationMs,
                                                parentToolCallId:
                                                    parentToolUseId ??
                                                    undefined,
                                            },
                                            {
                                                native: sdkMessage,
                                                nativeSessionId:
                                                    sdkMessage.session_id,
                                                nativeEventId:
                                                    sdkMessage.uuid,
                                            },
                                        );
                                        activeThinkingSourceKey = null;
                                    }

                                    // Track output tokens from message_delta usage
                                    if (event.type === "message_delta") {
                                        const usage = (
                                            event as Record<string, unknown>
                                        ).usage as
                                            | { output_tokens?: number }
                                            | undefined;
                                        if (usage?.output_tokens) {
                                            outputTokens += usage.output_tokens;
                                            // Emit per-API-call token count so the adapter can publish
                                            // stream.usage for live token display during streaming
                                            emitStreamingUsage(
                                                usage.output_tokens,
                                            );
                                        }
                                    }

                                        if (event.type === "content_block_delta") {
                                            if (event.delta.type === "text_delta") {
                                            if (!suppressTopLevelYield) {
                                                hasYieldedDeltas = true;
                                                yield {
                                                    type: "text",
                                                    content: event.delta.text,
                                                    role: "assistant",
                                                };
                                            }
                                            emitProviderStreamingEvent(
                                                "message.delta",
                                                {
                                                    delta: event.delta.text,
                                                    contentType: "text",
                                                    parentToolCallId:
                                                        parentToolUseId,
                                                },
                                                {
                                                    native: sdkMessage,
                                                    nativeSessionId:
                                                        sdkMessage.session_id,
                                                    nativeEventId:
                                                        sdkMessage.uuid,
                                                },
                                            );
                                        } else if (
                                            event.delta.type ===
                                            "thinking_delta"
                                        ) {
                                            if (!parentToolUseId) {
                                                hasYieldedDeltas = true;
                                            }
                                            const blockIndex =
                                                getClaudeContentBlockIndex(
                                                    event as Record<
                                                        string,
                                                        unknown
                                                    >,
                                                );
                                            const resolvedThinkingSourceKey:
                                                | string
                                                | null =
                                                blockIndex !== null
                                                    ? String(blockIndex)
                                                    : activeThinkingSourceKey;
                                            if (
                                                resolvedThinkingSourceKey !==
                                                null
                                            ) {
                                                activeThinkingSourceKey =
                                                    resolvedThinkingSourceKey;
                                            }
                                            const currentThinkingMs =
                                                thinkingDurationMs +
                                                (thinkingStartMs !== null
                                                    ? Date.now() -
                                                      thinkingStartMs
                                                    : 0);
                                            if (!suppressTopLevelYield) {
                                                yield {
                                                    type: "thinking" as MessageContentType,
                                                    content: (
                                                        event.delta as Record<
                                                            string,
                                                            unknown
                                                        >
                                                    ).thinking as string,
                                                    role: "assistant",
                                                    metadata: {
                                                        provider: "claude",
                                                        thinkingSourceKey:
                                                            resolvedThinkingSourceKey ??
                                                            undefined,
                                                        streamingStats: {
                                                            thinkingMs:
                                                                currentThinkingMs,
                                                            outputTokens,
                                                        },
                                                    },
                                                };
                                            }
                                            emitProviderStreamingEvent(
                                                "reasoning.delta",
                                                {
                                                    delta: (
                                                        event.delta as Record<
                                                            string,
                                                            unknown
                                                        >
                                                    ).thinking as string,
                                                    reasoningId:
                                                        resolvedThinkingSourceKey ??
                                                        "thinking",
                                                    parentToolCallId:
                                                        parentToolUseId ??
                                                        undefined,
                                                },
                                                {
                                                    native: sdkMessage,
                                                    nativeSessionId:
                                                        sdkMessage.session_id,
                                                    nativeEventId:
                                                        sdkMessage.uuid,
                                                },
                                            );
                                        }
                                    }
                                } else if (sdkMessage.type === "assistant") {
                                    const messageCompleteData =
                                        createMessageCompleteEventData(
                                            sdkMessage,
                                        );
                                    emitProviderStreamingEvent(
                                        "message.complete",
                                        {
                                            ...messageCompleteData,
                                            nativeMessageId: sdkMessage.uuid,
                                        },
                                        {
                                            native: sdkMessage,
                                            nativeSessionId:
                                                sdkMessage.session_id,
                                            nativeEventId: sdkMessage.uuid,
                                        },
                                    );

                                    // Skip sub-agent assistant messages — they
                                    // belong to a child agent context and their
                                    // tool calls are handled by the hook path
                                    // (PreToolUse/PostToolUse) with proper
                                    // parentAgentId routing. Yielding them here
                                    // would leak sub-agent tool_use (and text)
                                    // into the main chat without parentAgentId.
                                    const parentToolUseId = (
                                        sdkMessage as Record<string, unknown>
                                    ).parent_tool_use_id;
                                    const nativeAssistantSessionId =
                                        typeof sdkMessage.session_id ===
                                            "string"
                                            ? sdkMessage.session_id
                                            : undefined;
                                    const sessionScopedAgentId =
                                        nativeAssistantSessionId
                                            ? getSubagentAgentId(
                                                  nativeAssistantSessionId,
                                              )
                                            : undefined;
                                    const isChildAssistantMessage =
                                        typeof nativeAssistantSessionId ===
                                            "string" &&
                                        typeof state.sdkSessionId ===
                                            "string" &&
                                        nativeAssistantSessionId !==
                                            state.sdkSessionId;
                                    if (
                                        parentToolUseId ||
                                        sessionScopedAgentId ||
                                        isChildAssistantMessage
                                    ) {
                                        continue;
                                    }

                                    const { type, content, thinkingSourceKey } =
                                        extractMessageContent(sdkMessage);

                                    // Always yield tool_use messages so callers can track tool
                                    // invocations (e.g. spawnSubagentParallel counts them for
                                    // the tree view).  Text messages are only yielded when we
                                    // haven't already streamed text deltas to avoid duplication.
                                    if (type === "tool_use") {
                                        yield {
                                            type,
                                            content,
                                            role: "assistant",
                                            metadata: {
                                                toolName:
                                                    typeof content ===
                                                        "object" &&
                                                    content !== null
                                                        ? ((
                                                              content as Record<
                                                                  string,
                                                                  unknown
                                                              >
                                                          ).name as string)
                                                        : undefined,
                                            },
                                        };
                                    } else if (!hasYieldedDeltas) {
                                        yield {
                                            type,
                                            content,
                                            role: "assistant",
                                            metadata: {
                                                tokenUsage: {
                                                    inputTokens:
                                                        sdkMessage.message.usage
                                                            ?.input_tokens ?? 0,
                                                    outputTokens:
                                                        sdkMessage.message.usage
                                                            ?.output_tokens ??
                                                        0,
                                                },
                                                model: sdkMessage.message.model,
                                                stopReason:
                                                    sdkMessage.message
                                                        .stop_reason ??
                                                    undefined,
                                                ...(type === "thinking"
                                                    ? {
                                                          provider: "claude",
                                                          thinkingSourceKey,
                                                      }
                                                    : {}),
                                            },
                                        };
                                    }
                                }
                            }
                        } catch (error) {
                            throw error instanceof Error
                                ? error
                                : new Error(String(error));
                        }

                        if (!sawTerminalEvent) {
                            bumpMissingTerminalEvents();
                        }

                        // Yield final metadata with actual token count and thinking duration
                        if (outputTokens > 0 || thinkingDurationMs > 0) {
                            yield {
                                type: "text" as const,
                                content: "",
                                role: "assistant" as const,
                                metadata: {
                                    streamingStats: {
                                        outputTokens,
                                        thinkingMs: thinkingDurationMs,
                                    },
                                },
                            };
                        }
                    },
                };
            },

            summarize: async (): Promise<void> => {
                if (state.isClosed) {
                    throw new Error("Session is closed");
                }
                await waitForPendingAbort();
                this.emitRuntimeSelection(sessionId, "summarize");

                // Send /compact as a prompt to the Claude Agents SDK
                const options = this.buildSdkOptions(config, sessionId);
                if (state.sdkSessionId) {
                    options.resume = state.sdkSessionId;
                }

                const newQuery = query({
                    prompt: "/compact",
                    options,
                });
                state.query = newQuery;

                // Consume all messages to complete the compaction
                try {
                    for await (const sdkMessage of newQuery) {
                        this.processMessage(sdkMessage, sessionId, state);
                    }
                } catch (error) {
                    throw error instanceof Error
                        ? error
                        : new Error(String(error));
                }
            },

            getContextUsage: async (): Promise<ContextUsage> => {
                if (state.contextWindow === null) {
                    throw new Error(
                        "Context window size unavailable: no query has completed. Send a message before calling getContextUsage().",
                    );
                }
                const maxTokens = state.contextWindow;
                const totalTokens = state.inputTokens + state.outputTokens;
                return {
                    inputTokens: state.inputTokens,
                    outputTokens: state.outputTokens,
                    maxTokens,
                    usagePercentage: (totalTokens / maxTokens) * 100,
                };
            },

            getSystemToolsTokens: (): number => {
                if (state.systemToolsBaseline === null) {
                    throw new Error(
                        "System tools baseline unavailable: no query has completed. Send a message first.",
                    );
                }
                return state.systemToolsBaseline;
            },

            getMcpSnapshot: async (): Promise<McpRuntimeSnapshot | null> => {
                if (state.isClosed) {
                    return null;
                }
                await waitForPendingAbort();

                let statusQuery: Query | null = null;
                let shouldClose = false;

                try {
                    if (state.sdkSessionId) {
                        const options = this.buildSdkOptions(config, sessionId);
                        options.resume = state.sdkSessionId;
                        options.maxTurns = 0;
                        statusQuery = query({ prompt: "", options });
                        shouldClose = true;
                    } else if (state.query) {
                        statusQuery = state.query;
                    } else {
                        return null;
                    }

                    const statusList = await statusQuery.mcpServerStatus();
                    const servers: McpRuntimeSnapshot["servers"] = {};
                    for (const status of statusList) {
                        const authStatus = mapAuthStatusFromMcpServerStatus(
                            status.status,
                        );
                        servers[status.name] = {
                            ...(authStatus ? { authStatus } : {}),
                            tools:
                                status.tools
                                    ?.map((tool) => tool.name)
                                    .filter((name) => name.length > 0) ?? [],
                        };
                    }
                    return { servers };
                } catch {
                    return null;
                } finally {
                    if (shouldClose) {
                        statusQuery?.close();
                    }
                }
            },

            abort: async (): Promise<void> => {
                await runAbortWithLock();
            },

            abortBackgroundAgents: async (): Promise<void> => {
                await runAbortWithLock();
            },

            destroy: async (): Promise<void> => {
                if (!state.isClosed) {
                    state.isClosed = true;
                    state.query?.close();
                    const pendingTools =
                        this.pendingToolBySession.get(sessionId) ?? 0;
                    const pendingSubagents =
                        this.pendingSubagentBySession.get(sessionId) ?? 0;
                    if (pendingTools > 0) {
                        this.bumpStreamIntegrityCounter(
                            sessionId,
                            "unmatchedToolStarts",
                            pendingTools,
                        );
                    }
                    if (pendingSubagents > 0) {
                        this.bumpStreamIntegrityCounter(
                            sessionId,
                            "unmatchedSubagentStarts",
                            pendingSubagents,
                        );
                    }
                    this.pendingToolBySession.delete(sessionId);
                    this.pendingSubagentBySession.delete(sessionId);
                    this.modelListReadsBySession.delete(sessionId);
                    for (const [
                        toolUseId,
                        mappedSessionId,
                    ] of this.toolUseIdToSessionId.entries()) {
                        if (mappedSessionId === sessionId) {
                            this.toolUseIdToSessionId.delete(toolUseId);
                            this.taskDescriptionByToolUseId.delete(toolUseId);
                        }
                    }
                    // Clean up sub-agent session tracking
                    this.subagentSdkSessionIdToAgentId.clear();
                    this.unmappedSubagentIds.length = 0;
                    this.sessions.delete(sessionId);
                    this.emitEvent("session.idle", sessionId, {
                        reason: "destroyed",
                    });
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
        state: ClaudeSessionState,
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

        if (sdkMessage.type === "system" && sdkMessage.subtype === "status") {
            const statusMessage = sdkMessage as SDKStatusMessage;
            if (statusMessage.status === "compacting") {
                this.emitEvent("session.compaction", sessionId, {
                    phase: "start",
                });
            }
        }

        if (sdkMessage.type === "system" && sdkMessage.subtype === "compact_boundary") {
            this.emitEvent("session.compaction", sessionId, {
                phase: "complete",
                success: true,
            });
        }

        // Handle task_progress messages from sub-agents (periodic progress updates)
        if (
            sdkMessage.type === "system" &&
            sdkMessage.subtype === "task_progress"
        ) {
            const msg = sdkMessage as SDKTaskProgressMessage;
            const toolUseId = msg.tool_use_id;
            const mappedAgentId = toolUseId
                ? this.toolUseIdToAgentId.get(toolUseId)
                : undefined;
            const sessionScopedAgentId =
                this.subagentSdkSessionIdToAgentId.get(msg.session_id);
            const agentId = mappedAgentId ?? sessionScopedAgentId;
            if (agentId) {
                this.emitEvent("subagent.update", sessionId, {
                    subagentId: agentId,
                    currentTool: msg.last_tool_name,
                    toolUses: msg.usage.tool_uses,
                });
            }
        }

        if (
            sdkMessage.type === "system" &&
            sdkMessage.subtype === "task_started"
        ) {
            const msg = sdkMessage as SDKTaskStartedMessage;
            const toolUseId = msg.tool_use_id;
            const description = msg.description.trim();
            if (toolUseId && description.length > 0) {
                this.taskDescriptionByToolUseId.set(toolUseId, description);
            }
        }

        // Handle task_notification messages (sub-agent completion notification)
        if (
            sdkMessage.type === "system" &&
            sdkMessage.subtype === "task_notification"
        ) {
            const msg = sdkMessage as SDKTaskNotificationMessage;
            const toolUseId = msg.tool_use_id;
            const mappedAgentId = toolUseId
                ? this.toolUseIdToAgentId.get(toolUseId)
                : undefined;
            const sessionScopedAgentId =
                this.subagentSdkSessionIdToAgentId.get(msg.session_id);
            const agentId = mappedAgentId ?? sessionScopedAgentId;
            if (agentId) {
                this.emitEvent("subagent.complete", sessionId, {
                    subagentId: agentId,
                    success: msg.status === "completed",
                    result: msg.summary,
                });
                if (toolUseId) {
                    this.toolUseIdToAgentId.delete(toolUseId);
                    this.toolUseIdToSessionId.delete(toolUseId);
                    this.taskDescriptionByToolUseId.delete(toolUseId);
                }
            }
        }

        // Track token usage from assistant messages (state only — values are
        // stale during streaming because the SDK yields assistant messages at
        // content_block_stop before message_delta delivers the real count).
        // The authoritative usage event is emitted from the result message below.
        if (sdkMessage.type === "assistant") {
            const usage = sdkMessage.message.usage;
            if (usage) {
                state.inputTokens = usage.input_tokens;
                state.outputTokens = usage.output_tokens;
            }
        }

        // Map and emit events
        const eventType = mapSdkEventToEventType(sdkMessage.type);
        if (eventType === "message.complete" && sdkMessage.type === "assistant") {
            this.emitEvent(eventType, sessionId, createMessageCompleteEventData(sdkMessage));
        } else if (eventType) {
            this.emitEvent(eventType, sessionId, { sdkMessage });
        }

        // Handle specific message types
        if (sdkMessage.type === "result") {
            const result = sdkMessage as SDKResultMessage;
            if (result.subtype === "success") {
                this.emitEvent("session.idle", sessionId, {
                    reason: result.stop_reason ?? "completed",
                });
            } else {
                const errorMessage = result.errors.join("; ") || "Claude turn failed";
                const errorCode =
                    result.subtype === "error_max_turns"
                        ? "MAX_TURNS"
                        : result.subtype === "error_max_budget_usd"
                          ? "MAX_BUDGET"
                          : result.subtype === "error_max_structured_output_retries"
                            ? "MAX_STRUCTURED_OUTPUT_RETRIES"
                            : "EXECUTION_ERROR";
                this.emitEvent("session.error", sessionId, {
                    error: errorMessage,
                    code: errorCode,
                });
            }

            // Emit authoritative cumulative usage from the result message.
            // The result carries the correct totals for all API calls in
            // this interaction (unlike assistant messages which have stale
            // initial values during streaming).
            if (result.usage) {
                state.inputTokens = result.usage.input_tokens;
                state.outputTokens = result.usage.output_tokens;
                const detectedModelUsage = this.detectedModel
                    ? result.modelUsage?.[this.detectedModel]
                    : undefined;
                if (!state.hasEmittedStreamingUsage) {
                    // Non-streaming path (send): emit full usage
                    this.emitEvent("usage", sessionId, {
                        inputTokens: result.usage.input_tokens ?? 0,
                        outputTokens: result.usage.output_tokens ?? 0,
                        model: this.detectedModel,
                        costUsd: result.total_cost_usd,
                        cacheReadTokens:
                            detectedModelUsage?.cacheReadInputTokens ?? 0,
                        cacheWriteTokens:
                            detectedModelUsage?.cacheCreationInputTokens ?? 0,
                    });
                } else {
                    // Streaming path: output tokens already accumulated from message_delta.
                    // Emit input tokens only (outputTokens: 0 adds nothing to accumulator).
                    this.emitEvent("usage", sessionId, {
                        inputTokens: result.usage.input_tokens ?? 0,
                        outputTokens: 0,
                        model: this.detectedModel,
                        costUsd: result.total_cost_usd,
                        cacheReadTokens:
                            detectedModelUsage?.cacheReadInputTokens ?? 0,
                        cacheWriteTokens:
                            detectedModelUsage?.cacheCreationInputTokens ?? 0,
                    });
                }
                // Reset so subsequent queries on this session (send, summarize) emit normally
                state.hasEmittedStreamingUsage = false;
            }

            // Extract contextWindow and systemToolsBaseline from modelUsage
            if (result.modelUsage) {
                const modelKey =
                    this.detectedModel ?? Object.keys(result.modelUsage)[0];
                if (modelKey && result.modelUsage[modelKey]) {
                    const mu = result.modelUsage[modelKey];
                    if (mu.contextWindow != null) {
                        state.contextWindow = mu.contextWindow;
                        this.capturedModelContextWindows.set(
                            modelKey,
                            mu.contextWindow,
                        );
                    }
                    state.systemToolsBaseline =
                        mu.cacheCreationInputTokens > 0
                            ? mu.cacheCreationInputTokens
                            : mu.cacheReadInputTokens;
                }
                // Populate capturedModelContextWindows for all models in usage
                for (const [key, mu] of Object.entries(result.modelUsage)) {
                    if (mu.contextWindow != null) {
                        this.capturedModelContextWindows.set(
                            key,
                            mu.contextWindow,
                        );
                    }
                }
            }
        }

        switch (sdkMessage.type) {
            case "assistant":
            case "user":
            case "result":
            case "stream_event":
                break;
            case "system":
                switch (sdkMessage.subtype) {
                    case "init":
                    case "compact_boundary":
                    case "status":
                    case "task_started":
                    case "task_progress":
                    case "task_notification":
                    case "hook_started":
                    case "hook_progress":
                    case "hook_response":
                    case "files_persisted":
                    case "local_command_output":
                    case "elicitation_complete":
                        break;
                    default: {
                        const unexpectedSystemMessage: never = sdkMessage;
                        throw new Error(`Unhandled Claude system subtype: ${JSON.stringify(unexpectedSystemMessage)}`);
                    }
                }
                break;
            case "tool_progress": {
                const toolProgressMessage = sdkMessage as SDKToolProgressMessage;
                void toolProgressMessage;
                break;
            }
            case "auth_status": {
                const authStatusMessage = sdkMessage as SDKAuthStatusMessage;
                void authStatusMessage;
                break;
            }
            case "tool_use_summary": {
                const toolSummaryMessage = sdkMessage as SDKToolUseSummaryMessage;
                void toolSummaryMessage;
                break;
            }
            case "rate_limit_event": {
                const rateLimitMessage = sdkMessage as SDKRateLimitEvent;
                void rateLimitMessage;
                break;
            }
            case "prompt_suggestion": {
                const promptSuggestionMessage = sdkMessage as SDKPromptSuggestionMessage;
                void promptSuggestionMessage;
                break;
            }
            default:
                assertNeverClaudeMessage(sdkMessage);
        }
    }

    /**
     * Emit an event to all registered handlers
     */
    private emitEvent<T extends EventType>(
        eventType: T,
        sessionId: string,
        data: Record<string, unknown>,
    ): void {
        const handlers = this.eventHandlers.get(eventType);

        if (eventType === "tool.start") {
            const active = this.pendingToolBySession.get(sessionId) ?? 0;
            this.pendingToolBySession.set(sessionId, active + 1);
        }

        if (eventType === "tool.complete") {
            const active = this.pendingToolBySession.get(sessionId) ?? 0;
            if (active === 0) {
                this.bumpStreamIntegrityCounter(
                    sessionId,
                    "unmatchedToolCompletes",
                );
            } else {
                this.pendingToolBySession.set(sessionId, active - 1);
            }
        }

        if (eventType === "subagent.start") {
            const active = this.pendingSubagentBySession.get(sessionId) ?? 0;
            this.pendingSubagentBySession.set(sessionId, active + 1);
        }

        if (eventType === "subagent.complete") {
            const active = this.pendingSubagentBySession.get(sessionId) ?? 0;
            if (active === 0) {
                this.bumpStreamIntegrityCounter(
                    sessionId,
                    "unmatchedSubagentCompletes",
                );
            } else {
                this.pendingSubagentBySession.set(sessionId, active - 1);
            }
        }

        if (!handlers) {
            return;
        }

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
                console.error(
                    `Error in event handler for ${eventType}:`,
                    error,
                );
            }
        }
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

        const resolveProviderBridgeNativeSessionId = (
            event: AgentEvent<EventType>,
        ): string | undefined => {
            const data = event.data;
            if (
                typeof data === "object" &&
                data !== null &&
                !Array.isArray(data)
            ) {
                const nativeSessionId = (data as Record<string, unknown>)
                    .nativeSessionId;
                if (typeof nativeSessionId === "string") {
                    return nativeSessionId;
                }
            }
            return event.sessionId;
        };

        this.on("tool.start", (event) => {
            this.emitProviderEvent("tool.start", event.sessionId, {
                toolName: String((event.data as { toolName?: unknown }).toolName ?? "unknown"),
                toolInput: ((event.data as { toolInput?: Record<string, unknown> }).toolInput ?? {}) as Record<string, unknown>,
                toolUseId: (event.data as { toolUseID?: string; toolUseId?: string }).toolUseID
                    ?? (event.data as { toolUseID?: string; toolUseId?: string }).toolUseId,
                parentToolCallId: (event.data as { parentToolUseId?: string }).parentToolUseId,
                parentAgentId: (event.data as { parentAgentId?: string }).parentAgentId,
            }, {
                native: event,
                nativeSessionId: resolveProviderBridgeNativeSessionId(event),
            });
        });

        this.on("tool.complete", (event) => {
            this.emitProviderEvent("tool.complete", event.sessionId, {
                toolName: String((event.data as { toolName?: unknown }).toolName ?? "unknown"),
                toolInput: (event.data as { toolInput?: Record<string, unknown> }).toolInput,
                toolResult: (event.data as { toolResult?: unknown }).toolResult,
                success: Boolean((event.data as { success?: unknown }).success),
                error: (event.data as { error?: string }).error,
                toolUseId: (event.data as { toolUseID?: string; toolUseId?: string }).toolUseID
                    ?? (event.data as { toolUseID?: string; toolUseId?: string }).toolUseId,
                parentToolCallId: (event.data as { parentToolUseId?: string }).parentToolUseId,
                parentAgentId: (event.data as { parentAgentId?: string }).parentAgentId,
            }, {
                native: event,
                nativeSessionId: resolveProviderBridgeNativeSessionId(event),
            });
        });

        this.on("subagent.start", (event) => {
            this.emitProviderEvent("subagent.start", event.sessionId, {
                subagentId: String((event.data as { subagentId?: unknown }).subagentId ?? ""),
                subagentType: (event.data as { subagentType?: string }).subagentType,
                task: (event.data as { task?: string }).task,
                toolUseId: (event.data as { toolUseID?: string; toolUseId?: string }).toolUseID
                    ?? (event.data as { toolUseID?: string; toolUseId?: string }).toolUseId,
                parentToolCallId: (event.data as { parentToolUseId?: string }).parentToolUseId,
                subagentSessionId: (event.data as { subagentSessionId?: string }).subagentSessionId,
            }, {
                native: event,
                nativeSessionId: resolveProviderBridgeNativeSessionId(event),
            });
        });

        this.on("subagent.update", (event) => {
            this.emitProviderEvent("subagent.update", event.sessionId, {
                subagentId: String((event.data as { subagentId?: unknown }).subagentId ?? ""),
                currentTool: (event.data as { currentTool?: string }).currentTool,
                toolUses: (event.data as { toolUses?: number }).toolUses,
            }, {
                native: event,
                nativeSessionId: resolveProviderBridgeNativeSessionId(event),
            });
        });

        this.on("subagent.complete", (event) => {
            this.emitProviderEvent("subagent.complete", event.sessionId, {
                subagentId: String((event.data as { subagentId?: unknown }).subagentId ?? ""),
                success: Boolean((event.data as { success?: unknown }).success),
                result: (event.data as { result?: unknown }).result,
            }, {
                native: event,
                nativeSessionId: resolveProviderBridgeNativeSessionId(event),
            });
        });

        this.on("permission.requested", (event) => {
            this.emitProviderEvent("permission.requested", event.sessionId, event.data as ProviderStreamEventDataMap["permission.requested"], {
                native: event,
                nativeSessionId: event.sessionId,
            });
        });

        this.on("skill.invoked", (event) => {
            this.emitProviderEvent("skill.invoked", event.sessionId, {
                skillName: String((event.data as { skillName?: unknown }).skillName ?? ""),
                skillPath: (event.data as { skillPath?: string }).skillPath,
            }, {
                native: event,
                nativeSessionId: event.sessionId,
            });
        });

        this.on("session.error", (event) => {
            this.emitProviderEvent("session.error", event.sessionId, {
                error: typeof (event.data as { error?: unknown }).error === "string"
                    ? (event.data as { error: string }).error
                    : String((event.data as { error?: unknown }).error ?? "Unknown error"),
                code: (event.data as { code?: string }).code,
            }, {
                native: event,
                nativeSessionId: event.sessionId,
            });
        });

        this.on("session.idle", (event) => {
            this.emitProviderEvent("session.idle", event.sessionId, {
                reason: (event.data as { reason?: string }).reason,
            }, {
                native: event,
                nativeSessionId: event.sessionId,
            });
        });

        this.on("session.compaction", (event) => {
            this.emitProviderEvent("session.compaction", event.sessionId, {
                phase: (event.data as { phase?: "start" | "complete" }).phase ?? "complete",
                success: (event.data as { success?: boolean }).success,
                error: (event.data as { error?: string }).error,
            }, {
                native: event,
                nativeSessionId: event.sessionId,
            });
        });

        this.on("usage", (event) => {
            this.emitProviderEvent("usage", event.sessionId, {
                inputTokens: Number((event.data as { inputTokens?: unknown }).inputTokens ?? 0),
                outputTokens: Number((event.data as { outputTokens?: unknown }).outputTokens ?? 0),
                model: (event.data as { model?: string }).model,
                cacheReadTokens: (event.data as { cacheReadTokens?: number }).cacheReadTokens,
                cacheWriteTokens: (event.data as { cacheWriteTokens?: number }).cacheWriteTokens,
                costUsd: (event.data as { costUsd?: number }).costUsd,
            }, {
                native: event,
                nativeSessionId: event.sessionId,
            });
        });
    }

    private emitProviderEvent<T extends ProviderStreamEventType>(
        eventType: T,
        sessionId: string,
        data: ProviderStreamEventDataMap[T],
        options?: {
            native?: ClaudeNativeEvent;
            nativeEventId?: string;
            nativeSessionId?: string;
            timestamp?: number;
        },
    ): void {
        if (this.providerEventHandlers.size === 0) {
            return;
        }

        const event: ClaudeProviderEvent = {
            provider: "claude",
            type: eventType,
            sessionId,
            timestamp: options?.timestamp ?? Date.now(),
            nativeType: options?.native?.type ?? eventType,
            native: options?.native ?? createSyntheticProviderNativeEvent(eventType, data),
            ...(options?.nativeEventId ? { nativeEventId: options.nativeEventId } : {}),
            ...(options?.nativeSessionId ? { nativeSessionId: options.nativeSessionId } : {}),
            ...(getClaudeNativeSubtype(options?.native)
                ? { nativeSubtype: getClaudeNativeSubtype(options?.native) }
                : {}),
            ...(getClaudeNativeMeta(options?.native)
                ? { nativeMeta: getClaudeNativeMeta(options?.native) }
                : {}),
            data,
        } as ClaudeProviderEvent;

        for (const handler of this.providerEventHandlers) {
            try {
                handler(event);
            } catch (error) {
                console.error(
                    `Error in provider event handler for ${eventType}:`,
                    error,
                );
            }
        }
    }

    /**
     * Normalize hook-reported session IDs back to Atomic's wrapped session ID.
     *
     * Claude hook callbacks report the SDK-native `session_id`, while the UI
     * ownership filter tracks wrapped IDs returned by createSession().
     * Without this mapping, tool/subagent hook events can be dropped.
     */
    private resolveHookSessionId(sdkSessionId: string): string {
        // Already using wrapped ID
        if (this.sessions.has(sdkSessionId)) {
            return sdkSessionId;
        }

        // Known SDK session ID for an existing wrapped session
        for (const [wrappedSessionId, state] of this.sessions.entries()) {
            if (state.sdkSessionId === sdkSessionId) {
                return wrappedSessionId;
            }
        }

        // Deterministic FIFO binding for newly-created wrapped sessions that
        // haven't yet seen their first assistant/result message with sdkSessionId.
        // This is critical when multiple sessions are created concurrently.
        for (let i = 0; i < this.pendingHookSessionBindings.length; i++) {
            const candidateWrappedId = this.pendingHookSessionBindings[i];
            if (!candidateWrappedId) {
                continue;
            }
            const candidateState = this.sessions.get(candidateWrappedId);
            if (!candidateState || candidateState.isClosed) {
                continue;
            }
            // Ignore sessions that have not started a query yet (e.g. freshly
            // created main session before first prompt). Their SDK session ID
            // is not knowable from hooks yet and should not absorb unrelated
            // sub-agent hook traffic.
            if (candidateState.query === null) {
                continue;
            }
            if (
                candidateState.sdkSessionId &&
                candidateState.sdkSessionId !== sdkSessionId
            ) {
                continue;
            }
            this.pendingHookSessionBindings.splice(i, 1);
            candidateState.sdkSessionId = sdkSessionId;
            return candidateWrappedId;
        }

        // First hook can arrive before assistant/result messages populate sdkSessionId.
        // If exactly one open session exists, bind this SDK session ID to it.
        const openSessions = Array.from(this.sessions.entries()).filter(
            ([, state]) => !state.isClosed,
        );
        if (openSessions.length === 1) {
            const [wrappedSessionId, state] = openSessions[0]!;
            if (!state.sdkSessionId) {
                state.sdkSessionId = sdkSessionId;
            }
            return wrappedSessionId;
        }

        // If there is exactly one unbound open session, bind it.
        const unboundOpenSessions = openSessions.filter(
            ([, state]) => !state.sdkSessionId,
        );
        if (unboundOpenSessions.length === 1) {
            const [wrappedSessionId, state] = unboundOpenSessions[0]!;
            state.sdkSessionId = sdkSessionId;
            return wrappedSessionId;
        }

        // Fall back to the SDK ID if we cannot disambiguate.
        return sdkSessionId;
    }

    /**
     * Resolve tool use correlation ID from either hook callback argument or hook payload.
     */
    private resolveHookToolUseId(
        toolUseID: string | undefined,
        hookInput: Record<string, unknown>,
    ): string | undefined {
        if (typeof toolUseID === "string" && toolUseID.trim().length > 0) {
            return toolUseID;
        }

        const candidates = [
            hookInput.tool_use_id,
            hookInput.toolUseId,
            hookInput.toolUseID,
            hookInput.tool_call_id,
            hookInput.toolCallId,
        ];
        for (const candidate of candidates) {
            if (typeof candidate === "string" && candidate.trim().length > 0) {
                return candidate;
            }
        }
        return undefined;
    }

    /**
     * Resolve parent tool correlation ID from hook payload.
     *
     * Claude hook payloads can provide this as either "use" or "call" IDs
     * depending on runtime/event shape.
     */
    private resolveHookParentToolUseId(
        hookInput: Record<string, unknown>,
    ): string | undefined {
        const candidates = [
            hookInput.parent_tool_use_id,
            hookInput.parentToolUseId,
            hookInput.parentToolUseID,
            hookInput.parent_tool_call_id,
            hookInput.parentToolCallId,
            hookInput.parentToolCallID,
        ];
        for (const candidate of candidates) {
            if (typeof candidate === "string" && candidate.trim().length > 0) {
                return candidate;
            }
        }
        return undefined;
    }

    /**
     * Fallback session routing for hooks that omit session_id.
     */
    private resolveFallbackHookSessionId(toolUseId?: string): string {
        if (toolUseId) {
            const mappedSessionId = this.toolUseIdToSessionId.get(toolUseId);
            if (mappedSessionId) {
                const mappedState = this.sessions.get(mappedSessionId);
                if (mappedState && !mappedState.isClosed) {
                    return mappedSessionId;
                }
                this.toolUseIdToSessionId.delete(toolUseId);
            }
        }

        const openActiveSessions = Array.from(this.sessions.entries()).filter(
            ([, state]) => !state.isClosed && state.query !== null,
        );
        if (openActiveSessions.length === 1) {
            return openActiveSessions[0]![0];
        }
        return "";
    }

    /**
     * Get the SDK session ID for a given wrapped session ID.
     * Returns null if the session doesn't exist or hasn't been bound yet.
     */
    private getMainSdkSessionId(wrappedSessionId: string): string | null {
        const state = this.sessions.get(wrappedSessionId);
        return state?.sdkSessionId ?? null;
    }

    /**
     * Detect if a hook event originates from a sub-agent based on its SDK session ID.
     * If the hook's session_id differs from the main session's sdkSessionId,
     * attribute the event to a sub-agent and return the agent ID.
     */
    private resolveSubagentParentId(
        hookSdkSessionId: string,
        wrappedSessionId: string,
    ): string | undefined {
        if (!hookSdkSessionId) return undefined;

        const mainSdkSessionId = this.getMainSdkSessionId(wrappedSessionId);
        if (!mainSdkSessionId || hookSdkSessionId === mainSdkSessionId) {
            return undefined;
        }

        // Check if we've already mapped this SDK session ID to a sub-agent
        const knownAgentId =
            this.subagentSdkSessionIdToAgentId.get(hookSdkSessionId);
        if (knownAgentId) return knownAgentId;

        // Bind to the first unmapped sub-agent
        if (this.unmappedSubagentIds.length > 0) {
            const agentId = this.unmappedSubagentIds.shift()!;
            this.subagentSdkSessionIdToAgentId.set(hookSdkSessionId, agentId);
            return agentId;
        }

        return undefined;
    }

    /**
     * Create a new agent session
     */
    async createSession(config: SessionConfig = {}): Promise<Session> {
        if (!this.isRunning) {
            throw new Error("Client not started. Call start() first.");
        }

        const sessionId =
            config.sessionId ??
            `claude-${Date.now()}-${Math.random().toString(36).slice(2)}`;

        // Don't create an initial query here — send()/stream() each create
        // their own query with the actual user message.  Previously an empty-prompt
        // query was spawned here, which leaked a Claude Code subprocess that was
        // never consumed.

        // Load custom agents from project and global directories
        const projectRoot = process.cwd();
        const loadedAgents = await this.loadConfiguredAgents(projectRoot);

        const agentsMap: Record<
            string,
            {
                description: string;
                prompt: string;
                tools?: string[];
                model?: "sonnet" | "opus" | "haiku" | "inherit";
            }
        > = { ...config.agents };

        for (const agent of loadedAgents) {
            if (!agentsMap[agent.name]) {
                agentsMap[agent.name] = {
                    description: agent.description,
                    prompt: agent.systemPrompt,
                    tools: agent.tools,
                    // Note: model is optional, defaulting to SDK's behavior
                };
            }
        }

        if (Object.keys(agentsMap).length > 0) {
            config.agents = agentsMap;
        }

        // Emit session start event
        this.emitEvent("session.start", sessionId, { config });
        this.emitProviderEvent("session.start", sessionId, { config }, {
            nativeSessionId: sessionId,
        });
        this.emitRuntimeSelection(sessionId, "create");
        this.pendingHookSessionBindings.push(sessionId);
        return this.wrapQuery(null, sessionId, config);
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
                existingState.config,
                {
                    sdkSessionId: existingState.sdkSessionId,
                    inputTokens: existingState.inputTokens,
                    outputTokens: existingState.outputTokens,
                    contextWindow: existingState.contextWindow,
                    systemToolsBaseline: existingState.systemToolsBaseline,
                },
            );
        }

        this.emitRuntimeSelection(sessionId, "resume");

        // Try to resume from SDK — use buildSdkOptions() so that
        // permissionMode, allowedTools, canUseTool, and settingSources are
        // all present (a bare Options object would fall back to "default"
        // mode which causes sub-agent tool denials).
        try {
            const options = this.buildSdkOptions({ sessionId }, sessionId);
            options.resume = sessionId;

            const queryInstance = query({ prompt: "", options });

            return this.wrapQuery(
                queryInstance,
                sessionId,
                {},
                {
                    sdkSessionId: sessionId,
                },
            );
        } catch (error) {
            console.warn(`Failed to resume session ${sessionId}:`, error);
            return null;
        }
    }

    /**
     * Register an event handler
     */
    on<T extends EventType>(
        eventType: T,
        handler: EventHandler<T>,
    ): () => void {
        let handlers = this.eventHandlers.get(eventType);
        if (!handlers) {
            handlers = new Set();
            this.eventHandlers.set(eventType, handlers);
        }

        handlers.add(handler as EventHandler<EventType>);

        // Track all hook callbacks added by this on() call so they can be
        // removed on unsubscribe (prevents hook accumulation across session resets)
        const addedHooks: Array<{ event: string; callback: HookCallback }> = [];

        // Also register as native hook if applicable
        const hookEvent = mapEventTypeToHookEvent(eventType);
        if (hookEvent) {
            // Factory: creates a hook callback that maps SDK HookInput to a unified
            // AgentEvent and forwards it to the registered handler.
            // `targetHookEvent` controls the `success` flag — "PostToolUseFailure"
            // sets success=false so the UI knows the tool errored.
            const createHookCallback = (
                targetHookEvent: string,
            ): HookCallback => {
                return async (
                    input: HookInput,
                    toolUseID: string | undefined,
                    _options: { signal: AbortSignal },
                ): Promise<HookJSONOutput> => {
                    // Map hook input to the expected event data format
                    // The HookInput has fields like tool_name, tool_input, tool_result
                    // but the UI expects toolName, toolInput, toolResult
                    const hookInput = input as Record<string, unknown>;
                    const resolvedToolUseId = this.resolveHookToolUseId(
                        toolUseID,
                        hookInput,
                    );
                    const resolvedParentToolUseId =
                        this.resolveHookParentToolUseId(hookInput);
                    const eventData: Record<string, unknown> = {
                        hookInput: input,
                        toolUseID: resolvedToolUseId,
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
                    eventData.success =
                        targetHookEvent !== "PostToolUseFailure";
                    if (hookInput.error) {
                        eventData.error = hookInput.error;
                    }

                    // Map subagent-specific fields for subagent.start and subagent.complete events
                    // SubagentStartHookInput: { agent_id, agent_type }
                    // SubagentStopHookInput: { agent_id, agent_transcript_path }
                    if (hookInput.agent_id) {
                        eventData.subagentId = hookInput.agent_id;
                    }
                    if (hookInput.agent_type) {
                        eventData.subagentType = hookInput.agent_type;
                    }
                    if (resolvedParentToolUseId) {
                        eventData.parentToolUseId =
                            resolvedParentToolUseId;
                    }
                    const taskFromHook =
                        typeof hookInput.description === "string"
                            ? hookInput.description.trim()
                            : typeof hookInput.prompt === "string"
                              ? hookInput.prompt.trim()
                              : typeof hookInput.task === "string"
                                ? hookInput.task.trim()
                                : undefined;
                    if (targetHookEvent === "SubagentStart") {
                        const agentTypeFromHook =
                            typeof hookInput.agent_type === "string"
                                ? hookInput.agent_type.trim()
                                : undefined;
                        const taskFromStartedMessage = resolvedToolUseId
                            ? this.taskDescriptionByToolUseId.get(
                                  resolvedToolUseId,
                              )
                            : undefined;
                        // Also check parent_tool_use_id for task description —
                        // the SubagentStart hook's toolUseID may differ from
                        // the Agent tool's tool_use_id used in task_started messages.
                        const taskFromParentToolUse =
                            resolvedParentToolUseId
                            ? this.taskDescriptionByToolUseId.get(
                                  resolvedParentToolUseId,
                              )
                            : undefined;
                        const taskFromRecordedMetadata =
                            taskFromStartedMessage ?? taskFromParentToolUse;
                        const resolvedTask =
                            taskFromRecordedMetadata &&
                            shouldPreferRecordedSubagentTask({
                                taskFromHook,
                                agentType: agentTypeFromHook,
                            })
                                ? taskFromRecordedMetadata
                                : taskFromHook && taskFromHook.length > 0
                                  ? taskFromHook
                                  : taskFromRecordedMetadata;
                        if (resolvedTask) {
                            eventData.task = resolvedTask;
                        }
                    }
                    if (targetHookEvent === "SubagentStop") {
                        // SubagentStop implies successful completion
                        eventData.success = true;
                        // Fill missing agent_id from previously registered tool_use_id.
                        const mappedAgentId = resolvedToolUseId
                            ? this.toolUseIdToAgentId.get(resolvedToolUseId)
                            : undefined;
                        if (!eventData.subagentId && mappedAgentId) {
                            eventData.subagentId = mappedAgentId;
                        }
                    }

                    // Store toolUseID → agent_id mapping for task_progress correlation.
                    // Some SubagentStart hook payloads do not include toolUse IDs.
                    // Still track the agent as "unmapped" so we can later bind a
                    // child SDK session_id from tool hooks via resolveSubagentParentId().
                    if (
                        targetHookEvent === "SubagentStart" &&
                        hookInput.agent_id
                    ) {
                        const startedAgentId = hookInput.agent_id as string;
                        if (resolvedToolUseId) {
                            this.toolUseIdToAgentId.set(
                                resolvedToolUseId,
                                startedAgentId,
                            );
                            // Also register under parent_tool_use_id so task_progress
                            // messages that carry the Agent tool's tool_use_id (which
                            // may differ from the SubagentStart hook's toolUseID) can
                            // still be correlated to the sub-agent.
                            if (
                                resolvedParentToolUseId &&
                                resolvedParentToolUseId !== resolvedToolUseId
                            ) {
                                this.toolUseIdToAgentId.set(
                                    resolvedParentToolUseId,
                                    startedAgentId,
                                );
                            }
                        }

                        const isAlreadySessionMapped = Array.from(
                            this.subagentSdkSessionIdToAgentId.values(),
                        ).includes(startedAgentId);
                        if (
                            !isAlreadySessionMapped &&
                            !this.unmappedSubagentIds.includes(startedAgentId)
                        ) {
                            this.unmappedSubagentIds.push(startedAgentId);
                        }
                    }

                    const hookSessionId =
                        typeof input.session_id === "string"
                            ? input.session_id
                            : "";
                    const sessionId = hookSessionId
                        ? this.resolveHookSessionId(hookSessionId)
                        : this.resolveFallbackHookSessionId(resolvedToolUseId);
                    if (hookSessionId) {
                        eventData.nativeSessionId = hookSessionId;
                    }

                    if (eventType === "skill.invoked") {
                        if (!isSkillToolName(hookInput.tool_name)) {
                            return { continue: true };
                        }

                        const skillInvocation =
                            extractSkillInvocationFromToolInput(
                                hookInput.tool_input,
                            );
                        if (!skillInvocation) {
                            return { continue: true };
                        }

                        const skillEvent: AgentEvent<T> = {
                            type: eventType,
                            sessionId,
                            timestamp: new Date().toISOString(),
                            data: {
                                ...skillInvocation,
                                ...(resolvedParentToolUseId
                                    ? {
                                          parentToolCallId:
                                              resolvedParentToolUseId,
                                      }
                                    : {}),
                            } as AgentEvent<T>["data"],
                        };

                        try {
                            await handler(skillEvent);
                        } catch (error) {
                            console.error(
                                `Error in hook handler for ${eventType}:`,
                                error,
                            );
                        }

                        return { continue: true };
                    }

                    if (
                        targetHookEvent === "SubagentStart" &&
                        resolvedToolUseId &&
                        sessionId
                    ) {
                        this.toolUseIdToSessionId.set(
                            resolvedToolUseId,
                            sessionId,
                        );
                    }
                    if (targetHookEvent === "SubagentStop") {
                        if (resolvedToolUseId) {
                            this.toolUseIdToAgentId.delete(resolvedToolUseId);
                            this.toolUseIdToSessionId.delete(resolvedToolUseId);
                            this.taskDescriptionByToolUseId.delete(
                                resolvedToolUseId,
                            );
                            // Also clean up parent_tool_use_id mapping if it exists
                            if (resolvedParentToolUseId) {
                                this.toolUseIdToAgentId.delete(
                                    resolvedParentToolUseId,
                                );
                                this.toolUseIdToSessionId.delete(
                                    resolvedParentToolUseId,
                                );
                                this.taskDescriptionByToolUseId.delete(
                                    resolvedParentToolUseId,
                                );
                            }
                        }

                        // Clean up sub-agent session tracking even when toolUse IDs
                        // are missing from the stop hook payload.
                        const stoppedAgentId = (eventData.subagentId ??
                            hookInput.agent_id) as string | undefined;
                        if (stoppedAgentId) {
                            const idx =
                                this.unmappedSubagentIds.indexOf(
                                    stoppedAgentId,
                                );
                            if (idx >= 0)
                                this.unmappedSubagentIds.splice(idx, 1);
                            for (const [sid, aid] of this
                                .subagentSdkSessionIdToAgentId) {
                                if (aid === stoppedAgentId) {
                                    this.subagentSdkSessionIdToAgentId.delete(
                                        sid,
                                    );
                                    break;
                                }
                            }
                        }
                    }

                    // Detect if this tool hook originates from a sub-agent.
                    // Sub-agent tool hooks carry a different SDK session_id than
                    // the main session. When detected, add parentAgentId so the
                    // adapter can route events to the agent tree.
                    const mappedParentAgentId =
                        (resolvedParentToolUseId
                            ? this.toolUseIdToAgentId.get(
                                  resolvedParentToolUseId,
                              )
                            : undefined) ??
                        (resolvedToolUseId
                            ? this.toolUseIdToAgentId.get(resolvedToolUseId)
                            : undefined);
                    if (mappedParentAgentId) {
                        eventData.parentAgentId = mappedParentAgentId;
                    }
                    if (
                        !eventData.parentAgentId &&
                        targetHookEvent !== "SubagentStart" &&
                        targetHookEvent !== "SubagentStop" &&
                        hookSessionId &&
                        sessionId
                    ) {
                        const parentAgentId = this.resolveSubagentParentId(
                            hookSessionId,
                            sessionId,
                        );
                        if (parentAgentId) {
                            eventData.parentAgentId = parentAgentId;
                        }
                    }

                    const event: AgentEvent<T> = {
                        type: eventType,
                        sessionId,
                        timestamp: new Date().toISOString(),
                        data: eventData as AgentEvent<T>["data"],
                    };

                    try {
                        await handler(event);
                    } catch (error) {
                        console.error(
                            `Error in hook handler for ${eventType}:`,
                            error,
                        );
                    }

                    return { continue: true };
                };
            };

            const hookCallback = createHookCallback(hookEvent);
            if (!this.registeredHooks[hookEvent]) {
                this.registeredHooks[hookEvent] = [];
            }
            this.registeredHooks[hookEvent]!.push(hookCallback);
            addedHooks.push({ event: hookEvent, callback: hookCallback });

            // For tool.complete events, also register a PostToolUseFailure hook
            // so that failed tools are properly reported as completed with an error
            // instead of remaining stuck in "running" status forever.
            if (hookEvent === "PostToolUse") {
                const failureCallback =
                    createHookCallback("PostToolUseFailure");
                if (!this.registeredHooks["PostToolUseFailure"]) {
                    this.registeredHooks["PostToolUseFailure"] = [];
                }
                this.registeredHooks["PostToolUseFailure"]!.push(
                    failureCallback,
                );
                addedHooks.push({
                    event: "PostToolUseFailure",
                    callback: failureCallback,
                });
            }
        }

        return () => {
            handlers?.delete(handler as EventHandler<EventType>);
            // Remove all hook callbacks added by this on() call to prevent
            // accumulation across session resets (e.g., after /clear)
            for (const { event, callback } of addedHooks) {
                const hooks = this.registeredHooks[event];
                if (hooks) {
                    const idx = hooks.indexOf(callback);
                    if (idx !== -1) {
                        hooks.splice(idx, 1);
                    }
                }
            }
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
                    const context: ToolContext = {
                        sessionID: this.sessions.keys().next().value ?? "",
                        messageID: "",
                        agent: "claude",
                        directory: process.cwd(),
                        abort: new AbortController().signal,
                    };
                    const result = await tool.handler(
                        args as Record<string, unknown>,
                        context,
                    );
                    return {
                        content: [
                            {
                                type: "text" as const,
                                text:
                                    typeof result === "string"
                                        ? result
                                        : JSON.stringify(result),
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
     * List supported models via the Claude SDK's supportedModels() API.
     * Uses an existing active session's query if available, otherwise creates a temporary one.
     */
    async listSupportedModels(): Promise<
        Array<{ value: string; displayName: string; description: string }>
    > {
        if (!this.isRunning) {
            throw new Error("Client not started. Call start() first.");
        }

        // Reuse the active session query once, then force a fresh lookup for
        // repeated /model runs so newly added models appear without restarting.
        for (const [sessionId, state] of this.sessions.entries()) {
            if (!state.isClosed && state.query) {
                const readCount =
                    this.modelListReadsBySession.get(sessionId) ?? 0;
                this.modelListReadsBySession.set(sessionId, readCount + 1);

                if (readCount === 0) {
                    return await state.query.supportedModels();
                }

                return await this.fetchFreshSupportedModels();
            }
        }

        return await this.fetchFreshSupportedModels();
    }

    private async fetchFreshSupportedModels(): Promise<
        Array<{ value: string; displayName: string; description: string }>
    > {
        // No active session — create a temporary query for model listing.
        // Explicitly set Claude executable path so packaged binaries don't fall
        // back to Bun virtual FS resolution (/$bunfs/.../cli.js).
        const tempQuery = query({
            prompt: "",
            options: {
                maxTurns: 0,
                pathToClaudeCodeExecutable: getBundledClaudeCodePath(),
            },
        });
        try {
            return await tempQuery.supportedModels();
        } finally {
            tempQuery.close();
        }
    }

    /**
     * Switch model for the active Claude session while preserving history.
     *
     * This client uses turn-scoped queries (send/stream each create a new Query),
     * so persisting the model on session config is sufficient for future turns.
     * Calling query.setModel() on the previous Query instance is unsafe because
     * its underlying transport may already be closed between turns.
     */
    async setActiveSessionModel(model: string): Promise<void> {
        const targetModel = stripProviderPrefix(model).trim();
        if (!targetModel) {
            throw new Error("Model ID cannot be empty.");
        }
        if (targetModel.toLowerCase() === "default") {
            throw new Error(
                "Model 'default' is not supported for Claude. Use one of: opus, sonnet, haiku.",
            );
        }

        // Use the most recently created active session as the primary chat session.
        const activeSessions = Array.from(this.sessions.values()).filter(
            (state) => !state.isClosed,
        );
        const activeSession = activeSessions[activeSessions.length - 1];

        if (!activeSession) {
            return;
        }

        activeSession.config.model = targetModel;
    }

    /**
     * Start the client
     */
    async start(): Promise<void> {
        if (this.isRunning) {
            return; // Already running
        }
        this.isRunning = true;
        // Model detection, contextWindow, and systemToolsBaseline are captured
        // from the first real query's system init and result messages via
        // processMessage(). No startup probe needed — getModelDisplayInfo()
        // falls back to "Claude" until the first query populates detectedModel.
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
                state.query?.close();
            }
        }

        this.sessions.clear();
        this.pendingToolBySession.clear();
        this.pendingSubagentBySession.clear();
        this.modelListReadsBySession.clear();
        this.eventHandlers.clear();
    }

    /**
     * Get model display information for UI rendering.
     * Uses the model detected from the SDK system init message as the
     * authoritative source. Falls back to modelHint (raw, unformatted).
     * @param modelHint - Optional model ID from saved preferences
     */
    async getModelDisplayInfo(
        modelHint?: string,
    ): Promise<{ model: string; tier: string; contextWindow?: number }> {
        // Prefer explicit hint (user's /model choice), then detected model from SDK probe.
        // When both are absent, fall back directly to "opus" (the canonical default).
        const raw =
            (modelHint ? stripProviderPrefix(modelHint) : null) ??
            this.detectedModel ??
            "opus";
        const modelKey = raw;
        const displayModel = normalizeClaudeModelLabel(modelKey);
        const contextWindow =
            this.capturedModelContextWindows.get(modelKey) ??
            this.capturedModelContextWindows.get(displayModel) ??
            this.probeContextWindow ??
            undefined;

        return {
            model: displayModel,
            tier: "Claude Code",
            contextWindow,
        };
    }

    /**
     * Get the system tools token baseline captured during start() probe.
     */
    getSystemToolsTokens(): number | null {
        return this.probeSystemToolsBaseline;
    }
}

/**
 * Factory function to create a ClaudeAgentClient instance
 */
export function createClaudeAgentClient(): ClaudeAgentClient {
    return new ClaudeAgentClient();
}

/**
 * Dependencies used to resolve the Claude Code executable path.
 * Exported for deterministic unit testing.
 */
export interface ClaudeExecutablePathResolutionOptions {
    platform: NodeJS.Platform;
    homeDir: string;
    claudeFromPath: string | null;
    sdkCliPath: string | null;
    envOverridePath: string | null;
    pathExists: (path: string) => boolean;
    resolveRealPath: (path: string) => string;
}

interface ClaudeExecutableCandidate {
    invokePath: string;
    canonicalPath: string;
}

function isLikelyNodeModulesClaudePath(path: string): boolean {
    const normalized = path.replaceAll("\\", "/").toLowerCase();
    return (
        normalized.includes("/node_modules/") ||
        normalized.includes("/.bun/install/") ||
        normalized.endsWith("/cli.js")
    );
}

function resolveClaudeExecutableCandidate(
    candidate: string | null,
    options: Pick<
        ClaudeExecutablePathResolutionOptions,
        "pathExists" | "resolveRealPath"
    >,
): ClaudeExecutableCandidate | null {
    if (!candidate) {
        return null;
    }
    if (!options.pathExists(candidate)) {
        return null;
    }

    try {
        const canonicalPath = options.resolveRealPath(candidate);
        if (options.pathExists(canonicalPath)) {
            return {
                invokePath: candidate,
                canonicalPath,
            };
        }
    } catch {
        // Fall through to returning the original candidate.
    }

    return {
        invokePath: candidate,
        canonicalPath: candidate,
    };
}

/**
 * Resolve the best Claude Code executable path for the active runtime.
 */
export function resolveClaudeCodeExecutablePath(
    options: ClaudeExecutablePathResolutionOptions,
): string | null {
    const claudeFromPath = resolveClaudeExecutableCandidate(
        options.claudeFromPath,
        options,
    );
    const sdkCliPath = resolveClaudeExecutableCandidate(options.sdkCliPath, options);
    const envOverridePath = resolveClaudeExecutableCandidate(
        options.envOverridePath,
        options,
    );

    if (envOverridePath) {
        return envOverridePath.invokePath;
    }

    if (options.platform === "darwin") {
        // On macOS, prefer native installs first so Claude desktop/Homebrew auth
        // state is reused even when PATH points to a Bun/npm shim.
        const macNativeCandidates = [
            "/opt/homebrew/bin/claude",
            "/usr/local/bin/claude",
            "/Applications/Claude Code.app/Contents/MacOS/claude",
            join(options.homeDir, ".local", "bin", "claude"),
            join(options.homeDir, ".claude", "local", "claude"),
            join(options.homeDir, "bin", "claude"),
            "/Applications/Claude.app/Contents/MacOS/claude",
            join(options.homeDir, "Applications", "Claude.app", "Contents", "MacOS", "claude"),
            join(
                options.homeDir,
                "Applications",
                "Claude Code.app",
                "Contents",
                "MacOS",
                "claude",
            ),
        ];

        for (const candidate of macNativeCandidates) {
            const resolved = resolveClaudeExecutableCandidate(candidate, options);
            if (resolved && !isLikelyNodeModulesClaudePath(resolved.canonicalPath)) {
                return resolved.invokePath;
            }
        }

        if (
            claudeFromPath &&
            !isLikelyNodeModulesClaudePath(claudeFromPath.canonicalPath)
        ) {
            return claudeFromPath.invokePath;
        }

        if (sdkCliPath && !isLikelyNodeModulesClaudePath(sdkCliPath.canonicalPath)) {
            return sdkCliPath.invokePath;
        }

        return claudeFromPath?.invokePath ?? sdkCliPath?.invokePath ?? null;
    }

    return sdkCliPath?.invokePath ?? claudeFromPath?.invokePath ?? null;
}

/**
 * Get the path to the Claude Code CLI entry point.
 *
 * Supports all official installation methods:
 * - Native install (curl/bash on macOS/Linux/WSL, PowerShell/CMD on Windows)
 * - Homebrew (brew install --cask claude-code)
 * - WinGet (winget install Anthropic.ClaudeCode)
 * - npm package (@anthropic-ai/claude-agent-sdk, dev only)
 *
 * Resolution order:
 * 1. On macOS, prefer native install locations and non-node_modules binaries
 * 2. SDK bundled cli.js (import.meta.resolve)
 * 3. PATH fallback (including Bun/npm shims)
 */
export function getBundledClaudeCodePath(): string {
    const envOverridePath = process.env.ATOMIC_CLAUDE_CODE_EXECUTABLE?.trim() ||
        null;
    let sdkCliPath: string | null = null;
    try {
        const sdkUrl = import.meta.resolve("@anthropic-ai/claude-agent-sdk");
        const sdkPath = fileURLToPath(sdkUrl);
        const pkgDir = dirname(sdkPath);
        sdkCliPath = join(pkgDir, "cli.js");
    } catch {
        // Falls through.
    }

    const resolvedPath = resolveClaudeCodeExecutablePath({
        platform: process.platform,
        homeDir: homedir(),
        claudeFromPath: Bun.which("claude") ?? Bun.which("claude-code"),
        sdkCliPath,
        envOverridePath,
        pathExists: existsSync,
        resolveRealPath: realpathSync,
    });

    if (resolvedPath) {
        return resolvedPath;
    }

    throw new Error(
        "Cannot find Claude Code CLI.\n\n" +
            "Install Claude Code by visiting: https://code.claude.com/docs/en/setup\n\n" +
            "Or ensure 'claude' is available in your PATH.",
    );
}
