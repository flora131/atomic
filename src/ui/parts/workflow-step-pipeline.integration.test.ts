/**
 * Integration Tests: Workflow Step Event → Render Pipeline
 *
 * Tests the full pipeline from BusEvent emission through:
 *   1. StreamPipelineConsumer.mapToStreamPart() — event mapping
 *   2. applyStreamPartEvent() reducer — message/part state updates
 *   3. PART_REGISTRY lookup — renderer dispatch
 *
 * Covers all three workflow event types:
 *   - workflow.step.start  → workflow-step-start → WorkflowStepPart (running)
 *   - workflow.step.complete → workflow-step-complete → WorkflowStepPart (completed/error)
 *   - workflow.task.update → task-list-update → TaskListPart
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { AtomicEventBus } from "../../events/event-bus.ts";
import { BatchDispatcher } from "../../events/batch-dispatcher.ts";
import { wireConsumers } from "../../events/consumers/wire-consumers.ts";
import type { StreamPartEvent } from "./stream-pipeline.ts";
import { applyStreamPartEvent } from "./stream-pipeline.ts";
import { _resetPartCounter } from "./id.ts";
import { PART_REGISTRY } from "../components/parts/registry.tsx";
import type { ChatMessage } from "../chat.tsx";
import type { WorkflowStepPart, TaskListPart, Part } from "./types.ts";

// ============================================================================
// Helpers
// ============================================================================

function createAssistantMessage(): ChatMessage {
  return {
    id: "msg-wf-test",
    role: "assistant",
    content: "",
    timestamp: new Date().toISOString(),
    streaming: true,
    parts: [],
    toolCalls: [],
  };
}

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitForBatchFlush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 25));
}

// ============================================================================
// Tests
// ============================================================================

beforeEach(() => {
  _resetPartCounter();
});

describe("Workflow Step Event → Render Pipeline (integration)", () => {
  let bus: AtomicEventBus;
  let dispatcher: BatchDispatcher;

  beforeEach(() => {
    bus = new AtomicEventBus();
    dispatcher = new BatchDispatcher(bus);
  });

  // --------------------------------------------------------------------------
  // 1. Bus → Consumer → StreamPartEvent mapping
  // --------------------------------------------------------------------------

  describe("bus → consumer mapping", () => {
    function publishEvent(type: string, data: Record<string, unknown>, sessionId = "wf-session", runId = 1) {
      bus.publish({
        type: type as any,
        sessionId,
        runId,
        timestamp: Date.now(),
        data,
      } as any);
    }

    test("workflow.step.start emits workflow-step-start StreamPartEvent", async () => {
      const { pipeline, correlation, dispose } = wireConsumers(bus, dispatcher);
      const output: StreamPartEvent[] = [];
      pipeline.onStreamParts((parts) => output.push(...parts));

      // Initialize a run so the correlation service owns events on this session
      correlation.startRun(1, "wf-session");

      const now = Date.now();
      publishEvent("workflow.step.start", {
        workflowId: "wf1",
        nodeId: "planner",
        nodeName: "Planner",
      });

      await flushMicrotasks();
      await waitForBatchFlush();

      const starts = output.filter((e) => e.type === "workflow-step-start");
      expect(starts).toHaveLength(1);
      expect(starts[0]).toMatchObject({
        type: "workflow-step-start",
        nodeId: "planner",
        nodeName: "Planner",
      });
      expect(starts[0]!.startedAt).toBeGreaterThanOrEqual(now);

      dispose();
    });

    test("workflow.step.complete emits workflow-step-complete StreamPartEvent", async () => {
      const { pipeline, correlation, dispose } = wireConsumers(bus, dispatcher);
      const output: StreamPartEvent[] = [];
      pipeline.onStreamParts((parts) => output.push(...parts));

      correlation.startRun(1, "wf-session");

      const now = Date.now();
      publishEvent("workflow.step.complete", {
        workflowId: "wf1",
        nodeId: "planner",
        status: "success",
      });

      await flushMicrotasks();
      await waitForBatchFlush();

      const completes = output.filter((e) => e.type === "workflow-step-complete");
      expect(completes).toHaveLength(1);
      expect(completes[0]).toMatchObject({
        type: "workflow-step-complete",
        nodeId: "planner",
        status: "success",
      });
      expect(completes[0]!.completedAt).toBeGreaterThanOrEqual(now);

      dispose();
    });

    test("workflow.task.update emits task-list-update StreamPartEvent", async () => {
      const { pipeline, correlation, dispose } = wireConsumers(bus, dispatcher);
      const output: StreamPartEvent[] = [];
      pipeline.onStreamParts((parts) => output.push(...parts));

      correlation.startRun(1, "wf-session");

      publishEvent("workflow.task.update", {
        workflowId: "wf1",
        tasks: [
          { id: "t1", title: "Plan", status: "complete" },
          { id: "t2", title: "Implement", status: "pending" },
        ],
      });

      await flushMicrotasks();
      await waitForBatchFlush();

      const updates = output.filter((e) => e.type === "task-list-update");
      expect(updates).toHaveLength(1);
      expect(updates[0]!.tasks).toEqual([
        { id: "t1", title: "Plan", status: "complete" },
        { id: "t2", title: "Implement", status: "pending" },
      ]);

      dispose();
    });
  });

  // --------------------------------------------------------------------------
  // 2. StreamPartEvent → Reducer → Part state
  // --------------------------------------------------------------------------

  describe("reducer creates and updates parts", () => {
    test("workflow-step-start inserts a running WorkflowStepPart", () => {
      const msg = createAssistantMessage();
      const now = Date.now();

      const next = applyStreamPartEvent(msg, {
        type: "workflow-step-start",
        nodeId: "planner",
        nodeName: "Planner",
        startedAt: now,
      });

      expect(next.parts).toHaveLength(1);
      const part = next.parts![0] as WorkflowStepPart;
      expect(part.type).toBe("workflow-step");
      expect(part.nodeId).toBe("planner");
      expect(part.nodeName).toBe("Planner");
      expect(part.status).toBe("running");
      expect(part.startedAt).toBe(now);
    });

    test("workflow-step-complete transitions part to completed with duration", () => {
      let msg = createAssistantMessage();
      const startTime = Date.now();

      msg = applyStreamPartEvent(msg, {
        type: "workflow-step-start",
        nodeId: "planner",
        nodeName: "Planner",
        startedAt: startTime,
      });

      const completeTime = startTime + 2300;
      const next = applyStreamPartEvent(msg, {
        type: "workflow-step-complete",
        nodeId: "planner",
        status: "success",
        completedAt: completeTime,
      });

      expect(next.parts).toHaveLength(1);
      const part = next.parts![0] as WorkflowStepPart;
      expect(part.status).toBe("completed");
      expect(part.completedAt).toBe(completeTime);
      expect(part.durationMs).toBe(2300);
    });

    test("workflow-step-complete with error status transitions to error", () => {
      let msg = createAssistantMessage();
      const startTime = Date.now();

      msg = applyStreamPartEvent(msg, {
        type: "workflow-step-start",
        nodeId: "runner",
        nodeName: "Runner",
        startedAt: startTime,
      });

      const completeTime = startTime + 1500;
      const next = applyStreamPartEvent(msg, {
        type: "workflow-step-complete",
        nodeId: "runner",
        status: "error",
        completedAt: completeTime,
      });

      const part = next.parts![0] as WorkflowStepPart;
      expect(part.status).toBe("error");
      expect(part.durationMs).toBe(1500);
    });

    test("task-list-update inserts a TaskListPart", () => {
      const msg = createAssistantMessage();

      const next = applyStreamPartEvent(msg, {
        type: "task-list-update",
        tasks: [
          { id: "t1", title: "Plan", status: "complete" },
          { id: "t2", title: "Implement", status: "in_progress" },
        ],
      });

      expect(next.parts).toHaveLength(1);
      const part = next.parts![0] as TaskListPart;
      expect(part.type).toBe("task-list");
      expect(part.items).toHaveLength(2);
      expect(part.items[0]).toEqual({ id: "t1", content: "Plan", status: "completed" });
      expect(part.items[1]).toEqual({ id: "t2", content: "Implement", status: "in_progress" });
    });

    test("task-list-update upserts existing TaskListPart", () => {
      let msg = createAssistantMessage();

      msg = applyStreamPartEvent(msg, {
        type: "task-list-update",
        tasks: [{ id: "t1", title: "Plan", status: "pending" }],
      });

      const next = applyStreamPartEvent(msg, {
        type: "task-list-update",
        tasks: [
          { id: "t1", title: "Plan", status: "done" },
          { id: "t2", title: "Implement", status: "pending" },
        ],
      });

      // Still only one TaskListPart (upserted, not duplicated)
      const taskParts = next.parts!.filter((p) => p.type === "task-list");
      expect(taskParts).toHaveLength(1);
      const part = taskParts[0] as TaskListPart;
      expect(part.items).toHaveLength(2);
      expect(part.items[0]!.status).toBe("completed"); // "done" normalizes to "completed"
    });
  });

  // --------------------------------------------------------------------------
  // 3. Multi-step workflow sequence
  // --------------------------------------------------------------------------

  describe("multi-step workflow sequence", () => {
    test("start → text → complete → next start produces correct part ordering", () => {
      let msg = createAssistantMessage();
      const t0 = Date.now();

      // Step 1 starts
      msg = applyStreamPartEvent(msg, {
        type: "workflow-step-start",
        nodeId: "planner",
        nodeName: "Planner",
        startedAt: t0,
      });

      // Text output during step 1
      msg = applyStreamPartEvent(msg, { type: "text-delta", delta: "Planning..." });

      // Step 1 completes
      msg = applyStreamPartEvent(msg, {
        type: "workflow-step-complete",
        nodeId: "planner",
        status: "success",
        completedAt: t0 + 1000,
      });

      // Step 2 starts
      msg = applyStreamPartEvent(msg, {
        type: "workflow-step-start",
        nodeId: "executor",
        nodeName: "Executor",
        startedAt: t0 + 1100,
      });

      // Text output during step 2
      msg = applyStreamPartEvent(msg, { type: "text-delta", delta: " Executing..." });

      const partTypes = msg.parts!.map((p) => p.type);
      expect(partTypes).toContain("workflow-step");
      expect(partTypes).toContain("text");

      // Both workflow step parts should exist
      const stepParts = msg.parts!.filter((p) => p.type === "workflow-step") as WorkflowStepPart[];
      expect(stepParts).toHaveLength(2);
      expect(stepParts[0]!.nodeId).toBe("planner");
      expect(stepParts[0]!.status).toBe("completed");
      expect(stepParts[1]!.nodeId).toBe("executor");
      expect(stepParts[1]!.status).toBe("running");

      // Text content accumulated
      expect(msg.content).toBe("Planning... Executing...");
    });

    test("workflow steps interleaved with tool calls", () => {
      let msg = createAssistantMessage();
      const t0 = Date.now();

      msg = applyStreamPartEvent(msg, {
        type: "workflow-step-start",
        nodeId: "coder",
        nodeName: "Coder",
        startedAt: t0,
      });

      msg = applyStreamPartEvent(msg, {
        type: "tool-start",
        toolId: "tool_1",
        toolName: "Edit",
        input: { file: "main.ts" },
      });

      msg = applyStreamPartEvent(msg, {
        type: "tool-complete",
        toolId: "tool_1",
        output: "ok",
        success: true,
      });

      msg = applyStreamPartEvent(msg, {
        type: "workflow-step-complete",
        nodeId: "coder",
        status: "success",
        completedAt: t0 + 3000,
      });

      const stepPart = msg.parts!.find((p) => p.type === "workflow-step") as WorkflowStepPart;
      expect(stepPart.status).toBe("completed");
      expect(stepPart.durationMs).toBe(3000);

      const toolPart = msg.parts!.find((p) => p.type === "tool");
      expect(toolPart).toBeDefined();
      expect(toolPart!.type).toBe("tool");
    });

    test("workflow step + task list together", () => {
      let msg = createAssistantMessage();
      const t0 = Date.now();

      msg = applyStreamPartEvent(msg, {
        type: "task-list-update",
        tasks: [
          { id: "t1", title: "Plan", status: "in_progress" },
          { id: "t2", title: "Code", status: "pending" },
        ],
      });

      msg = applyStreamPartEvent(msg, {
        type: "workflow-step-start",
        nodeId: "planner",
        nodeName: "Planner",
        startedAt: t0,
      });

      msg = applyStreamPartEvent(msg, {
        type: "workflow-step-complete",
        nodeId: "planner",
        status: "success",
        completedAt: t0 + 500,
      });

      msg = applyStreamPartEvent(msg, {
        type: "task-list-update",
        tasks: [
          { id: "t1", title: "Plan", status: "done" },
          { id: "t2", title: "Code", status: "in_progress" },
        ],
      });

      // Task list and workflow step parts coexist
      const taskParts = msg.parts!.filter((p) => p.type === "task-list") as TaskListPart[];
      expect(taskParts).toHaveLength(1);
      expect(taskParts[0]!.items[0]!.status).toBe("completed");
      expect(taskParts[0]!.items[1]!.status).toBe("in_progress");

      const stepParts = msg.parts!.filter((p) => p.type === "workflow-step") as WorkflowStepPart[];
      expect(stepParts).toHaveLength(1);
      expect(stepParts[0]!.status).toBe("completed");
    });
  });

  // --------------------------------------------------------------------------
  // 4. PART_REGISTRY dispatch
  // --------------------------------------------------------------------------

  describe("PART_REGISTRY dispatch", () => {
    test("workflow-step type is registered in PART_REGISTRY", () => {
      expect(PART_REGISTRY["workflow-step"]).toBeDefined();
      expect(typeof PART_REGISTRY["workflow-step"]).toBe("function");
    });

    test("task-list type is registered in PART_REGISTRY", () => {
      expect(PART_REGISTRY["task-list"]).toBeDefined();
      expect(typeof PART_REGISTRY["task-list"]).toBe("function");
    });

    test("all Part union types have a registry entry", () => {
      const expectedTypes = [
        "text", "reasoning", "tool", "agent",
        "task-list", "skill-load", "mcp-snapshot",
        "compaction", "workflow-step",
      ];
      for (const type of expectedTypes) {
        expect(PART_REGISTRY[type as Part["type"]]).toBeDefined();
      }
    });
  });

  // --------------------------------------------------------------------------
  // 5. Full end-to-end: Bus event → Consumer → Reducer → Part → Registry
  // --------------------------------------------------------------------------

  describe("full end-to-end pipeline", () => {
    function publishEvent(type: string, data: Record<string, unknown>, sessionId = "wf-session", runId = 1) {
      bus.publish({
        type: type as any,
        sessionId,
        runId,
        timestamp: Date.now(),
        data,
      } as any);
    }

    test("workflow.step.start → reducer → rendered part", async () => {
      const { pipeline, correlation, dispose } = wireConsumers(bus, dispatcher);
      const output: StreamPartEvent[] = [];
      pipeline.onStreamParts((parts) => output.push(...parts));

      correlation.startRun(1, "wf-session");

      publishEvent("workflow.step.start", {
        workflowId: "wf1",
        nodeId: "planner",
        nodeName: "Planner",
      });

      await flushMicrotasks();
      await waitForBatchFlush();

      // Consumer produced a StreamPartEvent
      expect(output).toHaveLength(1);
      const streamEvent = output[0]!;
      expect(streamEvent.type).toBe("workflow-step-start");

      // Reducer creates a WorkflowStepPart
      let msg = createAssistantMessage();
      msg = applyStreamPartEvent(msg, streamEvent);

      const part = msg.parts![0] as WorkflowStepPart;
      expect(part.type).toBe("workflow-step");
      expect(part.status).toBe("running");

      // Registry can dispatch to a renderer
      const renderer = PART_REGISTRY[part.type];
      expect(renderer).toBeDefined();

      dispose();
    });

    test("full step lifecycle: start → complete through pipeline", async () => {
      const { pipeline, correlation, dispose } = wireConsumers(bus, dispatcher);
      const output: StreamPartEvent[] = [];
      pipeline.onStreamParts((parts) => output.push(...parts));

      correlation.startRun(1, "wf-session");

      publishEvent("workflow.step.start", {
        workflowId: "wf1",
        nodeId: "reviewer",
        nodeName: "Reviewer",
      });

      await flushMicrotasks();
      await waitForBatchFlush();

      publishEvent("workflow.step.complete", {
        workflowId: "wf1",
        nodeId: "reviewer",
        status: "success",
      });

      await flushMicrotasks();
      await waitForBatchFlush();

      // Apply all stream events through the reducer
      let msg = createAssistantMessage();
      for (const event of output) {
        msg = applyStreamPartEvent(msg, event);
      }

      expect(msg.parts).toHaveLength(1);
      const part = msg.parts![0] as WorkflowStepPart;
      expect(part.type).toBe("workflow-step");
      expect(part.status).toBe("completed");
      expect(part.durationMs).toBeDefined();
      expect(part.durationMs).toBeGreaterThanOrEqual(0);

      dispose();
    });

    test("full task update lifecycle through pipeline", async () => {
      const { pipeline, correlation, dispose } = wireConsumers(bus, dispatcher);
      const output: StreamPartEvent[] = [];
      pipeline.onStreamParts((parts) => output.push(...parts));

      correlation.startRun(1, "wf-session");

      publishEvent("workflow.task.update", {
        workflowId: "wf1",
        tasks: [
          { id: "t1", title: "Research", status: "complete" },
          { id: "t2", title: "Implement", status: "in_progress" },
          { id: "t3", title: "Test", status: "pending" },
        ],
      });

      await flushMicrotasks();
      await waitForBatchFlush();

      // Apply through reducer
      let msg = createAssistantMessage();
      for (const event of output) {
        msg = applyStreamPartEvent(msg, event);
      }

      expect(msg.parts).toHaveLength(1);
      const part = msg.parts![0] as TaskListPart;
      expect(part.type).toBe("task-list");
      expect(part.items).toHaveLength(3);
      expect(part.items[0]).toEqual({ id: "t1", content: "Research", status: "completed" });
      expect(part.items[1]).toEqual({ id: "t2", content: "Implement", status: "in_progress" });
      expect(part.items[2]).toEqual({ id: "t3", content: "Test", status: "pending" });

      // Registry can dispatch
      expect(PART_REGISTRY[part.type]).toBeDefined();

      dispose();
    });

    test("mixed workflow events through full pipeline", async () => {
      const { pipeline, correlation, dispose } = wireConsumers(bus, dispatcher);
      const output: StreamPartEvent[] = [];
      pipeline.onStreamParts((parts) => output.push(...parts));

      correlation.startRun(1, "wf-session");

      // Task list initial state
      publishEvent("workflow.task.update", {
        workflowId: "wf1",
        tasks: [
          { id: "t1", title: "Plan", status: "in_progress" },
          { id: "t2", title: "Code", status: "pending" },
        ],
      });

      // Step start
      publishEvent("workflow.step.start", {
        workflowId: "wf1",
        nodeId: "planner",
        nodeName: "Planner",
      });

      // Step complete
      publishEvent("workflow.step.complete", {
        workflowId: "wf1",
        nodeId: "planner",
        status: "success",
      });

      // Task list updated
      publishEvent("workflow.task.update", {
        workflowId: "wf1",
        tasks: [
          { id: "t1", title: "Plan", status: "done" },
          { id: "t2", title: "Code", status: "in_progress" },
        ],
      });

      await flushMicrotasks();
      await waitForBatchFlush();

      // Apply all events through reducer
      let msg = createAssistantMessage();
      for (const event of output) {
        msg = applyStreamPartEvent(msg, event);
      }

      // Verify final state: 1 task-list (upserted) + 1 workflow-step (completed)
      const taskParts = msg.parts!.filter((p) => p.type === "task-list");
      expect(taskParts).toHaveLength(1);
      const taskPart = taskParts[0] as TaskListPart;
      expect(taskPart.items[0]!.status).toBe("completed");
      expect(taskPart.items[1]!.status).toBe("in_progress");

      const stepParts = msg.parts!.filter((p) => p.type === "workflow-step");
      expect(stepParts).toHaveLength(1);
      expect((stepParts[0] as WorkflowStepPart).status).toBe("completed");

      dispose();
    });
  });

  // --------------------------------------------------------------------------
  // 6. Edge cases
  // --------------------------------------------------------------------------

  describe("edge cases", () => {
    test("workflow-step-complete for unknown nodeId is a no-op", () => {
      const msg = createAssistantMessage();

      const next = applyStreamPartEvent(msg, {
        type: "workflow-step-complete",
        nodeId: "nonexistent",
        status: "success",
        completedAt: Date.now(),
      });

      // No parts created - the complete event for a non-existent start is harmless
      expect(next.parts).toHaveLength(0);
    });

    test("task-list-update normalizes various status strings", () => {
      const msg = createAssistantMessage();

      const next = applyStreamPartEvent(msg, {
        type: "task-list-update",
        tasks: [
          { id: "t1", title: "A", status: "done" },
          { id: "t2", title: "B", status: "success" },
          { id: "t3", title: "C", status: "failed" },
          { id: "t4", title: "D", status: "complete" },
          { id: "t5", title: "E", status: "unknown_status" },
        ],
      });

      const part = next.parts![0] as TaskListPart;
      expect(part.items[0]!.status).toBe("completed");  // done → completed
      expect(part.items[1]!.status).toBe("completed");  // success → completed
      expect(part.items[2]!.status).toBe("error");       // failed → error
      expect(part.items[3]!.status).toBe("completed");  // complete → completed
      expect(part.items[4]!.status).toBe("pending");     // unknown → pending
    });

    test("skipped status maps to error in reducer", () => {
      let msg = createAssistantMessage();
      const t0 = Date.now();

      msg = applyStreamPartEvent(msg, {
        type: "workflow-step-start",
        nodeId: "optional",
        nodeName: "OptionalStep",
        startedAt: t0,
      });

      msg = applyStreamPartEvent(msg, {
        type: "workflow-step-complete",
        nodeId: "optional",
        status: "skipped",
        completedAt: t0 + 100,
      });

      // "skipped" is not "success", so it maps to "error" in the reducer
      const part = msg.parts![0] as WorkflowStepPart;
      expect(part.status).toBe("error");
    });
  });
});
