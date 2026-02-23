import { describe, expect, test } from "bun:test";
import type { Part, ReasoningPart, TextPart } from "../../parts/types.ts";
import { buildPartRenderKeys } from "./message-bubble-parts.tsx";

function createReasoningPart(id: string, thinkingSourceKey: string): ReasoningPart {
  return {
    id,
    type: "reasoning",
    thinkingSourceKey,
    content: "thinking",
    durationMs: 100,
    isStreaming: true,
    createdAt: "2026-02-23T00:00:00.000Z",
  };
}

function createTextPart(id: string): TextPart {
  return {
    id,
    type: "text",
    content: "answer",
    isStreaming: true,
    createdAt: "2026-02-23T00:00:00.000Z",
  };
}

describe("buildPartRenderKeys", () => {
  test("renders concurrent reasoning sources as isolated source-bound keys", () => {
    const parts: Part[] = [
      createReasoningPart("part_1", "source:a"),
      createReasoningPart("part_2", "source:b"),
      createTextPart("part_3"),
    ];

    expect(buildPartRenderKeys(parts)).toEqual([
      "reasoning-source:source:a",
      "reasoning-source:source:b",
      "part_3",
    ]);
  });

  test("keeps reasoning identity stable across source updates", () => {
    const firstRender = buildPartRenderKeys([createReasoningPart("part_old", "source:a")]);
    const secondRender = buildPartRenderKeys([createReasoningPart("part_new", "source:a")]);

    expect(firstRender).toEqual(["reasoning-source:source:a"]);
    expect(secondRender).toEqual(["reasoning-source:source:a"]);
  });

  test("suffixes duplicate source keys to avoid key collisions", () => {
    const parts: Part[] = [
      createReasoningPart("part_1", "source:a"),
      createReasoningPart("part_2", "source:a"),
    ];

    expect(buildPartRenderKeys(parts)).toEqual([
      "reasoning-source:source:a",
      "reasoning-source:source:a#1",
    ]);
  });
});
