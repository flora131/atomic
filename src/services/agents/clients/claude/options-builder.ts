import { join } from "path";
import type {
    HookCallback,
    McpSdkServerConfigWithInstance,
    Options,
    ThinkingConfig,
} from "@anthropic-ai/claude-agent-sdk";
import { initClaudeOptions } from "@/services/agents/init.ts";
import { normalizeClaudeModelLabel } from "@/services/agents/clients/claude/message-normalization.ts";
import type {
    SessionConfig,
} from "@/services/agents/types.ts";
import type {
    ProviderStreamEventDataMap,
} from "@/services/agents/provider-events.ts";
import type {
    AskUserQuestionInput,
    ClaudeHookConfig,
    ReasoningEffort,
} from "@/services/agents/clients/claude/internal-types.ts";
import { buildClaudeNativeHooks } from "@/services/agents/clients/claude/internal-types.ts";
import { createClaudeSubagentToolPermissionHook } from "@/services/agents/clients/claude/tool-permissions.ts";
import { isPipelineDebug } from "@/services/events/pipeline-logger.ts";
import { getActiveSessionLogDir } from "@/services/events/debug-subscriber/index.ts";

export function getClaudeReasoningEffort(
    effort: string | undefined,
    supportedReasoningEfforts: ReadonlySet<ReasoningEffort>,
): ReasoningEffort {
    return supportedReasoningEfforts.has(effort as ReasoningEffort)
        ? (effort as ReasoningEffort)
        : "high";
}

export function getClaudeThinkingBudget(
    model: string | undefined,
    maxThinkingTokens = 16000,
    adaptiveThinkingModels: ReadonlySet<string>,
): ThinkingConfig | undefined {
    return model && adaptiveThinkingModels.has(normalizeClaudeModelLabel(model))
        ? { type: "adaptive" }
        : {
              type: "enabled",
              budgetTokens: maxThinkingTokens,
          };
}

export async function handleClaudeAskUserQuestion(args: {
    sessionId: string;
    toolInput: Record<string, unknown>;
    emitEvent: (
        eventType: "human_input_required",
        sessionId: string,
        data: ProviderStreamEventDataMap["human_input_required"],
    ) => void;
    emitProviderEvent: (
        eventType: "human_input_required",
        sessionId: string,
        data: ProviderStreamEventDataMap["human_input_required"],
        options?: {
            nativeSessionId?: string;
            nativeEventId?: string;
        },
    ) => void;
}): Promise<{
    behavior: "allow";
    updatedInput: Record<string, unknown>;
} | null> {
    const input = args.toolInput as AskUserQuestionInput;

    if (!input.questions || input.questions.length === 0) {
        return null;
    }

    const answers: Record<string, string> = {};

    for (const question of input.questions) {
        const responsePromise = new Promise<string | string[]>((resolve) => {
            const requestId = `ask_${Date.now()}`;
            const providerData = {
                requestId,
                question: question.question,
                header: question.header,
                options: question.options?.map((option) => ({
                    label: option.label,
                    description: option.description,
                })) ?? [
                    {
                        label: "Yes",
                        description: "Approve",
                    },
                    {
                        label: "No",
                        description: "Deny",
                    },
                ],
                nodeId: requestId,
                respond: resolve,
            } satisfies ProviderStreamEventDataMap["human_input_required"];
            args.emitEvent("human_input_required", args.sessionId, providerData);
            args.emitProviderEvent(
                "human_input_required",
                args.sessionId,
                providerData,
                {
                    nativeSessionId: args.sessionId,
                    nativeEventId: requestId,
                },
            );
        });

        const response = await responsePromise;
        answers[question.question] = Array.isArray(response)
            ? response.join(", ")
            : response;
    }

    return {
        behavior: "allow",
        updatedInput: { ...input, answers },
    };
}

export async function resolveClaudeToolPermission(args: {
    sessionId: string;
    toolName: string;
    toolInput: Record<string, unknown>;
    handleAskUserQuestion: (
        sessionId: string,
        toolInput: Record<string, unknown>,
    ) => Promise<{
        behavior: "allow";
        updatedInput: Record<string, unknown>;
    } | null>;
}): Promise<{ behavior: "allow"; updatedInput: Record<string, unknown> }> {
    if (args.toolName === "AskUserQuestion") {
        const resolved = await args.handleAskUserQuestion(
            args.sessionId,
            args.toolInput,
        );
        if (resolved) {
            return resolved;
        }
    }

    return { behavior: "allow", updatedInput: args.toolInput };
}

export function buildClaudeMcpServers(
    config: SessionConfig,
    registeredTools: Map<string, McpSdkServerConfigWithInstance>,
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

    for (const [name, server] of registeredTools) {
        mcpServers[name] = server;
        hasMcpServers = true;
    }

    return hasMcpServers ? mcpServers : undefined;
}

export function buildClaudeSdkOptions(args: {
    config: SessionConfig;
    sessionId?: string;
    registeredHooks: Record<string, ClaudeHookConfig[keyof ClaudeHookConfig]>;
    registeredTools: Map<string, McpSdkServerConfigWithInstance>;
    supportedReasoningEfforts: ReadonlySet<ReasoningEffort>;
    adaptiveThinkingModels: ReadonlySet<string>;
    allowedTools: readonly string[];
    disallowedTools: readonly string[];
    executablePath: string;
    resolveToolPermission: (
        sessionId: string,
        toolName: string,
        toolInput: Record<string, unknown>,
    ) => Promise<{ behavior: "allow"; updatedInput: Record<string, unknown> }>;
}): Options {
    const registeredHooks = Object.fromEntries(
        Object.entries(args.registeredHooks).filter(([, hooks]) => Array.isArray(hooks)),
    ) as Record<string, HookCallback[]>;
    const preToolUseHooks = registeredHooks.PreToolUse ?? [];
    registeredHooks.PreToolUse = [
        createClaudeSubagentToolPermissionHook(args.config),
        ...preToolUseHooks,
    ];

    const options: Options = {
        ...initClaudeOptions(),
        model: args.config.model,
        maxTurns: args.config.maxTurns,
        maxBudgetUsd: args.config.maxBudgetUsd,
        effort: getClaudeReasoningEffort(
            args.config.reasoningEffort,
            args.supportedReasoningEfforts,
        ),
        thinking: getClaudeThinkingBudget(
            args.config.model,
            args.config.maxThinkingTokens,
            args.adaptiveThinkingModels,
        ),
        hooks: buildClaudeNativeHooks(
            registeredHooks as Record<string, NonNullable<ClaudeHookConfig[keyof ClaudeHookConfig]>>,
        ),
        includePartialMessages: true,
        systemPrompt: args.config.systemPrompt
            ? args.config.systemPrompt
            : args.config.additionalInstructions
              ? {
                    type: "preset",
                    preset: "claude_code",
                    append: args.config.additionalInstructions,
                }
              : { type: "preset", preset: "claude_code" },
        pathToClaudeCodeExecutable: args.executablePath,
    };

    options.canUseTool = async (
        toolName: string,
        toolInput: Record<string, unknown>,
        _options: { signal: AbortSignal },
    ) => {
        return args.resolveToolPermission(
            args.sessionId ?? "",
            toolName,
            toolInput,
        );
    };

    const mcpServers = buildClaudeMcpServers(
        args.config,
        args.registeredTools,
    );
    if (mcpServers) {
        options.mcpServers = mcpServers;
    }

    if (args.config.tools && args.config.tools.length > 0) {
        options.tools = args.config.tools;
    }

    if (args.config.agents && Object.keys(args.config.agents).length > 0) {
        options.agents = args.config.agents;
    }

    options.permissionMode = "bypassPermissions";
    options.allowDangerouslySkipPermissions = true;
    options.allowedTools = [...args.allowedTools];
    options.disallowedTools = [...args.disallowedTools];

    if (args.config.sessionId) {
        options.resume = args.config.sessionId;
    }

    if (isPipelineDebug()) {
        const sessionLogDir = getActiveSessionLogDir();
        if (sessionLogDir) {
            options.debug = true;
            options.debugFile = join(sessionLogDir, "claude-debug.txt");
        }
    }

    return options;
}
