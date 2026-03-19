import { describe, expect, test, beforeEach } from "bun:test";
import { upsertThinkingMetaPart } from "@/state/streaming/pipeline-thinking.ts";
import { createPartId, _resetPartCounter } from "@/state/parts/id.ts";
import type { Part, TextPart, ReasoningPart } from "@/state/parts/types.ts";
import type { ThinkingMetaEvent } from "@/state/streaming/pipeline-types.ts";

beforeEach(() => _resetPartCounter());

function makeEvent(overrides: Partial<ThinkingMetaEvent> = {}): ThinkingMetaEvent {
  return {
    type: "thinking-meta",
    thinkingSourceKey: "source:test",
    targetMessageId: "msg-test",
    streamGeneration: 1,
    thinkingMs: 500,
    thinkingText: "thinking...",
    includeReasoningPart: true,
    ...overrides,
  };
}

function makeTextPart(content = "hello"): TextPart {
  return {
    id: createPartId(),
    type: "text",
    content,
    isStreaming: true,
    createdAt: new Date().toISOString(),
  };
}

function makeReasoningPart(
  sourceKey: string,
  content = "thought",
  isStreaming = true,
): ReasoningPart {
  return {
    id: createPartId(),
    type: "reasoning",
    thinkingSourceKey: sourceKey,
    content,
    durationMs: 100,
    isStreaming,
    createdAt: new Date().toISOString(),
  };
}

describe("upsertThinkingMetaPart", () => {
  test("returns parts unchanged when includeReasoningPart is false", () => {
    const parts: Part[] = [makeTextPart()];
    const result = upsertThinkingMetaPart(parts, makeEvent({ includeReasoningPart: false }));
    expect(result).toBe(parts);
  });

  test("inserts new reasoning part into empty array", () => {
    const result = upsertThinkingMetaPart([], makeEvent());
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe("reasoning");
    expect((result[0] as ReasoningPart).content).toBe("thinking...");
    expect((result[0] as ReasoningPart).isStreaming).toBe(true);
  });

  test("skips insertion when thinkingText is empty/whitespace", () => {
    const parts: Part[] = [makeTextPart()];
    const result = upsertThinkingMetaPart(parts, makeEvent({ thinkingText: "   " }));
    expect(result).toBe(parts);
  });

  test("updates existing reasoning part by thinkingSourceKey", () => {
    const existing = makeReasoningPart("source:test", "old thought");
    const parts: Part[] = [existing];

    const result = upsertThinkingMetaPart(
      parts,
      makeEvent({ thinkingText: "new thought", thinkingMs: 999 }),
    );

    expect(result).toHaveLength(1);
    expect((result[0] as ReasoningPart).content).toBe("new thought");
    expect((result[0] as ReasoningPart).durationMs).toBe(999);
    expect((result[0] as ReasoningPart).isStreaming).toBe(true);
  });

  test("new reasoning part is sorted by ID relative to existing text parts", () => {
    const textPart = makeTextPart("existing text");
    const parts: Part[] = [textPart];

    const result = upsertThinkingMetaPart(parts, makeEvent());

    expect(result).toHaveLength(2);
    const ids = result.map((p) => p.id);
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
  });

  test("maintains sorted order when reasoning inserted among multiple parts", () => {
    const text1 = makeTextPart("first");
    const text2 = makeTextPart("second");
    const parts: Part[] = [text1, text2];

    const result = upsertThinkingMetaPart(parts, makeEvent());

    expect(result).toHaveLength(3);
    const ids = result.map((p) => p.id);
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
  });

  test("does not duplicate parts for same sourceKey on repeated calls", () => {
    let parts: Part[] = [];
    parts = upsertThinkingMetaPart(parts, makeEvent({ thinkingText: "v1" }));
    parts = upsertThinkingMetaPart(parts, makeEvent({ thinkingText: "v2" }));
    parts = upsertThinkingMetaPart(parts, makeEvent({ thinkingText: "v3" }));

    const reasoningParts = parts.filter((p) => p.type === "reasoning");
    expect(reasoningParts).toHaveLength(1);
    expect((reasoningParts[0] as ReasoningPart).content).toBe("v3");
  });

  test("different sourceKeys create separate reasoning parts", () => {
    let parts: Part[] = [];
    parts = upsertThinkingMetaPart(parts, makeEvent({ thinkingSourceKey: "source:a", thinkingText: "alpha" }));
    parts = upsertThinkingMetaPart(parts, makeEvent({ thinkingSourceKey: "source:b", thinkingText: "beta" }));

    const reasoningParts = parts.filter((p) => p.type === "reasoning");
    expect(reasoningParts).toHaveLength(2);

    const sourceA = reasoningParts.find((p) => (p as ReasoningPart).thinkingSourceKey === "source:a");
    const sourceB = reasoningParts.find((p) => (p as ReasoningPart).thinkingSourceKey === "source:b");
    expect((sourceA as ReasoningPart).content).toBe("alpha");
    expect((sourceB as ReasoningPart).content).toBe("beta");
  });

  test("result array preserves sorted ID order after interleaved text and reasoning", () => {
    const text1 = makeTextPart("first text");
    let parts: Part[] = [text1];

    parts = upsertThinkingMetaPart(parts, makeEvent({ thinkingSourceKey: "source:a", thinkingText: "thought A" }));

    // Simulate a new text part arriving after reasoning
    const text2 = makeTextPart("second text");
    parts = [...parts, text2].sort((a, b) => a.id.localeCompare(b.id));

    parts = upsertThinkingMetaPart(parts, makeEvent({ thinkingSourceKey: "source:b", thinkingText: "thought B" }));

    const ids = parts.map((p) => p.id);
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
  });

  test("returns new array reference even when updating existing part", () => {
    const existing = makeReasoningPart("source:test");
    const parts: Part[] = [existing];

    const result = upsertThinkingMetaPart(parts, makeEvent());
    expect(result).not.toBe(parts);
  });
});
