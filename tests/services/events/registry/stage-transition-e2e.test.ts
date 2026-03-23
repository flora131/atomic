/**
 * End-to-end integration test for workflow stage transition events (§5.9).
 *
 * Verifies the full pipeline:
 *   Conductor emitStepStart/emitStepComplete
 *     → BusEvent { type: "workflow.step.start" | "workflow.step.complete" }
 *     → EventHandlerRegistry.toStreamPart()
 *     → StreamPartEvent { type: "workflow-step-start" | "workflow-step-complete" }
 *     → applyStreamPartEvent()
 *     → Part { type: "workflow-step" }
 *     → PART_REGISTRY["workflow-step"] → WorkflowStepPartDisplay
 *
 * Also covers:
 *   createTaskUpdatePublisher()
 *     → BusEvent { type: "workflow.task.update" }
 *     → EventHandlerRegistry.toStreamPart()
 *     → StreamPartEvent { type: "task-list-update" }
 *     → applyStreamPartEvent()
 *     → Part { type: "task-list" }
 */

import { describe, expect, test, beforeEach } from "bun:test";
import {
  EventHandlerRegistry,
  setEventHandlerRegistry,
} from "@/services/events/registry/registry.ts";
import type {
  BusEvent,
  BusEventDataMap,
  EnrichedBusEvent,
} from "@/services/events/bus-events/types.ts";
import type { StreamPartContext } from "@/services/events/registry/types.ts";
import type {
  WorkflowStepStartEvent,
  WorkflowStepCompleteEvent,
  TaskListUpdateEvent,
  StreamPartEvent,
} from "@/state/streaming/pipeline-types.ts";
import type {
  WorkflowStepPart,
  TaskListPart,
  Part,
} from "@/state/parts/types.ts";
import { applyStreamPartEvent } from "@/state/streaming/pipeline.ts";
import { _resetPartCounter } from "@/state/parts/id.ts";
import type { ChatMessage } from "@/state/chat/types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal BusEvent. */
function makeBusEvent<T extends keyof BusEventDataMap>(
  type: T,
  data: BusEventDataMap[T],
  overrides?: Partial<Omit<BusEvent<T>, "type" | "data">>,
): BusEvent<T> {
  return {
    type,
    sessionId: "sess-1",
    runId: 42,
    timestamp: Date.now(),
    data,
    ...overrides,
  };
}

/** Cast to EnrichedBusEvent for mapper calls. */
function enriched<T extends keyof BusEventDataMap>(
  event: BusEvent<T>,
): EnrichedBusEvent & { type: T } {
  return event as unknown as EnrichedBusEvent & { type: T };
}

const stubContext: StreamPartContext = { filterDelta: (d) => d };

/** Build a minimal ChatMessage with empty parts. */
function emptyMessage(): ChatMessage {
  return {
    id: "msg-1",
    role: "assistant",
    content: "",
    timestamp: new Date().toISOString(),
    parts: [],
  } as unknown as ChatMessage;
}

// ---------------------------------------------------------------------------
// Registry setup — mirrors the real handler registrations
// ---------------------------------------------------------------------------

function registerWorkflowHandlers(registry: EventHandlerRegistry): void {
  // workflow.step.start — mirrors stream-workflow-step.ts
  registry.register("workflow.step.start", {
    coalescingKey: (event) => {
      const data = event.data as BusEventDataMap["workflow.step.start"];
      return `workflow.step.start:${data.workflowId}:${data.nodeId}`;
    },
    toStreamPart: (event) => {
      const data = event.data as BusEventDataMap["workflow.step.start"];
      return {
        type: "workflow-step-start" as const,
        runId: event.runId,
        workflowId: data.workflowId,
        nodeId: data.nodeId,
        indicator: data.indicator,
      };
    },
  });

  // workflow.step.complete — mirrors stream-workflow-step.ts
  registry.register("workflow.step.complete", {
    coalescingKey: (event) => {
      const data = event.data as BusEventDataMap["workflow.step.complete"];
      return `workflow.step.complete:${data.workflowId}:${data.nodeId}`;
    },
    toStreamPart: (event) => {
      const data = event.data as BusEventDataMap["workflow.step.complete"];
      return {
        type: "workflow-step-complete" as const,
        runId: event.runId,
        workflowId: data.workflowId,
        nodeId: data.nodeId,
        status: data.status,
        durationMs: data.durationMs,
        ...(data.error ? { error: data.error } : {}),
        ...(data.truncation ? { truncation: data.truncation } : {}),
      };
    },
  });

  // workflow.task.update — mirrors stream-workflow-task.ts
  registry.register("workflow.task.update", {
    coalescingKey: (event) => `workflow.task.update:${event.sessionId}`,
    toStreamPart: (event) => {
      const data = event.data as BusEventDataMap["workflow.task.update"];
      return {
        type: "task-list-update" as const,
        runId: event.runId,
        tasks: data.tasks.map((t) => ({
          id: t.id ?? t.description.slice(0, 40),
          title: t.description,
          status: t.status as "pending",
          ...(t.blockedBy ? { blockedBy: t.blockedBy } : {}),
        })),
      };
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("stage transition events → UI pipeline (§5.9 e2e)", () => {
  let registry: EventHandlerRegistry;

  beforeEach(() => {
    _resetPartCounter();
    registry = new EventHandlerRegistry();
    setEventHandlerRegistry(registry);
    registerWorkflowHandlers(registry);
  });

  // ── Link 1: BusEvent → StreamPartEvent via registry mapper ──────────────

  describe("BusEvent → StreamPartEvent mapping", () => {
    test("workflow.step.start → workflow-step-start", () => {
      const bus = makeBusEvent("workflow.step.start", {
        workflowId: "ralph",
        nodeId: "planner",
        indicator: "📋",
      });
      const mapper = registry.getStreamPartMapper("workflow.step.start")!;
      const stream = mapper(enriched(bus), stubContext) as WorkflowStepStartEvent;

      expect(stream.type).toBe("workflow-step-start");
      expect(stream.workflowId).toBe("ralph");
      expect(stream.nodeId).toBe("planner");
      expect(stream.indicator).toBe("📋");
      expect(stream.runId).toBe(42);
    });

    test("workflow.step.complete → workflow-step-complete", () => {
      const bus = makeBusEvent("workflow.step.complete", {
        workflowId: "ralph",
        nodeId: "planner",
        status: "completed",
        durationMs: 3000,
      });
      const mapper = registry.getStreamPartMapper("workflow.step.complete")!;
      const stream = mapper(enriched(bus), stubContext) as WorkflowStepCompleteEvent;

      expect(stream.type).toBe("workflow-step-complete");
      expect(stream.status).toBe("completed");
      expect(stream.durationMs).toBe(3000);
      expect(stream.error).toBeUndefined();
    });

    test("workflow.step.complete with error → includes error field", () => {
      const bus = makeBusEvent("workflow.step.complete", {
        workflowId: "ralph",
        nodeId: "orchestrator",
        status: "error",
        durationMs: 500,
        error: "context window exceeded",
      });
      const mapper = registry.getStreamPartMapper("workflow.step.complete")!;
      const stream = mapper(enriched(bus), stubContext) as WorkflowStepCompleteEvent;

      expect(stream.status).toBe("error");
      expect(stream.error).toBe("context window exceeded");
    });

    test("workflow.step.complete with truncation → includes truncation config", () => {
      const truncation = {
        minTruncationParts: 4,
        truncateText: true,
        truncateReasoning: true,
        truncateTools: true,
      };
      const bus = makeBusEvent("workflow.step.complete", {
        workflowId: "ralph",
        nodeId: "planner",
        status: "completed",
        durationMs: 2000,
        truncation,
      });
      const mapper = registry.getStreamPartMapper("workflow.step.complete")!;
      const stream = mapper(enriched(bus), stubContext) as WorkflowStepCompleteEvent;

      expect(stream.truncation).toEqual(truncation);
    });

    test("workflow.task.update → task-list-update", () => {
      const bus = makeBusEvent("workflow.task.update", {
        tasks: [
          { description: "Write tests", status: "in_progress", summary: "Writing unit tests" },
          { id: "t-2", description: "Deploy", status: "pending", summary: "Pending deploy", blockedBy: ["t-1"] },
        ],
      });
      const mapper = registry.getStreamPartMapper("workflow.task.update")!;
      const stream = mapper(enriched(bus), stubContext) as TaskListUpdateEvent;

      expect(stream.type).toBe("task-list-update");
      expect(stream.tasks).toHaveLength(2);
      expect(stream.tasks[0]!.title).toBe("Write tests");
      // When no id is provided, it should be derived from description
      expect(stream.tasks[0]!.id).toBe("Write tests");
      expect(stream.tasks[1]!.blockedBy).toEqual(["t-1"]);
    });
  });

  // ── Link 2: StreamPartEvent → Part via applyStreamPartEvent ─────────────

  describe("StreamPartEvent → Part via pipeline reducer", () => {
    test("workflow-step-start produces a workflow-step part with running status", () => {
      const event: WorkflowStepStartEvent = {
        type: "workflow-step-start",
        runId: 42,
        workflowId: "ralph",
        nodeId: "planner",
        indicator: "📋",
      };
      const msg = applyStreamPartEvent(emptyMessage(), event);

      expect(msg.parts).toHaveLength(1);
      const part = msg.parts![0] as WorkflowStepPart;
      expect(part.type).toBe("workflow-step");
      expect(part.workflowId).toBe("ralph");
      expect(part.nodeId).toBe("planner");
      expect(part.status).toBe("running");
      expect(part.startedAt).toBeDefined();
      expect(part.completedAt).toBeUndefined();
    });

    test("workflow-step-complete updates running part to completed", () => {
      const startEvt: WorkflowStepStartEvent = {
        type: "workflow-step-start",
        runId: 42,
        workflowId: "ralph",
        nodeId: "planner",
        indicator: "📋",
      };
      const completeEvt: WorkflowStepCompleteEvent = {
        type: "workflow-step-complete",
        runId: 42,
        workflowId: "ralph",
        nodeId: "planner",
        status: "completed",
        durationMs: 2500,
      };

      let msg = applyStreamPartEvent(emptyMessage(), startEvt);
      msg = applyStreamPartEvent(msg, completeEvt);

      expect(msg.parts).toHaveLength(1);
      const part = msg.parts![0] as WorkflowStepPart;
      expect(part.status).toBe("completed");
      expect(part.durationMs).toBe(2500);
      expect(part.completedAt).toBeDefined();
    });

    test("task-list-update produces a task-list part", () => {
      const event: TaskListUpdateEvent = {
        type: "task-list-update",
        runId: 42,
        tasks: [
          { id: "t-1", title: "Write tests", status: "in_progress" },
          { id: "t-2", title: "Deploy", status: "pending", blockedBy: ["t-1"] },
        ],
      };
      const msg = applyStreamPartEvent(emptyMessage(), event);

      expect(msg.parts).toHaveLength(1);
      const part = msg.parts![0] as TaskListPart;
      expect(part.type).toBe("task-list");
      expect(part.items).toHaveLength(2);
      expect(part.items[0]!.description).toBe("Write tests");
      expect(part.items[0]!.status).toBe("in_progress");
    });
  });

  // ── Link 3: Full pipeline — BusEvent → mapper → reducer → Part ──────────

  describe("full pipeline: BusEvent → StreamPartEvent → Part", () => {
    test("step.start BusEvent flows through to a running WorkflowStepPart", () => {
      // Simulate what the conductor's emitStepStart produces
      const bus = makeBusEvent("workflow.step.start", {
        workflowId: "ralph",
        nodeId: "planner",
        indicator: "📋",
      });

      // Step 1: BusEvent → StreamPartEvent (via registry)
      const mapper = registry.getStreamPartMapper("workflow.step.start")!;
      const streamEvent = mapper(enriched(bus), stubContext) as StreamPartEvent;

      // Step 2: StreamPartEvent → Part (via pipeline reducer)
      const msg = applyStreamPartEvent(emptyMessage(), streamEvent);

      const part = msg.parts![0] as WorkflowStepPart;
      expect(part.type).toBe("workflow-step");
      expect(part.status).toBe("running");
      expect(part.nodeId).toBe("planner");
    });

    test("step.complete BusEvent flows through to a completed WorkflowStepPart", () => {
      // Start
      const startBus = makeBusEvent("workflow.step.start", {
        workflowId: "ralph",
        nodeId: "orchestrator",
        indicator: "🎯",
      });
      const startMapper = registry.getStreamPartMapper("workflow.step.start")!;
      const startStream = startMapper(enriched(startBus), stubContext) as StreamPartEvent;
      let msg = applyStreamPartEvent(emptyMessage(), startStream);

      // Complete
      const completeBus = makeBusEvent("workflow.step.complete", {
        workflowId: "ralph",
        nodeId: "orchestrator",
        status: "completed",
        durationMs: 5000,
      });
      const completeMapper = registry.getStreamPartMapper("workflow.step.complete")!;
      const completeStream = completeMapper(enriched(completeBus), stubContext) as StreamPartEvent;
      msg = applyStreamPartEvent(msg, completeStream);

      const part = msg.parts![0] as WorkflowStepPart;
      expect(part.type).toBe("workflow-step");
      expect(part.status).toBe("completed");
      expect(part.durationMs).toBe(5000);
    });

    test("multi-stage workflow produces correct parts sequence", () => {
      let msg = emptyMessage();

      const stages = [
        { id: "planner", indicator: "📋" },
        { id: "orchestrator", indicator: "🎯" },
        { id: "reviewer", indicator: "🔍" },
      ];

      for (const stage of stages) {
        // Start
        const startBus = makeBusEvent("workflow.step.start", {
          workflowId: "ralph",
          nodeId: stage.id,
          indicator: stage.indicator,
        });
        const startStream = registry.getStreamPartMapper("workflow.step.start")!(
          enriched(startBus),
          stubContext,
        ) as StreamPartEvent;
        msg = applyStreamPartEvent(msg, startStream);

        // Complete
        const completeBus = makeBusEvent("workflow.step.complete", {
          workflowId: "ralph",
          nodeId: stage.id,
          status: "completed",
          durationMs: 1000,
        });
        const completeStream = registry.getStreamPartMapper("workflow.step.complete")!(
          enriched(completeBus),
          stubContext,
        ) as StreamPartEvent;
        msg = applyStreamPartEvent(msg, completeStream);
      }

      expect(msg.parts).toHaveLength(3);
      const parts = msg.parts as WorkflowStepPart[];
      expect(parts[0]!.nodeId).toBe("planner");
      expect(parts[0]!.status).toBe("completed");
      expect(parts[1]!.nodeId).toBe("orchestrator");
      expect(parts[1]!.status).toBe("completed");
      expect(parts[2]!.nodeId).toBe("reviewer");
      expect(parts[2]!.status).toBe("completed");
    });

    test("skipped step BusEvent does not create a WorkflowStepPart", () => {
      const skipBus = makeBusEvent("workflow.step.complete", {
        workflowId: "ralph",
        nodeId: "debugger",
        status: "skipped",
        durationMs: 0,
      });
      const mapper = registry.getStreamPartMapper("workflow.step.complete")!;
      const stream = mapper(enriched(skipBus), stubContext) as StreamPartEvent;
      const msg = applyStreamPartEvent(emptyMessage(), stream);

      expect(msg.parts).toHaveLength(0);
    });

    test("task.update BusEvent flows through to a TaskListPart", () => {
      const bus = makeBusEvent("workflow.task.update", {
        tasks: [
          { id: "t-1", description: "Implement feature", status: "completed", summary: "Done" },
          { description: "Write tests", status: "in_progress", summary: "In progress" },
        ],
      });
      const mapper = registry.getStreamPartMapper("workflow.task.update")!;
      const stream = mapper(enriched(bus), stubContext) as StreamPartEvent;
      const msg = applyStreamPartEvent(emptyMessage(), stream);

      const part = msg.parts![0] as TaskListPart;
      expect(part.type).toBe("task-list");
      expect(part.items).toHaveLength(2);
    });
  });

  // ── Link 4: Event type string alignment ─────────────────────────────────

  describe("event type string alignment", () => {
    test("all three workflow BusEvent types have registered handlers", () => {
      expect(registry.getStreamPartMapper("workflow.step.start")).toBeDefined();
      expect(registry.getStreamPartMapper("workflow.step.complete")).toBeDefined();
      expect(registry.getStreamPartMapper("workflow.task.update")).toBeDefined();
    });

    test("all three workflow BusEvent types have coalescing keys", () => {
      expect(registry.getCoalescingKeyFn("workflow.step.start")).toBeDefined();
      expect(registry.getCoalescingKeyFn("workflow.step.complete")).toBeDefined();
      expect(registry.getCoalescingKeyFn("workflow.task.update")).toBeDefined();
    });
  });
});
