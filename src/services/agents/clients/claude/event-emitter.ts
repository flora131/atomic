import type {
    AgentEvent,
    EventHandler,
    EventType,
} from "@/services/agents/types.ts";

export function emitClaudeEvent<T extends EventType>(args: {
    eventHandlers: Map<EventType, Set<EventHandler<EventType>>>;
    pendingToolBySession: Map<string, number>;
    pendingSubagentBySession: Map<string, number>;
    bumpStreamIntegrityCounter: (
        sessionId: string,
        counter:
            | "missingTerminalEvents"
            | "unmatchedToolStarts"
            | "unmatchedToolCompletes"
            | "unmatchedSubagentStarts"
            | "unmatchedSubagentCompletes",
        amount?: number,
    ) => number;
    eventType: T;
    sessionId: string;
    data: Record<string, unknown>;
}): void {
    const handlers = args.eventHandlers.get(args.eventType);

    if (args.eventType === "tool.start") {
        const active = args.pendingToolBySession.get(args.sessionId) ?? 0;
        args.pendingToolBySession.set(args.sessionId, active + 1);
    }

    if (args.eventType === "tool.complete") {
        const active = args.pendingToolBySession.get(args.sessionId) ?? 0;
        if (active === 0) {
            args.bumpStreamIntegrityCounter(
                args.sessionId,
                "unmatchedToolCompletes",
            );
        } else {
            args.pendingToolBySession.set(args.sessionId, active - 1);
        }
    }

    if (args.eventType === "subagent.start") {
        const active = args.pendingSubagentBySession.get(args.sessionId) ?? 0;
        args.pendingSubagentBySession.set(args.sessionId, active + 1);
    }

    if (args.eventType === "subagent.complete") {
        const active = args.pendingSubagentBySession.get(args.sessionId) ?? 0;
        if (active === 0) {
            args.bumpStreamIntegrityCounter(
                args.sessionId,
                "unmatchedSubagentCompletes",
            );
        } else {
            args.pendingSubagentBySession.set(args.sessionId, active - 1);
        }
    }

    if (!handlers) {
        return;
    }

    const event: AgentEvent<T> = {
        type: args.eventType,
        sessionId: args.sessionId,
        timestamp: new Date().toISOString(),
        data: args.data as AgentEvent<T>["data"],
    };

    for (const handler of handlers) {
        try {
            handler(event as AgentEvent<EventType>);
        } catch (error) {
            console.error(
                `Error in event handler for ${args.eventType}:`,
                error,
            );
        }
    }
}
