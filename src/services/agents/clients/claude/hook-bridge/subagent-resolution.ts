import type { ClaudeSessionState } from "@/services/agents/clients/claude/internal-types.ts";
import { getClaudeMainSdkSessionId } from "@/services/agents/clients/claude/hook-bridge/session-resolution.ts";

const DEFAULT_SUBAGENT_TASK_LABEL = "sub-agent task";

function isGenericSubagentTaskLabel(task: string | undefined): boolean {
    const normalized = task?.trim().toLowerCase() ?? "";
    return (
        normalized.length === 0 ||
        normalized === DEFAULT_SUBAGENT_TASK_LABEL ||
        normalized === "subagent task"
    );
}

export function shouldPreferRecordedSubagentTask(args: {
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

export function resolveClaudeSubagentParentId(args: {
    hookSdkSessionId: string;
    wrappedSessionId: string;
    sessions: Map<string, ClaudeSessionState>;
    subagentSdkSessionIdToAgentId: Map<string, string>;
    unmappedSubagentIds: string[];
}): string | undefined {
    if (!args.hookSdkSessionId) return undefined;

    const mainSdkSessionId = getClaudeMainSdkSessionId(
        args.wrappedSessionId,
        args.sessions,
    );
    if (!mainSdkSessionId || args.hookSdkSessionId === mainSdkSessionId) {
        return undefined;
    }

    const knownAgentId =
        args.subagentSdkSessionIdToAgentId.get(args.hookSdkSessionId);
    if (knownAgentId) return knownAgentId;

    if (args.unmappedSubagentIds.length > 0) {
        const agentId = args.unmappedSubagentIds.shift()!;
        // Only set the session mapping if no other agent already owns this
        // session. Multiple sub-agents can share the same SDK session.
        if (!args.subagentSdkSessionIdToAgentId.has(args.hookSdkSessionId)) {
            args.subagentSdkSessionIdToAgentId.set(args.hookSdkSessionId, agentId);
        }
        return agentId;
    }

    return undefined;
}
