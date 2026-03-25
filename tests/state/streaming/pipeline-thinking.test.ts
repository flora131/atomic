import { describe, expect, test, beforeEach } from "bun:test";
import {
  finalizeStreamingTextParts,
  finalizeStreamingReasoningParts,
  finalizeStreamingReasoningInMessage,
} from "@/state/streaming/pipeline-thinking.ts";
import { _resetPartCounter } from "@/state/parts/id.ts";
import {
  createTextPart,
  createReasoningPart,
  createToolPart,
  resetPartIdCounter,
} from "../../test-support/fixtures/parts.ts";
import type { Part, TextPart, ReasoningPart } from "@/state/parts/types.ts";

beforeEach(() => {
  resetPartIdCounter();
  _resetPartCounter();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createStreamingTextPart(overrides?: Partial<Parameters<typeof createTextPart>[0]>) {
  return createTextPart({ isStreaming: true, content: "streaming...", ...overrides });
}

function createStreamingReasoningPart(overrides?: Partial<Parameters<typeof createReasoningPart>[0]>) {
  return createReasoningPart({ isStreaming: true, durationMs: 0, ...overrides });
}

// ---------------------------------------------------------------------------
// finalizeStreamingTextParts
// ---------------------------------------------------------------------------

describe("finalizeStreamingTextParts", () => {
  test("returns same reference when no streaming text parts exist", () => {
    const parts: Part[] = [
      createTextPart({ isStreaming: false }),
      createReasoningPart(),
    ];
    const result = finalizeStreamingTextParts(parts);
    expect(result).toBe(parts);
  });

  test("clears isStreaming on all streaming text parts", () => {
    const parts: Part[] = [
      createStreamingTextPart({ content: "first" }),
      createStreamingTextPart({ content: "second" }),
    ];

    const result = finalizeStreamingTextParts(parts);

    expect(result).not.toBe(parts);
    expect(result).toHaveLength(2);
    for (const part of result) {
      expect(part.type).toBe("text");
      expect((part as TextPart).isStreaming).toBe(false);
    }
  });

  test("leaves non-text parts unchanged", () => {
    const reasoning = createReasoningPart({ isStreaming: true });
    const tool = createToolPart();
    const streamingText = createStreamingTextPart();

    const parts: Part[] = [reasoning, tool, streamingText];
    const result = finalizeStreamingTextParts(parts);

    expect(result).not.toBe(parts);
    // reasoning and tool should be the exact same object references
    expect(result[0]).toBe(reasoning);
    expect(result[1]).toBe(tool);
    // text part should be finalized
    expect(result[2]!.type).toBe("text");
    expect((result[2] as TextPart).isStreaming).toBe(false);
  });

  test("handles empty parts array", () => {
    const parts: Part[] = [];
    const result = finalizeStreamingTextParts(parts);
    expect(result).toBe(parts);
  });

  test("handles mixed streaming and non-streaming text parts", () => {
    const nonStreaming = createTextPart({ isStreaming: false, content: "done" });
    const streaming = createStreamingTextPart({ content: "still going" });

    const parts: Part[] = [nonStreaming, streaming];
    const result = finalizeStreamingTextParts(parts);

    expect(result).not.toBe(parts);
    // Non-streaming text part should be unchanged (same object)
    expect(result[0]).toBe(nonStreaming);
    expect((result[0] as TextPart).isStreaming).toBe(false);
    // Streaming text part should be finalized (new object)
    expect(result[1]).not.toBe(streaming);
    expect((result[1] as TextPart).isStreaming).toBe(false);
    expect((result[1] as { content: string }).content).toBe("still going");
  });
});

// ---------------------------------------------------------------------------
// finalizeStreamingReasoningParts
// ---------------------------------------------------------------------------

describe("finalizeStreamingReasoningParts", () => {
  test("returns same reference when no streaming reasoning parts exist", () => {
    const parts: Part[] = [
      createReasoningPart({ isStreaming: false }),
      createTextPart(),
    ];
    const result = finalizeStreamingReasoningParts(parts);
    expect(result).toBe(parts);
  });

  test("clears isStreaming on all streaming reasoning parts", () => {
    const parts: Part[] = [
      createStreamingReasoningPart({ content: "thought 1" }),
      createStreamingReasoningPart({ content: "thought 2" }),
    ];

    const result = finalizeStreamingReasoningParts(parts);

    expect(result).not.toBe(parts);
    expect(result).toHaveLength(2);
    for (const part of result) {
      expect(part.type).toBe("reasoning");
      expect((part as ReasoningPart).isStreaming).toBe(false);
    }
  });

  test("uses fallbackDurationMs when part has no durationMs", () => {
    const parts: Part[] = [
      createStreamingReasoningPart({ durationMs: 0 }),
    ];

    const result = finalizeStreamingReasoningParts(parts, 1234);

    expect(result).toHaveLength(1);
    expect((result[0] as { durationMs: number }).durationMs).toBe(1234);
    expect((result[0] as ReasoningPart).isStreaming).toBe(false);
  });

  test("preserves existing durationMs when present", () => {
    const parts: Part[] = [
      createStreamingReasoningPart({ durationMs: 500 }),
    ];

    const result = finalizeStreamingReasoningParts(parts, 9999);

    expect(result).toHaveLength(1);
    // durationMs is 500 (truthy), so it should be preserved over fallback
    expect((result[0] as { durationMs: number }).durationMs).toBe(500);
    expect((result[0] as ReasoningPart).isStreaming).toBe(false);
  });

  test("handles empty parts array", () => {
    const parts: Part[] = [];
    const result = finalizeStreamingReasoningParts(parts);
    expect(result).toBe(parts);
  });
});

// ---------------------------------------------------------------------------
// finalizeStreamingReasoningInMessage
// ---------------------------------------------------------------------------

describe("finalizeStreamingReasoningInMessage", () => {
  test("returns same reference when message has no parts", () => {
    const message: { parts?: Part[] } = {};
    const result = finalizeStreamingReasoningInMessage(message);
    expect(result).toBe(message);
  });

  test("returns same reference when no streaming reasoning parts", () => {
    const message = {
      parts: [
        createReasoningPart({ isStreaming: false }),
        createTextPart({ isStreaming: true }),
      ] as Part[],
    };

    const result = finalizeStreamingReasoningInMessage(message);
    expect(result).toBe(message);
  });

  test("finalizes streaming reasoning parts using message.thinkingMs as fallback", () => {
    const message = {
      parts: [
        createStreamingReasoningPart({ durationMs: 0 }),
        createTextPart(),
      ] as Part[],
      thinkingMs: 2500,
    };

    const result = finalizeStreamingReasoningInMessage(message);

    expect(result).not.toBe(message);
    expect(result.parts).toBeDefined();
    expect(result.parts).toHaveLength(2);

    const reasoningPart = result.parts![0]!;
    expect(reasoningPart.type).toBe("reasoning");
    expect((reasoningPart as ReasoningPart).isStreaming).toBe(false);
    expect((reasoningPart as { durationMs: number }).durationMs).toBe(2500);

    // Text part should be untouched (not a reasoning part)
    expect(result.parts![1]).toBe(message.parts[1]);
  });

  test("handles message with empty parts array", () => {
    const message = { parts: [] as Part[] };
    const result = finalizeStreamingReasoningInMessage(message);
    expect(result).toBe(message);
  });
});
