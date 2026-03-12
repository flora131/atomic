import { query, type Query } from "@anthropic-ai/claude-agent-sdk";
import type { ContextUsage, McpRuntimeSnapshot } from "@/services/agents/types.ts";
import { mapAuthStatusFromMcpServerStatus } from "@/services/agents/clients/claude/message-normalization.ts";
import type { ClaudeSessionState } from "@/services/agents/clients/claude/internal-types.ts";
import type { ClaudeSessionWrapperArgs } from "@/services/agents/clients/claude/session-runtime.ts";

export async function summarizeClaudeSession(args: {
    wrapperArgs: ClaudeSessionWrapperArgs;
    state: ClaudeSessionState;
    waitForPendingAbort: () => Promise<void>;
}): Promise<void> {
    if (args.state.isClosed) {
        throw new Error("Session is closed");
    }
    await args.waitForPendingAbort();
    args.wrapperArgs.emitRuntimeSelection(args.wrapperArgs.sessionId, "summarize");

    const options = args.wrapperArgs.buildSdkOptions(
        args.wrapperArgs.config,
        args.wrapperArgs.sessionId,
    );
    if (args.state.sdkSessionId) {
        options.resume = args.state.sdkSessionId;
    }

    const newQuery = query({
        prompt: "/compact",
        options,
    });
    args.state.query = newQuery;

    try {
        for await (const sdkMessage of newQuery) {
            args.wrapperArgs.processMessage(
                sdkMessage,
                args.wrapperArgs.sessionId,
                args.state,
            );
        }
    } catch (error) {
        throw error instanceof Error ? error : new Error(String(error));
    }
}

export function getClaudeSessionContextUsage(
    state: ClaudeSessionState,
): ContextUsage {
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
}

export function getClaudeSessionSystemToolsTokens(
    state: ClaudeSessionState,
): number {
    if (state.systemToolsBaseline === null) {
        throw new Error(
            "System tools baseline unavailable: no query has completed. Send a message first.",
        );
    }
    return state.systemToolsBaseline;
}

export async function getClaudeSessionMcpSnapshot(args: {
    wrapperArgs: ClaudeSessionWrapperArgs;
    state: ClaudeSessionState;
    waitForPendingAbort: () => Promise<void>;
}): Promise<McpRuntimeSnapshot | null> {
    if (args.state.isClosed) {
        return null;
    }
    await args.waitForPendingAbort();

    let statusQuery: Query | null = null;
    let shouldClose = false;

    try {
        if (args.state.sdkSessionId) {
            const options = args.wrapperArgs.buildSdkOptions(
                args.wrapperArgs.config,
                args.wrapperArgs.sessionId,
            );
            options.resume = args.state.sdkSessionId;
            options.maxTurns = 0;
            statusQuery = query({ prompt: "", options });
            shouldClose = true;
        } else if (args.state.query) {
            statusQuery = args.state.query;
        } else {
            return null;
        }

        const statusList = await statusQuery.mcpServerStatus();
        const servers: McpRuntimeSnapshot["servers"] = {};
        for (const status of statusList) {
            const authStatus = mapAuthStatusFromMcpServerStatus(status.status);
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
}

export async function destroyClaudeSession(args: {
    wrapperArgs: ClaudeSessionWrapperArgs;
    state: ClaudeSessionState;
}): Promise<void> {
    if (args.state.isClosed) {
        return;
    }

    args.state.isClosed = true;
    args.state.query?.close();
    const pendingTools =
        args.wrapperArgs.pendingToolBySession.get(args.wrapperArgs.sessionId) ?? 0;
    const pendingSubagents =
        args.wrapperArgs.pendingSubagentBySession.get(args.wrapperArgs.sessionId) ??
        0;
    if (pendingTools > 0) {
        args.wrapperArgs.bumpStreamIntegrityCounter(
            args.wrapperArgs.sessionId,
            "unmatchedToolStarts",
            pendingTools,
        );
    }
    if (pendingSubagents > 0) {
        args.wrapperArgs.bumpStreamIntegrityCounter(
            args.wrapperArgs.sessionId,
            "unmatchedSubagentStarts",
            pendingSubagents,
        );
    }
    args.wrapperArgs.pendingToolBySession.delete(args.wrapperArgs.sessionId);
    args.wrapperArgs.pendingSubagentBySession.delete(args.wrapperArgs.sessionId);
    args.wrapperArgs.modelListReadsBySession.delete(args.wrapperArgs.sessionId);
    for (const [toolUseId, mappedSessionId] of args.wrapperArgs.toolUseIdToSessionId.entries()) {
        if (mappedSessionId === args.wrapperArgs.sessionId) {
            args.wrapperArgs.toolUseIdToSessionId.delete(toolUseId);
            args.wrapperArgs.taskDescriptionByToolUseId.delete(toolUseId);
        }
    }
    args.wrapperArgs.subagentSdkSessionIdToAgentId.clear();
    args.wrapperArgs.unmappedSubagentIds.length = 0;
    args.wrapperArgs.sessions.delete(args.wrapperArgs.sessionId);
    args.wrapperArgs.emitEvent("session.idle", args.wrapperArgs.sessionId, {
        reason: "destroyed",
    });
}
