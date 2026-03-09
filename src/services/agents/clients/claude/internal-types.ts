import type {
    HookCallback,
    HookCallbackMatcher,
    HookEvent,
    McpSdkServerConfigWithInstance,
    Query,
} from "@anthropic-ai/claude-agent-sdk";
import type {
    EventType,
    SessionConfig,
} from "@/services/agents/types.ts";

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

export interface ClaudeSessionState {
    query: Query | null;
    sessionId: string;
    sdkSessionId: string | null;
    config: SessionConfig;
    inputTokens: number;
    outputTokens: number;
    isClosed: boolean;
    contextWindow: number | null;
    systemToolsBaseline: number | null;
    hasEmittedStreamingUsage: boolean;
    pendingAbortPromise: Promise<void> | null;
}

export interface StreamIntegrityCounters {
    missingTerminalEvents: number;
    unmatchedToolStarts: number;
    unmatchedToolCompletes: number;
    unmatchedSubagentStarts: number;
    unmatchedSubagentCompletes: number;
}

export type ReasoningEffort = "low" | "medium" | "high" | "max";

export interface AskUserQuestionInput {
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

export type ClaudeRuntimeOperation =
    | "create"
    | "resume"
    | "send"
    | "stream"
    | "summarize";

export function mapEventTypeToHookEvent(eventType: EventType): HookEvent | null {
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

export function buildClaudeNativeHooks(
    registeredHooks: Record<string, HookCallback[]>,
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
    const hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {};

    for (const [event, callbacks] of Object.entries(registeredHooks)) {
        if (callbacks && callbacks.length > 0) {
            hooks[event as HookEvent] = [{ hooks: callbacks }];
        }
    }

    return hooks;
}

