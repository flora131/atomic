import { describe, expect, test, mock, spyOn } from "bun:test";
import type { AgentEvent, EventType } from "@/services/agents/types.ts";
import type {
    ClaudeNativeEvent,
    ClaudeProviderEvent,
    ClaudeProviderEventHandler,
    ProviderStreamEventType,
} from "@/services/agents/provider-events.ts";
import {
    getClaudeNativeSubtype,
    getClaudeNativeMeta,
    emitClaudeProviderEvent,
    registerClaudeProviderEventBridges,
} from "@/services/agents/clients/claude/provider-bridge.ts";

// ---------------------------------------------------------------------------
// Shared helper type for the emitProviderEvent mock used in bridge tests
// ---------------------------------------------------------------------------
// We use a non-generic signature for the mock so that TypeScript can resolve
// `data` from `mock.calls[n]` as `Record<string, unknown>` instead of a
// union of every ProviderStreamEventDataMap value.  The `createMockEmit`
// helper casts the mock to the generic signature expected by the production
// code while keeping the non-generic mock calls accessible.
type EmitProviderEventMockFn = (
    eventType: ProviderStreamEventType,
    sessionId: string,
    data: Record<string, unknown>,
    options?: {
        native?: ClaudeNativeEvent;
        nativeEventId?: string;
        nativeSessionId?: string;
        timestamp?: number;
    },
) => void;

// ---------------------------------------------------------------------------
// getClaudeNativeSubtype
// ---------------------------------------------------------------------------
describe("getClaudeNativeSubtype", () => {
    test("returns undefined when native is undefined", () => {
        expect(getClaudeNativeSubtype(undefined)).toBeUndefined();
    });

    test("returns undefined when native has no subtype field", () => {
        const native = { type: "assistant" } as unknown as ClaudeNativeEvent;
        expect(getClaudeNativeSubtype(native)).toBeUndefined();
    });

    test("returns string subtype when present", () => {
        const native = {
            type: "assistant",
            subtype: "tool_use",
        } as unknown as ClaudeNativeEvent;
        expect(getClaudeNativeSubtype(native)).toBe("tool_use");
    });

    test("returns undefined when subtype is not a string (number)", () => {
        const native = {
            type: "assistant",
            subtype: 42,
        } as unknown as ClaudeNativeEvent;
        expect(getClaudeNativeSubtype(native)).toBeUndefined();
    });

    test("returns undefined when subtype is not a string (boolean)", () => {
        const native = {
            type: "assistant",
            subtype: true,
        } as unknown as ClaudeNativeEvent;
        expect(getClaudeNativeSubtype(native)).toBeUndefined();
    });

    test("returns undefined when subtype is null", () => {
        const native = {
            type: "assistant",
            subtype: null,
        } as unknown as ClaudeNativeEvent;
        expect(getClaudeNativeSubtype(native)).toBeUndefined();
    });

    test("returns empty string when subtype is an empty string", () => {
        const native = {
            type: "assistant",
            subtype: "",
        } as unknown as ClaudeNativeEvent;
        expect(getClaudeNativeSubtype(native)).toBe("");
    });
});

// ---------------------------------------------------------------------------
// getClaudeNativeMeta
// ---------------------------------------------------------------------------
describe("getClaudeNativeMeta", () => {
    test("returns undefined when native is undefined", () => {
        expect(getClaudeNativeMeta(undefined)).toBeUndefined();
    });

    test("returns undefined when native has no meta-relevant fields", () => {
        const native = { type: "assistant" } as unknown as ClaudeNativeEvent;
        expect(getClaudeNativeMeta(native)).toBeUndefined();
    });

    test("extracts session_id as nativeSessionId", () => {
        const native = {
            type: "assistant",
            session_id: "sess-123",
        } as unknown as ClaudeNativeEvent;
        const meta = getClaudeNativeMeta(native);
        expect(meta).toBeDefined();
        expect(meta!.nativeSessionId).toBe("sess-123");
    });

    test("extracts uuid as nativeMessageId", () => {
        const native = {
            type: "assistant",
            uuid: "msg-456",
        } as unknown as ClaudeNativeEvent;
        const meta = getClaudeNativeMeta(native);
        expect(meta).toBeDefined();
        expect(meta!.nativeMessageId).toBe("msg-456");
    });

    test("extracts parent_tool_use_id as parentToolCallId from SDK (string)", () => {
        const native = {
            type: "assistant",
            parent_tool_use_id: "tool-789",
        } as unknown as ClaudeNativeEvent;
        const meta = getClaudeNativeMeta(native);
        expect(meta).toBeDefined();
        expect(meta!.parentToolCallId).toBe("tool-789");
    });

    test("extracts parent_tool_use_id as parentToolCallId from SDK (null)", () => {
        const native = {
            type: "assistant",
            parent_tool_use_id: null,
        } as unknown as ClaudeNativeEvent;
        const meta = getClaudeNativeMeta(native);
        expect(meta).toBeDefined();
        expect(meta!.parentToolCallId).toBeNull();
    });

    test("sets parentToolCallId to undefined for non-string/non-null parent_tool_use_id", () => {
        const native = {
            type: "assistant",
            parent_tool_use_id: 42,
        } as unknown as ClaudeNativeEvent;
        const meta = getClaudeNativeMeta(native);
        expect(meta).toBeDefined();
        expect(meta!.parentToolCallId).toBeUndefined();
    });

    test("extracts tool_use_id as toolUseId", () => {
        const native = {
            type: "assistant",
            tool_use_id: "tu-abc",
        } as unknown as ClaudeNativeEvent;
        const meta = getClaudeNativeMeta(native);
        expect(meta).toBeDefined();
        expect(meta!.toolUseId).toBe("tu-abc");
    });

    test("extracts task_id as taskId", () => {
        const native = {
            type: "assistant",
            task_id: "task-def",
        } as unknown as ClaudeNativeEvent;
        const meta = getClaudeNativeMeta(native);
        expect(meta).toBeDefined();
        expect(meta!.taskId).toBe("task-def");
    });

    test("extracts hook_id as hookId", () => {
        const native = {
            type: "assistant",
            hook_id: "hook-ghi",
        } as unknown as ClaudeNativeEvent;
        const meta = getClaudeNativeMeta(native);
        expect(meta).toBeDefined();
        expect(meta!.hookId).toBe("hook-ghi");
    });

    test("extracts all meta fields when present", () => {
        const native = {
            type: "assistant",
            session_id: "sess-1",
            uuid: "msg-2",
            parent_tool_use_id: "ptuid-3",
            tool_use_id: "tuid-4",
            task_id: "tid-5",
            hook_id: "hid-6",
        } as unknown as ClaudeNativeEvent;
        const meta = getClaudeNativeMeta(native);
        expect(meta).toEqual({
            nativeSessionId: "sess-1",
            nativeMessageId: "msg-2",
            parentToolCallId: "ptuid-3",
            toolUseId: "tuid-4",
            taskId: "tid-5",
            hookId: "hid-6",
        });
    });

    test("ignores non-string session_id", () => {
        const native = {
            type: "assistant",
            session_id: 123,
        } as unknown as ClaudeNativeEvent;
        expect(getClaudeNativeMeta(native)).toBeUndefined();
    });

    test("ignores non-string uuid", () => {
        const native = {
            type: "assistant",
            uuid: 456,
        } as unknown as ClaudeNativeEvent;
        expect(getClaudeNativeMeta(native)).toBeUndefined();
    });

    test("ignores non-string tool_use_id", () => {
        const native = {
            type: "assistant",
            tool_use_id: true,
        } as unknown as ClaudeNativeEvent;
        expect(getClaudeNativeMeta(native)).toBeUndefined();
    });

    test("ignores non-string task_id", () => {
        const native = {
            type: "assistant",
            task_id: null,
        } as unknown as ClaudeNativeEvent;
        expect(getClaudeNativeMeta(native)).toBeUndefined();
    });

    test("ignores non-string hook_id", () => {
        const native = {
            type: "assistant",
            hook_id: 99,
        } as unknown as ClaudeNativeEvent;
        expect(getClaudeNativeMeta(native)).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// emitClaudeProviderEvent
// ---------------------------------------------------------------------------
describe("emitClaudeProviderEvent", () => {
    test("returns silently when there are no handlers", () => {
        // Should not throw
        emitClaudeProviderEvent({
            providerEventHandlers: new Set<ClaudeProviderEventHandler>(),
            eventType: "session.idle",
            sessionId: "sess-1",
            data: { reason: "done" },
        });
    });

    test("calls a single handler with the constructed event", () => {
        const handler = mock<ClaudeProviderEventHandler>(() => {});
        const handlers = new Set<ClaudeProviderEventHandler>([handler]);

        const nativeEvent = {
            type: "session.idle",
            synthetic: true,
            data: { reason: "done" },
        } as unknown as ClaudeNativeEvent;

        emitClaudeProviderEvent({
            providerEventHandlers: handlers,
            eventType: "session.idle",
            sessionId: "sess-abc",
            data: { reason: "idle-reason" },
            options: {
                native: nativeEvent,
                nativeSessionId: "native-sess",
                timestamp: 1000,
            },
        });

        expect(handler).toHaveBeenCalledTimes(1);
        const event = handler.mock.calls[0]![0] as ClaudeProviderEvent;
        expect(event.provider).toBe("claude");
        expect(event.type).toBe("session.idle");
        expect(event.sessionId).toBe("sess-abc");
        expect(event.timestamp).toBe(1000);
        expect(event.nativeSessionId).toBe("native-sess");
        expect(event.data).toEqual({ reason: "idle-reason" });
    });

    test("calls multiple handlers", () => {
        const handler1 = mock<ClaudeProviderEventHandler>(() => {});
        const handler2 = mock<ClaudeProviderEventHandler>(() => {});
        const handlers = new Set<ClaudeProviderEventHandler>([handler1, handler2]);

        emitClaudeProviderEvent({
            providerEventHandlers: handlers,
            eventType: "session.idle",
            sessionId: "sess-1",
            data: { reason: "test" },
            options: {
                native: {
                    type: "session.idle",
                    synthetic: true,
                    data: {},
                } as unknown as ClaudeNativeEvent,
            },
        });

        expect(handler1).toHaveBeenCalledTimes(1);
        expect(handler2).toHaveBeenCalledTimes(1);
    });

    test("catches handler errors without propagating them", () => {
        const consoleSpy = spyOn(console, "error").mockImplementation(() => {});
        const throwingHandler: ClaudeProviderEventHandler = () => {
            throw new Error("handler blew up");
        };
        const goodHandler = mock<ClaudeProviderEventHandler>(() => {});

        const handlers = new Set<ClaudeProviderEventHandler>([throwingHandler, goodHandler]);

        // Should not throw
        emitClaudeProviderEvent({
            providerEventHandlers: handlers,
            eventType: "session.idle",
            sessionId: "sess-1",
            data: { reason: "test" },
            options: {
                native: {
                    type: "session.idle",
                    synthetic: true,
                    data: {},
                } as unknown as ClaudeNativeEvent,
            },
        });

        expect(consoleSpy).toHaveBeenCalled();
        // The good handler should still be called even after the first handler throws
        expect(goodHandler).toHaveBeenCalledTimes(1);
        consoleSpy.mockRestore();
    });

    test("uses Date.now() as default timestamp when none provided", () => {
        const handler = mock<ClaudeProviderEventHandler>(() => {});
        const handlers = new Set<ClaudeProviderEventHandler>([handler]);

        const before = Date.now();
        emitClaudeProviderEvent({
            providerEventHandlers: handlers,
            eventType: "session.idle",
            sessionId: "sess-1",
            data: { reason: "test" },
            options: {
                native: {
                    type: "session.idle",
                    synthetic: true,
                    data: {},
                } as unknown as ClaudeNativeEvent,
            },
        });
        const after = Date.now();

        const event = handler.mock.calls[0]![0] as ClaudeProviderEvent;
        expect(event.timestamp).toBeGreaterThanOrEqual(before);
        expect(event.timestamp).toBeLessThanOrEqual(after);
    });

    test("includes nativeEventId when provided in options", () => {
        const handler = mock<ClaudeProviderEventHandler>(() => {});
        const handlers = new Set<ClaudeProviderEventHandler>([handler]);

        emitClaudeProviderEvent({
            providerEventHandlers: handlers,
            eventType: "session.idle",
            sessionId: "sess-1",
            data: { reason: "test" },
            options: {
                native: {
                    type: "session.idle",
                    synthetic: true,
                    data: {},
                } as unknown as ClaudeNativeEvent,
                nativeEventId: "evt-123",
            },
        });

        const event = handler.mock.calls[0]![0] as ClaudeProviderEvent;
        expect(event.nativeEventId).toBe("evt-123");
    });

    test("includes nativeSubtype from native event when present", () => {
        const handler = mock<ClaudeProviderEventHandler>(() => {});
        const handlers = new Set<ClaudeProviderEventHandler>([handler]);

        emitClaudeProviderEvent({
            providerEventHandlers: handlers,
            eventType: "session.idle",
            sessionId: "sess-1",
            data: { reason: "test" },
            options: {
                native: {
                    type: "session.idle",
                    subtype: "compaction",
                } as unknown as ClaudeNativeEvent,
            },
        });

        const event = handler.mock.calls[0]![0] as ClaudeProviderEvent;
        expect(event.nativeSubtype).toBe("compaction");
    });

    test("includes nativeMeta from native event when meta fields present", () => {
        const handler = mock<ClaudeProviderEventHandler>(() => {});
        const handlers = new Set<ClaudeProviderEventHandler>([handler]);

        emitClaudeProviderEvent({
            providerEventHandlers: handlers,
            eventType: "session.idle",
            sessionId: "sess-1",
            data: { reason: "test" },
            options: {
                native: {
                    type: "session.idle",
                    session_id: "native-sess-id",
                    uuid: "native-msg-id",
                } as unknown as ClaudeNativeEvent,
            },
        });

        const event = handler.mock.calls[0]![0] as ClaudeProviderEvent;
        expect(event.nativeMeta).toEqual({
            nativeSessionId: "native-sess-id",
            nativeMessageId: "native-msg-id",
        });
    });

    test("creates synthetic native event when no native option provided", () => {
        const handler = mock<ClaudeProviderEventHandler>(() => {});
        const handlers = new Set<ClaudeProviderEventHandler>([handler]);

        emitClaudeProviderEvent({
            providerEventHandlers: handlers,
            eventType: "session.idle",
            sessionId: "sess-1",
            data: { reason: "synthetic-test" },
        });

        const event = handler.mock.calls[0]![0] as ClaudeProviderEvent;
        expect(event.native).toEqual({
            type: "session.idle",
            synthetic: true,
            data: { reason: "synthetic-test" },
        });
        // nativeType falls back to eventType when no native
        expect(event.nativeType).toBe("session.idle");
    });

    test("uses native.type as nativeType when native is provided", () => {
        const handler = mock<ClaudeProviderEventHandler>(() => {});
        const handlers = new Set<ClaudeProviderEventHandler>([handler]);

        emitClaudeProviderEvent({
            providerEventHandlers: handlers,
            eventType: "session.idle",
            sessionId: "sess-1",
            data: { reason: "test" },
            options: {
                native: {
                    type: "result",
                } as unknown as ClaudeNativeEvent,
            },
        });

        const event = handler.mock.calls[0]![0] as ClaudeProviderEvent;
        expect(event.nativeType).toBe("result");
    });
});

// ---------------------------------------------------------------------------
// registerClaudeProviderEventBridges
// ---------------------------------------------------------------------------
describe("registerClaudeProviderEventBridges", () => {
    function createMockOn() {
        const registeredHandlers = new Map<
            string,
            Array<(event: AgentEvent<EventType>) => void>
        >();
        const on = mock(
            <T extends EventType>(
                eventType: T,
                handler: (event: AgentEvent<T>) => void,
            ): (() => void) => {
                const existing = registeredHandlers.get(eventType) ?? [];
                existing.push(handler as (event: AgentEvent<EventType>) => void);
                registeredHandlers.set(eventType, existing);
                return () => {};
            },
        );
        return { on, registeredHandlers };
    }

    function createMockEmit() {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fn = mock<EmitProviderEventMockFn>(() => {}) as any;
        return fn as ReturnType<typeof mock<EmitProviderEventMockFn>> & {
            // Allow the mock to be passed to registerClaudeProviderEventBridges
            (...args: Parameters<Parameters<typeof registerClaudeProviderEventBridges>[0]["emitProviderEvent"]>): void;
        };
    }

    function makeEvent<T extends EventType>(
        type: T,
        sessionId: string,
        data: Record<string, unknown>,
    ): AgentEvent<T> {
        return {
            type,
            sessionId,
            timestamp: new Date().toISOString(),
            data,
        } as AgentEvent<T>;
    }

    function simulateEvent<T extends EventType>(
        registeredHandlers: Map<string, Array<(event: AgentEvent<EventType>) => void>>,
        eventType: T,
        event: AgentEvent<T>,
    ) {
        const handlers = registeredHandlers.get(eventType);
        if (handlers) {
            for (const h of handlers) {
                h(event as AgentEvent<EventType>);
            }
        }
    }

    // -- tool.start --
    describe("tool.start bridge", () => {
        test("emits provider tool.start event with correct data mapping", () => {
            const { on, registeredHandlers } = createMockOn();
            const emitProviderEvent = createMockEmit();

            registerClaudeProviderEventBridges({ on, emitProviderEvent });

            const event = makeEvent("tool.start", "sess-1", {
                toolName: "Bash",
                toolInput: { command: "ls" },
                toolUseID: "tuid-1",
                parentToolCallId: "ptuid-1",
                parentAgentId: "agent-1",
            });

            simulateEvent(registeredHandlers, "tool.start", event);

            expect(emitProviderEvent).toHaveBeenCalledTimes(1);
            const [type, sid, data, opts] = emitProviderEvent.mock.calls[0]!;
            expect(type).toBe("tool.start");
            expect(sid).toBe("sess-1");
            expect(data.toolName).toBe("Bash");
            expect(data.toolInput).toEqual({ command: "ls" });
            expect(data.toolUseId).toBe("tuid-1");
            expect(data.parentToolCallId).toBe("ptuid-1");
            expect(data.parentAgentId).toBe("agent-1");
            expect(opts!.native).toBe(event);
        });

        test("falls back toolUseId to toolUseId field when toolUseID missing", () => {
            const { on, registeredHandlers } = createMockOn();
            const emitProviderEvent = createMockEmit();

            registerClaudeProviderEventBridges({ on, emitProviderEvent });

            const event = makeEvent("tool.start", "sess-1", {
                toolName: "Read",
                toolInput: {},
                toolUseId: "fallback-id",
            });

            simulateEvent(registeredHandlers, "tool.start", event);

            const [, , data] = emitProviderEvent.mock.calls[0]!;
            expect(data.toolUseId).toBe("fallback-id");
        });

        test("defaults toolName to 'unknown' when missing", () => {
            const { on, registeredHandlers } = createMockOn();
            const emitProviderEvent = createMockEmit();

            registerClaudeProviderEventBridges({ on, emitProviderEvent });

            const event = makeEvent("tool.start", "sess-1", {});

            simulateEvent(registeredHandlers, "tool.start", event);

            const [, , data] = emitProviderEvent.mock.calls[0]!;
            expect(data.toolName).toBe("unknown");
        });

        test("defaults toolInput to empty object when missing", () => {
            const { on, registeredHandlers } = createMockOn();
            const emitProviderEvent = createMockEmit();

            registerClaudeProviderEventBridges({ on, emitProviderEvent });

            const event = makeEvent("tool.start", "sess-1", {});

            simulateEvent(registeredHandlers, "tool.start", event);

            const [, , data] = emitProviderEvent.mock.calls[0]!;
            expect(data.toolInput).toEqual({});
        });
    });

    // -- tool.complete --
    describe("tool.complete bridge", () => {
        test("emits provider tool.complete event with correct data mapping", () => {
            const { on, registeredHandlers } = createMockOn();
            const emitProviderEvent = createMockEmit();

            registerClaudeProviderEventBridges({ on, emitProviderEvent });

            const event = makeEvent("tool.complete", "sess-2", {
                toolName: "Bash",
                toolInput: { command: "echo hello" },
                toolResult: "hello\n",
                success: true,
                error: undefined,
                toolUseID: "tuid-2",
                parentToolCallId: "ptuid-2",
                parentAgentId: "agent-2",
            });

            simulateEvent(registeredHandlers, "tool.complete", event);

            expect(emitProviderEvent).toHaveBeenCalledTimes(1);
            const [type, sid, data, opts] = emitProviderEvent.mock.calls[0]!;
            expect(type).toBe("tool.complete");
            expect(sid).toBe("sess-2");
            expect(data.toolName).toBe("Bash");
            expect(data.toolInput).toEqual({ command: "echo hello" });
            expect(data.toolResult).toBe("hello\n");
            expect(data.success).toBe(true);
            expect(data.error).toBeUndefined();
            expect(data.toolUseId).toBe("tuid-2");
            expect(data.parentToolCallId).toBe("ptuid-2");
            expect(data.parentAgentId).toBe("agent-2");
            expect(opts!.native).toBe(event);
        });

        test("success defaults to false when missing", () => {
            const { on, registeredHandlers } = createMockOn();
            const emitProviderEvent = createMockEmit();

            registerClaudeProviderEventBridges({ on, emitProviderEvent });

            const event = makeEvent("tool.complete", "sess-2", {
                toolName: "Bash",
            });

            simulateEvent(registeredHandlers, "tool.complete", event);

            const [, , data] = emitProviderEvent.mock.calls[0]!;
            expect(data.success).toBe(false);
        });
    });

    // -- subagent.start --
    describe("subagent.start bridge", () => {
        test("emits provider subagent.start event with correct data mapping", () => {
            const { on, registeredHandlers } = createMockOn();
            const emitProviderEvent = createMockEmit();

            registerClaudeProviderEventBridges({ on, emitProviderEvent });

            const event = makeEvent("subagent.start", "sess-3", {
                subagentId: "sub-1",
                subagentType: "worker",
                task: "implement feature",
                toolUseID: "tuid-3",
                parentToolCallId: "ptuid-3",
                subagentSessionId: "sub-sess-1",
            });

            simulateEvent(registeredHandlers, "subagent.start", event);

            expect(emitProviderEvent).toHaveBeenCalledTimes(1);
            const [type, sid, data] = emitProviderEvent.mock.calls[0]!;
            expect(type).toBe("subagent.start");
            expect(sid).toBe("sess-3");
            expect(data.subagentId).toBe("sub-1");
            expect(data.subagentType).toBe("worker");
            expect(data.task).toBe("implement feature");
            expect(data.toolUseId).toBe("tuid-3");
            expect(data.parentToolCallId).toBe("ptuid-3");
            expect(data.subagentSessionId).toBe("sub-sess-1");
        });

        test("defaults subagentId to empty string when missing", () => {
            const { on, registeredHandlers } = createMockOn();
            const emitProviderEvent = createMockEmit();

            registerClaudeProviderEventBridges({ on, emitProviderEvent });

            const event = makeEvent("subagent.start", "sess-3", {});

            simulateEvent(registeredHandlers, "subagent.start", event);

            const [, , data] = emitProviderEvent.mock.calls[0]!;
            expect(data.subagentId).toBe("");
        });
    });

    // -- subagent.update --
    describe("subagent.update bridge", () => {
        test("emits provider subagent.update event with correct data mapping", () => {
            const { on, registeredHandlers } = createMockOn();
            const emitProviderEvent = createMockEmit();

            registerClaudeProviderEventBridges({ on, emitProviderEvent });

            const event = makeEvent("subagent.update", "sess-4", {
                subagentId: "sub-2",
                currentTool: "Read",
                toolUses: 5,
            });

            simulateEvent(registeredHandlers, "subagent.update", event);

            expect(emitProviderEvent).toHaveBeenCalledTimes(1);
            const [type, sid, data] = emitProviderEvent.mock.calls[0]!;
            expect(type).toBe("subagent.update");
            expect(sid).toBe("sess-4");
            expect(data.subagentId).toBe("sub-2");
            expect(data.currentTool).toBe("Read");
            expect(data.toolUses).toBe(5);
        });
    });

    // -- subagent.complete --
    describe("subagent.complete bridge", () => {
        test("emits provider subagent.complete event with correct data mapping", () => {
            const { on, registeredHandlers } = createMockOn();
            const emitProviderEvent = createMockEmit();

            registerClaudeProviderEventBridges({ on, emitProviderEvent });

            const event = makeEvent("subagent.complete", "sess-5", {
                subagentId: "sub-3",
                success: true,
                result: "task completed",
            });

            simulateEvent(registeredHandlers, "subagent.complete", event);

            expect(emitProviderEvent).toHaveBeenCalledTimes(1);
            const [type, sid, data] = emitProviderEvent.mock.calls[0]!;
            expect(type).toBe("subagent.complete");
            expect(sid).toBe("sess-5");
            expect(data.subagentId).toBe("sub-3");
            expect(data.success).toBe(true);
            expect(data.result).toBe("task completed");
        });

        test("defaults success to false when missing", () => {
            const { on, registeredHandlers } = createMockOn();
            const emitProviderEvent = createMockEmit();

            registerClaudeProviderEventBridges({ on, emitProviderEvent });

            const event = makeEvent("subagent.complete", "sess-5", {
                subagentId: "sub-4",
            });

            simulateEvent(registeredHandlers, "subagent.complete", event);

            const [, , data] = emitProviderEvent.mock.calls[0]!;
            expect(data.success).toBe(false);
        });
    });

    // -- permission.requested --
    describe("permission.requested bridge", () => {
        test("emits provider permission.requested event with data pass-through", () => {
            const { on, registeredHandlers } = createMockOn();
            const emitProviderEvent = createMockEmit();

            registerClaudeProviderEventBridges({ on, emitProviderEvent });

            const permData = {
                requestId: "req-1",
                toolName: "Bash",
                toolInput: { command: "rm -rf /" },
                question: "Allow dangerous command?",
                header: "Permission needed",
                options: [{ label: "Allow", value: "allow" }],
                multiSelect: false,
            };
            const event = makeEvent("permission.requested", "sess-6", permData);

            simulateEvent(registeredHandlers, "permission.requested", event);

            expect(emitProviderEvent).toHaveBeenCalledTimes(1);
            const [type, sid, data, opts] = emitProviderEvent.mock.calls[0]!;
            expect(type).toBe("permission.requested");
            expect(sid).toBe("sess-6");
            // Data is passed through as-is
            expect(data).toEqual(permData);
            expect(opts!.nativeSessionId).toBe("sess-6");
        });
    });

    // -- skill.invoked --
    describe("skill.invoked bridge", () => {
        test("emits provider skill.invoked event with correct data mapping", () => {
            const { on, registeredHandlers } = createMockOn();
            const emitProviderEvent = createMockEmit();

            registerClaudeProviderEventBridges({ on, emitProviderEvent });

            const event = makeEvent("skill.invoked", "sess-7", {
                skillName: "commit",
                skillPath: "/skills/commit",
            });

            simulateEvent(registeredHandlers, "skill.invoked", event);

            expect(emitProviderEvent).toHaveBeenCalledTimes(1);
            const [type, sid, data, opts] = emitProviderEvent.mock.calls[0]!;
            expect(type).toBe("skill.invoked");
            expect(sid).toBe("sess-7");
            expect(data.skillName).toBe("commit");
            expect(data.skillPath).toBe("/skills/commit");
            expect(opts!.nativeSessionId).toBe("sess-7");
        });

        test("defaults skillName to empty string when missing", () => {
            const { on, registeredHandlers } = createMockOn();
            const emitProviderEvent = createMockEmit();

            registerClaudeProviderEventBridges({ on, emitProviderEvent });

            const event = makeEvent("skill.invoked", "sess-7", {});

            simulateEvent(registeredHandlers, "skill.invoked", event);

            const [, , data] = emitProviderEvent.mock.calls[0]!;
            expect(data.skillName).toBe("");
        });
    });

    // -- session.error --
    describe("session.error bridge", () => {
        test("emits provider session.error event with string error", () => {
            const { on, registeredHandlers } = createMockOn();
            const emitProviderEvent = createMockEmit();

            registerClaudeProviderEventBridges({ on, emitProviderEvent });

            const event = makeEvent("session.error", "sess-8", {
                error: "Connection failed",
                code: "ECONNREFUSED",
            });

            simulateEvent(registeredHandlers, "session.error", event);

            expect(emitProviderEvent).toHaveBeenCalledTimes(1);
            const [type, sid, data, opts] = emitProviderEvent.mock.calls[0]!;
            expect(type).toBe("session.error");
            expect(sid).toBe("sess-8");
            expect(data.error).toBe("Connection failed");
            expect(data.code).toBe("ECONNREFUSED");
            expect(opts!.nativeSessionId).toBe("sess-8");
        });

        test("stringifies non-string error", () => {
            const { on, registeredHandlers } = createMockOn();
            const emitProviderEvent = createMockEmit();

            registerClaudeProviderEventBridges({ on, emitProviderEvent });

            const event = makeEvent("session.error", "sess-8", {
                error: 404,
            });

            simulateEvent(registeredHandlers, "session.error", event);

            const [, , data] = emitProviderEvent.mock.calls[0]!;
            expect(data.error).toBe("404");
        });

        test("defaults error to 'Unknown error' when missing", () => {
            const { on, registeredHandlers } = createMockOn();
            const emitProviderEvent = createMockEmit();

            registerClaudeProviderEventBridges({ on, emitProviderEvent });

            const event = makeEvent("session.error", "sess-8", {});

            simulateEvent(registeredHandlers, "session.error", event);

            const [, , data] = emitProviderEvent.mock.calls[0]!;
            expect(data.error).toBe("Unknown error");
        });
    });

    // -- session.idle --
    describe("session.idle bridge", () => {
        test("emits provider session.idle event with correct data mapping", () => {
            const { on, registeredHandlers } = createMockOn();
            const emitProviderEvent = createMockEmit();

            registerClaudeProviderEventBridges({ on, emitProviderEvent });

            const event = makeEvent("session.idle", "sess-9", {
                reason: "waiting for input",
            });

            simulateEvent(registeredHandlers, "session.idle", event);

            expect(emitProviderEvent).toHaveBeenCalledTimes(1);
            const [type, sid, data, opts] = emitProviderEvent.mock.calls[0]!;
            expect(type).toBe("session.idle");
            expect(sid).toBe("sess-9");
            expect(data.reason).toBe("waiting for input");
            expect(opts!.nativeSessionId).toBe("sess-9");
        });
    });

    // -- session.compaction --
    describe("session.compaction bridge", () => {
        test("emits provider session.compaction event with correct data mapping", () => {
            const { on, registeredHandlers } = createMockOn();
            const emitProviderEvent = createMockEmit();

            registerClaudeProviderEventBridges({ on, emitProviderEvent });

            const event = makeEvent("session.compaction", "sess-10", {
                phase: "start",
                success: undefined,
                error: undefined,
            });

            simulateEvent(registeredHandlers, "session.compaction", event);

            expect(emitProviderEvent).toHaveBeenCalledTimes(1);
            const [type, sid, data, opts] = emitProviderEvent.mock.calls[0]!;
            expect(type).toBe("session.compaction");
            expect(sid).toBe("sess-10");
            expect(data.phase).toBe("start");
            expect(opts!.nativeSessionId).toBe("sess-10");
        });

        test("defaults phase to 'complete' when missing", () => {
            const { on, registeredHandlers } = createMockOn();
            const emitProviderEvent = createMockEmit();

            registerClaudeProviderEventBridges({ on, emitProviderEvent });

            const event = makeEvent("session.compaction", "sess-10", {});

            simulateEvent(registeredHandlers, "session.compaction", event);

            const [, , data] = emitProviderEvent.mock.calls[0]!;
            expect(data.phase).toBe("complete");
        });

        test("passes success and error fields through", () => {
            const { on, registeredHandlers } = createMockOn();
            const emitProviderEvent = createMockEmit();

            registerClaudeProviderEventBridges({ on, emitProviderEvent });

            const event = makeEvent("session.compaction", "sess-10", {
                phase: "complete",
                success: false,
                error: "compaction failed",
            });

            simulateEvent(registeredHandlers, "session.compaction", event);

            const [, , data] = emitProviderEvent.mock.calls[0]!;
            expect(data.success).toBe(false);
            expect(data.error).toBe("compaction failed");
        });
    });

    // -- usage --
    describe("usage bridge", () => {
        test("emits provider usage event with correct data mapping", () => {
            const { on, registeredHandlers } = createMockOn();
            const emitProviderEvent = createMockEmit();

            registerClaudeProviderEventBridges({ on, emitProviderEvent });

            const event = makeEvent("usage", "sess-11", {
                inputTokens: 100,
                outputTokens: 200,
                model: "claude-opus-4",
                cacheReadTokens: 50,
                cacheWriteTokens: 25,
                costUsd: 0.05,
            });

            simulateEvent(registeredHandlers, "usage", event);

            expect(emitProviderEvent).toHaveBeenCalledTimes(1);
            const [type, sid, data, opts] = emitProviderEvent.mock.calls[0]!;
            expect(type).toBe("usage");
            expect(sid).toBe("sess-11");
            expect(data.inputTokens).toBe(100);
            expect(data.outputTokens).toBe(200);
            expect(data.model).toBe("claude-opus-4");
            expect(data.cacheReadTokens).toBe(50);
            expect(data.cacheWriteTokens).toBe(25);
            expect(data.costUsd).toBe(0.05);
            expect(opts!.nativeSessionId).toBe("sess-11");
        });

        test("defaults token counts to 0 when missing", () => {
            const { on, registeredHandlers } = createMockOn();
            const emitProviderEvent = createMockEmit();

            registerClaudeProviderEventBridges({ on, emitProviderEvent });

            const event = makeEvent("usage", "sess-11", {});

            simulateEvent(registeredHandlers, "usage", event);

            const [, , data] = emitProviderEvent.mock.calls[0]!;
            expect(data.inputTokens).toBe(0);
            expect(data.outputTokens).toBe(0);
        });
    });

    // -- nativeSessionId resolution --
    describe("nativeSessionId resolution", () => {
        test("resolves nativeSessionId from event data when present", () => {
            const { on, registeredHandlers } = createMockOn();
            const emitProviderEvent = createMockEmit();

            registerClaudeProviderEventBridges({ on, emitProviderEvent });

            const event = makeEvent("tool.start", "sess-outer", {
                toolName: "Bash",
                nativeSessionId: "native-inner-sess",
            });

            simulateEvent(registeredHandlers, "tool.start", event);

            const [, , , opts] = emitProviderEvent.mock.calls[0]!;
            expect(opts!.nativeSessionId).toBe("native-inner-sess");
        });

        test("falls back to event.sessionId when data has no nativeSessionId", () => {
            const { on, registeredHandlers } = createMockOn();
            const emitProviderEvent = createMockEmit();

            registerClaudeProviderEventBridges({ on, emitProviderEvent });

            const event = makeEvent("tool.start", "sess-outer", {
                toolName: "Bash",
            });

            simulateEvent(registeredHandlers, "tool.start", event);

            const [, , , opts] = emitProviderEvent.mock.calls[0]!;
            expect(opts!.nativeSessionId).toBe("sess-outer");
        });

        test("falls back to event.sessionId when data.nativeSessionId is not a string", () => {
            const { on, registeredHandlers } = createMockOn();
            const emitProviderEvent = createMockEmit();

            registerClaudeProviderEventBridges({ on, emitProviderEvent });

            const event = makeEvent("tool.start", "sess-outer", {
                toolName: "Bash",
                nativeSessionId: 12345,
            });

            simulateEvent(registeredHandlers, "tool.start", event);

            const [, , , opts] = emitProviderEvent.mock.calls[0]!;
            expect(opts!.nativeSessionId).toBe("sess-outer");
        });
    });

    // -- registration coverage --
    describe("registers all expected event types", () => {
        test("registers handlers for all 11 bridged event types", () => {
            const { on } = createMockOn();
            const emitProviderEvent = createMockEmit();

            registerClaudeProviderEventBridges({ on, emitProviderEvent });

            const registeredTypes = on.mock.calls.map(
                (call) => call[0],
            );

            expect(registeredTypes).toContain("tool.start");
            expect(registeredTypes).toContain("tool.complete");
            expect(registeredTypes).toContain("subagent.start");
            expect(registeredTypes).toContain("subagent.update");
            expect(registeredTypes).toContain("subagent.complete");
            expect(registeredTypes).toContain("permission.requested");
            expect(registeredTypes).toContain("skill.invoked");
            expect(registeredTypes).toContain("session.error");
            expect(registeredTypes).toContain("session.idle");
            expect(registeredTypes).toContain("session.compaction");
            expect(registeredTypes).toContain("usage");
            expect(registeredTypes).toHaveLength(11);
        });
    });
});
