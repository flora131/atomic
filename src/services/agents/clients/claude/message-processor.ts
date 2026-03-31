import type {
    SDKAuthStatusMessage,
    SDKMessage,
    SDKPromptSuggestionMessage,
    SDKRateLimitEvent,
    SDKResultMessage,
    SDKStatusMessage,
    SDKSystemMessage,
    SDKTaskNotificationMessage,
    SDKTaskProgressMessage,
    SDKTaskStartedMessage,
    SDKToolProgressMessage,
    SDKToolUseSummaryMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { createMessageCompleteEventData } from "@/services/agents/clients/claude/message-normalization.ts";
import type { EventType } from "@/services/agents/types.ts";
import type { ClaudeSessionState } from "@/services/agents/clients/claude/internal-types.ts";
import { toolDebug } from "@/services/events/adapters/providers/claude/tool-debug-log.ts";

export function mapClaudeSdkEventToEventType(
    sdkMessageType: string,
): EventType | null {
    const mapping: Record<string, EventType> = {
        assistant: "message.complete",
        stream_event: "message.delta",
    };
    return mapping[sdkMessageType] ?? null;
}

export function assertNeverClaudeMessage(value: never): never {
    throw new Error(`Unhandled Claude SDK message: ${JSON.stringify(value)}`);
}

export function processClaudeMessage(args: {
    sdkMessage: SDKMessage;
    sessionId: string;
    state: ClaudeSessionState;
    detectedModel: string | null;
    setDetectedModel: (model: string) => void;
    emitEvent: (
        eventType: EventType,
        sessionId: string,
        data: Record<string, unknown>,
    ) => void;
    toolUseIdToAgentId: Map<string, string>;
    toolUseIdToSessionId: Map<string, string>;
    taskDescriptionByToolUseId: Map<string, string>;
    subagentSdkSessionIdToAgentId: Map<string, string>;
    capturedModelContextWindows: Map<string, number>;
}): void {
    const { sdkMessage, sessionId, state } = args;

    if (!state.sdkSessionId && "session_id" in sdkMessage) {
        const msgWithSessionId = sdkMessage as { session_id?: string };
        if (msgWithSessionId.session_id) {
            state.sdkSessionId = msgWithSessionId.session_id;
        }
    }

    if (sdkMessage.type === "system" && sdkMessage.subtype === "init") {
        const systemMsg = sdkMessage as SDKSystemMessage;
        if (systemMsg.model && !args.detectedModel) {
            args.setDetectedModel(systemMsg.model);
        }
    }

    if (sdkMessage.type === "system" && sdkMessage.subtype === "status") {
        const statusMessage = sdkMessage as SDKStatusMessage;
        if (statusMessage.status === "compacting") {
            args.emitEvent("session.compaction", sessionId, {
                phase: "start",
            });
        }
    }

    if (sdkMessage.type === "system" && sdkMessage.subtype === "compact_boundary") {
        args.emitEvent("session.compaction", sessionId, {
            phase: "complete",
            success: true,
        });
    }

    if (
        sdkMessage.type === "system" &&
        sdkMessage.subtype === "task_progress"
    ) {
        const msg = sdkMessage as SDKTaskProgressMessage;
        const toolUseId = msg.tool_use_id;
        const mappedAgentId = toolUseId
            ? args.toolUseIdToAgentId.get(toolUseId)
            : undefined;
        const sessionScopedAgentId =
            args.subagentSdkSessionIdToAgentId.get(msg.session_id);
        const agentId = mappedAgentId ?? sessionScopedAgentId;
        toolDebug("taskProgress", {
            sdkSessionId: msg.session_id,
            toolUseId,
            mappedAgentId,
            sessionScopedAgentId,
            resolvedAgentId: agentId,
            sdkToolUses: msg.usage.tool_uses,
            lastToolName: msg.last_tool_name,
        });
        if (agentId) {
            args.emitEvent("subagent.update", sessionId, {
                subagentId: agentId,
                currentTool: msg.last_tool_name,
                toolUses: msg.usage.tool_uses,
            });
        }
    }

    if (
        sdkMessage.type === "system" &&
        sdkMessage.subtype === "task_started"
    ) {
        const msg = sdkMessage as SDKTaskStartedMessage;
        const toolUseId = msg.tool_use_id;
        const description = msg.description.trim();
        if (toolUseId && description.length > 0) {
            args.taskDescriptionByToolUseId.set(toolUseId, description);
        }
    }

    if (
        sdkMessage.type === "system" &&
        sdkMessage.subtype === "task_notification"
    ) {
        const msg = sdkMessage as SDKTaskNotificationMessage;
        const toolUseId = msg.tool_use_id;
        const mappedAgentId = toolUseId
            ? args.toolUseIdToAgentId.get(toolUseId)
            : undefined;
        const sessionScopedAgentId =
            args.subagentSdkSessionIdToAgentId.get(msg.session_id);
        const agentId = mappedAgentId ?? sessionScopedAgentId;
        if (agentId) {
            args.emitEvent("subagent.complete", sessionId, {
                subagentId: agentId,
                success: msg.status === "completed",
                result: msg.summary,
            });
            if (toolUseId) {
                args.toolUseIdToAgentId.delete(toolUseId);
                args.toolUseIdToSessionId.delete(toolUseId);
                args.taskDescriptionByToolUseId.delete(toolUseId);
            }
        }
    }

    if (sdkMessage.type === "assistant") {
        const usage = sdkMessage.message.usage;
        if (usage) {
            state.inputTokens = usage.input_tokens;
            state.outputTokens = usage.output_tokens;
        }
    }

    const eventType = mapClaudeSdkEventToEventType(sdkMessage.type);
    if (eventType === "message.complete" && sdkMessage.type === "assistant") {
        args.emitEvent(
            eventType,
            sessionId,
            createMessageCompleteEventData(sdkMessage),
        );
    } else if (eventType) {
        args.emitEvent(eventType, sessionId, { sdkMessage });
    }

    if (sdkMessage.type === "result") {
        const result = sdkMessage as SDKResultMessage;
        if (result.subtype === "success") {
            args.emitEvent("session.idle", sessionId, {
                reason: result.stop_reason ?? "completed",
            });
        } else if (
            state.abortRequested &&
            result.subtype === "error_during_execution"
        ) {
            state.abortRequested = false;
        } else {
            const errorMessage = result.errors.join("; ") || "Claude turn failed";
            const errorCode =
                result.subtype === "error_max_turns"
                    ? "MAX_TURNS"
                    : result.subtype === "error_max_budget_usd"
                      ? "MAX_BUDGET"
                      : result.subtype === "error_max_structured_output_retries"
                        ? "MAX_STRUCTURED_OUTPUT_RETRIES"
                        : "EXECUTION_ERROR";
            args.emitEvent("session.error", sessionId, {
                error: errorMessage,
                code: errorCode,
            });
        }
        state.abortRequested = false;

        if (result.usage) {
            state.inputTokens = result.usage.input_tokens;
            state.outputTokens = result.usage.output_tokens;
            const detectedModelUsage = args.detectedModel
                ? result.modelUsage?.[args.detectedModel]
                : undefined;
            if (!state.hasEmittedStreamingUsage) {
                args.emitEvent("usage", sessionId, {
                    inputTokens: result.usage.input_tokens ?? 0,
                    outputTokens: result.usage.output_tokens ?? 0,
                    model: args.detectedModel,
                    costUsd: result.total_cost_usd,
                    cacheReadTokens:
                        detectedModelUsage?.cacheReadInputTokens ?? 0,
                    cacheWriteTokens:
                        detectedModelUsage?.cacheCreationInputTokens ?? 0,
                });
            } else {
                args.emitEvent("usage", sessionId, {
                    inputTokens: result.usage.input_tokens ?? 0,
                    outputTokens: 0,
                    model: args.detectedModel,
                    costUsd: result.total_cost_usd,
                    cacheReadTokens:
                        detectedModelUsage?.cacheReadInputTokens ?? 0,
                    cacheWriteTokens:
                        detectedModelUsage?.cacheCreationInputTokens ?? 0,
                });
            }
            state.hasEmittedStreamingUsage = false;
        }

        if (result.modelUsage) {
            const modelKey =
                args.detectedModel ?? Object.keys(result.modelUsage)[0];
            if (modelKey && result.modelUsage[modelKey]) {
                const modelUsage = result.modelUsage[modelKey];
                if (modelUsage.contextWindow != null) {
                    state.contextWindow = modelUsage.contextWindow;
                    args.capturedModelContextWindows.set(
                        modelKey,
                        modelUsage.contextWindow,
                    );
                }
                state.systemToolsBaseline =
                    modelUsage.cacheCreationInputTokens > 0
                        ? modelUsage.cacheCreationInputTokens
                        : modelUsage.cacheReadInputTokens;
            }
            for (const [key, modelUsage] of Object.entries(result.modelUsage)) {
                if (modelUsage.contextWindow != null) {
                    args.capturedModelContextWindows.set(
                        key,
                        modelUsage.contextWindow,
                    );
                }
            }
        }
    }

    switch (sdkMessage.type) {
        case "assistant":
        case "user":
        case "result":
        case "stream_event":
            break;
        case "system":
            switch (sdkMessage.subtype) {
                case "init":
                case "compact_boundary":
                case "status":
                case "task_started":
                case "task_progress":
                case "task_notification":
                case "hook_started":
                case "hook_progress":
                case "hook_response":
                case "files_persisted":
                case "local_command_output":
                case "elicitation_complete":
                case "api_retry":
                case "session_state_changed":
                    break;
                default: {
                    const unexpectedSystemMessage: never = sdkMessage;
                    throw new Error(
                        `Unhandled Claude system subtype: ${JSON.stringify(unexpectedSystemMessage)}`,
                    );
                }
            }
            break;
        case "tool_progress": {
            const toolProgressMessage = sdkMessage as SDKToolProgressMessage;
            void toolProgressMessage;
            break;
        }
        case "auth_status": {
            const authStatusMessage = sdkMessage as SDKAuthStatusMessage;
            void authStatusMessage;
            break;
        }
        case "tool_use_summary": {
            const toolSummaryMessage = sdkMessage as SDKToolUseSummaryMessage;
            void toolSummaryMessage;
            break;
        }
        case "rate_limit_event": {
            const rateLimitMessage = sdkMessage as SDKRateLimitEvent;
            void rateLimitMessage;
            break;
        }
        case "prompt_suggestion": {
            const promptSuggestionMessage = sdkMessage as SDKPromptSuggestionMessage;
            void promptSuggestionMessage;
            break;
        }
        default:
            assertNeverClaudeMessage(sdkMessage);
    }
}
