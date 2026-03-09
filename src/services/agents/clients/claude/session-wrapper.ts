import type { Query } from "@anthropic-ai/claude-agent-sdk";
import type { Session } from "@/services/agents/types.ts";
import type { ClaudeSessionState } from "@/services/agents/clients/claude/internal-types.ts";
import type { ClaudeSessionWrapperArgs } from "@/services/agents/clients/claude/session-runtime.ts";
import { sendClaudeSessionMessage } from "@/services/agents/clients/claude/session-send.ts";
import { streamClaudeSessionMessages } from "@/services/agents/clients/claude/session-stream.ts";
import {
    destroyClaudeSession,
    getClaudeSessionContextUsage,
    getClaudeSessionMcpSnapshot,
    getClaudeSessionSystemToolsTokens,
    summarizeClaudeSession,
} from "@/services/agents/clients/claude/session-maintenance.ts";

export function wrapClaudeQuerySession(args: ClaudeSessionWrapperArgs): Session {
    const state: ClaudeSessionState = {
        query: args.queryInstance,
        sessionId: args.sessionId,
        sdkSessionId: args.persisted?.sdkSessionId ?? null,
        config: args.config,
        inputTokens: args.persisted?.inputTokens ?? 0,
        outputTokens: args.persisted?.outputTokens ?? 0,
        isClosed: false,
        contextWindow: args.persisted?.contextWindow ?? args.probeContextWindow,
        systemToolsBaseline:
            args.persisted?.systemToolsBaseline ?? args.probeSystemToolsBaseline,
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

    args.sessions.set(args.sessionId, state);

    return {
        id: args.sessionId,

        send: (message: string) =>
            sendClaudeSessionMessage({
                wrapperArgs: args,
                state,
                waitForPendingAbort,
                message,
            }),

        stream: (
            message: string,
            _optionsArg?: { agent?: string },
        ) =>
            streamClaudeSessionMessages({
                wrapperArgs: args,
                state,
                waitForPendingAbort,
                message,
            }),

        summarize: () =>
            summarizeClaudeSession({
                wrapperArgs: args,
                state,
                waitForPendingAbort,
            }),

        getContextUsage: async () => getClaudeSessionContextUsage(state),

        getSystemToolsTokens: () => getClaudeSessionSystemToolsTokens(state),

        getMcpSnapshot: () =>
            getClaudeSessionMcpSnapshot({
                wrapperArgs: args,
                state,
                waitForPendingAbort,
            }),

        abort: async (): Promise<void> => {
            await runAbortWithLock();
        },

        abortBackgroundAgents: async (): Promise<void> => {
            await runAbortWithLock();
        },

        destroy: () => destroyClaudeSession({ wrapperArgs: args, state }),
    };
}
