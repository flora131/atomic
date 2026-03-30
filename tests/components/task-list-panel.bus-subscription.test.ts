/**
 * Tests for TaskListPanel bus event subscription.
 *
 * Verifies that:
 * - TaskListPanelProps includes sessionId and eventBus optional props
 * - When eventBus + sessionId are provided, the component subscribes to
 *   "workflow:tasks-updated" bus events via eventBus.on()
 * - The bus handler filters events by sessionId
 * - The bus handler maps event data tasks to TaskItem[] and calls
 *   sortTasksTopologically
 * - The useEffect depends on [sessionId, resolvedEventBus]
 * - The EventBus.on() API contract: subscribe returns an unsubscribe function
 *
 * Tests use two approaches:
 * 1. Source code structural verification (confirming the code structure)
 * 2. Real EventBus integration tests (verifying the subscription pattern works)
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { EventBus } from "@/services/events/event-bus.ts";
import type { BusEvent } from "@/services/events/bus-events/index.ts";
import { sortTasksTopologically } from "@/components/task-order.ts";
import type { TaskItem } from "@/components/task-list-indicator.tsx";

// ---------------------------------------------------------------------------
// Source code reference
// ---------------------------------------------------------------------------

const SOURCE_PATH = path.resolve(
  import.meta.dir,
  "../../src/components/task-list-panel.tsx",
);
const source = fs.readFileSync(SOURCE_PATH, "utf-8");

// ===========================================================================
// TaskListPanelProps type verification
// ===========================================================================

describe("TaskListPanelProps interface", () => {
  test("includes sessionId optional prop", () => {
    expect(source).toContain("sessionId?: string");
  });

  test("includes eventBus optional prop with EventBus type", () => {
    expect(source).toContain('eventBus?: import("@/services/events/event-bus.ts").EventBus');
  });

  test("retains expanded optional prop", () => {
    expect(source).toContain("expanded?: boolean");
  });

  test("retains workflowActive optional prop", () => {
    expect(source).toContain("workflowActive?: boolean");
  });
});

// ===========================================================================
// Component destructuring
// ===========================================================================

describe("TaskListPanel component destructuring", () => {
  test("destructures sessionId from props", () => {
    expect(source).toContain("sessionId,");
  });

  test("destructures eventBus from props (aliased to eventBusProp)", () => {
    expect(source).toContain("eventBus: eventBusProp,");
  });
});

// ===========================================================================
// Bus event subscription logic
// ===========================================================================

describe("bus event subscription in useEffect", () => {
  test("checks for resolvedEventBus && sessionId before subscribing", () => {
    expect(source).toContain("if (!resolvedEventBus || !sessionId)");
  });

  test("subscribes to workflow:tasks-updated via resolvedEventBus.on()", () => {
    expect(source).toContain('resolvedEventBus.on("workflow:tasks-updated"');
  });

  test("filters events by sessionId", () => {
    expect(source).toContain("event.data.sessionId === sessionId");
  });

  test("maps event tasks to TaskItem array with id, description, status, blockedBy", () => {
    expect(source).toContain("id: t.id,");
    expect(source).toContain("description: t.description,");
    expect(source).toContain("status: t.status,");
    expect(source).toContain("blockedBy: t.blockedBy,");
  });

  test("applies sortTasksTopologically to mapped items", () => {
    expect(source).toContain("setTasks(sortTasksTopologically(items))");
  });

  test("returns unsubscribe from useEffect cleanup", () => {
    expect(source).toContain("return unsubscribe");
  });

  test("useEffect depends on sessionId and resolvedEventBus", () => {
    expect(source).toContain("[sessionId, resolvedEventBus]");
  });
});

// ===========================================================================
// EventBus integration tests (real EventBus, no React rendering)
// ===========================================================================

describe("EventBus subscription pattern integration", () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus({ validatePayloads: true });
  });

  afterEach(() => {
    bus.clear();
  });

  test("on() subscribes to workflow:tasks-updated and receives events", () => {
    const received: BusEvent<"workflow:tasks-updated">[] = [];

    bus.on("workflow:tasks-updated", (event) => {
      received.push(event);
    });

    bus.publish({
      type: "workflow:tasks-updated",
      sessionId: "sess-1",
      runId: 1,
      timestamp: Date.now(),
      data: {
        sessionId: "sess-1",
        tasks: [
          { id: "1", description: "Task A", status: "pending", summary: "Doing A" },
          { id: "2", description: "Task B", status: "completed", summary: "Done B" },
        ],
      },
    });

    expect(received).toHaveLength(1);
    expect(received[0]!.data.tasks).toHaveLength(2);
    expect(received[0]!.data.sessionId).toBe("sess-1");
  });

  test("on() returns an unsubscribe function that stops delivery", () => {
    const received: BusEvent<"workflow:tasks-updated">[] = [];

    const unsubscribe = bus.on("workflow:tasks-updated", (event) => {
      received.push(event);
    });

    bus.publish({
      type: "workflow:tasks-updated",
      sessionId: "sess-1",
      runId: 1,
      timestamp: Date.now(),
      data: {
        sessionId: "sess-1",
        tasks: [{ id: "1", description: "Task A", status: "pending", summary: "Doing A" }],
      },
    });
    expect(received).toHaveLength(1);

    unsubscribe();

    bus.publish({
      type: "workflow:tasks-updated",
      sessionId: "sess-1",
      runId: 2,
      timestamp: Date.now(),
      data: {
        sessionId: "sess-1",
        tasks: [{ id: "2", description: "Task B", status: "pending", summary: "Doing B" }],
      },
    });
    expect(received).toHaveLength(1);
  });

  test("sessionId filtering logic works correctly", () => {
    const mySessionId = "session-abc";
    const collected: TaskItem[][] = [];

    bus.on("workflow:tasks-updated", (event) => {
      if (event.data.sessionId === mySessionId) {
        const items: TaskItem[] = event.data.tasks.map((t) => ({
          id: t.id,
          description: t.description,
          status: t.status,
          blockedBy: t.blockedBy,
        }));
        collected.push(sortTasksTopologically(items));
      }
    });

    bus.publish({
      type: "workflow:tasks-updated",
      sessionId: "session-xyz",
      runId: 1,
      timestamp: Date.now(),
      data: {
        sessionId: "session-xyz",
        tasks: [{ id: "1", description: "Other session task", status: "pending", summary: "Other" }],
      },
    });
    expect(collected).toHaveLength(0);

    bus.publish({
      type: "workflow:tasks-updated",
      sessionId: mySessionId,
      runId: 1,
      timestamp: Date.now(),
      data: {
        sessionId: mySessionId,
        tasks: [
          { id: "1", description: "My task", status: "in_progress", summary: "Working on it" },
        ],
      },
    });
    expect(collected).toHaveLength(1);
    expect(collected[0]!).toHaveLength(1);
    expect(collected[0]![0]!.description).toBe("My task");
    expect(collected[0]![0]!.status).toBe("in_progress");
  });

  test("task mapping preserves all TaskItem fields correctly", () => {
    let mappedItems: TaskItem[] = [];

    bus.on("workflow:tasks-updated", (event) => {
      mappedItems = event.data.tasks.map((t) => ({
        id: t.id,
        description: t.description,
        status: t.status,
        blockedBy: t.blockedBy,
      }));
    });

    bus.publish({
      type: "workflow:tasks-updated",
      sessionId: "sess-1",
      runId: 1,
      timestamp: Date.now(),
      data: {
        sessionId: "sess-1",
        tasks: [
          {
            id: "1",
            description: "Implement feature X",
            status: "in_progress",
            summary: "Implementing feature X",
            blockedBy: [],
          },
          {
            id: "2",
            description: "Write tests for feature X",
            status: "pending",
            summary: "Writing tests",
            blockedBy: ["1"],
          },
          {
            id: "3",
            description: "Deploy feature X",
            status: "error",
            summary: "Deploying",
            blockedBy: ["1", "2"],
          },
        ],
      },
    });

    expect(mappedItems).toHaveLength(3);
    expect(mappedItems[0]!.id).toBe("1");
    expect(mappedItems[0]!.description).toBe("Implement feature X");
    expect(mappedItems[0]!.status).toBe("in_progress");
    expect(mappedItems[0]!.blockedBy).toEqual([]);
    expect(mappedItems[1]!.id).toBe("2");
    expect(mappedItems[1]!.description).toBe("Write tests for feature X");
    expect(mappedItems[1]!.status).toBe("pending");
    expect(mappedItems[1]!.blockedBy).toEqual(["1"]);
    expect(mappedItems[2]!.id).toBe("3");
    expect(mappedItems[2]!.description).toBe("Deploy feature X");
    expect(mappedItems[2]!.status).toBe("error");
    expect(mappedItems[2]!.blockedBy).toEqual(["1", "2"]);
  });

  test("tasks without blockedBy receive undefined (not required field)", () => {
    let mappedItems: TaskItem[] = [];

    bus.on("workflow:tasks-updated", (event) => {
      mappedItems = event.data.tasks.map((t) => ({
        id: t.id,
        description: t.description,
        status: t.status,
        blockedBy: t.blockedBy,
      }));
    });

    bus.publish({
      type: "workflow:tasks-updated",
      sessionId: "sess-1",
      runId: 1,
      timestamp: Date.now(),
      data: {
        sessionId: "sess-1",
        tasks: [
          { id: "1", description: "Independent task", status: "completed", summary: "Done" },
        ],
      },
    });

    expect(mappedItems).toHaveLength(1);
    expect(mappedItems[0]!.id).toBe("1");
    expect(mappedItems[0]!.blockedBy).toBeUndefined();
  });

  test("sortTasksTopologically is applied to bus-provided tasks", () => {
    const tasks: TaskItem[] = [
      { id: "2", description: "Task B", status: "pending", blockedBy: ["1"] },
      { id: "1", description: "Task A", status: "pending" },
    ];

    const sorted = sortTasksTopologically(tasks);

    expect(sorted[0]!.id).toBe("1");
    expect(sorted[1]!.id).toBe("2");
  });

  test("schema validates all four status values", () => {
    const statuses = ["pending", "in_progress", "completed", "error"] as const;

    for (const status of statuses) {
      const received: BusEvent<"workflow:tasks-updated">[] = [];

      const unsubscribe = bus.on("workflow:tasks-updated", (event) => {
        received.push(event);
      });

      bus.publish({
        type: "workflow:tasks-updated",
        sessionId: "sess-1",
        runId: 1,
        timestamp: Date.now(),
        data: {
          sessionId: "sess-1",
          tasks: [{ id: "1", description: "Task", status, summary: "Summary" }],
        },
      });

      expect(received).toHaveLength(1);
      expect(received[0]!.data.tasks[0]!.status).toBe(status);
      unsubscribe();
    }
  });

  test("multiple subscriptions receive the same event", () => {
    let count1 = 0;
    let count2 = 0;

    bus.on("workflow:tasks-updated", () => { count1++; });
    bus.on("workflow:tasks-updated", () => { count2++; });

    bus.publish({
      type: "workflow:tasks-updated",
      sessionId: "sess-1",
      runId: 1,
      timestamp: Date.now(),
      data: {
        sessionId: "sess-1",
        tasks: [{ id: "1", description: "Task", status: "pending", summary: "S" }],
      },
    });

    expect(count1).toBe(1);
    expect(count2).toBe(1);
  });
});

// ===========================================================================
// Import and structure verification
// ===========================================================================

describe("import structure", () => {
  test("imports useEffect from react", () => {
    expect(source).toContain("useEffect");
    expect(source).toMatch(/import.*useEffect.*from\s+"react"/);
  });

  test("does not import useBusSubscription (uses eventBus prop instead)", () => {
    expect(source).not.toContain("useBusSubscription");
  });

  test("imports useOptionalEventBusContext for context-based bus resolution", () => {
    expect(source).toContain("useOptionalEventBusContext");
    expect(source).toMatch(/import.*useOptionalEventBusContext.*from/);
  });

  test("resolves event bus from prop or context", () => {
    expect(source).toContain("const resolvedEventBus = eventBusProp ?? eventBusCtx?.bus ?? undefined");
  });

  test("exports TaskListPanelProps interface", () => {
    expect(source).toContain("export interface TaskListPanelProps");
  });

  test("exports TaskListPanel function", () => {
    expect(source).toContain("export function TaskListPanel");
  });
});
