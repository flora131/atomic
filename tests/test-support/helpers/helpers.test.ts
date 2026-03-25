/**
 * Smoke tests for test helper utilities.
 *
 * Verifies that the EventBus helpers and Part assertion helpers
 * work correctly with the fixture factories.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import {
  createTestEventBus,
  collectEvents,
  waitForEvent,
  flushEvents,
  drainEvents,
  type TrackedEventBus,
} from "./event-bus.ts";
import {
  assertPartExists,
  assertPartType,
  assertPartOrder,
  assertPartsContain,
  assertPartExistsWithType,
  findPartByType,
  expectTextContent,
  expectPartOrder,
  expectPartType,
} from "./parts.ts";
import {
  createTextDeltaEvent,
  createSessionIdleEvent,
  createToolStartEvent,
  resetRunIdCounter,
} from "../fixtures/events.ts";
import {
  createTextPart,
  createToolPart,
  createReasoningPart,
  createWorkflowStepPart,
  resetPartIdCounter,
} from "../fixtures/parts.ts";
import { BatchDispatcher } from "@/services/events/batch-dispatcher.ts";

// ---------------------------------------------------------------------------
// EventBus helpers
// ---------------------------------------------------------------------------

describe("EventBus helpers", () => {
  let bus: TrackedEventBus;

  beforeEach(() => {
    resetRunIdCounter();
    bus = createTestEventBus({ validatePayloads: false });
  });

  test("createTestEventBus returns a TrackedEventBus with tracking", () => {
    expect(bus.publishedEvents).toHaveLength(0);
    expect(bus.internalErrors).toHaveLength(0);
    bus.publish(createTextDeltaEvent());
    expect(bus.publishedEvents).toHaveLength(1);
    expect(bus.publishedEvents[0]!.type).toBe("stream.text.delta");
  });

  test("TrackedEventBus.resetTracking clears events and errors", () => {
    bus.publish(createTextDeltaEvent());
    expect(bus.publishedEvents).toHaveLength(1);
    bus.resetTracking();
    expect(bus.publishedEvents).toHaveLength(0);
  });

  test("TrackedEventBus.destroy clears handlers and tracking", () => {
    bus.publish(createTextDeltaEvent());
    bus.destroy();
    expect(bus.publishedEvents).toHaveLength(0);
    expect(bus.handlerCount).toBe(0);
  });

  test("collectEvents with specific event type collects only that type", () => {
    const collector = collectEvents(bus, "stream.text.delta");
    bus.publish(createTextDeltaEvent());
    bus.publish(createSessionIdleEvent());
    bus.publish(createTextDeltaEvent());
    expect(collector.events).toHaveLength(2);
    expect(collector.events[0]!.type).toBe("stream.text.delta");
    collector.unsubscribe();
  });

  test("collectEvents without event type collects all events", () => {
    const collector = collectEvents(bus);
    bus.publish(createTextDeltaEvent());
    bus.publish(createSessionIdleEvent());
    bus.publish(createToolStartEvent());
    expect(collector.events).toHaveLength(3);
    expect(collector.events[0]!.type).toBe("stream.text.delta");
    expect(collector.events[1]!.type).toBe("stream.session.idle");
    expect(collector.events[2]!.type).toBe("stream.tool.start");
    collector.unsubscribe();
  });

  test("collectEvents.clear resets collected events", () => {
    const collector = collectEvents(bus, "stream.text.delta");
    bus.publish(createTextDeltaEvent());
    expect(collector.events).toHaveLength(1);
    collector.clear();
    expect(collector.events).toHaveLength(0);
    collector.unsubscribe();
  });

  test("waitForEvent resolves when the event fires", async () => {
    const promise = waitForEvent(bus, "stream.session.idle");
    bus.publish(createSessionIdleEvent());
    const event = await promise;
    expect(event.type).toBe("stream.session.idle");
  });

  test("waitForEvent rejects on timeout", async () => {
    await expect(
      waitForEvent(bus, "stream.session.idle", 50),
    ).rejects.toThrow("timed out");
  });

  test("flushEvents is a no-op on a plain EventBus", () => {
    bus.publish(createTextDeltaEvent());
    // Should not throw
    flushEvents(bus);
    expect(bus.publishedEvents).toHaveLength(1);
  });

  test("drainEvents is an alias for flushEvents", () => {
    expect(drainEvents).toBe(flushEvents);
  });
});

// ---------------------------------------------------------------------------
// Part assertion helpers
// ---------------------------------------------------------------------------

describe("Part assertion helpers", () => {
  beforeEach(() => {
    resetPartIdCounter();
  });

  test("assertPartExists finds a part by ID", () => {
    const part = createTextPart();
    const parts = [part];
    const found = assertPartExists(parts, part.id);
    expect(found).toBe(part);
  });

  test("assertPartExists throws when part not found", () => {
    const parts = [createTextPart()];
    expect(() => assertPartExists(parts, "nonexistent" as string)).toThrow(
      "assertPartExists",
    );
  });

  test("assertPartType narrows to concrete type", () => {
    const part = createToolPart();
    const narrowed = assertPartType(part, "tool");
    // TypeScript should narrow this to ToolPart
    expect(narrowed.toolName).toBe("Read");
  });

  test("assertPartType throws on type mismatch", () => {
    const part = createTextPart();
    expect(() => assertPartType(part, "tool")).toThrow("assertPartType");
  });

  test("assertPartOrder verifies part ID ordering", () => {
    const p1 = createTextPart();
    const p2 = createToolPart();
    const p3 = createReasoningPart();
    // Should not throw
    assertPartOrder([p1, p2, p3], [p1.id, p2.id, p3.id]);
  });

  test("assertPartsContain matches by subset fields", () => {
    const parts = [
      createTextPart({ content: "Hello" }),
      createToolPart({ toolName: "Bash" }),
    ];
    // Should not throw
    assertPartsContain(parts, [
      { type: "text" },
      { type: "tool" },
    ]);
  });

  test("assertPartExistsWithType combines lookup and narrowing", () => {
    const tool = createToolPart({ toolName: "Edit" });
    const parts = [createTextPart(), tool, createReasoningPart()];
    const narrowed = assertPartExistsWithType(parts, tool.id, "tool");
    expect(narrowed.toolName).toBe("Edit");
  });

  test("findPartByType returns the first matching part", () => {
    const t1 = createTextPart({ content: "first" });
    const t2 = createTextPart({ content: "second" });
    const parts = [t1, createToolPart(), t2];
    const found = findPartByType(parts, "text");
    expect(found).toBeDefined();
    expect(found!.content).toBe("first");
  });

  test("findPartByType returns undefined when no match", () => {
    const parts = [createTextPart()];
    const found = findPartByType(parts, "tool");
    expect(found).toBeUndefined();
  });

  test("expectTextContent asserts concatenated text across TextParts", () => {
    const parts = [
      createTextPart({ content: "Hello, " }),
      createToolPart(),
      createTextPart({ content: "world!" }),
    ];
    // Should not throw
    expectTextContent(parts, "Hello, world!");
  });

  test("expectTextContent fails on mismatch", () => {
    const parts = [createTextPart({ content: "Hello" })];
    expect(() => expectTextContent(parts, "Goodbye")).toThrow();
  });

  test("expectPartOrder is an alias for assertPartOrder", () => {
    expect(expectPartOrder).toBe(assertPartOrder);
  });

  test("expectPartType is an alias for assertPartType", () => {
    expect(expectPartType).toBe(assertPartType);
  });

  test("findPartByType returns correct narrowed type for workflow-step", () => {
    const step = createWorkflowStepPart({ status: "completed" });
    const parts = [createTextPart(), step];
    const found = findPartByType(parts, "workflow-step");
    expect(found).toBeDefined();
    expect(found!.status).toBe("completed");
    expect(found!.workflowId).toBe("wf_test");
  });
});
