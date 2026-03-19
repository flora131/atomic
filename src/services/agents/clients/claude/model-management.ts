import { query } from "@anthropic-ai/claude-agent-sdk";
import { stripProviderPrefix } from "@/services/agents/types.ts";
import type {
    EventHandler,
    EventType,
} from "@/services/agents/types.ts";
import { normalizeClaudeModelLabel } from "@/services/agents/clients/claude/message-normalization.ts";
import { getBundledClaudeCodePath } from "@/services/agents/clients/claude/executable-path.ts";
import type { ClaudeSessionState } from "@/services/agents/clients/claude/internal-types.ts";
import type { ClaudeSdkModelInfo } from "@/services/models/model-operations/claude.ts";

export async function listClaudeSupportedModels(args: {
    isRunning: boolean;
    sessions: Map<string, ClaudeSessionState>;
    modelListReadsBySession: Map<string, number>;
    fetchFreshSupportedModels: () => Promise<ClaudeSdkModelInfo[]>;
}): Promise<ClaudeSdkModelInfo[]> {
    if (!args.isRunning) {
        throw new Error("Client not started. Call start() first.");
    }

    for (const [sessionId, state] of args.sessions.entries()) {
        if (!state.isClosed && state.query) {
            const readCount = args.modelListReadsBySession.get(sessionId) ?? 0;
            args.modelListReadsBySession.set(sessionId, readCount + 1);

            if (readCount === 0) {
                return await state.query.supportedModels();
            }

            return await args.fetchFreshSupportedModels();
        }
    }

    return await args.fetchFreshSupportedModels();
}

export async function fetchFreshClaudeSupportedModels(): Promise<ClaudeSdkModelInfo[]> {
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

export function setClaudeActiveSessionModel(args: {
    model: string;
    options?: { reasoningEffort?: string };
    sessions: Map<string, ClaudeSessionState>;
}): void {
    const targetModel = stripProviderPrefix(args.model).trim();
    if (!targetModel) {
        throw new Error("Model ID cannot be empty.");
    }
    if (targetModel.toLowerCase() === "default") {
        throw new Error(
            "Model 'default' is not supported for Claude. Use one of: opus, sonnet, haiku.",
        );
    }

    const activeSessions = Array.from(args.sessions.values()).filter(
        (state) => !state.isClosed,
    );
    const activeSession = activeSessions[activeSessions.length - 1];

    if (!activeSession) {
        return;
    }

    activeSession.config.model = targetModel;
    activeSession.config.reasoningEffort = args.options?.reasoningEffort;
}

export function getClaudeModelDisplayInfo(args: {
    modelHint?: string;
    detectedModel: string | null;
    capturedModelContextWindows: Map<string, number>;
    probeContextWindow: number | null;
    supportedModels?: ClaudeSdkModelInfo[];
}): {
    model: string;
    tier: string;
    supportsReasoning?: boolean;
    supportedReasoningEfforts?: string[];
    defaultReasoningEffort?: string;
    contextWindow?: number;
} {
    const raw =
        (args.modelHint ? stripProviderPrefix(args.modelHint) : null) ??
        args.detectedModel ??
        "opus";
    const modelKey = raw;
    const displayModel = normalizeClaudeModelLabel(modelKey);
    const matchedModel = args.supportedModels?.find(
        (model) =>
            model.value === modelKey
            || model.value === displayModel
            || normalizeClaudeModelLabel(model.value) === displayModel,
    );
    const supportedReasoningEfforts = matchedModel?.supportsEffort === true
        && Array.isArray(matchedModel.supportedEffortLevels)
        && matchedModel.supportedEffortLevels.length > 0
        ? [...matchedModel.supportedEffortLevels]
        : undefined;
    const defaultReasoningEffort = supportedReasoningEfforts?.includes("high")
        ? "high"
        : supportedReasoningEfforts?.[0];
    const contextWindow =
        args.capturedModelContextWindows.get(modelKey) ??
        args.capturedModelContextWindows.get(displayModel) ??
        args.probeContextWindow ??
        undefined;

    return {
        model: displayModel,
        tier: "Claude Code",
        supportsReasoning: Boolean(supportedReasoningEfforts?.length),
        supportedReasoningEfforts,
        defaultReasoningEffort,
        contextWindow,
    };
}

export function getClaudeSystemToolsTokens(
    probeSystemToolsBaseline: number | null,
): number | null {
    return probeSystemToolsBaseline;
}

export function stopClaudeClient(args: {
    isRunning: boolean;
    setIsRunning: (value: boolean) => void;
    sessions: Map<string, ClaudeSessionState>;
    pendingToolBySession: Map<string, number>;
    pendingSubagentBySession: Map<string, number>;
    modelListReadsBySession: Map<string, number>;
    eventHandlers: Map<EventType, Set<EventHandler<EventType>>>;
}): void {
    if (!args.isRunning) {
        return;
    }

    args.setIsRunning(false);

    for (const [, state] of args.sessions) {
        if (!state.isClosed) {
            state.isClosed = true;
            state.query?.close();
        }
    }

    args.sessions.clear();
    args.pendingToolBySession.clear();
    args.pendingSubagentBySession.clear();
    args.modelListReadsBySession.clear();
    args.eventHandlers.clear();
}
