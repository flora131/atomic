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
    type SDKResultMessage,
    type SDKSystemMessage,
    type HookEvent,
    type HookCallback,
    type HookCallbackMatcher,
    type HookInput,
    type HookJSONOutput,
    type McpSdkServerConfigWithInstance,
    type McpServerStatus,
} from "@anthropic-ai/claude-agent-sdk";
import type {
    CodingAgentClient,
    Session,
    SessionConfig,
    AgentMessage,
    ContextUsage,
    McpAuthStatus,
    McpRuntimeSnapshot,
    EventType,
    EventHandler,
    AgentEvent,
    ToolDefinition,
    ToolContext,
    MessageContentType,
} from "../types.ts";
import { stripProviderPrefix } from "../types.ts";
import { initClaudeOptions } from "../init.ts";
import { loadCopilotAgents } from "../../config/copilot-manual.ts";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
        result: "session.idle",
        system: "session.start",
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
        "session.error": "Stop",
        "tool.start": "PreToolUse",
        "tool.complete": "PostToolUse",
        "subagent.start": "SubagentStart",
        "subagent.complete": "SubagentStop",
    };
    return mapping[eventType] ?? null;
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

    for (let blockIndex = 0; blockIndex < betaMessage.content.length; blockIndex++) {
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

function getClaudeContentBlockIndex(event: Record<string, unknown>): number | null {
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

function buildSubagentInvocationPrompt(agentName: string, task: string): string {
    return `Invoke the "${agentName}" sub-agent with the following task. Return ONLY the sub-agent's complete output with no additional commentary or explanation.

Task for ${agentName}:
${task}

Important: Do not add any text before or after the sub-agent's output. Pass through the complete response exactly as produced.`;
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
    private static readonly SUPPORTED_REASONING_EFFORTS = new Set([
        "low",
        "medium",
        "high",
        "max",
    ]);

    private eventHandlers: Map<EventType, Set<EventHandler<EventType>>> =
        new Map();
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
    ): Promise<Awaited<ReturnType<typeof loadCopilotAgents>>> {
        return loadCopilotAgents(projectRoot);
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

    private async handleAskUserQuestion(
        sessionId: string,
        toolInput: Record<string, unknown>,
    ): Promise<
        | {
              behavior: "allow";
              updatedInput: Record<string, unknown>;
          }
        | null
    > {
        const input = toolInput as AskUserQuestionInput;

        if (!input.questions || input.questions.length === 0) {
            return null;
        }

        const answers: Record<string, string> = {};

        for (const q of input.questions) {
            const responsePromise = new Promise<string | string[]>((resolve) => {
                this.emitEvent("permission.requested", sessionId, {
                    requestId: `ask_${Date.now()}`,
                    toolName: "AskUserQuestion",
                    toolInput: q,
                    question: q.question,
                    header: q.header,
                    options:
                        q.options?.map((opt) => ({
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
                });
            });

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
            const resolved = await this.handleAskUserQuestion(sessionId, toolInput);
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
            thinking:
                config.model == "opus"
                    ? { type: "adaptive" }
                    : {
                          type: "enabled",
                          budgetTokens: config.maxThinkingTokens ?? 16000,
                      },
            hooks: this.buildNativeHooks(),
            includePartialMessages: true,
            // Use Claude Code's built-in system prompt, appending custom instructions if provided
            systemPrompt: config.systemPrompt
                ? {
                      type: "preset",
                      preset: "claude_code",
                      append: config.systemPrompt,
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
            return this.resolveToolPermission(sessionId ?? "", toolName, toolInput);
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
        };

        this.sessions.set(sessionId, state);

        const session: Session = {
            id: sessionId,

            send: async (message: string): Promise<AgentMessage> => {
                if (state.isClosed) {
                    throw new Error("Session is closed");
                }
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

                for await (const sdkMessage of newQuery) {
                    this.processMessage(sdkMessage, sessionId, state);
                    if (sdkMessage.type === "result") {
                        sawTerminalEvent = true;
                    }

                    if (sdkMessage.type === "assistant") {
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
                                    sdkMessage.message.stop_reason ?? undefined,
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

            stream: (message: string, optionsArg?: { agent?: string }): AsyncIterable<AgentMessage> => {
                // Capture references for the async generator
                const buildOptions = () =>
                    this.buildSdkOptions(config, sessionId);
                const processMsg = (msg: SDKMessage) =>
                    this.processMessage(msg, sessionId, state);
                const emitRuntimeSelection = () =>
                    this.emitRuntimeSelection(sessionId, "stream");
                const bumpMissingTerminalEvents = () => {
                    return this.bumpStreamIntegrityCounter(
                        sessionId,
                        "missingTerminalEvents",
                    );
                };
                // Capture SDK session ID for resume
                const getSdkSessionId = () => state.sdkSessionId;
                const resolvePrompt = () => {
                    const requestedAgent = optionsArg?.agent?.trim();
                    if (!requestedAgent) {
                        return message;
                    }
                    return buildSubagentInvocationPrompt(requestedAgent, message);
                };
                const emitStreamingUsage = (outputTokens: number) => {
                    state.hasEmittedStreamingUsage = true;
                    this.emitEvent("usage", sessionId, {
                        inputTokens: 0,
                        outputTokens,
                        model: this.detectedModel,
                    });
                };

                return {
                    [Symbol.asyncIterator]: async function* () {
                        if (state.isClosed) {
                            throw new Error("Session is closed");
                        }
                        state.hasEmittedStreamingUsage = false;
                        emitRuntimeSelection();
                        const options = {
                            ...buildOptions(),
                            includePartialMessages: true,
                        };
                        const sdkSessionId = getSdkSessionId();
                        if (sdkSessionId) {
                            options.resume = sdkSessionId;
                        }

                        const streamSource = query({
                            prompt: resolvePrompt(),
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

                        for await (const sdkMessage of streamSource) {
                            processMsg(sdkMessage);
                            if (sdkMessage.type === "result") {
                                sawTerminalEvent = true;
                            }

                            if (sdkMessage.type === "stream_event") {
                                const event = sdkMessage.event;

                                // Track thinking block boundaries
                                if (event.type === "content_block_start") {
                                    const blockIndex = getClaudeContentBlockIndex(
                                        event as Record<string, unknown>,
                                    );
                                    const blockType = (
                                        event as Record<string, unknown>
                                    ).content_block
                                        ? (
                                              (event as Record<string, unknown>)
                                                  .content_block as Record<
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
                                                event as Record<string, unknown>,
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
                                                thinkingMs: thinkingDurationMs,
                                                outputTokens,
                                            },
                                        },
                                    };
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
                                        emitStreamingUsage(usage.output_tokens);
                                    }
                                }

                                if (event.type === "content_block_delta") {
                                    if (event.delta.type === "text_delta") {
                                        hasYieldedDeltas = true;
                                        yield {
                                            type: "text",
                                            content: event.delta.text,
                                            role: "assistant",
                                        };
                                    } else if (
                                        event.delta.type === "thinking_delta"
                                    ) {
                                        hasYieldedDeltas = true;
                                        const blockIndex =
                                            getClaudeContentBlockIndex(
                                                event as Record<string, unknown>,
                                            );
                                        const resolvedThinkingSourceKey: string | null =
                                            blockIndex !== null
                                                ? String(blockIndex)
                                                : activeThinkingSourceKey;
                                        if (resolvedThinkingSourceKey !== null) {
                                            activeThinkingSourceKey =
                                                resolvedThinkingSourceKey;
                                        }
                                        const currentThinkingMs =
                                            thinkingDurationMs +
                                            (thinkingStartMs !== null
                                                ? Date.now() - thinkingStartMs
                                                : 0);
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
                                }
                            } else if (sdkMessage.type === "assistant") {
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
                                                typeof content === "object" &&
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
                                                        ?.output_tokens ?? 0,
                                            },
                                            model: sdkMessage.message.model,
                                            stopReason:
                                                sdkMessage.message
                                                    .stop_reason ?? undefined,
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
                for await (const sdkMessage of newQuery) {
                    this.processMessage(sdkMessage, sessionId, state);
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
                // Close the active query to terminate in-flight SDK work
                // (including sub-agent invocations). The session remains
                // reusable for subsequent queries via resume.
                state.query?.close();
            },

            abortBackgroundAgents: async (): Promise<void> => {
                // Close the active query to terminate background agents.
                // The Claude SDK manages sub-agents internally within the
                // query; closing it terminates all in-flight work including
                // background sub-agent invocations.
                state.query?.close();
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
                    for (const [toolUseId, mappedSessionId] of this.toolUseIdToSessionId.entries()) {
                        if (mappedSessionId === sessionId) {
                            this.toolUseIdToSessionId.delete(toolUseId);
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

        // Handle task_progress messages from sub-agents (periodic progress updates)
        if (sdkMessage.type === "system" && sdkMessage.subtype === "task_progress") {
            const msg = sdkMessage as Record<string, unknown>;
            const toolUseId = msg.tool_use_id as string | undefined;
            const agentId = toolUseId ? this.toolUseIdToAgentId.get(toolUseId) : undefined;
            if (agentId) {
                const usage = msg.usage as { tool_uses?: number } | undefined;
                this.emitEvent("subagent.update", sessionId, {
                    subagentId: agentId,
                    currentTool: (msg.last_tool_name as string | undefined),
                    toolUses: usage?.tool_uses,
                });
            }
        }

        // Handle task_notification messages (sub-agent completion notification)
        if (sdkMessage.type === "system" && sdkMessage.subtype === "task_notification") {
            const msg = sdkMessage as Record<string, unknown>;
            const toolUseId = msg.tool_use_id as string | undefined;
            const agentId = toolUseId ? this.toolUseIdToAgentId.get(toolUseId) : undefined;
            if (agentId) {
                this.emitEvent("subagent.complete", sessionId, {
                    subagentId: agentId,
                    success: msg.status === "completed",
                    result: msg.summary as string | undefined,
                });
                if (toolUseId) {
                    this.toolUseIdToAgentId.delete(toolUseId);
                    this.toolUseIdToSessionId.delete(toolUseId);
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
        if (eventType) {
            this.emitEvent(eventType, sessionId, { sdkMessage });
        }

        // Handle specific message types
        if (sdkMessage.type === "result") {
            const result = sdkMessage as SDKResultMessage;
            if (result.subtype === "error_max_turns") {
                this.emitEvent("session.error", sessionId, {
                    error: "Maximum turns exceeded",
                    code: "MAX_TURNS",
                });
            } else if (result.subtype === "error_max_budget_usd") {
                this.emitEvent("session.error", sessionId, {
                    error: "Budget exceeded",
                    code: "MAX_BUDGET",
                });
            }

            // Emit authoritative cumulative usage from the result message.
            // The result carries the correct totals for all API calls in
            // this interaction (unlike assistant messages which have stale
            // initial values during streaming).
            if (result.usage) {
                state.inputTokens = result.usage.input_tokens;
                state.outputTokens = result.usage.output_tokens;
                if (!state.hasEmittedStreamingUsage) {
                    // Non-streaming path (send): emit full usage
                    this.emitEvent("usage", sessionId, {
                        inputTokens: result.usage.input_tokens ?? 0,
                        outputTokens: result.usage.output_tokens ?? 0,
                        model: this.detectedModel,
                    });
                } else {
                    // Streaming path: output tokens already accumulated from message_delta.
                    // Emit input tokens only (outputTokens: 0 adds nothing to accumulator).
                    this.emitEvent("usage", sessionId, {
                        inputTokens: result.usage.input_tokens ?? 0,
                        outputTokens: 0,
                        model: this.detectedModel,
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
            if (candidateState.sdkSessionId && candidateState.sdkSessionId !== sdkSessionId) {
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
        const unboundOpenSessions = openSessions.filter(([, state]) => !state.sdkSessionId);
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
        const knownAgentId = this.subagentSdkSessionIdToAgentId.get(hookSdkSessionId);
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
        
        const agentsMap: Record<string, { description: string; prompt: string; tools?: string[]; model?: "sonnet" | "opus" | "haiku" | "inherit" }> = { ...config.agents };
        
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

            return this.wrapQuery(queryInstance, sessionId, {}, {
                sdkSessionId: sessionId,
            });
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

                    // Store toolUseID → agent_id mapping for task_progress correlation
                    if (
                        targetHookEvent === "SubagentStart"
                        && resolvedToolUseId
                        && hookInput.agent_id
                    ) {
                        this.toolUseIdToAgentId.set(
                            resolvedToolUseId,
                            hookInput.agent_id as string,
                        );
                        // Track as unmapped until we discover its SDK session ID
                        this.unmappedSubagentIds.push(hookInput.agent_id as string);
                    }

                    const hookSessionId =
                        typeof input.session_id === "string"
                            ? input.session_id
                            : "";
                    const sessionId = hookSessionId
                        ? this.resolveHookSessionId(hookSessionId)
                        : this.resolveFallbackHookSessionId(resolvedToolUseId);

                    if (
                        targetHookEvent === "SubagentStart"
                        && resolvedToolUseId
                        && sessionId
                    ) {
                        this.toolUseIdToSessionId.set(resolvedToolUseId, sessionId);
                    }
                    if (targetHookEvent === "SubagentStop" && resolvedToolUseId) {
                        this.toolUseIdToAgentId.delete(resolvedToolUseId);
                        this.toolUseIdToSessionId.delete(resolvedToolUseId);
                        // Clean up sub-agent session tracking
                        const stoppedAgentId = (eventData.subagentId ?? hookInput.agent_id) as string | undefined;
                        if (stoppedAgentId) {
                            const idx = this.unmappedSubagentIds.indexOf(stoppedAgentId);
                            if (idx >= 0) this.unmappedSubagentIds.splice(idx, 1);
                            for (const [sid, aid] of this.subagentSdkSessionIdToAgentId) {
                                if (aid === stoppedAgentId) {
                                    this.subagentSdkSessionIdToAgentId.delete(sid);
                                    break;
                                }
                            }
                        }
                    }

                    // Detect if this tool hook originates from a sub-agent.
                    // Sub-agent tool hooks carry a different SDK session_id than
                    // the main session. When detected, add parentAgentId so the
                    // adapter can route events to the agent tree.
                    if (
                        targetHookEvent !== "SubagentStart"
                        && targetHookEvent !== "SubagentStop"
                        && hookSessionId
                        && sessionId
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

        // Reuse an existing active session's query if available
        for (const state of this.sessions.values()) {
            if (!state.isClosed && state.query) {
                return await state.query.supportedModels();
            }
        }

        // No active session — create a temporary query for model listing
        const tempQuery = query({ prompt: "", options: { maxTurns: 0 } });
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

        // Probe the SDK to detect the default model from the system init message
        // This makes a lightweight query that doesn't require actual user input
        try {
            const probeOptions: Options = {
                ...initClaudeOptions(),
                maxTurns: 0, // Don't allow any turns - just get init message
                // Required for CLAUDE.md/project-setting based sub-agent discovery.
                systemPrompt: { type: "preset", preset: "claude_code" },
                // Explicitly set the path to Claude Code executable
                pathToClaudeCodeExecutable: getBundledClaudeCodePath(),
            };
            const probeQuery = query({
                prompt: "",
                options: probeOptions,
            });

            // Read the first message (should be system init)
            for await (const msg of probeQuery) {
                if (msg.type === "system" && msg.subtype === "init") {
                    const systemMsg = msg as SDKSystemMessage;
                    if (systemMsg.model) {
                        this.detectedModel = systemMsg.model;
                    }
                }

                // Capture contextWindow and systemToolsBaseline from result
                if (msg.type === "result") {
                    const result = msg as SDKResultMessage;
                    if (result.modelUsage) {
                        const modelKey =
                            this.detectedModel ??
                            Object.keys(result.modelUsage)[0];
                        if (modelKey && result.modelUsage[modelKey]) {
                            const mu = result.modelUsage[modelKey];
                            if (mu.contextWindow != null) {
                                this.probeContextWindow = mu.contextWindow;
                                this.capturedModelContextWindows.set(
                                    modelKey,
                                    mu.contextWindow,
                                );
                            }
                            this.probeSystemToolsBaseline =
                                mu.cacheCreationInputTokens > 0
                                    ? mu.cacheCreationInputTokens
                                    : mu.cacheReadInputTokens;
                        }
                        for (const [key, mu] of Object.entries(
                            result.modelUsage,
                        )) {
                            if (mu.contextWindow != null) {
                                this.capturedModelContextWindows.set(
                                    key,
                                    mu.contextWindow,
                                );
                            }
                        }
                    }
                    break;
                }
            }
            probeQuery.close();
        } catch {
            // Probe failed - will fall back to "Claude" in getModelDisplayInfo
        }
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
        // Prefer explicit hint (user's /model choice), then detected model from SDK probe, then raw fallback
        const raw =
            (modelHint ? stripProviderPrefix(modelHint) : null) ??
            this.detectedModel;
        const modelKey = raw ?? "Claude";
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
 * Get the path to the Claude Code CLI entry point.
 *
 * Supports all official installation methods:
 * - Native install (curl/bash on macOS/Linux/WSL, PowerShell/CMD on Windows)
 * - Homebrew (brew install --cask claude-code)
 * - WinGet (winget install Anthropic.ClaudeCode)
 * - npm package (@anthropic-ai/claude-agent-sdk, dev only)
 *
 * Resolution order:
 * 1. import.meta.resolve (works in dev when @anthropic-ai/claude-agent-sdk is available)
 * 2. Find globally-installed claude CLI on $PATH
 */
export function getBundledClaudeCodePath(): string {
    // Strategy 1: import.meta.resolve (works in dev, fails in compiled binary)
    try {
        const sdkUrl = import.meta.resolve("@anthropic-ai/claude-agent-sdk");
        const sdkPath = fileURLToPath(sdkUrl);
        const pkgDir = dirname(sdkPath);
        const cliPath = join(pkgDir, "cli.js");
        if (existsSync(cliPath)) return cliPath;
    } catch {
        // Falls through
    }

    // Strategy 2: Find claude CLI on $PATH.
    // For npm global installs, the symlink resolves into the package with cli.js.
    // For standalone installs (native install, Homebrew, WinGet), return the binary
    // directly — the SDK handles executable paths by spawning them directly.
    try {
        const cmd =
            process.platform === "win32" ? "where claude" : "which claude";
        const claudeBin = execSync(cmd, {
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
        })
            .trim()
            .split(/\r?\n/)[0]
            ?.replace(/\r$/, "");
        if (claudeBin) {
            const { realpathSync } = require("node:fs") as typeof import("node:fs");
            const realPath = realpathSync(claudeBin);
            // Check if it's an npm package with cli.js
            const pkgDir = dirname(realPath);
            const cliPath = join(pkgDir, "cli.js");
            if (existsSync(cliPath)) return cliPath;
            // Standalone binary (native install, Homebrew, WinGet) — no cli.js
            if (existsSync(realPath)) return realPath;
        }
    } catch {
        // Falls through
    }

    throw new Error(
        "Cannot find Claude Code CLI.\n\n" +
            "Install Claude Code by visiting: https://code.claude.com/docs/en/setup\n\n" +
            "Or ensure 'claude' is available in your PATH.",
    );
}
