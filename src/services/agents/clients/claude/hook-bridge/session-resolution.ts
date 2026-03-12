import type { ClaudeSessionState } from "@/services/agents/clients/claude/internal-types.ts";

export function resolveClaudeHookSessionId(args: {
    sdkSessionId: string;
    sessions: Map<string, ClaudeSessionState>;
    pendingHookSessionBindings: string[];
}): string {
    if (args.sessions.has(args.sdkSessionId)) {
        return args.sdkSessionId;
    }

    for (const [wrappedSessionId, state] of args.sessions.entries()) {
        if (state.sdkSessionId === args.sdkSessionId) {
            return wrappedSessionId;
        }
    }

    for (let index = 0; index < args.pendingHookSessionBindings.length; index += 1) {
        const candidateWrappedId = args.pendingHookSessionBindings[index];
        if (!candidateWrappedId) {
            continue;
        }
        const candidateState = args.sessions.get(candidateWrappedId);
        if (!candidateState || candidateState.isClosed) {
            continue;
        }
        if (candidateState.query === null) {
            continue;
        }
        if (
            candidateState.sdkSessionId &&
            candidateState.sdkSessionId !== args.sdkSessionId
        ) {
            continue;
        }
        args.pendingHookSessionBindings.splice(index, 1);
        candidateState.sdkSessionId = args.sdkSessionId;
        return candidateWrappedId;
    }

    const openSessions = Array.from(args.sessions.entries()).filter(
        ([, state]) => !state.isClosed,
    );
    if (openSessions.length === 1) {
        const [wrappedSessionId, state] = openSessions[0]!;
        if (!state.sdkSessionId) {
            state.sdkSessionId = args.sdkSessionId;
        }
        return wrappedSessionId;
    }

    const unboundOpenSessions = openSessions.filter(
        ([, state]) => !state.sdkSessionId,
    );
    if (unboundOpenSessions.length === 1) {
        const [wrappedSessionId, state] = unboundOpenSessions[0]!;
        state.sdkSessionId = args.sdkSessionId;
        return wrappedSessionId;
    }

    return args.sdkSessionId;
}

export function resolveClaudeHookToolUseId(
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

export function resolveClaudeHookParentToolUseId(
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

export function resolveClaudeFallbackHookSessionId(args: {
    toolUseId?: string;
    toolUseIdToSessionId: Map<string, string>;
    sessions: Map<string, ClaudeSessionState>;
}): string {
    if (args.toolUseId) {
        const mappedSessionId = args.toolUseIdToSessionId.get(args.toolUseId);
        if (mappedSessionId) {
            const mappedState = args.sessions.get(mappedSessionId);
            if (mappedState && !mappedState.isClosed) {
                return mappedSessionId;
            }
            args.toolUseIdToSessionId.delete(args.toolUseId);
        }
    }

    const openActiveSessions = Array.from(args.sessions.entries()).filter(
        ([, state]) => !state.isClosed && state.query !== null,
    );
    if (openActiveSessions.length === 1) {
        return openActiveSessions[0]![0];
    }
    return "";
}

export function getClaudeMainSdkSessionId(
    wrappedSessionId: string,
    sessions: Map<string, ClaudeSessionState>,
): string | null {
    const state = sessions.get(wrappedSessionId);
    return state?.sdkSessionId ?? null;
}
