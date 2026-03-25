/**
 * Tests for the main `applyStreamPartEvent` unified event reducer.
 *
 * Validates that each StreamPartEvent type correctly transforms a ChatMessage
 * by dispatching to the appropriate handler and returning the expected state.
 * No mocks — tests exercise real reducer behavior end-to-end.
 */

import { test, describe, expect, beforeEach } from "bun:test";
import { applyStreamPartEvent } from "@/state/streaming/pipeline.ts";
import type {
  StreamPartEvent,
  TextDeltaEvent,
  TextCompleteEvent,
  ThinkingMetaEvent,
  ThinkingCompleteEvent,
  ToolStartEvent,
  ToolCompleteEvent,
  ToolPartialResultEvent,
  TaskListUpdateEvent,
  TaskResultUpsertEvent,
  WorkflowStepStartEvent,
  WorkflowStepCompleteEvent,
} from "@/state/streaming/pipeline-types.ts";
import type { ChatMessage } from "@/types/chat.ts";
import type {
  TextPart,
  ReasoningPart,
  ToolPart,
  TaskListPart,
  TaskResultPart,
  WorkflowStepPart,
} from "@/state/parts/types.ts";
import { _resetPartCounter } from "@/state/parts/id.ts";
import { resetPartIdCounter } from "../../test-support/fixtures/parts.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createBaseMessage(overrides?: Partial<ChatMessage>): ChatMessage {
  return {
    id: "msg-1",
    role: "assistant",
    content: "",
    timestamp: new Date().toISOString(),
    parts: [],
    streaming: true,
    ...overrides,
  } as ChatMessage;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("applyStreamPartEvent", () => {
  beforeEach(() => {
    _resetPartCounter();
    resetPartIdCounter();
  });

  // =========================================================================
  // text-delta
  // =========================================================================

  describe("text-delta", () => {
    test("appends text to message content and creates a TextPart", () => {
      const msg = createBaseMessage();
      const event: TextDeltaEvent = {
        type: "text-delta",
        delta: "Hello",
      };

      const result = applyStreamPartEvent(msg, event);

      expect(result.content).toBe("Hello");
      expect(result.parts).toHaveLength(1);
      const textPart = result.parts![0] as TextPart;
      expect(textPart.type).toBe("text");
      expect(textPart.content).toBe("Hello");
      expect(textPart.isStreaming).toBe(true);
    });

    test("appends multiple text deltas to existing streaming TextPart", () => {
      const msg = createBaseMessage();
      const event1: TextDeltaEvent = { type: "text-delta", delta: "Hello" };
      const event2: TextDeltaEvent = { type: "text-delta", delta: ", world!" };

      const after1 = applyStreamPartEvent(msg, event1);
      const after2 = applyStreamPartEvent(after1, event2);

      expect(after2.content).toBe("Hello, world!");
      expect(after2.parts).toHaveLength(1);
      const textPart = after2.parts![0] as TextPart;
      expect(textPart.content).toBe("Hello, world!");
      expect(textPart.isStreaming).toBe(true);
    });
  });

  // =========================================================================
  // text-complete
  // =========================================================================

  describe("text-complete", () => {
    test("returns message unchanged", () => {
      const msg = createBaseMessage({ content: "done" });
      const event: TextCompleteEvent = {
        type: "text-complete",
        fullText: "done",
        messageId: "msg-1",
      };

      const result = applyStreamPartEvent(msg, event);

      expect(result).toBe(msg);
    });
  });

  // =========================================================================
  // tool-start
  // =========================================================================

  describe("tool-start", () => {
    test("creates a ToolPart with running state", () => {
      const msg = createBaseMessage();
      const event: ToolStartEvent = {
        type: "tool-start",
        toolId: "tool-call-1",
        toolName: "Read",
        input: { file_path: "/tmp/test.ts" },
      };

      const result = applyStreamPartEvent(msg, event);

      expect(result.parts!.length).toBeGreaterThanOrEqual(1);
      const toolPart = result.parts!.find(
        (p) => p.type === "tool",
      ) as ToolPart;
      expect(toolPart).toBeDefined();
      expect(toolPart.type).toBe("tool");
      expect(toolPart.toolCallId).toBe("tool-call-1");
      expect(toolPart.toolName).toBe("Read");
      expect(toolPart.input).toEqual({ file_path: "/tmp/test.ts" });
      expect(toolPart.state.status).toBe("running");
    });

    test("updates existing tool part if same toolId already exists", () => {
      const msg = createBaseMessage();
      const startEvent: ToolStartEvent = {
        type: "tool-start",
        toolId: "tool-call-1",
        toolName: "Read",
        input: { file_path: "/tmp/a.ts" },
      };

      const after1 = applyStreamPartEvent(msg, startEvent);
      const toolParts1 = after1.parts!.filter((p) => p.type === "tool");
      expect(toolParts1).toHaveLength(1);

      // Send another start event with same toolId but different input
      const startEvent2: ToolStartEvent = {
        type: "tool-start",
        toolId: "tool-call-1",
        toolName: "Read",
        input: { file_path: "/tmp/b.ts" },
      };
      const after2 = applyStreamPartEvent(after1, startEvent2);
      const toolParts2 = after2.parts!.filter((p) => p.type === "tool");
      expect(toolParts2).toHaveLength(1);
      expect((toolParts2[0] as ToolPart).input).toEqual({
        file_path: "/tmp/b.ts",
      });
    });
  });

  // =========================================================================
  // tool-complete (success)
  // =========================================================================

  describe("tool-complete (success)", () => {
    test("marks tool as completed with output", () => {
      const msg = createBaseMessage();
      const startEvent: ToolStartEvent = {
        type: "tool-start",
        toolId: "tool-call-1",
        toolName: "Read",
        input: { file_path: "/tmp/test.ts" },
      };
      const completeEvent: ToolCompleteEvent = {
        type: "tool-complete",
        toolId: "tool-call-1",
        output: "file contents here",
        success: true,
      };

      const afterStart = applyStreamPartEvent(msg, startEvent);
      const afterComplete = applyStreamPartEvent(afterStart, completeEvent);

      const toolPart = afterComplete.parts!.find(
        (p) => p.type === "tool",
      ) as ToolPart;
      expect(toolPart).toBeDefined();
      expect(toolPart.state.status).toBe("completed");
      expect(toolPart.output).toBe("file contents here");
    });

    test("creates tool part on complete even if tool-start was not received", () => {
      const msg = createBaseMessage();
      const completeEvent: ToolCompleteEvent = {
        type: "tool-complete",
        toolId: "tool-orphan",
        toolName: "Write",
        output: "written",
        success: true,
        input: { content: "data" },
      };

      const result = applyStreamPartEvent(msg, completeEvent);

      const toolPart = result.parts!.find(
        (p) => p.type === "tool",
      ) as ToolPart;
      expect(toolPart).toBeDefined();
      expect(toolPart.toolCallId).toBe("tool-orphan");
      expect(toolPart.state.status).toBe("completed");
    });
  });

  // =========================================================================
  // tool-complete (error)
  // =========================================================================

  describe("tool-complete (error)", () => {
    test("marks tool as error with error message", () => {
      const msg = createBaseMessage();
      const startEvent: ToolStartEvent = {
        type: "tool-start",
        toolId: "tool-call-err",
        toolName: "Execute",
        input: { command: "fail" },
      };
      const completeEvent: ToolCompleteEvent = {
        type: "tool-complete",
        toolId: "tool-call-err",
        output: null,
        success: false,
        error: "Command failed with exit code 1",
      };

      const afterStart = applyStreamPartEvent(msg, startEvent);
      const afterComplete = applyStreamPartEvent(afterStart, completeEvent);

      const toolPart = afterComplete.parts!.find(
        (p) => p.type === "tool",
      ) as ToolPart;
      expect(toolPart).toBeDefined();
      expect(toolPart.state.status).toBe("error");
      if (toolPart.state.status === "error") {
        expect(toolPart.state.error).toBe(
          "Command failed with exit code 1",
        );
      }
    });

    test("defaults to 'Unknown error' when error string is empty", () => {
      const msg = createBaseMessage();
      const startEvent: ToolStartEvent = {
        type: "tool-start",
        toolId: "tool-call-err2",
        toolName: "Execute",
        input: {},
      };
      const completeEvent: ToolCompleteEvent = {
        type: "tool-complete",
        toolId: "tool-call-err2",
        output: undefined,
        success: false,
        error: "",
      };

      const afterStart = applyStreamPartEvent(msg, startEvent);
      const afterComplete = applyStreamPartEvent(afterStart, completeEvent);

      const toolPart = afterComplete.parts!.find(
        (p) => p.type === "tool",
      ) as ToolPart;
      expect(toolPart.state.status).toBe("error");
      if (toolPart.state.status === "error") {
        expect(toolPart.state.error).toBe("Unknown error");
      }
    });
  });

  // =========================================================================
  // tool-partial-result
  // =========================================================================

  describe("tool-partial-result", () => {
    test("appends partial output to an existing tool part", () => {
      const msg = createBaseMessage();
      const startEvent: ToolStartEvent = {
        type: "tool-start",
        toolId: "tool-partial",
        toolName: "LongRunning",
        input: {},
      };
      const partialEvent1: ToolPartialResultEvent = {
        type: "tool-partial-result",
        toolId: "tool-partial",
        partialOutput: "chunk1",
      };
      const partialEvent2: ToolPartialResultEvent = {
        type: "tool-partial-result",
        toolId: "tool-partial",
        partialOutput: "chunk2",
      };

      const afterStart = applyStreamPartEvent(msg, startEvent);
      const afterPartial1 = applyStreamPartEvent(afterStart, partialEvent1);
      const afterPartial2 = applyStreamPartEvent(afterPartial1, partialEvent2);

      const toolPart = afterPartial2.parts!.find(
        (p) => p.type === "tool",
      ) as ToolPart;
      expect(toolPart).toBeDefined();
      expect(toolPart.partialOutput).toBe("chunk1chunk2");
      expect(toolPart.state.status).toBe("running");
    });

    test("does nothing if tool part does not exist", () => {
      const msg = createBaseMessage();
      const partialEvent: ToolPartialResultEvent = {
        type: "tool-partial-result",
        toolId: "nonexistent",
        partialOutput: "data",
      };

      const result = applyStreamPartEvent(msg, partialEvent);

      // Parts should remain empty since there's no matching tool part
      expect(result.parts).toHaveLength(0);
    });
  });

  // =========================================================================
  // thinking-meta
  // =========================================================================

  describe("thinking-meta", () => {
    test("creates reasoning part when includeReasoningPart is true", () => {
      const msg = createBaseMessage();
      const event: ThinkingMetaEvent = {
        type: "thinking-meta",
        thinkingSourceKey: "src-1",
        targetMessageId: "msg-1",
        streamGeneration: 1,
        thinkingText: "Let me think about this...",
        thinkingMs: 500,
        includeReasoningPart: true,
      };

      const result = applyStreamPartEvent(msg, event);

      expect(result.thinkingMs).toBe(500);
      expect(result.thinkingText).toBe("Let me think about this...");
      const reasoningPart = result.parts!.find(
        (p) => p.type === "reasoning",
      ) as ReasoningPart;
      expect(reasoningPart).toBeDefined();
      expect(reasoningPart.content).toBe("Let me think about this...");
      expect(reasoningPart.durationMs).toBe(500);
      expect(reasoningPart.isStreaming).toBe(true);
      expect(reasoningPart.thinkingSourceKey).toBe("src-1");
    });

    test("updates thinkingMs and thinkingText without creating part when includeReasoningPart is false", () => {
      const msg = createBaseMessage();
      const event: ThinkingMetaEvent = {
        type: "thinking-meta",
        thinkingSourceKey: "src-1",
        targetMessageId: "msg-1",
        streamGeneration: 1,
        thinkingText: "thinking...",
        thinkingMs: 200,
        includeReasoningPart: false,
      };

      const result = applyStreamPartEvent(msg, event);

      expect(result.thinkingMs).toBe(200);
      expect(result.thinkingText).toBe("thinking...");
      // No reasoning part should be created
      const reasoningParts = result.parts!.filter(
        (p) => p.type === "reasoning",
      );
      expect(reasoningParts).toHaveLength(0);
    });

    test("updates existing reasoning part on subsequent events with same sourceKey", () => {
      const msg = createBaseMessage();
      const event1: ThinkingMetaEvent = {
        type: "thinking-meta",
        thinkingSourceKey: "src-1",
        targetMessageId: "msg-1",
        streamGeneration: 1,
        thinkingText: "First thought",
        thinkingMs: 100,
        includeReasoningPart: true,
      };
      const event2: ThinkingMetaEvent = {
        type: "thinking-meta",
        thinkingSourceKey: "src-1",
        targetMessageId: "msg-1",
        streamGeneration: 1,
        thinkingText: "First thought, extended reasoning",
        thinkingMs: 300,
        includeReasoningPart: true,
      };

      const after1 = applyStreamPartEvent(msg, event1);
      const after2 = applyStreamPartEvent(after1, event2);

      // Should still have only one reasoning part
      const reasoningParts = after2.parts!.filter(
        (p) => p.type === "reasoning",
      );
      expect(reasoningParts).toHaveLength(1);
      const part = reasoningParts[0] as ReasoningPart;
      expect(part.content).toBe("First thought, extended reasoning");
      expect(part.durationMs).toBe(300);
    });
  });

  // =========================================================================
  // thinking-complete
  // =========================================================================

  describe("thinking-complete", () => {
    test("finalizes a thinking source by setting isStreaming to false", () => {
      const msg = createBaseMessage();
      // First, create a streaming reasoning part
      const metaEvent: ThinkingMetaEvent = {
        type: "thinking-meta",
        thinkingSourceKey: "src-finalize",
        targetMessageId: "msg-1",
        streamGeneration: 1,
        thinkingText: "My reasoning",
        thinkingMs: 400,
        includeReasoningPart: true,
      };
      const completeEvent: ThinkingCompleteEvent = {
        type: "thinking-complete",
        sourceKey: "src-finalize",
        durationMs: 450,
      };

      const afterMeta = applyStreamPartEvent(msg, metaEvent);
      const afterComplete = applyStreamPartEvent(afterMeta, completeEvent);

      const reasoningPart = afterComplete.parts!.find(
        (p) => p.type === "reasoning",
      ) as ReasoningPart;
      expect(reasoningPart).toBeDefined();
      expect(reasoningPart.isStreaming).toBe(false);
      expect(reasoningPart.durationMs).toBe(450);
    });

    test("returns message unchanged if sourceKey does not match any part", () => {
      const msg = createBaseMessage();
      const completeEvent: ThinkingCompleteEvent = {
        type: "thinking-complete",
        sourceKey: "nonexistent-source",
        durationMs: 100,
      };

      const result = applyStreamPartEvent(msg, completeEvent);

      // Message should be returned as-is since no matching part exists
      expect(result.parts).toHaveLength(0);
    });
  });

  // =========================================================================
  // task-list-update
  // =========================================================================

  describe("task-list-update", () => {
    test("creates TaskListPart with normalized statuses", () => {
      const msg = createBaseMessage();
      const event: TaskListUpdateEvent = {
        type: "task-list-update",
        tasks: [
          { id: "t1", title: "First task", status: "pending" },
          { id: "t2", title: "Second task", status: "in_progress" },
          { id: "t3", title: "Third task", status: "completed" },
          { id: "t4", title: "Fourth task", status: "failed" },
        ],
      };

      const result = applyStreamPartEvent(msg, event);

      const taskListPart = result.parts!.find(
        (p) => p.type === "task-list",
      ) as TaskListPart;
      expect(taskListPart).toBeDefined();
      expect(taskListPart.type).toBe("task-list");
      expect(taskListPart.items).toHaveLength(4);
      expect(taskListPart.items[0]!.status).toBe("pending");
      expect(taskListPart.items[1]!.status).toBe("in_progress");
      expect(taskListPart.items[2]!.status).toBe("completed");
      expect(taskListPart.items[3]!.status).toBe("error");
      expect(taskListPart.expanded).toBe(false);
    });

    test("normalizes alternate status names to canonical values", () => {
      const msg = createBaseMessage();
      const event: TaskListUpdateEvent = {
        type: "task-list-update",
        tasks: [
          { id: "t1", title: "Done task", status: "completed" },
          { id: "t2", title: "Success task", status: "completed" },
          { id: "t3", title: "Unknown status", status: "pending" },
        ],
      };

      const result = applyStreamPartEvent(msg, event);

      const taskListPart = result.parts!.find(
        (p) => p.type === "task-list",
      ) as TaskListPart;
      expect(taskListPart.items[0]!.status).toBe("completed");
      expect(taskListPart.items[1]!.status).toBe("completed");
      expect(taskListPart.items[2]!.status).toBe("pending");
    });

    test("updates existing TaskListPart on subsequent events", () => {
      const msg = createBaseMessage();
      const event1: TaskListUpdateEvent = {
        type: "task-list-update",
        tasks: [
          { id: "t1", title: "Task A", status: "pending" },
        ],
      };
      const event2: TaskListUpdateEvent = {
        type: "task-list-update",
        tasks: [
          { id: "t1", title: "Task A", status: "completed" },
          { id: "t2", title: "Task B", status: "in_progress" },
        ],
      };

      const after1 = applyStreamPartEvent(msg, event1);
      const after2 = applyStreamPartEvent(after1, event2);

      const taskListParts = after2.parts!.filter(
        (p) => p.type === "task-list",
      );
      // Should still only have one task-list part (upserted, not duplicated)
      expect(taskListParts).toHaveLength(1);
      const taskListPart = taskListParts[0] as TaskListPart;
      expect(taskListPart.items).toHaveLength(2);
      expect(taskListPart.items[0]!.status).toBe("completed");
      expect(taskListPart.items[1]!.status).toBe("in_progress");
    });

    test("maps task descriptions and blockedBy correctly", () => {
      const msg = createBaseMessage();
      const event: TaskListUpdateEvent = {
        type: "task-list-update",
        tasks: [
          {
            id: "t1",
            title: "First task",
            status: "completed",
          },
          {
            id: "t2",
            title: "Second task",
            status: "pending",
            blockedBy: ["t1"],
          },
        ],
      };

      const result = applyStreamPartEvent(msg, event);

      const taskListPart = result.parts!.find(
        (p) => p.type === "task-list",
      ) as TaskListPart;
      expect(taskListPart.items[0]!.description).toBe("First task");
      expect(taskListPart.items[1]!.description).toBe("Second task");
      expect(taskListPart.items[1]!.blockedBy).toEqual(["t1"]);
    });
  });

  // =========================================================================
  // task-result-upsert
  // =========================================================================

  describe("task-result-upsert", () => {
    test("creates TaskResultPart from envelope", () => {
      const msg = createBaseMessage();
      const event: TaskResultUpsertEvent = {
        type: "task-result-upsert",
        envelope: {
          task_id: "task-1",
          tool_name: "Task",
          title: "Implement feature X",
          status: "completed",
          output_text: "Feature implemented successfully.",
        },
      };

      const result = applyStreamPartEvent(msg, event);

      const taskResultPart = result.parts!.find(
        (p) => p.type === "task-result",
      ) as TaskResultPart;
      expect(taskResultPart).toBeDefined();
      expect(taskResultPart.taskId).toBe("task-1");
      expect(taskResultPart.toolName).toBe("Task");
      expect(taskResultPart.title).toBe("Implement feature X");
      expect(taskResultPart.status).toBe("completed");
      expect(taskResultPart.outputText).toBe(
        "Feature implemented successfully.",
      );
    });

    test("updates existing TaskResultPart with same taskId", () => {
      const msg = createBaseMessage();
      const event1: TaskResultUpsertEvent = {
        type: "task-result-upsert",
        envelope: {
          task_id: "task-1",
          tool_name: "Task",
          title: "Implement feature X",
          status: "completed",
          output_text: "In progress...",
        },
      };
      const event2: TaskResultUpsertEvent = {
        type: "task-result-upsert",
        envelope: {
          task_id: "task-1",
          tool_name: "Task",
          title: "Implement feature X",
          status: "completed",
          output_text: "Done!",
        },
      };

      const after1 = applyStreamPartEvent(msg, event1);
      const after2 = applyStreamPartEvent(after1, event2);

      const taskResultParts = after2.parts!.filter(
        (p) => p.type === "task-result",
      );
      expect(taskResultParts).toHaveLength(1);
      expect((taskResultParts[0] as TaskResultPart).outputText).toBe("Done!");
    });
  });

  // =========================================================================
  // workflow-step-start
  // =========================================================================

  describe("workflow-step-start", () => {
    test("creates WorkflowStepPart with running status", () => {
      const msg = createBaseMessage();
      const event: WorkflowStepStartEvent = {
        type: "workflow-step-start",
        workflowId: "wf-1",
        nodeId: "planner",
        indicator: "[PLANNER]",
      };

      const result = applyStreamPartEvent(msg, event);

      const stepPart = result.parts!.find(
        (p) => p.type === "workflow-step",
      ) as WorkflowStepPart;
      expect(stepPart).toBeDefined();
      expect(stepPart.type).toBe("workflow-step");
      expect(stepPart.workflowId).toBe("wf-1");
      expect(stepPart.nodeId).toBe("planner");
      expect(stepPart.status).toBe("running");
      expect(stepPart.startedAt).toBeDefined();
    });

    test("updates existing step part for same workflowId and nodeId", () => {
      const msg = createBaseMessage();
      const event1: WorkflowStepStartEvent = {
        type: "workflow-step-start",
        workflowId: "wf-1",
        nodeId: "planner",
        indicator: "[PLANNER]",
      };
      const event2: WorkflowStepStartEvent = {
        type: "workflow-step-start",
        workflowId: "wf-1",
        nodeId: "planner",
        indicator: "[PLANNER v2]",
      };

      const after1 = applyStreamPartEvent(msg, event1);
      const after2 = applyStreamPartEvent(after1, event2);

      const stepParts = after2.parts!.filter(
        (p) => p.type === "workflow-step",
      );
      expect(stepParts).toHaveLength(1);
      expect((stepParts[0] as WorkflowStepPart).status).toBe("running");
    });
  });

  // =========================================================================
  // workflow-step-complete
  // =========================================================================

  describe("workflow-step-complete", () => {
    test("updates WorkflowStepPart with completed status", () => {
      const msg = createBaseMessage();
      const startEvent: WorkflowStepStartEvent = {
        type: "workflow-step-start",
        workflowId: "wf-1",
        nodeId: "researcher",
        indicator: "[RESEARCHER]",
      };
      const completeEvent: WorkflowStepCompleteEvent = {
        type: "workflow-step-complete",
        workflowId: "wf-1",
        nodeId: "researcher",
        status: "completed",
        durationMs: 2500,
      };

      const afterStart = applyStreamPartEvent(msg, startEvent);
      const afterComplete = applyStreamPartEvent(afterStart, completeEvent);

      const stepPart = afterComplete.parts!.find(
        (p) => p.type === "workflow-step",
      ) as WorkflowStepPart;
      expect(stepPart).toBeDefined();
      expect(stepPart.status).toBe("completed");
      expect(stepPart.durationMs).toBe(2500);
      expect(stepPart.completedAt).toBeDefined();
    });

    test("updates WorkflowStepPart with error status and error message", () => {
      const msg = createBaseMessage();
      const startEvent: WorkflowStepStartEvent = {
        type: "workflow-step-start",
        workflowId: "wf-1",
        nodeId: "executor",
        indicator: "[EXECUTOR]",
      };
      const completeEvent: WorkflowStepCompleteEvent = {
        type: "workflow-step-complete",
        workflowId: "wf-1",
        nodeId: "executor",
        status: "error",
        durationMs: 100,
        error: "Step failed due to timeout",
      };

      const afterStart = applyStreamPartEvent(msg, startEvent);
      const afterComplete = applyStreamPartEvent(afterStart, completeEvent);

      const stepPart = afterComplete.parts!.find(
        (p) => p.type === "workflow-step",
      ) as WorkflowStepPart;
      expect(stepPart).toBeDefined();
      expect(stepPart.status).toBe("error");
      expect(stepPart.error).toBe("Step failed due to timeout");
    });

    test("skipped steps do not create or modify parts", () => {
      const msg = createBaseMessage();
      const completeEvent: WorkflowStepCompleteEvent = {
        type: "workflow-step-complete",
        workflowId: "wf-1",
        nodeId: "optional-step",
        status: "skipped",
        durationMs: 0,
      };

      const result = applyStreamPartEvent(msg, completeEvent);

      expect(result.parts).toHaveLength(0);
    });

    test("creates WorkflowStepPart on complete even without prior start", () => {
      const msg = createBaseMessage();
      const completeEvent: WorkflowStepCompleteEvent = {
        type: "workflow-step-complete",
        workflowId: "wf-1",
        nodeId: "orphan-step",
        status: "completed",
        durationMs: 1000,
      };

      const result = applyStreamPartEvent(msg, completeEvent);

      const stepPart = result.parts!.find(
        (p) => p.type === "workflow-step",
      ) as WorkflowStepPart;
      expect(stepPart).toBeDefined();
      expect(stepPart.status).toBe("completed");
      expect(stepPart.durationMs).toBe(1000);
    });
  });

  // =========================================================================
  // Integration: mixed event sequence
  // =========================================================================

  describe("mixed event sequence", () => {
    test("handles a sequence of text, tool, and thinking events", () => {
      let msg = createBaseMessage();

      // 1. Start with text
      msg = applyStreamPartEvent(msg, {
        type: "text-delta",
        delta: "I'll read the file. ",
      } as TextDeltaEvent);

      // 2. Tool starts
      msg = applyStreamPartEvent(msg, {
        type: "tool-start",
        toolId: "tc-1",
        toolName: "Read",
        input: { path: "/test.ts" },
      } as ToolStartEvent);

      // 3. Tool completes
      msg = applyStreamPartEvent(msg, {
        type: "tool-complete",
        toolId: "tc-1",
        output: "file content",
        success: true,
      } as ToolCompleteEvent);

      // 4. More text
      msg = applyStreamPartEvent(msg, {
        type: "text-delta",
        delta: "The file contains...",
      } as TextDeltaEvent);

      expect(msg.content).toBe("I'll read the file. The file contains...");

      // Should have text part(s) and a tool part
      const toolParts = msg.parts!.filter((p) => p.type === "tool");
      const textParts = msg.parts!.filter((p) => p.type === "text");

      expect(toolParts).toHaveLength(1);
      expect(textParts.length).toBeGreaterThanOrEqual(1);

      const toolPart = toolParts[0] as ToolPart;
      expect(toolPart.state.status).toBe("completed");
    });
  });
});
