import { describe, expect, test, beforeEach } from "bun:test";
import "@/services/events/registry/index.ts";
import {
  EventHandlerRegistry,
  getEventHandlerRegistry,
  setEventHandlerRegistry,
} from "@/services/events/registry/registry.ts";
import {
  interactionRegistrations,
  sessionLifecycleRegistrations,
  turnLifecycleRegistrations,
  workflowStepRegistrations,
  workflowTaskRegistrations,
} from "@/services/events/registry/handlers/index.ts";
import { BusEventSchemas, type BusEvent, type BusEventDataMap, type BusEventType, type EnrichedBusEvent } from "@/services/events/bus-events/index.ts";
import type { StreamPartContext } from "@/services/events/registry/types.ts";
import type { StreamPartEvent } from "@/state/streaming/pipeline-types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent<T extends BusEventType>(
  type: T,
  data: BusEvent<T>["data"],
): BusEvent<T> {
  return {
    type,
    sessionId: "test-session",
    runId: 1,
    timestamp: Date.now(),
    data,
  };
}

function makeEnrichedEvent<T extends BusEventType>(
  type: T,
  data: BusEvent<T>["data"],
): EnrichedBusEvent & { type: T } {
  return {
    ...makeEvent(type, data),
  } as EnrichedBusEvent & { type: T };
}

const stubContext: StreamPartContext = {
  filterDelta: (delta: string) => delta,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EventHandlerRegistry", () => {
  let registry: EventHandlerRegistry;

  beforeEach(() => {
    registry = new EventHandlerRegistry();
  });

  // ── register / has ──────────────────────────────────────────────────────

  describe("register", () => {
    test("registers a descriptor and reports it via has()", () => {
      registry.register("stream.text.delta", {});
      expect(registry.has("stream.text.delta")).toBe(true);
    });

    test("throws on duplicate registration", () => {
      registry.register("stream.text.delta", {});
      expect(() => registry.register("stream.text.delta", {})).toThrow(
        'duplicate registration for "stream.text.delta"',
      );
    });

    test("has() returns false for unregistered types", () => {
      expect(registry.has("stream.text.delta")).toBe(false);
    });
  });

  // ── registerBatch ───────────────────────────────────────────────────────

  describe("registerBatch", () => {
    test("registers multiple event types at once", () => {
      registry.registerBatch([
        { eventType: "stream.text.delta", descriptor: {} },
        { eventType: "stream.text.complete", descriptor: {} },
      ]);

      expect(registry.has("stream.text.delta")).toBe(true);
      expect(registry.has("stream.text.complete")).toBe(true);
    });

    test("throws if any type in the batch is a duplicate", () => {
      registry.register("stream.text.delta", {});
      expect(() =>
        registry.registerBatch([
          { eventType: "stream.text.complete", descriptor: {} },
          { eventType: "stream.text.delta", descriptor: {} },
        ]),
      ).toThrow('duplicate registration for "stream.text.delta"');

      expect(registry.has("stream.text.complete")).toBe(false);
    });

    test("throws when the batch itself contains duplicate event types", () => {
      expect(() =>
        registry.registerBatch([
          { eventType: "stream.text.delta", descriptor: {} },
          { eventType: "stream.text.delta", descriptor: {} },
        ]),
      ).toThrow('duplicate registration for "stream.text.delta"');

      expect(registry.has("stream.text.delta")).toBe(false);
    });
  });

  // ── getCoalescingKeyFn ──────────────────────────────────────────────────

  describe("getCoalescingKeyFn", () => {
    test("returns undefined when no descriptor is registered", () => {
      expect(registry.getCoalescingKeyFn("stream.text.delta")).toBeUndefined();
    });

    test("returns undefined when descriptor has no coalescingKey", () => {
      registry.register("stream.text.delta", {});
      expect(registry.getCoalescingKeyFn("stream.text.delta")).toBeUndefined();
    });

    test("returns the registered coalescing key function", () => {
      registry.register("stream.tool.start", {
        coalescingKey: (event) => `tool.start:${event.data.toolId}`,
      });

      const fn = registry.getCoalescingKeyFn("stream.tool.start");
      expect(fn).toBeDefined();

      const event = makeEvent("stream.tool.start", {
        toolId: "t-1",
        toolName: "bash",
        toolInput: {},
      });
      expect(fn!(event)).toBe("tool.start:t-1");
    });
  });

  // ── getStreamPartMapper ─────────────────────────────────────────────────

  describe("getStreamPartMapper", () => {
    test("returns undefined when no descriptor is registered", () => {
      expect(registry.getStreamPartMapper("stream.text.delta")).toBeUndefined();
    });

    test("returns undefined when descriptor has no toStreamPart", () => {
      registry.register("stream.text.delta", {});
      expect(registry.getStreamPartMapper("stream.text.delta")).toBeUndefined();
    });

    test("returns the registered mapper that produces a single event", () => {
      registry.register("stream.text.delta", {
        toStreamPart: (event, ctx) => {
          const data = event.data as BusEventDataMap["stream.text.delta"];
          const filtered = ctx.filterDelta(data.delta);
          if (!filtered) return null;
          return { type: "text-delta", runId: event.runId, delta: filtered };
        },
      });

      const mapper = registry.getStreamPartMapper("stream.text.delta");
      expect(mapper).toBeDefined();

      const event = makeEnrichedEvent("stream.text.delta", {
        delta: "hello",
        messageId: "m-1",
      });
      const result = mapper!(event, stubContext);
      expect(result).toEqual({
        type: "text-delta",
        runId: 1,
        delta: "hello",
      });
    });

    test("mapper can return null to suppress an event", () => {
      registry.register("stream.session.start", {
        toStreamPart: () => null,
      });

      const mapper = registry.getStreamPartMapper("stream.session.start");
      const event = makeEnrichedEvent("stream.session.start", {});
      expect(mapper!(event, stubContext)).toBeNull();
    });

    test("mapper can return an array of events", () => {
      registry.register("workflow.task.update", {
        toStreamPart: (event) => {
          const result: StreamPartEvent[] = [
            { type: "task-list-update", runId: event.runId, tasks: [] },
          ];
          return result;
        },
      });

      const mapper = registry.getStreamPartMapper("workflow.task.update");
      const event = makeEnrichedEvent("workflow.task.update", {
        workflowId: "wf-1",
        tasks: [],
      });
      const result = mapper!(event, stubContext);
      expect(Array.isArray(result)).toBe(true);
      expect((result as StreamPartEvent[]).length).toBe(1);
    });
  });

  // ── getStalePredicate ───────────────────────────────────────────────────

  describe("getStalePredicate", () => {
    test("returns undefined when no descriptor is registered", () => {
      expect(registry.getStalePredicate("stream.text.delta")).toBeUndefined();
    });

    test("returns undefined when descriptor has no isStale", () => {
      registry.register("stream.text.delta", {});
      expect(registry.getStalePredicate("stream.text.delta")).toBeUndefined();
    });

    test("returns the registered stale predicate", () => {
      registry.register("stream.text.complete", {
        isStale: (event, latest) => event.timestamp < latest.timestamp,
      });

      const pred = registry.getStalePredicate("stream.text.complete");
      expect(pred).toBeDefined();

      const older = makeEvent("stream.text.complete", {
        messageId: "m-1",
        fullText: "old",
      });
      older.timestamp = 100;

      const newer = makeEvent("stream.text.complete", {
        messageId: "m-1",
        fullText: "new",
      });
      newer.timestamp = 200;

      expect(pred!(older, newer)).toBe(true);
      expect(pred!(newer, older)).toBe(false);
    });
  });

  // ── stale key lookups ───────────────────────────────────────────────────

  describe("stale key lookups", () => {
    test("returns the registered stale key function", () => {
      registry.register("stream.text.delta", {
        staleKey: (event) => `text.delta:${event.sessionId}:${event.data.messageId}`,
      });

      const fn = registry.getStaleKeyFn("stream.text.delta");
      expect(fn).toBeDefined();

      expect(fn!(makeEvent("stream.text.delta", {
        delta: "hello",
        messageId: "m-1",
      }))).toBe("text.delta:test-session:m-1");
    });

    test("returns the registered superseding stale key function", () => {
      registry.register("stream.text.complete", {
        supersedesStaleKey: (event) => `text.delta:${event.sessionId}:${event.data.messageId}`,
      });

      const fn = registry.getSupersedingStaleKeyFn("stream.text.complete");
      expect(fn).toBeDefined();

      expect(fn!(makeEvent("stream.text.complete", {
        messageId: "m-1",
        fullText: "done",
      }))).toBe("text.delta:test-session:m-1");
    });
  });

  // ── getUnregisteredTypes ────────────────────────────────────────────────

  describe("getUnregisteredTypes", () => {
    test("returns all types when registry is empty", () => {
      const allTypes: BusEventType[] = [
        "stream.text.delta",
        "stream.tool.start",
        "stream.session.start",
      ];
      expect(registry.getUnregisteredTypes(allTypes)).toEqual(allTypes);
    });

    test("returns only unregistered types", () => {
      registry.register("stream.text.delta", {});
      registry.register("stream.session.start", {});

      const allTypes: BusEventType[] = [
        "stream.text.delta",
        "stream.tool.start",
        "stream.session.start",
      ];
      expect(registry.getUnregisteredTypes(allTypes)).toEqual([
        "stream.tool.start",
      ]);
    });

    test("returns empty array when all types are registered", () => {
      registry.register("stream.text.delta", {});
      registry.register("stream.tool.start", {});

      const allTypes: BusEventType[] = [
        "stream.text.delta",
        "stream.tool.start",
      ];
      expect(registry.getUnregisteredTypes(allTypes)).toEqual([]);
    });
  });

  // ── getRegisteredTypes ──────────────────────────────────────────────────

  describe("getRegisteredTypes", () => {
    test("returns empty array when registry is empty", () => {
      expect(registry.getRegisteredTypes()).toEqual([]);
    });

    test("returns all registered types", () => {
      registry.register("stream.text.delta", {});
      registry.register("stream.tool.start", {});

      const registered = registry.getRegisteredTypes();
      expect(registered).toContain("stream.text.delta");
      expect(registered).toContain("stream.tool.start");
      expect(registered.length).toBe(2);
    });
  });

  // ── clear ───────────────────────────────────────────────────────────────

  describe("clear", () => {
    test("removes all registered handlers", () => {
      registry.register("stream.text.delta", {});
      registry.register("stream.tool.start", {});
      expect(registry.getRegisteredTypes().length).toBe(2);

      registry.clear();

      expect(registry.has("stream.text.delta")).toBe(false);
      expect(registry.has("stream.tool.start")).toBe(false);
      expect(registry.getRegisteredTypes().length).toBe(0);
    });

    test("allows re-registration after clear", () => {
      registry.register("stream.text.delta", {});
      registry.clear();
      registry.register("stream.text.delta", {});
      expect(registry.has("stream.text.delta")).toBe(true);
    });
  });
});

// ── Singleton ─────────────────────────────────────────────────────────────

describe("EventHandlerRegistry singleton", () => {
  test("getEventHandlerRegistry returns the same instance", () => {
    const a = getEventHandlerRegistry();
    const b = getEventHandlerRegistry();
    expect(a).toBe(b);
  });

  test("registry barrel eagerly registers implemented handler modules", () => {
    const registry = getEventHandlerRegistry();

    expect(registry.has("stream.agent.start")).toBe(true);
    expect(registry.has("stream.session.info")).toBe(true);
    expect(registry.has("stream.permission.requested")).toBe(true);
    expect(registry.has("stream.usage")).toBe(true);
    expect(registry.has("stream.turn.start")).toBe(true);
    expect(registry.has("stream.text.delta")).toBe(true);
    expect(registry.has("stream.tool.start")).toBe(true);
    expect(registry.has("workflow.step.start")).toBe(true);
    expect(registry.has("workflow.task.update")).toBe(true);
  });

  test("handler barrel re-exports turn and workflow registrations", () => {
    expect(sessionLifecycleRegistrations.map(({ eventType }) => eventType)).toEqual([
      "stream.session.start",
      "stream.session.idle",
      "stream.session.partial-idle",
      "stream.session.error",
      "stream.session.retry",
      "stream.session.info",
      "stream.session.warning",
      "stream.session.title_changed",
      "stream.session.truncation",
      "stream.session.compaction",
    ]);

    expect(interactionRegistrations.map(({ eventType }) => eventType)).toEqual([
      "stream.permission.requested",
      "stream.human_input_required",
      "stream.skill.invoked",
    ]);

    expect(turnLifecycleRegistrations.map(({ eventType }) => eventType)).toEqual([
      "stream.turn.start",
      "stream.turn.end",
    ]);

    expect(workflowStepRegistrations.map(({ eventType }) => eventType)).toEqual([
      "workflow.step.start",
      "workflow.step.complete",
    ]);

    expect(workflowTaskRegistrations.map(({ eventType }) => eventType)).toEqual([
      "workflow.task.update",
      "workflow.task.statusChange",
    ]);
  });

  test("registry barrel covers every canonical bus event type", () => {
    const registry = getEventHandlerRegistry();

    expect(
      registry.getUnregisteredTypes(Object.keys(BusEventSchemas) as BusEventType[]),
    ).toEqual([]);
  });

  test("setEventHandlerRegistry replaces the global instance", () => {
    const original = getEventHandlerRegistry();
    const custom = new EventHandlerRegistry();
    setEventHandlerRegistry(custom);
    expect(getEventHandlerRegistry()).toBe(custom);
    expect(getEventHandlerRegistry()).not.toBe(original);

    // Restore to avoid leaking state to other tests
    setEventHandlerRegistry(original);
  });
});

describe("registered text, thinking, and tool handlers", () => {
  const registry = getEventHandlerRegistry();

  test("maps text deltas through echo suppression unless they are agent-scoped", () => {
    const mapper = registry.getStreamPartMapper("stream.text.delta");
    expect(mapper).toBeDefined();

    const userEvent = makeEnrichedEvent("stream.text.delta", {
      delta: "visible text",
      messageId: "m-1",
    });

    expect(
      mapper!(userEvent, {
        filterDelta: () => null,
      }),
    ).toBeNull();

    const agentEvent = makeEnrichedEvent("stream.text.delta", {
      delta: "agent text",
      messageId: "m-2",
      agentId: "agent-1",
    });

    expect(
      mapper!(agentEvent, {
        filterDelta: () => null,
      }),
    ).toEqual({
      type: "text-delta",
      runId: 1,
      delta: "agent text",
      agentId: "agent-1",
    });
  });

  test("registers text completion coalescing and stale filtering", () => {
    const coalescingKey = registry.getCoalescingKeyFn("stream.text.complete");
    const isStale = registry.getStalePredicate("stream.text.complete");
    const mapper = registry.getStreamPartMapper("stream.text.complete");

    const older = makeEvent("stream.text.complete", {
      messageId: "m-1",
      fullText: "older",
    });
    older.timestamp = 100;

    const newer = makeEvent("stream.text.complete", {
      messageId: "m-1",
      fullText: "newer",
    });
    newer.timestamp = 200;

    expect(coalescingKey!(older)).toBe("text.complete:m-1");
    expect(isStale!(older, newer)).toBe(true);
    expect(mapper!(newer as EnrichedBusEvent & { type: "stream.text.complete" }, stubContext)).toEqual({
      type: "text-complete",
      runId: 1,
      fullText: "newer",
      messageId: "m-1",
    });
  });

  test("registers delta stale keys and complete supersession keys", () => {
    const textDeltaStaleKey = registry.getStaleKeyFn("stream.text.delta");
    const textCompleteSupersedes = registry.getSupersedingStaleKeyFn("stream.text.complete");
    const thinkingDeltaStaleKey = registry.getStaleKeyFn("stream.thinking.delta");
    const thinkingCompleteSupersedes = registry.getSupersedingStaleKeyFn("stream.thinking.complete");

    expect(textDeltaStaleKey?.(makeEvent("stream.text.delta", {
      delta: "hello",
      messageId: "m-1",
    }))).toBe("text.delta:test-session:m-1");

    expect(textCompleteSupersedes?.(makeEvent("stream.text.complete", {
      messageId: "m-1",
      fullText: "hello",
    }))).toBe("text.delta:test-session:m-1");

    expect(thinkingDeltaStaleKey?.(makeEvent("stream.thinking.delta", {
      delta: "hmm",
      sourceKey: "think-1",
      messageId: "m-1",
    }))).toBe("thinking.delta:test-session:think-1");

    expect(thinkingCompleteSupersedes?.(makeEvent("stream.thinking.complete", {
      sourceKey: "think-1",
      durationMs: 50,
    }))).toBe("thinking.delta:test-session:think-1");
  });

  test("maps thinking events to reasoning stream parts", () => {
    const deltaMapper = registry.getStreamPartMapper("stream.thinking.delta");
    const completeMapper = registry.getStreamPartMapper("stream.thinking.complete");

    expect(deltaMapper).toBeDefined();
    expect(completeMapper).toBeDefined();

    expect(
      deltaMapper!(
        makeEnrichedEvent("stream.thinking.delta", {
          delta: "step 1",
          sourceKey: "think-1",
          messageId: "m-1",
          agentId: "agent-7",
        }),
        stubContext,
      ),
    ).toEqual([{
      type: "thinking-meta",
      runId: 1,
      thinkingSourceKey: "think-1",
      targetMessageId: "m-1",
      streamGeneration: 0,
      thinkingText: "step 1",
      thinkingMs: 0,
      agentId: "agent-7",
    }]);

    expect(
      completeMapper!(
        makeEnrichedEvent("stream.thinking.complete", {
          sourceKey: "think-1",
          durationMs: 325,
        }),
        stubContext,
      ),
    ).toEqual([{
      type: "thinking-complete",
      runId: 1,
      sourceKey: "think-1",
      durationMs: 325,
    }]);
  });

  test("maps tool handlers using adapter-emitted parentAgentId", () => {
    const startMapper = registry.getStreamPartMapper("stream.tool.start");
    const completeMapper = registry.getStreamPartMapper("stream.tool.complete");
    const partialMapper = registry.getStreamPartMapper("stream.tool.partial_result");
    const startKey = registry.getCoalescingKeyFn("stream.tool.start");
    const completeKey = registry.getCoalescingKeyFn("stream.tool.complete");

    expect(startKey?.(
      makeEvent("stream.tool.start", {
        toolId: "tool-1",
        toolName: "bash",
        toolInput: { cmd: "ls" },
      }),
    )).toBe("tool.start:tool-1");

    expect(
      startMapper!(
        makeEnrichedEvent("stream.tool.start", {
          toolId: "tool-1",
          toolName: "bash",
          toolInput: { cmd: "ls" },
          toolMetadata: { origin: "test" },
        }),
        stubContext,
      ),
    ).toEqual({
      type: "tool-start",
      runId: 1,
      toolId: "tool-1",
      toolName: "bash",
      input: { cmd: "ls" },
      toolMetadata: { origin: "test" },
    });

    expect(completeKey?.(
      makeEvent("stream.tool.complete", {
        toolId: "tool-1",
        toolName: "bash",
        toolResult: { ok: true },
        success: true,
      }),
    )).toBe("tool.complete:tool-1");

    expect(
      completeMapper!(
        makeEnrichedEvent("stream.tool.complete", {
          toolId: "tool-1",
          toolName: "bash",
          toolInput: { cmd: "ls" },
          toolResult: { ok: true },
          success: true,
          parentAgentId: "agent-parent",
        }),
        stubContext,
      ),
    ).toEqual({
      type: "tool-complete",
      runId: 1,
      toolId: "tool-1",
      toolName: "bash",
      output: { ok: true },
      success: true,
      error: undefined,
      input: { cmd: "ls" },
      agentId: "agent-parent",
    });

    expect(
      partialMapper!(
        makeEnrichedEvent("stream.tool.partial_result", {
          toolCallId: "tool-1",
          partialOutput: "chunk",
        }),
        stubContext,
      ),
    ).toEqual({
      type: "tool-partial-result",
      runId: 1,
      toolId: "tool-1",
      partialOutput: "chunk",
    });
  });
});
