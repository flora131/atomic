/**
 * Regression test: batched interleaved text-delta and tool-start events.
 *
 * Guards against ordering violations when rapid-fire text-delta and tool-start
 * events arrive interleaved within a single batch (as they do in real streaming
 * from coding agents). The reducer `applyStreamPartEvent` must maintain
 * strictly monotonic part ID ordering and correct type sequencing at every
 * intermediate step, regardless of interleaving pattern.
 *
 * Also validates the batch application path (`applyStreamPartBatchToMessages`)
 * produces identical results to sequential reducer application.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { applyStreamPartEvent } from "@/state/parts/stream-pipeline.ts";
import {
  applyStreamPartBatchToMessages,
  createStreamPartBatch,
} from "@/state/chat/stream/part-batch.ts";
import type { StreamPartEvent } from "@/state/streaming/pipeline-types.ts";
import type { ChatMessage } from "@/types/chat.ts";
import { _resetPartCounter } from "@/state/parts/id.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

beforeEach(() => {
  _resetPartCounter();
});

function createAssistantMessage(id = "msg-test"): ChatMessage {
  return {
    id,
    role: "assistant",
    content: "",
    timestamp: new Date().toISOString(),
    streaming: true,
    parts: [],
  };
}

/**
 * Asserts that all part IDs in the message are strictly monotonically increasing.
 * Since PartIds encode `timestamp * 0x1000 + counter`, lexicographic order = chronological order.
 */
function expectSortedPartIds(message: ChatMessage, label?: string): void {
  const parts = message.parts ?? [];
  for (let i = 1; i < parts.length; i++) {
    const prev = parts[i - 1]!;
    const curr = parts[i]!;
    expect(curr.id > prev.id).toBe(true);
  }
}

/**
 * Applies a sequence of events to a fresh message, asserting sorted ordering
 * after each intermediate step (the invariant must never be transiently broken).
 */
function applySequence(events: StreamPartEvent[]): ChatMessage {
  let msg = createAssistantMessage();
  for (const event of events) {
    msg = applyStreamPartEvent(msg, event);
    expectSortedPartIds(msg);
  }
  return msg;
}

/**
 * Applies events via the batch path (`applyStreamPartBatchToMessages`) and
 * returns the resulting message. This exercises the same code path used in
 * production when the event bus flushes a micro-batch of queued events.
 */
function applyViaBatch(
  initialMessage: ChatMessage,
  events: StreamPartEvent[],
): ChatMessage {
  const batch = createStreamPartBatch();
  for (const event of events) {
    batch.queueMessagePartUpdate(initialMessage.id, event);
  }

  let result: ChatMessage = initialMessage;
  applyStreamPartBatchToMessages(batch.updatesByMessageId, (updater) => {
    const next =
      typeof updater === "function" ? updater([initialMessage]) : updater;
    result = next.find((m) => m.id === initialMessage.id) ?? result;
  });
  return result;
}

// ---------------------------------------------------------------------------
// Regression suite
// ---------------------------------------------------------------------------

describe("batched interleaved text-delta + tool-start — regression", () => {
  // -----------------------------------------------------------------------
  // Core interleaving patterns
  // -----------------------------------------------------------------------

  describe("interleaving patterns via sequential reducer", () => {
    test("text → tool-start → text → tool-start produces correct type sequence", () => {
      const msg = applySequence([
        { type: "text-delta", delta: "Reading files..." },
        {
          type: "tool-start",
          toolId: "t1",
          toolName: "Read",
          input: { path: "a.ts" },
        },
        { type: "text-delta", delta: "Now editing..." },
        {
          type: "tool-start",
          toolId: "t2",
          toolName: "Write",
          input: { path: "b.ts" },
        },
      ]);

      expect(msg.parts!.map((p) => p.type)).toEqual([
        "text",
        "tool",
        "text",
        "tool",
      ]);
      expectSortedPartIds(msg);
    });

    test("tool-start → text → tool-start → text (tool-first interleave)", () => {
      const msg = applySequence([
        {
          type: "tool-start",
          toolId: "t1",
          toolName: "bash",
          input: { command: "ls" },
        },
        { type: "text-delta", delta: "Found files. " },
        {
          type: "tool-start",
          toolId: "t2",
          toolName: "Read",
          input: { path: "file.ts" },
        },
        { type: "text-delta", delta: "Reading content." },
      ]);

      expect(msg.parts!.map((p) => p.type)).toEqual([
        "tool",
        "text",
        "tool",
        "text",
      ]);
      expectSortedPartIds(msg);
    });

    test("rapid alternation: 5 text-delta / tool-start pairs", () => {
      const events: StreamPartEvent[] = [];
      for (let i = 0; i < 5; i++) {
        events.push({ type: "text-delta", delta: `chunk-${i} ` });
        events.push({
          type: "tool-start",
          toolId: `t${i}`,
          toolName: "Read",
          input: { path: `file${i}.ts` },
        });
      }
      events.push({ type: "text-delta", delta: "done" });

      const msg = applySequence(events);

      // 5 text + 5 tool + 1 trailing text = 11
      expect(msg.parts).toHaveLength(11);
      expect(msg.parts!.map((p) => p.type)).toEqual([
        "text",
        "tool",
        "text",
        "tool",
        "text",
        "tool",
        "text",
        "tool",
        "text",
        "tool",
        "text",
      ]);
      expectSortedPartIds(msg);
    });

    test("consecutive text-deltas between tool-starts merge into single text part", () => {
      const msg = applySequence([
        { type: "text-delta", delta: "Hello " },
        { type: "text-delta", delta: "world " },
        {
          type: "tool-start",
          toolId: "t1",
          toolName: "Read",
          input: { path: "a.ts" },
        },
        { type: "text-delta", delta: "After " },
        { type: "text-delta", delta: "tool" },
      ]);

      expect(msg.parts!.map((p) => p.type)).toEqual(["text", "tool", "text"]);
      const textParts = msg.parts!.filter((p) => p.type === "text");
      expect((textParts[0] as { content: string }).content).toBe(
        "Hello world ",
      );
      expect((textParts[1] as { content: string }).content).toBe("After tool");
      expectSortedPartIds(msg);
    });

    test("tool-start between tool-complete and next text-delta preserves order", () => {
      const msg = applySequence([
        { type: "text-delta", delta: "start " },
        {
          type: "tool-start",
          toolId: "t1",
          toolName: "Read",
          input: { path: "a.ts" },
        },
        {
          type: "tool-complete",
          toolId: "t1",
          output: "file content",
          success: true,
        },
        {
          type: "tool-start",
          toolId: "t2",
          toolName: "Write",
          input: { path: "b.ts" },
        },
        { type: "text-delta", delta: "end" },
      ]);

      expect(msg.parts!.map((p) => p.type)).toEqual([
        "text",
        "tool",
        "tool",
        "text",
      ]);
      expectSortedPartIds(msg);
    });
  });

  // -----------------------------------------------------------------------
  // Batch application path
  // -----------------------------------------------------------------------

  describe("batch application path parity", () => {
    test("batch produces same ordering as sequential application", () => {
      const events: StreamPartEvent[] = [
        { type: "text-delta", delta: "Analyzing..." },
        {
          type: "tool-start",
          toolId: "t1",
          toolName: "Read",
          input: { path: "src/index.ts" },
        },
        { type: "text-delta", delta: "Found issue." },
        {
          type: "tool-start",
          toolId: "t2",
          toolName: "Write",
          input: { path: "src/fix.ts" },
        },
        { type: "text-delta", delta: "Fixed." },
      ];

      _resetPartCounter();
      const sequential = applySequence(events);

      _resetPartCounter();
      const batched = applyViaBatch(createAssistantMessage(), events);

      expect(batched.parts!.map((p) => p.type)).toEqual(
        sequential.parts!.map((p) => p.type),
      );
      expect(batched.parts).toHaveLength(sequential.parts!.length);
      expectSortedPartIds(batched);
    });

    test("batch with tool-complete interleaved preserves ordering", () => {
      const events: StreamPartEvent[] = [
        { type: "text-delta", delta: "Step 1. " },
        {
          type: "tool-start",
          toolId: "t1",
          toolName: "bash",
          input: { command: "npm test" },
        },
        {
          type: "tool-complete",
          toolId: "t1",
          output: "passed",
          success: true,
        },
        { type: "text-delta", delta: "Step 2. " },
        {
          type: "tool-start",
          toolId: "t2",
          toolName: "bash",
          input: { command: "npm build" },
        },
        {
          type: "tool-complete",
          toolId: "t2",
          output: "built",
          success: true,
        },
        { type: "text-delta", delta: "All done." },
      ];

      const msg = applyViaBatch(createAssistantMessage(), events);

      expect(msg.parts!.map((p) => p.type)).toEqual([
        "text",
        "tool",
        "text",
        "tool",
        "text",
      ]);
      expectSortedPartIds(msg);
    });

    test("large batch with 20 interleaved events maintains invariants", () => {
      const events: StreamPartEvent[] = [];
      for (let i = 0; i < 10; i++) {
        events.push({ type: "text-delta", delta: `msg-${i} ` });
        events.push({
          type: "tool-start",
          toolId: `tool-${i}`,
          toolName: "Read",
          input: { path: `file-${i}.ts` },
        });
      }

      const msg = applyViaBatch(createAssistantMessage(), events);

      expect(msg.parts).toHaveLength(20);
      expectSortedPartIds(msg);

      // Verify alternating text/tool pattern
      for (let i = 0; i < 20; i++) {
        expect(msg.parts![i]!.type).toBe(i % 2 === 0 ? "text" : "tool");
      }
    });

    test("empty batch is a no-op", () => {
      const initial = createAssistantMessage();
      const result = applyViaBatch(initial, []);

      expect(result.parts).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // Multi-batch sequences (simulating consecutive micro-batch flushes)
  // -----------------------------------------------------------------------

  describe("multi-batch sequences", () => {
    test("two consecutive batches maintain ordering across batch boundaries", () => {
      const msg1 = createAssistantMessage();

      // First batch: text + tool
      const batch1Events: StreamPartEvent[] = [
        { type: "text-delta", delta: "First batch " },
        {
          type: "tool-start",
          toolId: "t1",
          toolName: "Read",
          input: { path: "a.ts" },
        },
      ];
      const afterBatch1 = applyViaBatch(msg1, batch1Events);
      expectSortedPartIds(afterBatch1);

      // Second batch: tool-complete + text + tool
      const batch2Events: StreamPartEvent[] = [
        {
          type: "tool-complete",
          toolId: "t1",
          output: "content",
          success: true,
        },
        { type: "text-delta", delta: "Second batch " },
        {
          type: "tool-start",
          toolId: "t2",
          toolName: "Write",
          input: { path: "b.ts" },
        },
      ];
      const afterBatch2 = applyViaBatch(afterBatch1, batch2Events);

      expect(afterBatch2.parts!.map((p) => p.type)).toEqual([
        "text",
        "tool",
        "text",
        "tool",
      ]);
      expectSortedPartIds(afterBatch2);
    });

    test("three batches with text/tool interleaving across boundaries", () => {
      let msg = createAssistantMessage();

      // Batch 1: text
      msg = applyViaBatch(msg, [{ type: "text-delta", delta: "Planning... " }]);
      expectSortedPartIds(msg);

      // Batch 2: tool-start + tool-complete + text
      msg = applyViaBatch(msg, [
        {
          type: "tool-start",
          toolId: "t1",
          toolName: "Read",
          input: { path: "config.ts" },
        },
        {
          type: "tool-complete",
          toolId: "t1",
          output: "{}",
          success: true,
        },
        { type: "text-delta", delta: "Config read. " },
      ]);
      expectSortedPartIds(msg);

      // Batch 3: tool-start + text
      msg = applyViaBatch(msg, [
        {
          type: "tool-start",
          toolId: "t2",
          toolName: "Write",
          input: { path: "output.ts" },
        },
        { type: "text-delta", delta: "Done." },
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
  });

  // -----------------------------------------------------------------------
  // Edge cases for interleaved batches
  // -----------------------------------------------------------------------

  describe("edge cases", () => {
    test("tool-start with no preceding text creates tool as first part", () => {
      const msg = applySequence([
        {
          type: "tool-start",
          toolId: "t1",
          toolName: "Read",
          input: { path: "x.ts" },
        },
        { type: "text-delta", delta: "After tool" },
      ]);

      expect(msg.parts!.map((p) => p.type)).toEqual(["tool", "text"]);
      expectSortedPartIds(msg);
    });

    test("many tool-starts in a row followed by text-deltas", () => {
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
          toolName: "Read",
          input: { path: "b.ts" },
        },
        {
          type: "tool-start",
          toolId: "t3",
          toolName: "Read",
          input: { path: "c.ts" },
        },
        { type: "text-delta", delta: "All read." },
      ]);

      expect(msg.parts!.map((p) => p.type)).toEqual([
        "tool",
        "tool",
        "tool",
        "text",
      ]);
      expectSortedPartIds(msg);
    });

    test("duplicate tool-start for same toolId mid-interleave updates in place", () => {
      const msg = applySequence([
        { type: "text-delta", delta: "Before " },
        {
          type: "tool-start",
          toolId: "t1",
          toolName: "Read",
          input: { path: "old.ts" },
        },
        { type: "text-delta", delta: "Middle " },
        {
          type: "tool-start",
          toolId: "t1",
          toolName: "Read",
          input: { path: "new.ts" },
        },
        { type: "text-delta", delta: "After" },
      ]);

      // Duplicate tool-start updates in place — no duplicate tool part
      const toolParts = msg.parts!.filter((p) => p.type === "tool");
      expect(toolParts).toHaveLength(1);
      expectSortedPartIds(msg);
    });

    test("tool-complete arriving before tool-start creates orphan tool in order", () => {
      const msg = applySequence([
        { type: "text-delta", delta: "Preamble " },
        {
          type: "tool-complete",
          toolId: "orphan",
          output: "result",
          success: true,
        },
        // The first text part is still streaming, so this appends to it
        // rather than creating a new text part after the orphan tool.
        { type: "text-delta", delta: "more text " },
        {
          type: "tool-start",
          toolId: "t1",
          toolName: "Read",
          input: { path: "z.ts" },
        },
      ]);

      // The orphan tool-complete created a new tool part; the text-delta
      // merged back into the still-streaming first text part; then tool-start
      // finalized text and added a new tool.
      expect(msg.parts!.map((p) => p.type)).toEqual([
        "text",
        "tool",
        "tool",
      ]);
      expectSortedPartIds(msg);
    });

    test("interleaved batch across two messages targets correct message", () => {
      const msg1 = createAssistantMessage("msg-1");
      const msg2 = createAssistantMessage("msg-2");

      const batch = createStreamPartBatch();
      batch.queueMessagePartUpdate("msg-1", {
        type: "text-delta",
        delta: "Hello from msg-1",
      });
      batch.queueMessagePartUpdate("msg-2", {
        type: "tool-start",
        toolId: "t1",
        toolName: "Read",
        input: { path: "a.ts" },
      });
      batch.queueMessagePartUpdate("msg-1", {
        type: "tool-start",
        toolId: "t2",
        toolName: "Write",
        input: { path: "b.ts" },
      });
      batch.queueMessagePartUpdate("msg-2", {
        type: "text-delta",
        delta: "Hello from msg-2",
      });

      let results: ChatMessage[] = [msg1, msg2];
      applyStreamPartBatchToMessages(batch.updatesByMessageId, (updater) => {
        results =
          typeof updater === "function" ? updater(results) : updater;
      });

      const r1 = results.find((m) => m.id === "msg-1")!;
      const r2 = results.find((m) => m.id === "msg-2")!;

      expect(r1.parts!.map((p) => p.type)).toEqual(["text", "tool"]);
      expect(r2.parts!.map((p) => p.type)).toEqual(["tool", "text"]);
      expectSortedPartIds(r1);
      expectSortedPartIds(r2);
    });
  });

  // -----------------------------------------------------------------------
  // Stress: high-volume interleaved batch
  // -----------------------------------------------------------------------

  describe("stress", () => {
    test("50 interleaved text-delta/tool-start pairs maintain strict ordering", () => {
      const events: StreamPartEvent[] = [];
      for (let i = 0; i < 50; i++) {
        events.push({ type: "text-delta", delta: `t${i} ` });
        events.push({
          type: "tool-start",
          toolId: `tool-${i}`,
          toolName: "Read",
          input: { path: `f${i}.ts` },
        });
        events.push({
          type: "tool-complete",
          toolId: `tool-${i}`,
          output: `ok-${i}`,
          success: true,
        });
      }
      events.push({ type: "text-delta", delta: "fin" });

      const msg = applySequence(events);

      // 50 text + 50 tool + 1 trailing text = 101
      expect(msg.parts).toHaveLength(101);
      expectSortedPartIds(msg);

      // Verify alternating text/tool pattern
      for (let i = 0; i < 100; i++) {
        expect(msg.parts![i]!.type).toBe(i % 2 === 0 ? "text" : "tool");
      }
      expect(msg.parts![100]!.type).toBe("text");
    });

    test("50-event batch via batch path matches sequential reducer", () => {
      const events: StreamPartEvent[] = [];
      for (let i = 0; i < 25; i++) {
        events.push({ type: "text-delta", delta: `delta-${i} ` });
        events.push({
          type: "tool-start",
          toolId: `t-${i}`,
          toolName: "Read",
          input: { path: `p${i}.ts` },
        });
      }

      _resetPartCounter();
      const sequential = applySequence(events);

      _resetPartCounter();
      const batched = applyViaBatch(createAssistantMessage(), events);

      expect(batched.parts!.map((p) => p.type)).toEqual(
        sequential.parts!.map((p) => p.type),
      );
      expect(batched.parts).toHaveLength(sequential.parts!.length);
      expectSortedPartIds(batched);
    });
  });
});
