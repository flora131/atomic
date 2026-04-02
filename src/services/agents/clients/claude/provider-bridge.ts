import type {
    AgentEvent,
    EventType,
} from "@/services/agents/types.ts";
import type {
    ClaudeNativeEvent,
    ClaudeProviderEvent,
    ClaudeProviderEventHandler,
    ProviderStreamEventDataMap,
    ProviderStreamEventType,
} from "@/services/agents/provider-events.ts";
import { createSyntheticProviderNativeEvent } from "@/services/agents/provider-events.ts";

export function getClaudeNativeSubtype(
    native: ClaudeNativeEvent | undefined,
): string | undefined {
    if (!native || !("subtype" in native)) {
        return undefined;
    }
    const subtype = native.subtype;
    return typeof subtype === "string" ? subtype : undefined;
}

export function getClaudeNativeMeta(
    native: ClaudeNativeEvent | undefined,
): Readonly<Record<string, string | number | boolean | null | undefined>> | undefined {
    if (!native) {
        return undefined;
    }

    const meta: Record<string, string | number | boolean | null | undefined> = {};
    if ("session_id" in native && typeof native.session_id === "string") {
        meta.nativeSessionId = native.session_id;
    }
    if ("uuid" in native && typeof native.uuid === "string") {
        meta.nativeMessageId = native.uuid;
    }
    if ("parent_tool_use_id" in native) {
        meta.parentToolCallId =
            native.parent_tool_use_id === null || typeof native.parent_tool_use_id === "string"
                ? native.parent_tool_use_id
                : undefined;
    }
    if ("tool_use_id" in native && typeof native.tool_use_id === "string") {
        meta.toolUseId = native.tool_use_id;
    }
    if ("task_id" in native && typeof native.task_id === "string") {
        meta.taskId = native.task_id;
    }
    if ("hook_id" in native && typeof native.hook_id === "string") {
        meta.hookId = native.hook_id;
    }

    return Object.keys(meta).length > 0 ? meta : undefined;
}

export function emitClaudeProviderEvent<T extends ProviderStreamEventType>(args: {
    providerEventHandlers: Set<ClaudeProviderEventHandler>;
    eventType: T;
    sessionId: string;
    data: ProviderStreamEventDataMap[T];
    options?: {
        native?: ClaudeNativeEvent;
        nativeEventId?: string;
        nativeSessionId?: string;
        timestamp?: number;
    };
}): void {
    if (args.providerEventHandlers.size === 0) {
        return;
    }

    const event: ClaudeProviderEvent = {
        provider: "claude",
        type: args.eventType,
        sessionId: args.sessionId,
        timestamp: args.options?.timestamp ?? Date.now(),
        nativeType: args.options?.native?.type ?? args.eventType,
        native: args.options?.native ?? createSyntheticProviderNativeEvent(args.eventType, args.data),
        ...(args.options?.nativeEventId ? { nativeEventId: args.options.nativeEventId } : {}),
        ...(args.options?.nativeSessionId ? { nativeSessionId: args.options.nativeSessionId } : {}),
        ...(getClaudeNativeSubtype(args.options?.native)
            ? { nativeSubtype: getClaudeNativeSubtype(args.options?.native) }
            : {}),
        ...(getClaudeNativeMeta(args.options?.native)
            ? { nativeMeta: getClaudeNativeMeta(args.options?.native) }
            : {}),
        data: args.data,
    } as ClaudeProviderEvent;

    for (const handler of args.providerEventHandlers) {
        try {
            handler(event);
        } catch (error) {
            console.error(
                `Error in provider event handler for ${args.eventType}:`,
                error,
            );
        }
    }
}

export function registerClaudeProviderEventBridges(args: {
    on: <T extends EventType>(
        eventType: T,
        handler: (event: AgentEvent<T>) => void,
    ) => () => void;
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
}): void {
    const resolveProviderBridgeNativeSessionId = (
        event: AgentEvent<EventType>,
    ): string | undefined => {
        const data = event.data;
        if (
            typeof data === "object" &&
            data !== null &&
            !Array.isArray(data)
        ) {
            const nativeSessionId = (data as Record<string, unknown>)
                .nativeSessionId;
            if (typeof nativeSessionId === "string") {
                return nativeSessionId;
            }
        }
        return event.sessionId;
    };

    args.on("tool.start", (event) => {
        args.emitProviderEvent("tool.start", event.sessionId, {
            toolName: String((event.data as { toolName?: unknown }).toolName ?? "unknown"),
            toolInput: ((event.data as { toolInput?: Record<string, unknown> }).toolInput ?? {}) as Record<string, unknown>,
            toolUseId: (event.data as { toolUseID?: string; toolUseId?: string }).toolUseID
                ?? (event.data as { toolUseID?: string; toolUseId?: string }).toolUseId,
            parentToolCallId: (event.data as { parentToolCallId?: string; parentToolUseId?: string }).parentToolCallId
                ?? (event.data as { parentToolCallId?: string; parentToolUseId?: string }).parentToolUseId,
            parentAgentId: (event.data as { parentAgentId?: string }).parentAgentId,
        }, {
            native: event,
            nativeSessionId: resolveProviderBridgeNativeSessionId(event),
        });
    });

    args.on("tool.complete", (event) => {
        args.emitProviderEvent("tool.complete", event.sessionId, {
            toolName: String((event.data as { toolName?: unknown }).toolName ?? "unknown"),
            toolInput: (event.data as { toolInput?: Record<string, unknown> }).toolInput,
            toolResult: (event.data as { toolResult?: unknown }).toolResult,
            success: Boolean((event.data as { success?: unknown }).success),
            error: (event.data as { error?: string }).error,
            toolUseId: (event.data as { toolUseID?: string; toolUseId?: string }).toolUseID
                ?? (event.data as { toolUseID?: string; toolUseId?: string }).toolUseId,
            parentToolCallId: (event.data as { parentToolCallId?: string; parentToolUseId?: string }).parentToolCallId
                ?? (event.data as { parentToolCallId?: string; parentToolUseId?: string }).parentToolUseId,
            parentAgentId: (event.data as { parentAgentId?: string }).parentAgentId,
        }, {
            native: event,
            nativeSessionId: resolveProviderBridgeNativeSessionId(event),
        });
    });

    args.on("subagent.start", (event) => {
        args.emitProviderEvent("subagent.start", event.sessionId, {
            subagentId: String((event.data as { subagentId?: unknown }).subagentId ?? ""),
            subagentType: (event.data as { subagentType?: string }).subagentType,
            task: (event.data as { task?: string }).task,
            toolUseId: (event.data as { toolUseID?: string; toolUseId?: string }).toolUseID
                ?? (event.data as { toolUseID?: string; toolUseId?: string }).toolUseId,
            parentToolCallId: (event.data as { parentToolCallId?: string; parentToolUseId?: string }).parentToolCallId
                ?? (event.data as { parentToolCallId?: string; parentToolUseId?: string }).parentToolUseId,
            subagentSessionId: (event.data as { subagentSessionId?: string }).subagentSessionId,
        }, {
            native: event,
            nativeSessionId: resolveProviderBridgeNativeSessionId(event),
        });
    });

    args.on("subagent.update", (event) => {
        args.emitProviderEvent("subagent.update", event.sessionId, {
            subagentId: String((event.data as { subagentId?: unknown }).subagentId ?? ""),
            currentTool: (event.data as { currentTool?: string }).currentTool,
            toolUses: (event.data as { toolUses?: number }).toolUses,
        }, {
            native: event,
            nativeSessionId: resolveProviderBridgeNativeSessionId(event),
        });
    });

    args.on("subagent.complete", (event) => {
        args.emitProviderEvent("subagent.complete", event.sessionId, {
            subagentId: String((event.data as { subagentId?: unknown }).subagentId ?? ""),
            success: Boolean((event.data as { success?: unknown }).success),
            result: (event.data as { result?: unknown }).result,
        }, {
            native: event,
            nativeSessionId: resolveProviderBridgeNativeSessionId(event),
        });
    });

    args.on("permission.requested", (event) => {
        args.emitProviderEvent(
            "permission.requested",
            event.sessionId,
            event.data as ProviderStreamEventDataMap["permission.requested"],
            {
                native: event,
                nativeSessionId: event.sessionId,
            },
        );
    });

    args.on("skill.invoked", (event) => {
        args.emitProviderEvent("skill.invoked", event.sessionId, {
            skillName: String((event.data as { skillName?: unknown }).skillName ?? ""),
            skillPath: (event.data as { skillPath?: string }).skillPath,
        }, {
            native: event,
            nativeSessionId: event.sessionId,
        });
    });

    args.on("session.error", (event) => {
        args.emitProviderEvent("session.error", event.sessionId, {
            error: typeof (event.data as { error?: unknown }).error === "string"
                ? (event.data as { error: string }).error
                : String((event.data as { error?: unknown }).error ?? "Unknown error"),
            code: (event.data as { code?: string }).code,
        }, {
            native: event,
            nativeSessionId: event.sessionId,
        });
    });

    args.on("session.idle", (event) => {
        args.emitProviderEvent("session.idle", event.sessionId, {
            reason: (event.data as { reason?: string }).reason,
        }, {
            native: event,
            nativeSessionId: event.sessionId,
        });
    });

    args.on("session.compaction", (event) => {
        args.emitProviderEvent("session.compaction", event.sessionId, {
            phase: (event.data as { phase?: "start" | "complete" }).phase ?? "complete",
            success: (event.data as { success?: boolean }).success,
            error: (event.data as { error?: string }).error,
        }, {
            native: event,
            nativeSessionId: event.sessionId,
        });
    });

    args.on("usage", (event) => {
        args.emitProviderEvent("usage", event.sessionId, {
            inputTokens: Number((event.data as { inputTokens?: unknown }).inputTokens ?? 0),
            outputTokens: Number((event.data as { outputTokens?: unknown }).outputTokens ?? 0),
            model: (event.data as { model?: string }).model,
            cacheReadTokens: (event.data as { cacheReadTokens?: number }).cacheReadTokens,
            cacheWriteTokens: (event.data as { cacheWriteTokens?: number }).cacheWriteTokens,
            costUsd: (event.data as { costUsd?: number }).costUsd,
        }, {
            native: event,
            nativeSessionId: event.sessionId,
        });
    });
}

