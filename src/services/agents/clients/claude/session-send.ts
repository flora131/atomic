import { query } from "@anthropic-ai/claude-agent-sdk";
import type { AgentMessage } from "@/services/agents/types.ts";
import { extractMessageContent } from "@/services/agents/clients/claude/message-normalization.ts";
import type { ClaudeSessionState } from "@/services/agents/clients/claude/internal-types.ts";
import type { ClaudeSessionWrapperArgs } from "@/services/agents/clients/claude/session-runtime.ts";

export async function sendClaudeSessionMessage(args: {
    wrapperArgs: ClaudeSessionWrapperArgs;
    state: ClaudeSessionState;
    waitForPendingAbort: () => Promise<void>;
    message: string;
}): Promise<AgentMessage> {
    if (args.state.isClosed) {
        throw new Error("Session is closed");
    }
    await args.waitForPendingAbort();
    args.wrapperArgs.emitRuntimeSelection(args.wrapperArgs.sessionId, "send");
    args.state.abortRequested = false;

    const options = args.wrapperArgs.buildSdkOptions(
        args.wrapperArgs.config,
        args.wrapperArgs.sessionId,
    );
    if (args.state.sdkSessionId) {
        options.resume = args.state.sdkSessionId;
    }

    const newQuery = query({
        prompt: args.message,
        options,
    });
    args.state.query = newQuery;

    let lastAssistantMessage: AgentMessage | null = null;
    let sawTerminalEvent = false;

    try {
        for await (const sdkMessage of newQuery) {
            args.wrapperArgs.processMessage(
                sdkMessage,
                args.wrapperArgs.sessionId,
                args.state,
            );
            if (sdkMessage.type === "result") {
                sawTerminalEvent = true;
            }

            if (sdkMessage.type === "assistant") {
                const parentToolUseId = (
                    sdkMessage as Record<string, unknown>
                ).parent_tool_use_id;
                if (parentToolUseId) {
                    continue;
                }

                const { type, content, thinkingSourceKey } =
                    extractMessageContent(sdkMessage);
                lastAssistantMessage = {
                    type,
                    content,
                    role: "assistant",
                    metadata: {
                        tokenUsage: {
                            inputTokens:
                                sdkMessage.message.usage?.input_tokens ?? 0,
                            outputTokens:
                                sdkMessage.message.usage?.output_tokens ?? 0,
                        },
                        model: sdkMessage.message.model,
                        stopReason:
                            sdkMessage.message.stop_reason ?? undefined,
                        ...(type === "thinking"
                            ? {
                                  provider: "claude",
                                  thinkingSourceKey,
                              }
                            : {}),
                    },
                };
            }
        }
    } catch (error) {
        throw error instanceof Error ? error : new Error(String(error));
    }

    if (!sawTerminalEvent) {
        args.wrapperArgs.bumpStreamIntegrityCounter(
            args.wrapperArgs.sessionId,
            "missingTerminalEvents",
        );
    }

    return (
        lastAssistantMessage ?? {
            type: "text",
            content: "",
            role: "assistant",
        }
    );
}
