import {
    query,
    type AgentDefinition,
    type Options,
    type Query,
} from "@anthropic-ai/claude-agent-sdk";
import type {
    Session,
    SessionConfig,
} from "@/services/agents/types.ts";
import type {
    ClaudeNativeEvent,
    ProviderStreamEventDataMap,
    ProviderStreamEventType,
} from "@/services/agents/provider-events.ts";
import type { ClaudeSessionState } from "@/services/agents/clients/claude/internal-types.ts";

interface LoadedClaudeAgent {
    name: string;
    source: "local" | "global";
    description: string;
    prompt: string;
    tools?: string[];
    disallowedTools?: string[];
    model?: "sonnet" | "opus" | "haiku" | "inherit";
    mcpServers?: AgentDefinition["mcpServers"];
    skills?: string[];
    maxTurns?: number;
    criticalSystemReminder_EXPERIMENTAL?: string;
}

export async function createClaudeSession(args: {
    config: SessionConfig;
    isRunning: boolean;
    loadConfiguredAgents: (projectRoot: string) => Promise<LoadedClaudeAgent[]>;
    emitEvent: (
        eventType: "session.start",
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
    emitRuntimeSelection: (
        sessionId: string,
        operation: "create" | "resume" | "send" | "stream" | "summarize",
    ) => void;
    pendingHookSessionBindings: string[];
    wrapQuery: (
        queryInstance: Query | null,
        sessionId: string,
        config: SessionConfig,
    ) => Session;
}): Promise<Session> {
    if (!args.isRunning) {
        throw new Error("Client not started. Call start() first.");
    }

    const sessionId =
        args.config.sessionId ??
        `claude-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const programmaticAgents = args.config.agents;
    const hasProgrammaticAgents =
        Boolean(programmaticAgents) &&
        Object.keys(programmaticAgents ?? {}).length > 0;
    const sessionConfig = { ...args.config };

    if (hasProgrammaticAgents) {
        const projectRoot = process.cwd();
        const loadedAgents = await args.loadConfiguredAgents(projectRoot);
        const agentsMap: Record<string, AgentDefinition> = {
            ...programmaticAgents,
        };

        for (const agent of loadedAgents) {
            if (!agentsMap[agent.name]) {
                const { name: _name, source: _source, ...definition } = agent;
                agentsMap[agent.name] = definition;
            }
        }

        sessionConfig.agents = agentsMap;
    }

    args.emitEvent("session.start", sessionId, { config: sessionConfig });
    args.emitProviderEvent("session.start", sessionId, { config: sessionConfig }, {
        nativeSessionId: sessionId,
    });
    args.emitRuntimeSelection(sessionId, "create");
    args.pendingHookSessionBindings.push(sessionId);

    return args.wrapQuery(null, sessionId, sessionConfig);
}

export async function resumeClaudeSession(args: {
    sessionId: string;
    isRunning: boolean;
    sessions: Map<string, ClaudeSessionState>;
    emitRuntimeSelection: (
        sessionId: string,
        operation: "create" | "resume" | "send" | "stream" | "summarize",
    ) => void;
    buildSdkOptions: (config: SessionConfig, sessionId?: string) => Options;
    wrapQuery: (
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
    ) => Session;
}): Promise<Session | null> {
    if (!args.isRunning) {
        throw new Error("Client not started. Call start() first.");
    }

    const existingState = args.sessions.get(args.sessionId);
    if (existingState && !existingState.isClosed) {
        return args.wrapQuery(
            existingState.query,
            args.sessionId,
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

    args.emitRuntimeSelection(args.sessionId, "resume");

    try {
        const options = args.buildSdkOptions(
            { sessionId: args.sessionId },
            args.sessionId,
        );
        options.resume = args.sessionId;

        const queryInstance = query({ prompt: "", options });

        return args.wrapQuery(
            queryInstance,
            args.sessionId,
            {},
            {
                sdkSessionId: args.sessionId,
            },
        );
    } catch (error) {
        console.warn(`Failed to resume session ${args.sessionId}:`, error);
        return null;
    }
}
