/**
 * Unit tests for handleTextDelta() ordered part insertion.
 *
 * Task 3 replaced push() with upsertPart() in handleTextDelta() so that
 * new TextParts are binary-search-inserted into sorted position rather
 * than appended. These tests verify that the resulting Part[] array is
 * always sorted by PartId (lexicographic = chronological) regardless of
 * the code path taken (create / append / merge-back).
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { handleTextDelta } from "@/state/parts/handlers.ts";
import { createPartId, _resetPartCounter } from "@/state/parts/id.ts";
import { upsertPart, findLastPartIndex } from "@/state/parts/store.ts";
import type { Part, TextPart, ToolPart, ReasoningPart } from "@/state/parts/types.ts";
import type { PartId } from "@/state/parts/id.ts";
import type { ChatMessage } from "@/types/chat.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a deterministic PartId from a numeric composite value. */
function deterministicId(n: number): PartId {
  const composite = BigInt(n);
  return `part_${composite.toString(16).padStart(12, "0")}` as PartId;
}

function createMockMessage(parts: Part[] = []): ChatMessage {
  return {
    id: "test-msg",
    role: "assistant",
    content: "",
    timestamp: new Date().toISOString(),
    parts,
    streaming: true,
  } as ChatMessage;
}

function makeTextPart(
  content: string,
  partId: PartId,
  isStreaming = false,
): TextPart {
  return {
    id: partId,
    type: "text",
    content,
    isStreaming,
    createdAt: new Date().toISOString(),
  };
}

function makeToolPart(
  toolCallId: string,
  partId: PartId,
  status: "pending" | "running" | "completed" = "running",
): ToolPart {
  return {
    id: partId,
    type: "tool",
    toolCallId,
    toolName: "bash",
    input: { command: "echo test" },
    state:
      status === "completed"
        ? { status: "completed", output: "ok", durationMs: 50 }
        : status === "running"
          ? { status: "running", startedAt: new Date().toISOString() }
          : { status: "pending" },
    createdAt: new Date().toISOString(),
  };
}

function makeReasoningPart(
  content: string,
  partId: PartId,
  isStreaming = false,
): ReasoningPart {
  return {
    id: partId,
    type: "reasoning",
    content,
    durationMs: 100,
    isStreaming,
    createdAt: new Date().toISOString(),
  };
}

function finalizeLastStreamingText(msg: ChatMessage): ChatMessage {
  const parts = [...(msg.parts ?? [])];
  const idx = findLastPartIndex(
    parts,
    (p) => p.type === "text" && (p as TextPart).isStreaming,
  );
  if (idx >= 0) {
    parts[idx] = { ...parts[idx], isStreaming: false } as TextPart;
  }
  return { ...msg, parts };
}

/** Assert the parts array is sorted by ID (lexicographic ascending). */
function expectSortedById(parts: ReadonlyArray<Part>): void {
  for (let i = 1; i < parts.length; i++) {
    const prev = parts[i - 1]!;
    const curr = parts[i]!;
    expect(curr.id > prev.id).toBe(true);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => _resetPartCounter());

describe("handleTextDelta ordered part insertion", () => {
  // -------------------------------------------------------------------------
  // CREATE path: new TextPart via upsertPart()
  // -------------------------------------------------------------------------

  describe("create path (new TextPart via upsertPart)", () => {
    test("new TextPart on empty parts produces a single sorted entry", () => {
      const msg = createMockMessage();
      const result = handleTextDelta(msg, "Hello");

      expect(result.parts).toHaveLength(1);
      expect(result.parts![0]!.type).toBe("text");
      expect(result.parts![0]!.id).toMatch(/^part_[0-9a-f]{12,}$/);
    });

    test("new TextPart ID is greater than all pre-existing part IDs", () => {
      const existingParts: Part[] = [
        makeTextPart("First", deterministicId(0x1000), false),
        makeToolPart("tool_1", deterministicId(0x2000), "completed"),
      ];
      const msg = createMockMessage(existingParts);

      // Create a new TextPart (paragraph break forces create path)
      const result = handleTextDelta(msg, "\n\nNew paragraph");

      expect(result.parts).toHaveLength(3);
      expectSortedById(result.parts!);
      expect(result.parts![2]!.type).toBe("text");
      expect((result.parts![2] as TextPart).content).toBe("\n\nNew paragraph");
    });

    test("new TextPart after tool part is inserted in sorted position", () => {
      // text (finalized) → tool → (new text should appear after tool by ID)
      const textId = deterministicId(0x1000);
      const toolId = deterministicId(0x2000);
      const existingParts: Part[] = [
        makeTextPart("Before tool", textId, false),
        makeToolPart("tool_1", toolId, "completed"),
      ];
      const msg = createMockMessage(existingParts);

      const result = handleTextDelta(msg, "\n\nAfter tool");

      expect(result.parts).toHaveLength(3);
      expect(result.parts![0]!.id).toBe(textId);
      expect(result.parts![1]!.id).toBe(toolId);
      // New part must sort after both existing parts
      expect(result.parts![2]!.id > toolId).toBe(true);
      expectSortedById(result.parts!);
    });

    test("multiple paragraph-separated creates produce sorted TextParts", () => {
      let msg = createMockMessage();

      // First paragraph
      msg = handleTextDelta(msg, "Paragraph 1\n\n");
      msg = finalizeLastStreamingText(msg);

      // Second paragraph (paragraph break → new TextPart)
      msg = handleTextDelta(msg, "\n\nParagraph 2\n\n");
      msg = finalizeLastStreamingText(msg);

      // Third paragraph
      msg = handleTextDelta(msg, "\n\nParagraph 3");

      expect(msg.parts).toHaveLength(3);
      expectSortedById(msg.parts!);
      expect((msg.parts![0] as TextPart).content).toBe("Paragraph 1\n\n");
      expect((msg.parts![1] as TextPart).content).toBe("\n\nParagraph 2\n\n");
      expect((msg.parts![2] as TextPart).content).toBe("\n\nParagraph 3");
    });

    test("new TextPart among mixed part types stays sorted", () => {
      const existingParts: Part[] = [
        makeReasoningPart("Thinking...", deterministicId(0x1000)),
        makeTextPart("Intro", deterministicId(0x2000), false),
        makeToolPart("tool_1", deterministicId(0x3000), "completed"),
      ];
      const msg = createMockMessage(existingParts);

      // Existing text at index 1 ends without \n\n, but it's not the last part
      // (tool is after it), so merge won't trigger → create path
      const result = handleTextDelta(msg, "\n\nConclusion");

      expect(result.parts).toHaveLength(4);
      expectSortedById(result.parts!);
      // New TextPart must be last (highest ID)
      expect(result.parts![3]!.type).toBe("text");
      expect((result.parts![3] as TextPart).content).toBe("\n\nConclusion");
    });

    test("interleaved text→tool→text→tool→text all stay sorted", () => {
      let msg = createMockMessage();

      // Text 1
      msg = handleTextDelta(msg, "Step 1");
      msg = finalizeLastStreamingText(msg);

      // Tool 1
      const tool1 = makeToolPart("tool_1", createPartId(), "running");
      msg = { ...msg, parts: upsertPart(msg.parts!, tool1) };

      // Text 2
      msg = handleTextDelta(msg, "\n\nStep 2");
      msg = finalizeLastStreamingText(msg);

      // Tool 2
      const tool2 = makeToolPart("tool_2", createPartId(), "running");
      msg = { ...msg, parts: upsertPart(msg.parts!, tool2) };

      // Text 3
      msg = handleTextDelta(msg, "\n\nStep 3");

      expect(msg.parts).toHaveLength(5);
      expect(msg.parts![0]!.type).toBe("text");
      expect(msg.parts![1]!.type).toBe("tool");
      expect(msg.parts![2]!.type).toBe("text");
      expect(msg.parts![3]!.type).toBe("tool");
      expect(msg.parts![4]!.type).toBe("text");
      expectSortedById(msg.parts!);
    });

    test("rapid sequential creates from paragraph breaks produce monotonic IDs", () => {
      let msg = createMockMessage();

      // Create 10 TextParts rapidly via paragraph-break forcing
      for (let i = 0; i < 10; i++) {
        msg = handleTextDelta(msg, `\n\nPara ${i}`);
        msg = finalizeLastStreamingText(msg);
      }

      expect(msg.parts).toHaveLength(10);
      expectSortedById(msg.parts!);

      // Verify each part has the correct content
      for (let i = 0; i < 10; i++) {
        expect((msg.parts![i] as TextPart).content).toBe(`\n\nPara ${i}`);
      }
    });
  });

  // -------------------------------------------------------------------------
  // APPEND path: delta appended to existing streaming TextPart
  // -------------------------------------------------------------------------

  describe("append path (delta appended to streaming TextPart)", () => {
    test("appending to streaming TextPart preserves sorted order", () => {
      const reasoningId = deterministicId(0x1000);
      const existingParts: Part[] = [
        makeReasoningPart("Thinking...", reasoningId),
      ];
      let msg = createMockMessage(existingParts);

      // Create a streaming TextPart (will be after reasoning by ID)
      msg = handleTextDelta(msg, "Hello");
      expect(msg.parts).toHaveLength(2);
      expectSortedById(msg.parts!);

      // Append more deltas — should stay in the same part, order unchanged
      msg = handleTextDelta(msg, " world");
      msg = handleTextDelta(msg, "!");

      expect(msg.parts).toHaveLength(2);
      expectSortedById(msg.parts!);
      expect((msg.parts![1] as TextPart).content).toBe("Hello world!");
      expect((msg.parts![1] as TextPart).isStreaming).toBe(true);
    });

    test("appending preserves ID of the original TextPart", () => {
      let msg = createMockMessage();
      msg = handleTextDelta(msg, "Start");
      const originalId = msg.parts![0]!.id;

      msg = handleTextDelta(msg, " middle");
      msg = handleTextDelta(msg, " end");

      expect(msg.parts).toHaveLength(1);
      expect(msg.parts![0]!.id).toBe(originalId);
      expect((msg.parts![0] as TextPart).content).toBe("Start middle end");
    });

    test("appending among multiple parts does not reorder them", () => {
      const parts: Part[] = [
        makeTextPart("First", deterministicId(0x1000), false),
        makeToolPart("tool_1", deterministicId(0x2000), "completed"),
        makeTextPart("Streaming", deterministicId(0x3000), true),
      ];
      const msg = createMockMessage(parts);

      const result = handleTextDelta(msg, " more text");

      expect(result.parts).toHaveLength(3);
      expectSortedById(result.parts!);
      // Last part should be updated in place
      expect(result.parts![2]!.id).toBe(deterministicId(0x3000));
      expect((result.parts![2] as TextPart).content).toBe("Streaming more text");
    });
  });

  // -------------------------------------------------------------------------
  // MERGE-BACK path: continuation merged into finalized TextPart
  // -------------------------------------------------------------------------

  describe("merge-back path (continuation into finalized TextPart)", () => {
    test("merging into finalized TextPart preserves sorted order", () => {
      const parts: Part[] = [
        makeReasoningPart("Think", deterministicId(0x1000)),
        makeTextPart("Finalized", deterministicId(0x2000), false),
      ];
      const msg = createMockMessage(parts);

      // No paragraph break + finalized text is last → merge-back path
      const result = handleTextDelta(msg, " continuation");

      expect(result.parts).toHaveLength(2);
      expectSortedById(result.parts!);
      expect(result.parts![1]!.id).toBe(deterministicId(0x2000));
      expect((result.parts![1] as TextPart).content).toBe("Finalized continuation");
    });

    test("merge-back does not create a new part or change IDs", () => {
      let msg = createMockMessage();
      msg = handleTextDelta(msg, "Original");
      msg = finalizeLastStreamingText(msg);

      const originalId = msg.parts![0]!.id;
      const result = handleTextDelta(msg, " merged");

      expect(result.parts).toHaveLength(1);
      expect(result.parts![0]!.id).toBe(originalId);
      expect((result.parts![0] as TextPart).content).toBe("Original merged");
    });

    test("merge-back preserves order of preceding parts", () => {
      const parts: Part[] = [
        makeReasoningPart("Thought 1", deterministicId(0x1000)),
        makeReasoningPart("Thought 2", deterministicId(0x2000)),
        makeTextPart("Answer:", deterministicId(0x3000), false),
      ];
      const msg = createMockMessage(parts);

      const result = handleTextDelta(msg, " yes");

      expect(result.parts).toHaveLength(3);
      expectSortedById(result.parts!);
      expect(result.parts![0]!.type).toBe("reasoning");
      expect(result.parts![1]!.type).toBe("reasoning");
      expect(result.parts![2]!.type).toBe("text");
      expect((result.parts![2] as TextPart).content).toBe("Answer: yes");
    });
  });

  // -------------------------------------------------------------------------
  // Immutability guarantees
  // -------------------------------------------------------------------------

  describe("immutability", () => {
    test("handleTextDelta does not mutate the original message", () => {
      const originalParts: Part[] = [
        makeTextPart("Original", deterministicId(0x1000), false),
      ];
      const msg = createMockMessage(originalParts);
      const originalPartsRef = msg.parts;

      handleTextDelta(msg, "\n\nNew");

      // Original message unchanged
      expect(msg.parts).toBe(originalPartsRef);
      expect(msg.parts).toHaveLength(1);
      expect((msg.parts![0] as TextPart).content).toBe("Original");
    });

    test("handleTextDelta returns a new message object", () => {
      const msg = createMockMessage();
      const result = handleTextDelta(msg, "Hello");

      expect(result).not.toBe(msg);
      expect(result.parts).not.toBe(msg.parts);
    });

    test("appending to streaming part does not mutate original parts array", () => {
      let msg = createMockMessage();
      msg = handleTextDelta(msg, "Hello");
      const beforeAppend = [...msg.parts!];
      const beforeContent = (msg.parts![0] as TextPart).content;

      const result = handleTextDelta(msg, " World");

      // Original parts array entries unchanged
      expect((beforeAppend[0] as TextPart).content).toBe(beforeContent);
      expect((result.parts![0] as TextPart).content).toBe("Hello World");
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases for ordered insertion
  // -------------------------------------------------------------------------

  describe("edge cases", () => {
    test("new TextPart with pre-existing future-dated parts sorts correctly", () => {
      // Simulate a part with a very high ID (far future)
      const futureParts: Part[] = [
        makeTextPart("Present", deterministicId(0x1000), false),
        makeToolPart("tool_future", deterministicId(0xFFFFFFFFFF), "completed"),
      ];
      const msg = createMockMessage(futureParts);

      // New text part (paragraph break forces create path)
      const result = handleTextDelta(msg, "\n\nNew text");

      expect(result.parts).toHaveLength(3);
      // New part ID from Date.now() should be between present and future
      expectSortedById(result.parts!);
    });

    test("empty delta on empty message creates streaming TextPart", () => {
      const msg = createMockMessage();
      const result = handleTextDelta(msg, "");

      expect(result.parts).toHaveLength(1);
      expect((result.parts![0] as TextPart).content).toBe("");
      expect((result.parts![0] as TextPart).isStreaming).toBe(true);
    });

    test("handleTextDelta with undefined parts initializes correctly", () => {
      const msg = { id: "test", role: "assistant" } as unknown as ChatMessage;
      const result = handleTextDelta(msg, "Hello");

      expect(result.parts).toHaveLength(1);
      expect(result.parts![0]!.id).toMatch(/^part_[0-9a-f]{12,}$/);
      expectSortedById(result.parts!);
    });

    test("sequential create-finalize-create cycles maintain sort order", () => {
      let msg = createMockMessage();

      // Cycle 1: create text, finalize, add tool
      msg = handleTextDelta(msg, "Text 1");
      msg = finalizeLastStreamingText(msg);
      msg = { ...msg, parts: upsertPart(msg.parts!, makeToolPart("t1", createPartId())) };

      // Cycle 2: create text, finalize, add tool
      msg = handleTextDelta(msg, "\n\nText 2");
      msg = finalizeLastStreamingText(msg);
      msg = { ...msg, parts: upsertPart(msg.parts!, makeToolPart("t2", createPartId())) };

      // Cycle 3: create text
      msg = handleTextDelta(msg, "\n\nText 3");

      expect(msg.parts).toHaveLength(5);
      expectSortedById(msg.parts!);

      // Verify content order matches creation order
      const contents = msg.parts!.map((p) => {
        if (p.type === "text") return (p as TextPart).content;
        if (p.type === "tool") return (p as ToolPart).toolCallId;
        return p.type;
      });
      expect(contents).toEqual(["Text 1", "t1", "\n\nText 2", "t2", "\n\nText 3"]);
    });

    test("new TextPart inserted after all existing parts when IDs are older", () => {
      // All existing parts have very old IDs
      const parts: Part[] = [
        makeTextPart("Old 1", deterministicId(1), false),
        makeToolPart("tool_old", deterministicId(2), "completed"),
        makeTextPart("Old 2", deterministicId(3), false),
      ];
      const msg = createMockMessage(parts);

      // New part gets a real timestamp ID → much larger than 1, 2, 3
      const result = handleTextDelta(msg, "\n\nNew text");

      expect(result.parts).toHaveLength(4);
      expectSortedById(result.parts!);
      // New part should be at the end
      expect(result.parts![3]!.type).toBe("text");
      expect((result.parts![3] as TextPart).content).toBe("\n\nNew text");
    });

    test("transition from append to create path maintains order", () => {
      let msg = createMockMessage();

      // Append path: streaming text accumulation
      msg = handleTextDelta(msg, "A");
      msg = handleTextDelta(msg, "B");
      msg = handleTextDelta(msg, "C");
      expect(msg.parts).toHaveLength(1);

      // Finalize, add tool
      msg = finalizeLastStreamingText(msg);
      msg = { ...msg, parts: upsertPart(msg.parts!, makeToolPart("t1", createPartId())) };

      // Create path: new TextPart via paragraph break
      msg = handleTextDelta(msg, "\n\nD");

      // Back to append path
      msg = handleTextDelta(msg, "E");
      msg = handleTextDelta(msg, "F");

      expect(msg.parts).toHaveLength(3);
      expectSortedById(msg.parts!);
      expect((msg.parts![0] as TextPart).content).toBe("ABC");
      expect(msg.parts![1]!.type).toBe("tool");
      expect((msg.parts![2] as TextPart).content).toBe("\n\nDEF");
    });

    test("merge-back to create transition at paragraph boundary", () => {
      let msg = createMockMessage();

      // Stream and finalize
      msg = handleTextDelta(msg, "First");
      msg = finalizeLastStreamingText(msg);

      // Merge-back (no paragraph break)
      msg = handleTextDelta(msg, " still first");
      expect(msg.parts).toHaveLength(1);
      expect((msg.parts![0] as TextPart).content).toBe("First still first");

      // Now finalize again and force create with paragraph break
      msg = finalizeLastStreamingText(msg);
      msg = handleTextDelta(msg, "\n\nSecond");

      expect(msg.parts).toHaveLength(2);
      expectSortedById(msg.parts!);
      expect((msg.parts![0] as TextPart).content).toBe("First still first");
      expect((msg.parts![1] as TextPart).content).toBe("\n\nSecond");
    });
  });
});
