import { describe, expect, test } from "bun:test";
import { applyStreamPartEvent } from "@/state/parts/stream-pipeline.ts";
import type { StreamPartEvent } from "@/state/streaming/pipeline-types.ts";
import type { ChatMessage } from "@/types/chat.ts";
import {
  createAssistantMessage,
  registerStreamPipelineHooks,
} from "./stream-pipeline.fixtures.ts";

registerStreamPipelineHooks();

/**
 * Asserts that part IDs in the message are strictly monotonically increasing.
 *
 * Following OpenCode's methodology, parts are always ordered by their
 * monotonic timestamp-based IDs with no special-case overrides. Correct
 * reasoning-before-text ordering is ensured at the adapter level (e.g.,
 * the Copilot adapter buffers text deltas until thinking status is resolved).
 */
function expectSortedPartIds(message: ChatMessage): void {
  const parts = message.parts ?? [];
  for (let i = 1; i < parts.length; i++) {
    const prev = parts[i - 1]!;
    const curr = parts[i]!;
    expect(curr.id > prev.id).toBe(true);
  }
}

/**
 * Applies a sequence of events to a fresh message and returns the final message.
 * Asserts the ordering invariant holds after each intermediate step.
 */
function applySequence(events: StreamPartEvent[]): ChatMessage {
  let msg = createAssistantMessage();
  for (const event of events) {
    msg = applyStreamPartEvent(msg, event);
    expectSortedPartIds(msg);
  }
  return msg;
}

// ---------------------------------------------------------------------------
// Per-event-type ordering invariants
// ---------------------------------------------------------------------------

describe("applyStreamPartEvent — ordering invariants", () => {
  describe("text-delta", () => {
    test("single text-delta produces one part with valid ID", () => {
      const msg = applySequence([{ type: "text-delta", delta: "Hello" }]);
      expect(msg.parts).toHaveLength(1);
      expect(msg.parts![0]!.type).toBe("text");
    });

    test("consecutive text-deltas append to the same part without reordering", () => {
      const msg = applySequence([
        { type: "text-delta", delta: "Hello " },
        { type: "text-delta", delta: "world" },
      ]);
      expect(msg.parts).toHaveLength(1);
      if (msg.parts![0]!.type === "text") {
        expect(msg.parts![0]!.content).toBe("Hello world");
      }
    });

    test("text-delta after tool creates a new text part in sorted position", () => {
      const msg = applySequence([
        { type: "text-delta", delta: "Before " },
        {
          type: "tool-start",
          toolId: "t1",
          toolName: "Read",
          input: { path: "a.ts" },
        },
        {
          type: "tool-complete",
          toolId: "t1",
          output: "ok",
          success: true,
        },
        { type: "text-delta", delta: "After" },
      ]);

      expect(msg.parts!.map((p) => p.type)).toEqual(["text", "tool", "text"]);
      expectSortedPartIds(msg);
    });
  });

  describe("thinking-meta", () => {
    test("reasoning part without includeReasoningPart preserves empty parts order", () => {
      const msg = applySequence([
        {
          type: "thinking-meta",
          thinkingSourceKey: "s1",
          targetMessageId: "msg-test",
          streamGeneration: 1,
          thinkingMs: 500,
          thinkingText: "thinking",
        },
      ]);
      expect(msg.parts).toHaveLength(0);
      expectSortedPartIds(msg);
    });

    test("reasoning part with includeReasoningPart inserts in sorted position", () => {
      const msg = applySequence([
        {
          type: "thinking-meta",
          thinkingSourceKey: "s1",
          targetMessageId: "msg-test",
          streamGeneration: 1,
          thinkingMs: 500,
          thinkingText: "thinking",
          includeReasoningPart: true,
        },
        { type: "text-delta", delta: "answer" },
      ]);

      expect(msg.parts!.map((p) => p.type)).toEqual(["reasoning", "text"]);
      expectSortedPartIds(msg);
    });

    test("updating same source key preserves part position and order", () => {
      const msg = applySequence([
        {
          type: "thinking-meta",
          thinkingSourceKey: "s1",
          targetMessageId: "msg-test",
          streamGeneration: 1,
          thinkingMs: 200,
          thinkingText: "draft",
          includeReasoningPart: true,
        },
        { type: "text-delta", delta: "text" },
        {
          type: "thinking-meta",
          thinkingSourceKey: "s1",
          targetMessageId: "msg-test",
          streamGeneration: 1,
          thinkingMs: 400,
          thinkingText: "refined",
          includeReasoningPart: true,
        },
      ]);

      const reasoningParts = msg.parts!.filter((p) => p.type === "reasoning");
      expect(reasoningParts).toHaveLength(1);
      expectSortedPartIds(msg);
    });

    test("multiple distinct source keys are inserted in ID order", () => {
      const msg = applySequence([
        {
          type: "thinking-meta",
          thinkingSourceKey: "source:a",
          targetMessageId: "msg-test",
          streamGeneration: 1,
          thinkingMs: 100,
          thinkingText: "alpha",
          includeReasoningPart: true,
        },
        { type: "text-delta", delta: "mid" },
        {
          type: "thinking-meta",
          thinkingSourceKey: "source:b",
          targetMessageId: "msg-test",
          streamGeneration: 1,
          thinkingMs: 200,
          thinkingText: "beta",
          includeReasoningPart: true,
        },
      ]);

      // Parts are ordered by creation time (ID). The adapter layer is
      // responsible for emitting events in the correct order.
      expect(msg.parts!.map((p) => p.type)).toEqual([
        "reasoning",
        "text",
        "reasoning",
      ]);
      expectSortedPartIds(msg);
    });
  });

  describe("thinking-complete", () => {
    test("thinking-complete does not change part count or ordering", () => {
      let msg = applySequence([
        {
          type: "thinking-meta",
          thinkingSourceKey: "s1",
          targetMessageId: "msg-test",
          streamGeneration: 1,
          thinkingMs: 500,
          thinkingText: "thought",
          includeReasoningPart: true,
        },
        { type: "text-delta", delta: "answer" },
      ]);

      const beforeIds = msg.parts!.map((p) => p.id);

      msg = applyStreamPartEvent(msg, {
        type: "thinking-complete",
        sourceKey: "s1",
        durationMs: 600,
      });

      expect(msg.parts!.map((p) => p.id)).toEqual(beforeIds);
      expectSortedPartIds(msg);
    });
  });

  describe("tool-start", () => {
    test("first tool-start creates a tool part in sorted position", () => {
      const msg = applySequence([
        { type: "text-delta", delta: "preamble" },
        {
          type: "tool-start",
          toolId: "t1",
          toolName: "bash",
          input: { command: "ls" },
        },
      ]);

      expect(msg.parts!.map((p) => p.type)).toEqual(["text", "tool"]);
      expectSortedPartIds(msg);
    });

    test("multiple tool-starts create parts in sorted order", () => {
      const msg = applySequence([
        {
          type: "tool-start",
          toolId: "t1",
          toolName: "Read",
          input: { path: "a.ts" },
        },
        {
          type: "tool-start",
          toolId: "t2",
          toolName: "Write",
          input: { path: "b.ts" },
        },
        {
          type: "tool-start",
          toolId: "t3",
          toolName: "bash",
          input: { command: "echo hi" },
        },
      ]);

      expect(msg.parts).toHaveLength(3);
      expect(msg.parts!.every((p) => p.type === "tool")).toBe(true);
      expectSortedPartIds(msg);
    });

    test("duplicate tool-start for same toolId updates in place without reordering", () => {
      const msg = applySequence([
        {
          type: "tool-start",
          toolId: "t1",
          toolName: "Read",
          input: { path: "a.ts" },
        },
        {
          type: "tool-start",
          toolId: "t2",
          toolName: "bash",
          input: { command: "echo" },
        },
        {
          type: "tool-start",
          toolId: "t1",
          toolName: "Read",
          input: { path: "a.ts", encoding: "utf-8" },
        },
      ]);

      expect(msg.parts).toHaveLength(2);
      expectSortedPartIds(msg);
    });
  });

  describe("tool-complete", () => {
    test("tool-complete updates existing tool part without changing order", () => {
      let msg = applySequence([
        { type: "text-delta", delta: "before" },
        {
          type: "tool-start",
          toolId: "t1",
          toolName: "Read",
          input: { path: "a.ts" },
        },
      ]);

      const beforeIds = msg.parts!.map((p) => p.id);

      msg = applyStreamPartEvent(msg, {
        type: "tool-complete",
        toolId: "t1",
        output: "content",
        success: true,
      });

      expect(msg.parts!.map((p) => p.id)).toEqual(beforeIds);
      expectSortedPartIds(msg);
    });

    test("tool-complete for unknown toolId creates a new part in sorted position", () => {
      const msg = applySequence([
        { type: "text-delta", delta: "text" },
        {
          type: "tool-complete",
          toolId: "t_orphan",
          output: "result",
          success: true,
        },
      ]);

      expect(msg.parts!.map((p) => p.type)).toEqual(["text", "tool"]);
      expectSortedPartIds(msg);
    });
  });

  describe("tool-partial-result", () => {
    test("partial result updates tool part without changing order", () => {
      let msg = applySequence([
        { type: "text-delta", delta: "before" },
        {
          type: "tool-start",
          toolId: "t1",
          toolName: "bash",
          input: { command: "cat file" },
        },
      ]);

      const beforeIds = msg.parts!.map((p) => p.id);

      msg = applyStreamPartEvent(msg, {
        type: "tool-partial-result",
        toolId: "t1",
        partialOutput: "line 1\n",
      });

      expect(msg.parts!.map((p) => p.id)).toEqual(beforeIds);
      expectSortedPartIds(msg);
    });

    test("partial result for nonexistent toolId is a no-op preserving order", () => {
      const msg = applySequence([
        { type: "text-delta", delta: "text" },
        {
          type: "tool-partial-result",
          toolId: "ghost",
          partialOutput: "data",
        },
      ]);

      expect(msg.parts).toHaveLength(1);
      expectSortedPartIds(msg);
    });
  });

  describe("tool-hitl-request", () => {
    test("HITL request on existing tool part preserves order", () => {
      let msg = applySequence([
        { type: "text-delta", delta: "ask" },
        {
          type: "tool-start",
          toolId: "t1",
          toolName: "question",
          input: {},
        },
      ]);

      const beforeIds = msg.parts!.map((p) => p.id);

      msg = applyStreamPartEvent(msg, {
        type: "tool-hitl-request",
        toolId: "t1",
        request: {
          requestId: "req1",
          header: "Permission",
          question: "Allow?",
          options: [{ label: "Yes", value: "yes" }],
          multiSelect: false,
          respond: () => {},
        },
      });

      expect(msg.parts!.map((p) => p.id)).toEqual(beforeIds);
      expectSortedPartIds(msg);
    });

    test("HITL request for unknown toolId creates new tool part in sorted position", () => {
      const msg = applySequence([
        { type: "text-delta", delta: "context" },
        {
          type: "tool-hitl-request",
          toolId: "hitl_new",
          request: {
            requestId: "req2",
            header: "Question",
            question: "Pick one",
            options: [{ label: "A", value: "a" }],
            multiSelect: false,
            respond: () => {},
          },
        },
      ]);

      expect(msg.parts!.map((p) => p.type)).toEqual(["text", "tool"]);
      expectSortedPartIds(msg);
    });
  });

  describe("tool-hitl-response", () => {
    test("HITL response updates tool part without changing order", () => {
      let msg = applySequence([
        {
          type: "tool-start",
          toolId: "t1",
          toolName: "question",
          input: {},
        },
        {
          type: "tool-hitl-request",
          toolId: "t1",
          request: {
            requestId: "req1",
            header: "Q",
            question: "Allow?",
            options: [{ label: "Yes", value: "yes" }],
            multiSelect: false,
            respond: () => {},
          },
        },
      ]);

      const beforeIds = msg.parts!.map((p) => p.id);

      msg = applyStreamPartEvent(msg, {
        type: "tool-hitl-response",
        toolId: "t1",
        response: {
          cancelled: false,
          responseMode: "option",
          answerText: "yes",
          displayText: "Yes",
        },
      });

      expect(msg.parts!.map((p) => p.id)).toEqual(beforeIds);
      expectSortedPartIds(msg);
    });
  });

  describe("text-complete", () => {
    test("text-complete is a no-op and preserves ordering", () => {
      let msg = applySequence([
        { type: "text-delta", delta: "Hello" },
        {
          type: "tool-start",
          toolId: "t1",
          toolName: "Read",
          input: { path: "x" },
        },
      ]);

      const before = msg;
      msg = applyStreamPartEvent(msg, {
        type: "text-complete",
        fullText: "Hello",
        messageId: "msg-test",
      });

      expect(msg).toBe(before);
      expectSortedPartIds(msg);
    });
  });

  describe("task-list-update", () => {
    test("first task-list-update inserts via upsertPart in sorted position", () => {
      const msg = applySequence([
        { type: "text-delta", delta: "plan" },
        {
          type: "task-list-update",
          tasks: [
            { id: "#1", title: "Design", status: "completed" },
            { id: "#2", title: "Implement", status: "pending" },
          ],
        },
      ]);

      expect(msg.parts!.map((p) => p.type)).toEqual(["text", "task-list"]);
      expectSortedPartIds(msg);
    });

    test("repeated task-list-update re-uses same part ID without reordering", () => {
      let msg = applySequence([
        { type: "text-delta", delta: "plan" },
        {
          type: "task-list-update",
          tasks: [{ id: "#1", title: "Task A", status: "pending" }],
        },
      ]);

      const taskListId = msg.parts!.find((p) => p.type === "task-list")!.id;

      msg = applyStreamPartEvent(msg, {
        type: "task-list-update",
        tasks: [
          { id: "#1", title: "Task A", status: "completed" },
          { id: "#2", title: "Task B", status: "pending" },
        ],
      });

      expect(msg.parts!.find((p) => p.type === "task-list")!.id).toBe(
        taskListId,
      );
      expectSortedPartIds(msg);
    });

    test("task-list among many parts maintains sorted order", () => {
      const msg = applySequence([
        {
          type: "thinking-meta",
          thinkingSourceKey: "s1",
          targetMessageId: "msg-test",
          streamGeneration: 1,
          thinkingMs: 100,
          thinkingText: "plan",
          includeReasoningPart: true,
        },
        { type: "text-delta", delta: "answer" },
        {
          type: "tool-start",
          toolId: "t1",
          toolName: "Read",
          input: { path: "x" },
        },
        {
          type: "task-list-update",
          tasks: [{ id: "#1", title: "Task", status: "pending" }],
        },
      ]);

      expect(msg.parts!.map((p) => p.type)).toEqual([
        "reasoning",
        "text",
        "tool",
        "task-list",
      ]);
      expectSortedPartIds(msg);
    });
  });

  describe("task-result-upsert", () => {
    test("first task-result inserts in sorted position", () => {
      const msg = applySequence([
        { type: "text-delta", delta: "done" },
        {
          type: "task-result-upsert",
          envelope: {
            task_id: "#7",
            tool_name: "task",
            title: "Implement",
            status: "completed",
            output_text: "Done",
          },
        },
      ]);

      expect(msg.parts!.map((p) => p.type)).toEqual(["text", "task-result"]);
      expectSortedPartIds(msg);
    });

    test("updating same task-result preserves position and order", () => {
      let msg = applySequence([
        { type: "text-delta", delta: "status" },
        {
          type: "task-result-upsert",
          envelope: {
            task_id: "#7",
            tool_name: "task",
            title: "Implement",
            status: "completed",
            output_text: "v1",
          },
        },
      ]);

      const resultId = msg.parts!.find((p) => p.type === "task-result")!.id;

      msg = applyStreamPartEvent(msg, {
        type: "task-result-upsert",
        envelope: {
          task_id: "#7",
          tool_name: "task",
          title: "Implement",
          status: "error",
          output_text: "v2",
          error: "lint failed",
        },
      });

      expect(msg.parts!.find((p) => p.type === "task-result")!.id).toBe(
        resultId,
      );
      expect(
        msg.parts!.filter((p) => p.type === "task-result"),
      ).toHaveLength(1);
      expectSortedPartIds(msg);
    });

    test("multiple distinct task-results maintain sorted order", () => {
      const msg = applySequence([
        {
          type: "task-result-upsert",
          envelope: {
            task_id: "#1",
            tool_name: "task",
            title: "A",
            status: "completed",
            output_text: "a",
          },
        },
        {
          type: "task-result-upsert",
          envelope: {
            task_id: "#2",
            tool_name: "task",
            title: "B",
            status: "completed",
            output_text: "b",
          },
        },
        {
          type: "task-result-upsert",
          envelope: {
            task_id: "#3",
            tool_name: "task",
            title: "C",
            status: "completed",
            output_text: "c",
          },
        },
      ]);

      expect(msg.parts).toHaveLength(3);
      expectSortedPartIds(msg);
    });
  });

  // -------------------------------------------------------------------------
  // Cross-event-type ordering invariants
  // -------------------------------------------------------------------------

  describe("cross-event ordering", () => {
    test("reasoning → text → tool → text maintains sorted order", () => {
      const msg = applySequence([
        {
          type: "thinking-meta",
          thinkingSourceKey: "s1",
          targetMessageId: "msg-test",
          streamGeneration: 1,
          thinkingMs: 200,
          thinkingText: "analyzing",
          includeReasoningPart: true,
        },
        { type: "text-delta", delta: "First " },
        {
          type: "tool-start",
          toolId: "t1",
          toolName: "Read",
          input: { path: "file.ts" },
        },
        {
          type: "tool-complete",
          toolId: "t1",
          output: "content",
          success: true,
        },
        { type: "text-delta", delta: "Second" },
      ]);

      expect(msg.parts!.map((p) => p.type)).toEqual([
        "reasoning",
        "text",
        "tool",
        "text",
      ]);
      expectSortedPartIds(msg);
    });

    test("alternating text and tool events maintain sorted order", () => {
      const msg = applySequence([
        { type: "text-delta", delta: "A" },
        {
          type: "tool-start",
          toolId: "t1",
          toolName: "bash",
          input: { cmd: "a" },
        },
        {
          type: "tool-complete",
          toolId: "t1",
          output: "ok",
          success: true,
        },
        { type: "text-delta", delta: "B" },
        {
          type: "tool-start",
          toolId: "t2",
          toolName: "bash",
          input: { cmd: "b" },
        },
        {
          type: "tool-complete",
          toolId: "t2",
          output: "ok",
          success: true,
        },
        { type: "text-delta", delta: "C" },
      ]);

      expect(msg.parts!.map((p) => p.type)).toEqual([
        "text",
        "tool",
        "text",
        "tool",
        "text",
      ]);
      expectSortedPartIds(msg);
    });

    test("full lifecycle: thinking → text → tool (HITL) → task-list → task-result", () => {
      const msg = applySequence([
        {
          type: "thinking-meta",
          thinkingSourceKey: "s1",
          targetMessageId: "msg-test",
          streamGeneration: 1,
          thinkingMs: 300,
          thinkingText: "planning",
          includeReasoningPart: true,
        },
        { type: "thinking-complete", sourceKey: "s1", durationMs: 350 },
        { type: "text-delta", delta: "Here's the plan" },
        {
          type: "tool-start",
          toolId: "t1",
          toolName: "question",
          input: {},
        },
        {
          type: "tool-hitl-request",
          toolId: "t1",
          request: {
            requestId: "r1",
            header: "Q",
            question: "Continue?",
            options: [{ label: "Yes", value: "yes" }],
            multiSelect: false,
            respond: () => {},
          },
        },
        {
          type: "tool-hitl-response",
          toolId: "t1",
          response: {
            cancelled: false,
            responseMode: "option",
            answerText: "yes",
            displayText: "Yes",
          },
        },
        {
          type: "tool-complete",
          toolId: "t1",
          output: "yes",
          success: true,
        },
        {
          type: "task-list-update",
          tasks: [{ id: "#1", title: "Do it", status: "in_progress" }],
        },
        {
          type: "task-result-upsert",
          envelope: {
            task_id: "#1",
            tool_name: "task",
            title: "Do it",
            status: "completed",
            output_text: "Done",
          },
        },
        { type: "text-delta", delta: " all done" },
      ]);

      expect(msg.parts!.map((p) => p.type)).toEqual([
        "reasoning",
        "text",
        "tool",
        "task-list",
        "task-result",
        "text",
      ]);
      expectSortedPartIds(msg);
    });

    test("in-place updates to existing parts never break sorted order", () => {
      let msg = applySequence([
        { type: "text-delta", delta: "pre" },
        {
          type: "tool-start",
          toolId: "t1",
          toolName: "bash",
          input: { cmd: "test" },
        },
        {
          type: "task-list-update",
          tasks: [{ id: "#1", title: "Task", status: "pending" }],
        },
      ]);

      // All in-place updates: partial result on tool, task-list re-upsert
      msg = applyStreamPartEvent(msg, {
        type: "tool-partial-result",
        toolId: "t1",
        partialOutput: "output\n",
      });
      expectSortedPartIds(msg);

      msg = applyStreamPartEvent(msg, {
        type: "task-list-update",
        tasks: [{ id: "#1", title: "Task", status: "completed" }],
      });
      expectSortedPartIds(msg);

      msg = applyStreamPartEvent(msg, {
        type: "tool-complete",
        toolId: "t1",
        output: "final",
        success: true,
      });
      expectSortedPartIds(msg);

      // Part count unchanged — only in-place updates
      expect(msg.parts).toHaveLength(3);
    });

    test("many tool starts interleaved with text create strictly ordered parts", () => {
      const events: StreamPartEvent[] = [];
      for (let i = 0; i < 10; i++) {
        events.push({ type: "text-delta", delta: `chunk${i} ` });
        events.push({
          type: "tool-start",
          toolId: `t${i}`,
          toolName: "Read",
          input: { path: `file${i}.ts` },
        });
        events.push({
          type: "tool-complete",
          toolId: `t${i}`,
          output: "ok",
          success: true,
        });
      }
      events.push({ type: "text-delta", delta: "end" });

      const msg = applySequence(events);

      // 10 text + 10 tool + 1 final text = 21 parts
      expect(msg.parts).toHaveLength(21);
      expectSortedPartIds(msg);
    });

    test("reasoning from multiple sources interleaved with text are ordered by ID", () => {
      const msg = applySequence([
        {
          type: "thinking-meta",
          thinkingSourceKey: "claude",
          targetMessageId: "msg-test",
          streamGeneration: 1,
          thinkingMs: 100,
          thinkingText: "claude thought",
          includeReasoningPart: true,
          provider: "claude",
        },
        { type: "text-delta", delta: "response " },
        {
          type: "thinking-meta",
          thinkingSourceKey: "opencode",
          targetMessageId: "msg-test",
          streamGeneration: 1,
          thinkingMs: 200,
          thinkingText: "opencode thought",
          includeReasoningPart: true,
          provider: "opencode",
        },
        { type: "text-delta", delta: "more" },
        {
          type: "thinking-meta",
          thinkingSourceKey: "claude",
          targetMessageId: "msg-test",
          streamGeneration: 1,
          thinkingMs: 150,
          thinkingText: "claude refined",
          includeReasoningPart: true,
          provider: "claude",
        },
      ]);

      const reasoningParts = msg.parts!.filter((p) => p.type === "reasoning");
      expect(reasoningParts).toHaveLength(2);
      // Parts are ordered by creation time (ID). Claude reasoning was
      // created first, then text, then opencode reasoning. The final
      // thinking-meta for claude updates in-place (same ID, same position).
      expect(msg.parts!.map((p) => p.type)).toEqual(["reasoning", "text", "reasoning"]);
      expectSortedPartIds(msg);
    });

    test("task-list between tools maintains sorted order", () => {
      const msg = applySequence([
        {
          type: "tool-start",
          toolId: "t1",
          toolName: "Read",
          input: { path: "a.ts" },
        },
        {
          type: "tool-complete",
          toolId: "t1",
          output: "ok",
          success: true,
        },
        {
          type: "task-list-update",
          tasks: [{ id: "#1", title: "Plan", status: "completed" }],
        },
        {
          type: "tool-start",
          toolId: "t2",
          toolName: "Write",
          input: { path: "b.ts" },
        },
      ]);

      expect(msg.parts!.map((p) => p.type)).toEqual([
        "tool",
        "task-list",
        "tool",
      ]);
      expectSortedPartIds(msg);
    });
  });

  // -------------------------------------------------------------------------
  // Idempotency and stability invariants
  // -------------------------------------------------------------------------

  describe("idempotency and stability", () => {
    test("applying text-complete twice returns same reference", () => {
      let msg = applySequence([{ type: "text-delta", delta: "Hello" }]);

      const after1 = applyStreamPartEvent(msg, {
        type: "text-complete",
        fullText: "Hello",
        messageId: "msg-test",
      });
      const after2 = applyStreamPartEvent(after1, {
        type: "text-complete",
        fullText: "Hello",
        messageId: "msg-test",
      });

      expect(after1).toBe(msg);
      expect(after2).toBe(after1);
    });

    test("tool-complete on already completed tool preserves order", () => {
      let msg = applySequence([
        {
          type: "tool-start",
          toolId: "t1",
          toolName: "bash",
          input: { cmd: "ls" },
        },
        {
          type: "tool-complete",
          toolId: "t1",
          output: "files",
          success: true,
        },
      ]);

      const beforeIds = msg.parts!.map((p) => p.id);

      msg = applyStreamPartEvent(msg, {
        type: "tool-complete",
        toolId: "t1",
        output: "files-again",
        success: true,
      });

      expect(msg.parts!.map((p) => p.id)).toEqual(beforeIds);
      expectSortedPartIds(msg);
    });

    test("empty-text thinking-meta does not insert an empty part", () => {
      const msg = applySequence([
        { type: "text-delta", delta: "pre" },
        {
          type: "thinking-meta",
          thinkingSourceKey: "s1",
          targetMessageId: "msg-test",
          streamGeneration: 1,
          thinkingMs: 0,
          thinkingText: "   ",
          includeReasoningPart: true,
        },
      ]);

      expect(msg.parts!.filter((p) => p.type === "reasoning")).toHaveLength(0);
      expectSortedPartIds(msg);
    });

    test("HITL response on message with no parts is a no-op", () => {
      const msg = createAssistantMessage();
      const after = applyStreamPartEvent(msg, {
        type: "tool-hitl-response",
        toolId: "ghost",
        response: {
          cancelled: false,
          responseMode: "option",
          answerText: "yes",
          displayText: "Yes",
        },
      });

      expect(after).toBe(msg);
    });
  });
});
