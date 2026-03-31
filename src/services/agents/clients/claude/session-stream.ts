import { query, type Options, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentMessage } from "@/services/agents/types.ts";
import { createMessageCompleteEventData, extractMessageContent, getClaudeContentBlockIndex } from "@/services/agents/clients/claude/message-normalization.ts";
import type { ClaudeNativeEvent, ProviderStreamEventDataMap, ProviderStreamEventType } from "@/services/agents/provider-events.ts";
import type { ClaudeSessionState } from "@/services/agents/clients/claude/internal-types.ts";
import type { ClaudeSessionWrapperArgs } from "@/services/agents/clients/claude/session-runtime.ts";

export function streamClaudeSessionMessages(args: {
    wrapperArgs: ClaudeSessionWrapperArgs;
    state: ClaudeSessionState;
    waitForPendingAbort: () => Promise<void>;
    message: string;
}): AsyncIterable<AgentMessage> {
    const buildOptions = () =>
        args.wrapperArgs.buildSdkOptions(
            args.wrapperArgs.config,
            args.wrapperArgs.sessionId,
        );
    const processMsg = (msg: SDKMessage) =>
        args.wrapperArgs.processMessage(
            msg,
            args.wrapperArgs.sessionId,
            args.state,
        );
    const emitRuntimeSelection = () =>
        args.wrapperArgs.emitRuntimeSelection(args.wrapperArgs.sessionId, "stream");
    const getSubagentAgentId = (nativeSessionId: string) =>
        args.wrapperArgs.subagentSdkSessionIdToAgentId.get(nativeSessionId);
    const bumpMissingTerminalEvents = () =>
        args.wrapperArgs.bumpStreamIntegrityCounter(
            args.wrapperArgs.sessionId,
            "missingTerminalEvents",
        );
    const getSdkSessionId = () => args.state.sdkSessionId;
    const emitStreamingUsage = (outputTokens: number) => {
        args.state.hasEmittedStreamingUsage = true;
        args.wrapperArgs.emitEvent("usage", args.wrapperArgs.sessionId, {
            inputTokens: 0,
            outputTokens,
            model: args.wrapperArgs.getDetectedModel(),
        });
    };
    const emitProviderStreamingEvent = <T extends ProviderStreamEventType>(
        eventType: T,
        data: ProviderStreamEventDataMap[T],
        options?: {
            native?: ClaudeNativeEvent;
            nativeEventId?: string;
            nativeSessionId?: string;
            timestamp?: number;
        },
    ) => {
        args.wrapperArgs.emitProviderEvent(
            eventType,
            args.wrapperArgs.sessionId,
            data,
            options,
        );
    };

    return {
        [Symbol.asyncIterator]: async function* () {
            if (args.state.isClosed) {
                throw new Error("Session is closed");
            }
            await args.waitForPendingAbort();
            args.state.hasEmittedStreamingUsage = false;
            args.state.abortRequested = false;
            emitRuntimeSelection();
            const options: Options = {
                ...buildOptions(),
                includePartialMessages: true,
            };
            const sdkSessionId = getSdkSessionId();
            if (sdkSessionId) {
                options.resume = sdkSessionId;
            }
            const streamSource = query({
                prompt: args.message,
                options,
            });
            args.state.query = streamSource;

            let hasYieldedDeltas = false;
            let thinkingStartMs: number | null = null;
            let thinkingDurationMs = 0;
            let currentBlockIsThinking = false;
            let activeThinkingSourceKey: string | null = null;
            let outputTokens = 0;
            let sawTerminalEvent = false;

            try {
                for await (const sdkMessage of streamSource) {
                    processMsg(sdkMessage);
                    if (sdkMessage.type === "result") {
                        sawTerminalEvent = true;
                    }

                    if (sdkMessage.type === "stream_event") {
                        const event = sdkMessage.event;
                        const nativeEventSessionId =
                            typeof sdkMessage.session_id === "string"
                                ? sdkMessage.session_id
                                : undefined;
                        const sdkMessageRecord = sdkMessage as Record<string, unknown>;
                        const parentToolUseId =
                            typeof sdkMessageRecord.parent_tool_use_id === "string"
                                ? sdkMessageRecord.parent_tool_use_id
                                : typeof sdkMessageRecord.parentToolUseId === "string"
                                  ? sdkMessageRecord.parentToolUseId
                                  : undefined;
                        const sessionScopedAgentId = nativeEventSessionId
                            ? getSubagentAgentId(nativeEventSessionId)
                            : undefined;
                        const isChildSessionStream =
                            typeof nativeEventSessionId === "string" &&
                            typeof args.state.sdkSessionId === "string" &&
                            nativeEventSessionId !== args.state.sdkSessionId;
                        const suppressTopLevelYield =
                            Boolean(parentToolUseId) ||
                            Boolean(sessionScopedAgentId) ||
                            isChildSessionStream;

                        if (event.type === "content_block_start") {
                            const blockIndex = getClaudeContentBlockIndex(
                                event as unknown as Record<string, unknown>,
                            );
                            const blockType = (
                                event as unknown as Record<string, unknown>
                            ).content_block
                                ? ((
                                      event as unknown as Record<string, unknown>
                                  ).content_block as Record<string, unknown>).type
                                : undefined;
                            currentBlockIsThinking = blockType === "thinking";
                            if (currentBlockIsThinking) {
                                thinkingStartMs = Date.now();
                                activeThinkingSourceKey =
                                    blockIndex !== null
                                        ? String(blockIndex)
                                        : null;
                            }
                        }

                        if (
                            event.type === "content_block_stop" &&
                            currentBlockIsThinking
                        ) {
                            if (activeThinkingSourceKey === null) {
                                const blockIndex = getClaudeContentBlockIndex(
                                    event as unknown as Record<string, unknown>,
                                );
                                if (blockIndex !== null) {
                                    activeThinkingSourceKey = String(blockIndex);
                                }
                            }
                            if (thinkingStartMs !== null) {
                                thinkingDurationMs += Date.now() - thinkingStartMs;
                                thinkingStartMs = null;
                            }
                            currentBlockIsThinking = false;
                            if (!suppressTopLevelYield) {
                                yield {
                                    type: "thinking",
                                    content: "",
                                    role: "assistant",
                                    metadata: {
                                        provider: "claude",
                                        thinkingSourceKey:
                                            activeThinkingSourceKey ?? undefined,
                                        streamingStats: {
                                            thinkingMs: thinkingDurationMs,
                                            outputTokens,
                                        },
                                    },
                                };
                            }
                            emitProviderStreamingEvent(
                                "reasoning.complete",
                                {
                                    reasoningId:
                                        activeThinkingSourceKey ?? "thinking",
                                    durationMs: thinkingDurationMs,
                                    parentToolCallId:
                                        parentToolUseId ?? undefined,
                                },
                                {
                                    native: sdkMessage,
                                    nativeSessionId: sdkMessage.session_id,
                                    nativeEventId: sdkMessage.uuid,
                                },
                            );
                            activeThinkingSourceKey = null;
                        }

                        if (event.type === "message_delta") {
                            const usage = (
                                event as unknown as Record<string, unknown>
                            ).usage as { output_tokens?: number } | undefined;
                            if (usage?.output_tokens) {
                                outputTokens += usage.output_tokens;
                                emitStreamingUsage(usage.output_tokens);
                            }
                        }

                        if (event.type === "content_block_delta") {
                            if (event.delta.type === "text_delta") {
                                if (!suppressTopLevelYield) {
                                    hasYieldedDeltas = true;
                                    yield {
                                        type: "text",
                                        content: event.delta.text,
                                        role: "assistant",
                                    };
                                }
                                emitProviderStreamingEvent(
                                    "message.delta",
                                    {
                                        delta: event.delta.text,
                                        contentType: "text",
                                        parentToolCallId: parentToolUseId,
                                    },
                                    {
                                        native: sdkMessage,
                                        nativeSessionId: sdkMessage.session_id,
                                        nativeEventId: sdkMessage.uuid,
                                    },
                                );
                            } else if (event.delta.type === "thinking_delta") {
                                if (!parentToolUseId) {
                                    hasYieldedDeltas = true;
                                }
                                const blockIndex = getClaudeContentBlockIndex(
                                    event as unknown as Record<string, unknown>,
                                );
                                const resolvedThinkingSourceKey: string | null =
                                    blockIndex !== null
                                        ? String(blockIndex)
                                        : activeThinkingSourceKey;
                                if (resolvedThinkingSourceKey !== null) {
                                    activeThinkingSourceKey =
                                        resolvedThinkingSourceKey;
                                }
                                const currentThinkingMs =
                                    thinkingDurationMs +
                                    (thinkingStartMs !== null
                                        ? Date.now() - thinkingStartMs
                                        : 0);
                                if (!suppressTopLevelYield) {
                                    yield {
                                        type: "thinking",
                                        content: (
                                            event.delta as unknown as Record<string, unknown>
                                        ).thinking as string,
                                        role: "assistant",
                                        metadata: {
                                            provider: "claude",
                                            thinkingSourceKey:
                                                resolvedThinkingSourceKey ??
                                                undefined,
                                            streamingStats: {
                                                thinkingMs: currentThinkingMs,
                                                outputTokens,
                                            },
                                        },
                                    };
                                }
                                emitProviderStreamingEvent(
                                    "reasoning.delta",
                                    {
                                        delta: (
                                            event.delta as unknown as Record<string, unknown>
                                        ).thinking as string,
                                        reasoningId:
                                            resolvedThinkingSourceKey ??
                                            "thinking",
                                        parentToolCallId:
                                            parentToolUseId ?? undefined,
                                    },
                                    {
                                        native: sdkMessage,
                                        nativeSessionId: sdkMessage.session_id,
                                        nativeEventId: sdkMessage.uuid,
                                    },
                                );
                            }
                        }
                    } else if (sdkMessage.type === "assistant") {
                        const messageCompleteData =
                            createMessageCompleteEventData(sdkMessage);
                        emitProviderStreamingEvent(
                            "message.complete",
                            {
                                ...messageCompleteData,
                                nativeMessageId: sdkMessage.uuid,
                            },
                            {
                                native: sdkMessage,
                                nativeSessionId: sdkMessage.session_id,
                                nativeEventId: sdkMessage.uuid,
                            },
                        );

                        const parentToolUseId = (
                            sdkMessage as Record<string, unknown>
                        ).parent_tool_use_id;
                        const nativeAssistantSessionId =
                            typeof sdkMessage.session_id === "string"
                                ? sdkMessage.session_id
                                : undefined;
                        const sessionScopedAgentId = nativeAssistantSessionId
                            ? getSubagentAgentId(nativeAssistantSessionId)
                            : undefined;
                        const isChildAssistantMessage =
                            typeof nativeAssistantSessionId === "string" &&
                            typeof args.state.sdkSessionId === "string" &&
                            nativeAssistantSessionId !== args.state.sdkSessionId;
                        if (
                            parentToolUseId ||
                            sessionScopedAgentId ||
                            isChildAssistantMessage
                        ) {
                            continue;
                        }

                        const { type, content, thinkingSourceKey } =
                            extractMessageContent(sdkMessage);

                        if (type === "tool_use") {
                            yield {
                                type,
                                content,
                                role: "assistant",
                                metadata: {
                                    toolName:
                                        typeof content === "object" &&
                                        content !== null
                                            ? ((content as Record<string, unknown>)
                                                  .name as string)
                                            : undefined,
                                },
                            };
                        } else if (!hasYieldedDeltas) {
                            yield {
                                type,
                                content,
                                role: "assistant",
                                metadata: {
                                    tokenUsage: {
                                        inputTokens:
                                            sdkMessage.message.usage
                                                ?.input_tokens ?? 0,
                                        outputTokens:
                                            sdkMessage.message.usage
                                                ?.output_tokens ?? 0,
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
                }
            } catch (error) {
                throw error instanceof Error ? error : new Error(String(error));
            }

            if (!sawTerminalEvent) {
                bumpMissingTerminalEvents();
            }

            if (outputTokens > 0 || thinkingDurationMs > 0) {
                yield {
                    type: "text",
                    content: "",
                    role: "assistant",
                    metadata: {
                        streamingStats: {
                            outputTokens,
                            thinkingMs: thinkingDurationMs,
                        },
                    },
                };
            }
        },
    };
}
