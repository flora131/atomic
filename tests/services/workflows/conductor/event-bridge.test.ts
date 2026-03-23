import { describe, expect, test, beforeEach } from "bun:test";
import { EventBus } from "@/services/events/event-bus.ts";
import { BusEventSchemas } from "@/services/events/bus-events/schemas.ts";
import type { BusEvent, BusEventDataMap } from "@/services/events/bus-events/types.ts";
import { createTaskUpdatePublisher } from "@/services/workflows/conductor/event-bridge.ts";
import { getEventHandlerRegistry, EventHandlerRegistry, setEventHandlerRegistry } from "@/services/events/registry/registry.ts";
import type { TaskItem } from "@/services/workflows/builtin/ralph/helpers/prompts.ts";

// Import handler registration side effect
import "@/services/events/registry/handlers/stream-workflow-task.ts";

// ---------------------------------------------------------------------------
// Test Data Factories
// ---------------------------------------------------------------------------

function makeTasks(count: number): TaskItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `task-${i + 1}`,
    description: `Implement feature ${i + 1}`,
    status: i === 0 ? "in_progress" : "pending",
    summary: `Feature ${i + 1}`,
    ...(i > 0 ? { blockedBy: [`task-${i}`] } : {}),
  }));
}

function makeTaskUpdateEvent(
  tasks: TaskItem[],
  overrides?: Partial<BusEvent<"workflow.task.update">>,
): BusEvent<"workflow.task.update"> {
  return {
    type: "workflow.task.update",
    sessionId: "test-session",
    runId: 1,
    timestamp: Date.now(),
    data: {
      tasks: tasks.map((t) => ({
        ...(t.id !== undefined ? { id: t.id } : {}),
        description: t.description,
        status: t.status,
        summary: t.summary,
        ...(t.blockedBy ? { blockedBy: t.blockedBy } : {}),
      })),
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Schema Validation Tests
// ---------------------------------------------------------------------------

describe("workflow.task.update schema", () => {
  const schema = BusEventSchemas["workflow.task.update"];

  test("accepts a valid task list payload", () => {
    const data = {
      tasks: [
        { id: "t1", description: "Build auth", status: "pending", summary: "Auth" },
        { description: "Write tests", status: "in_progress", summary: "Tests" },
      ],
    };
    expect(() => schema.parse(data)).not.toThrow();
  });

  test("accepts payload with sourceStageId", () => {
    const data = {
      tasks: [{ description: "Task 1", status: "pending", summary: "T1" }],
      sourceStageId: "planner",
    };
    const parsed = schema.parse(data);
    expect(parsed.sourceStageId).toBe("planner");
  });

  test("accepts payload with blockedBy array", () => {
    const data = {
      tasks: [{
        id: "t2",
        description: "Task 2",
        status: "blocked",
        summary: "T2",
        blockedBy: ["t1"],
      }],
    };
    const parsed = schema.parse(data);
    expect(parsed.tasks[0]!.blockedBy).toEqual(["t1"]);
  });

  test("accepts empty task list", () => {
    const data = { tasks: [] };
    expect(() => schema.parse(data)).not.toThrow();
  });

  test("rejects payload missing required task fields", () => {
    const data = {
      tasks: [{ id: "t1" }],
    };
    expect(() => schema.parse(data)).toThrow();
  });

  test("rejects non-object payload", () => {
    expect(() => schema.parse("not-an-object")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Handler Descriptor Tests
// ---------------------------------------------------------------------------

describe("workflow.task.update handler descriptor", () => {
  test("is registered in the global EventHandlerRegistry", () => {
    const registry = getEventHandlerRegistry();
    expect(registry.has("workflow.task.update")).toBe(true);
  });

  test("coalesces by sessionId", () => {
    const registry = getEventHandlerRegistry();
    const coalescingKeyFn = registry.getCoalescingKeyFn("workflow.task.update");
    expect(coalescingKeyFn).toBeDefined();

    const event = makeTaskUpdateEvent(makeTasks(2));
    const key = coalescingKeyFn!(event);
    expect(key).toBe("workflow.task.update:test-session");
  });

  test("maps to task-list-update StreamPartEvent", () => {
    const registry = getEventHandlerRegistry();
    const mapper = registry.getStreamPartMapper("workflow.task.update");
    expect(mapper).toBeDefined();

    const tasks = makeTasks(3);
    const event = makeTaskUpdateEvent(tasks);
    const enrichedEvent = { ...event, type: "workflow.task.update" as const };

    const result = mapper!(enrichedEvent, { filterDelta: (d: string) => d });

    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(false);

    const streamPart = result as { type: string; runId: number; tasks: Array<{ id: string; title: string; status: string; blockedBy?: string[] }> };
    expect(streamPart.type).toBe("task-list-update");
    expect(streamPart.runId).toBe(1);
    expect(streamPart.tasks).toHaveLength(3);
    expect(streamPart.tasks[0]!.id).toBe("task-1");
    expect(streamPart.tasks[0]!.title).toBe("Implement feature 1");
    expect(streamPart.tasks[0]!.status).toBe("in_progress");
  });

  test("normalizes status values in mapped tasks", () => {
    const registry = getEventHandlerRegistry();
    const mapper = registry.getStreamPartMapper("workflow.task.update");

    const tasks: TaskItem[] = [
      { id: "t1", description: "Task 1", status: "IN_PROGRESS", summary: "T1" },
      { id: "t2", description: "Task 2", status: "COMPLETED", summary: "T2" },
      { id: "t3", description: "Task 3", status: "invalid-status", summary: "T3" },
    ];
    const event = makeTaskUpdateEvent(tasks);
    const enrichedEvent = { ...event, type: "workflow.task.update" as const };

    const result = mapper!(enrichedEvent, { filterDelta: (d: string) => d });
    const streamPart = result as { tasks: Array<{ status: string }> };

    expect(streamPart.tasks[0]!.status).toBe("in_progress");
    expect(streamPart.tasks[1]!.status).toBe("completed");
    expect(streamPart.tasks[2]!.status).toBe("pending");
  });

  test("preserves blockedBy in mapped tasks", () => {
    const registry = getEventHandlerRegistry();
    const mapper = registry.getStreamPartMapper("workflow.task.update");

    const tasks: TaskItem[] = [
      { id: "t1", description: "Task 1", status: "completed", summary: "T1" },
      { id: "t2", description: "Task 2", status: "pending", summary: "T2", blockedBy: ["t1"] },
    ];
    const event = makeTaskUpdateEvent(tasks);
    const enrichedEvent = { ...event, type: "workflow.task.update" as const };

    const result = mapper!(enrichedEvent, { filterDelta: (d: string) => d });
    const streamPart = result as { tasks: Array<{ blockedBy?: string[] }> };

    expect(streamPart.tasks[0]!.blockedBy).toBeUndefined();
    expect(streamPart.tasks[1]!.blockedBy).toEqual(["t1"]);
  });

  test("falls back to truncated description when task has no id", () => {
    const registry = getEventHandlerRegistry();
    const mapper = registry.getStreamPartMapper("workflow.task.update");

    const tasks: TaskItem[] = [
      { description: "A task without an explicit identifier field", status: "pending", summary: "No ID" },
    ];
    const event = makeTaskUpdateEvent(tasks);
    const enrichedEvent = { ...event, type: "workflow.task.update" as const };

    const result = mapper!(enrichedEvent, { filterDelta: (d: string) => d });
    const streamPart = result as { tasks: Array<{ id: string }> };

    expect(streamPart.tasks[0]!.id).toBe("A task without an explicit identifier fi");
  });
});

// ---------------------------------------------------------------------------
// Event Bridge Tests
// ---------------------------------------------------------------------------

describe("createTaskUpdatePublisher", () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus({ validatePayloads: true });
  });

  test("publishes workflow.task.update event on the bus", () => {
    const received: BusEvent<"workflow.task.update">[] = [];
    bus.on("workflow.task.update", (event) => received.push(event));

    const publish = createTaskUpdatePublisher(bus, "sess-1", 42);
    const tasks = makeTasks(2);
    publish(tasks);

    expect(received).toHaveLength(1);
    expect(received[0]!.type).toBe("workflow.task.update");
    expect(received[0]!.sessionId).toBe("sess-1");
    expect(received[0]!.runId).toBe(42);
    expect(received[0]!.data.tasks).toHaveLength(2);
  });

  test("includes sourceStageId when provided", () => {
    const received: BusEvent<"workflow.task.update">[] = [];
    bus.on("workflow.task.update", (event) => received.push(event));

    const publish = createTaskUpdatePublisher(bus, "sess-1", 1, "planner");
    publish(makeTasks(1));

    expect(received[0]!.data.sourceStageId).toBe("planner");
  });

  test("omits sourceStageId when not provided", () => {
    const received: BusEvent<"workflow.task.update">[] = [];
    bus.on("workflow.task.update", (event) => received.push(event));

    const publish = createTaskUpdatePublisher(bus, "sess-1", 1);
    publish(makeTasks(1));

    expect(received[0]!.data.sourceStageId).toBeUndefined();
  });

  test("serializes task fields correctly", () => {
    const received: BusEvent<"workflow.task.update">[] = [];
    bus.on("workflow.task.update", (event) => received.push(event));

    const tasks: TaskItem[] = [
      {
        id: "auth-1",
        description: "Implement JWT auth",
        status: "in_progress",
        summary: "JWT Auth",
        blockedBy: ["setup-db"],
      },
    ];

    const publish = createTaskUpdatePublisher(bus, "sess-1", 1);
    publish(tasks);

    const eventTask = received[0]!.data.tasks[0]!;
    expect(eventTask.id).toBe("auth-1");
    expect(eventTask.description).toBe("Implement JWT auth");
    expect(eventTask.status).toBe("in_progress");
    expect(eventTask.summary).toBe("JWT Auth");
    expect(eventTask.blockedBy).toEqual(["setup-db"]);
  });

  test("omits optional id when task has no id", () => {
    const received: BusEvent<"workflow.task.update">[] = [];
    bus.on("workflow.task.update", (event) => received.push(event));

    const tasks: TaskItem[] = [
      { description: "No ID task", status: "pending", summary: "No ID" },
    ];

    const publish = createTaskUpdatePublisher(bus, "sess-1", 1);
    publish(tasks);

    expect(received[0]!.data.tasks[0]!.id).toBeUndefined();
  });

  test("publishes multiple events for multiple calls", () => {
    const received: BusEvent<"workflow.task.update">[] = [];
    bus.on("workflow.task.update", (event) => received.push(event));

    const publish = createTaskUpdatePublisher(bus, "sess-1", 1);
    publish(makeTasks(2));
    publish(makeTasks(3));

    expect(received).toHaveLength(2);
    expect(received[0]!.data.tasks).toHaveLength(2);
    expect(received[1]!.data.tasks).toHaveLength(3);
  });

  test("passes schema validation with real EventBus", () => {
    let validationPassed = true;
    bus.onInternalError((error) => {
      if (error.kind === "schema_validation") {
        validationPassed = false;
      }
    });

    const publish = createTaskUpdatePublisher(bus, "sess-1", 1);
    // Need a handler so publish actually dispatches
    bus.on("workflow.task.update", () => {});
    publish(makeTasks(5));

    expect(validationPassed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Integration: Bridge → Bus → Handler → StreamPartEvent
// ---------------------------------------------------------------------------

describe("conductor task update end-to-end", () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus({ validatePayloads: true });
  });

  test("bridge publish → handler maps to task-list-update StreamPartEvent", () => {
    const registry = getEventHandlerRegistry();
    const mapper = registry.getStreamPartMapper("workflow.task.update");
    expect(mapper).toBeDefined();

    const received: BusEvent<"workflow.task.update">[] = [];
    bus.on("workflow.task.update", (event) => received.push(event));

    const publish = createTaskUpdatePublisher(bus, "sess-e2e", 7);
    const tasks: TaskItem[] = [
      { id: "t1", description: "Setup DB", status: "completed", summary: "DB" },
      { id: "t2", description: "Build API", status: "in_progress", summary: "API", blockedBy: ["t1"] },
      { id: "t3", description: "Write tests", status: "pending", summary: "Tests", blockedBy: ["t2"] },
    ];
    publish(tasks);

    expect(received).toHaveLength(1);

    // Now map through the handler as the pipeline would
    const enriched = { ...received[0]!, type: "workflow.task.update" as const };
    const streamPart = mapper!(enriched, { filterDelta: (d: string) => d });

    expect(streamPart).not.toBeNull();
    const part = streamPart as {
      type: string;
      runId: number;
      tasks: Array<{ id: string; title: string; status: string; blockedBy?: string[] }>;
    };

    expect(part.type).toBe("task-list-update");
    expect(part.runId).toBe(7);
    expect(part.tasks).toHaveLength(3);

    expect(part.tasks[0]).toEqual({ id: "t1", title: "Setup DB", status: "completed" });
    expect(part.tasks[1]).toEqual({ id: "t2", title: "Build API", status: "in_progress", blockedBy: ["t1"] });
    expect(part.tasks[2]).toEqual({ id: "t3", title: "Write tests", status: "pending", blockedBy: ["t2"] });
  });
});
