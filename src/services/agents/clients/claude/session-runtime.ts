import type { Options, Query, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { EventType, SessionConfig } from "@/services/agents/types.ts";
import type { ClaudeNativeEvent, ProviderStreamEventDataMap, ProviderStreamEventType } from "@/services/agents/provider-events.ts";
import type { ClaudeRuntimeOperation, ClaudeSessionState } from "@/services/agents/clients/claude/internal-types.ts";

export type ClaudeSessionIntegrityCounter =
    | "missingTerminalEvents"
    | "unmatchedToolStarts"
    | "unmatchedToolCompletes"
    | "unmatchedSubagentStarts"
    | "unmatchedSubagentCompletes";

export interface ClaudeSessionWrapperArgs {
    queryInstance: Query | null;
    sessionId: string;
    config: SessionConfig;
    persisted?: Partial<
        Pick<
            ClaudeSessionState,
            | "sdkSessionId"
            | "inputTokens"
            | "outputTokens"
            | "contextWindow"
            | "systemToolsBaseline"
        >
    >;
    probeContextWindow: number | null;
    probeSystemToolsBaseline: number | null;
    sessions: Map<string, ClaudeSessionState>;
    pendingToolBySession: Map<string, number>;
    pendingSubagentBySession: Map<string, number>;
    modelListReadsBySession: Map<string, number>;
    toolUseIdToSessionId: Map<string, string>;
    taskDescriptionByToolUseId: Map<string, string>;
    subagentSdkSessionIdToAgentId: Map<string, string>;
    unmappedSubagentIds: string[];
    buildSdkOptions: (config: SessionConfig, sessionId?: string) => Options;
    processMessage: (
        sdkMessage: SDKMessage,
        sessionId: string,
        state: ClaudeSessionState,
    ) => void;
    emitRuntimeSelection: (
        sessionId: string,
        operation: ClaudeRuntimeOperation,
    ) => void;
    bumpStreamIntegrityCounter: (
        sessionId: string,
        counter: ClaudeSessionIntegrityCounter,
        amount?: number,
    ) => number;
    emitEvent: (
        eventType: EventType,
        sessionId: string,
        data: Record<string, unknown>,
    ) => void;
    emitProviderEvent: <T extends ProviderStreamEventType>(
        eventType: T,
        sessionId: string,
        data: ProviderStreamEventDataMap[T],
        options?: {
            native?: ClaudeNativeEvent;
            nativeEventId?: string;
            nativeSessionId?: string;
            timestamp?: number;
        },
    ) => void;
    getDetectedModel: () => string | null;
}
