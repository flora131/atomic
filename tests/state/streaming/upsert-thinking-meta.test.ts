/**
 * Unit tests for upsertThinkingMeta() ordered part insertion.
 *
 * Task 5 replaced splice()/push() with upsertPart() in upsertThinkingMeta()
 * so that new ReasoningParts are binary-search-inserted into sorted position.
 * Task 6 removed positional heuristics (firstTextIndex scan).
 *
 * These tests verify that:
 * 1. New reasoning parts are inserted in sorted ID order via upsertPart().
 * 2. The WeakMap-based registry correctly maps sourceKey → PartId.
 * 3. Existing parts are updated in-place without changing position.
 * 4. Registry recovery works when the WeakMap entry is missing (cloned messages).
 * 5. The result is always sorted by PartId regardless of insertion order.
 */

import { describe, expect, test, beforeEach } from "bun:test";
import {
  upsertThinkingMeta,
  carryReasoningPartRegistry,
  finalizeThinkingSource,
} from "@/state/streaming/pipeline-thinking.ts";
import { createPartId, _resetPartCounter } from "@/state/parts/id.ts";
import { upsertPart } from "@/state/parts/store.ts";
import type { Part, TextPart, ReasoningPart, ToolPart } from "@/state/parts/types.ts";
import type { PartId } from "@/state/parts/id.ts";
import type { ThinkingMetaEvent } from "@/state/streaming/pipeline-types.ts";
import type { ChatMessage } from "@/types/chat.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function makeMessage(parts: Part[] = []): ChatMessage {
  return {
    id: "msg-test",
    role: "assistant",
    content: "",
    timestamp: new Date().toISOString(),
    parts,
    streaming: true,
  } as ChatMessage;
}

function makeTextPart(content = "hello", isStreaming = true): TextPart {
  return {
    id: createPartId(),
    type: "text",
    content,
    isStreaming,
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

function makeToolPart(
  toolCallId: string,
  status: "pending" | "running" | "completed" = "running",
): ToolPart {
  return {
    id: createPartId(),
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

/** Build a deterministic PartId from a numeric value (zero-padded hex). */
function deterministicId(n: number): PartId {
  const composite = BigInt(n);
  return `part_${composite.toString(16).padStart(12, "0")}` as PartId;
}

/** Assert the parts array is sorted by ID (lexicographic ascending). */
function expectSortedById(parts: ReadonlyArray<Part>): void {
  for (let i = 1; i < parts.length; i++) {
    expect(parts[i]!.id > parts[i - 1]!.id).toBe(true);
  }
}

// ---------------------------------------------------------------------------
// Tests — Basic behavior
// ---------------------------------------------------------------------------

describe("upsertThinkingMeta — basic behavior", () => {
  test("returns message with updated thinkingMs/thinkingText when includeReasoningPart is false", () => {
    const msg = makeMessage([makeTextPart()]);
    const result = upsertThinkingMeta(
      msg,
      makeEvent({ includeReasoningPart: false, thinkingMs: 1234, thinkingText: "deep thought" }),
    );

    expect(result.thinkingMs).toBe(1234);
    expect(result.thinkingText).toBe("deep thought");
    expect(result.parts).toEqual(msg.parts);
  });

  test("sets thinkingText to undefined when event thinkingText is empty string", () => {
    const msg = makeMessage();
    const result = upsertThinkingMeta(
      msg,
      makeEvent({ includeReasoningPart: false, thinkingText: "" }),
    );
    expect(result.thinkingText).toBeUndefined();
  });

  test("inserts new reasoning part into empty parts array", () => {
    const msg = makeMessage();
    const result = upsertThinkingMeta(msg, makeEvent());

    expect(result.parts).toHaveLength(1);
    expect(result.parts![0]!.type).toBe("reasoning");
    expect((result.parts![0] as ReasoningPart).content).toBe("thinking...");
    expect((result.parts![0] as ReasoningPart).isStreaming).toBe(true);
    expect((result.parts![0] as ReasoningPart).thinkingSourceKey).toBe("source:test");
  });

  test("skips insertion when thinkingText is empty/whitespace", () => {
    const msg = makeMessage([makeTextPart()]);
    const result = upsertThinkingMeta(msg, makeEvent({ thinkingText: "   " }));

    expect(result.parts).toHaveLength(1);
    expect(result.parts![0]!.type).toBe("text");
  });

  test("returns a new message reference", () => {
    const msg = makeMessage();
    const result = upsertThinkingMeta(msg, makeEvent());
    expect(result).not.toBe(msg);
  });

  test("propagates thinkingMs and thinkingText to result message", () => {
    const msg = makeMessage();
    const result = upsertThinkingMeta(
      msg,
      makeEvent({ thinkingMs: 777, thinkingText: "specific text" }),
    );
    expect(result.thinkingMs).toBe(777);
    expect(result.thinkingText).toBe("specific text");
  });
});

// ---------------------------------------------------------------------------
// Tests — Ordered insertion
// ---------------------------------------------------------------------------

describe("upsertThinkingMeta — ordered insertion", () => {
  test("new reasoning part is sorted by ID relative to existing text parts", () => {
    const textPart = makeTextPart("existing text");
    const msg = makeMessage([textPart]);

    const result = upsertThinkingMeta(msg, makeEvent());

    expect(result.parts).toHaveLength(2);
    expectSortedById(result.parts!);
  });

  test("maintains sorted order when reasoning inserted among multiple text parts", () => {
    const text1 = makeTextPart("first");
    const text2 = makeTextPart("second");
    const msg = makeMessage([text1, text2]);

    const result = upsertThinkingMeta(msg, makeEvent());

    expect(result.parts).toHaveLength(3);
    expectSortedById(result.parts!);
  });

  test("maintains sorted order among text, tool, and reasoning parts", () => {
    const text1 = makeTextPart("intro", false);
    const tool1 = makeToolPart("tool-1");
    const text2 = makeTextPart("after-tool");
    const msg = makeMessage([text1, tool1, text2]);

    const result = upsertThinkingMeta(msg, makeEvent());

    expect(result.parts).toHaveLength(4);
    expectSortedById(result.parts!);
    expect(result.parts![3]!.type).toBe("reasoning");
  });

  test("multiple different sourceKeys produce sorted reasoning parts", () => {
    let msg = makeMessage();

    msg = upsertThinkingMeta(
      msg,
      makeEvent({ thinkingSourceKey: "source:a", thinkingText: "alpha" }),
    );
    msg = upsertThinkingMeta(
      msg,
      makeEvent({ thinkingSourceKey: "source:b", thinkingText: "beta" }),
    );
    msg = upsertThinkingMeta(
      msg,
      makeEvent({ thinkingSourceKey: "source:c", thinkingText: "gamma" }),
    );

    expect(msg.parts).toHaveLength(3);
    expectSortedById(msg.parts!);

    const contents = msg.parts!.map((p) => (p as ReasoningPart).content);
    expect(contents).toEqual(["alpha", "beta", "gamma"]);
  });

  test("interleaved text and reasoning insertions stay sorted", () => {
    const text1 = makeTextPart("first text");
    let msg = makeMessage([text1]);

    msg = upsertThinkingMeta(
      msg,
      makeEvent({ thinkingSourceKey: "source:a", thinkingText: "thought A" }),
    );

    // Simulate a new text part arriving after reasoning
    const text2 = makeTextPart("second text");
    msg = { ...msg, parts: upsertPart(msg.parts!, text2) };

    msg = upsertThinkingMeta(
      msg,
      makeEvent({ thinkingSourceKey: "source:b", thinkingText: "thought B" }),
    );

    expect(msg.parts).toHaveLength(4);
    expectSortedById(msg.parts!);
  });
});

// ---------------------------------------------------------------------------
// Tests — Registry (WeakMap) behavior
// ---------------------------------------------------------------------------

describe("upsertThinkingMeta — registry-based update", () => {
  test("updates existing reasoning part by sourceKey without duplicating", () => {
    let msg = makeMessage();
    msg = upsertThinkingMeta(msg, makeEvent({ thinkingText: "v1" }));
    msg = upsertThinkingMeta(msg, makeEvent({ thinkingText: "v2" }));
    msg = upsertThinkingMeta(msg, makeEvent({ thinkingText: "v3" }));

    const reasoningParts = msg.parts!.filter((p) => p.type === "reasoning");
    expect(reasoningParts).toHaveLength(1);
    expect((reasoningParts[0] as ReasoningPart).content).toBe("v3");
  });

  test("preserves reasoning part position when updating in-place", () => {
    const text1 = makeTextPart("before");
    let msg = makeMessage([text1]);

    msg = upsertThinkingMeta(msg, makeEvent({ thinkingText: "initial thought" }));
    const originalId = msg.parts!.find((p) => p.type === "reasoning")!.id;

    // Simulate a new text arriving
    const text2 = makeTextPart("after");
    msg = { ...msg, parts: upsertPart(msg.parts!, text2) };

    msg = upsertThinkingMeta(msg, makeEvent({ thinkingText: "updated thought" }));

    const reasoning = msg.parts!.find((p) => p.type === "reasoning") as ReasoningPart;
    expect(reasoning.id).toBe(originalId);
    expect(reasoning.content).toBe("updated thought");
    expectSortedById(msg.parts!);
  });

  test("registry survives across sequential upserts for same sourceKey", () => {
    let msg = makeMessage();

    for (let i = 1; i <= 10; i++) {
      msg = upsertThinkingMeta(msg, makeEvent({ thinkingText: `thought-${i}`, thinkingMs: i * 100 }));
    }

    const reasoningParts = msg.parts!.filter((p) => p.type === "reasoning");
    expect(reasoningParts).toHaveLength(1);
    expect((reasoningParts[0] as ReasoningPart).content).toBe("thought-10");
    expect((reasoningParts[0] as ReasoningPart).durationMs).toBe(1000);
  });

  test("different sourceKeys maintain independent registry entries", () => {
    let msg = makeMessage();

    msg = upsertThinkingMeta(msg, makeEvent({ thinkingSourceKey: "source:a", thinkingText: "alpha-v1" }));
    msg = upsertThinkingMeta(msg, makeEvent({ thinkingSourceKey: "source:b", thinkingText: "beta-v1" }));

    // Update only source:a
    msg = upsertThinkingMeta(msg, makeEvent({ thinkingSourceKey: "source:a", thinkingText: "alpha-v2" }));

    const reasoningParts = msg.parts!.filter((p) => p.type === "reasoning") as ReasoningPart[];
    expect(reasoningParts).toHaveLength(2);

    const alpha = reasoningParts.find((p) => p.thinkingSourceKey === "source:a")!;
    const beta = reasoningParts.find((p) => p.thinkingSourceKey === "source:b")!;
    expect(alpha.content).toBe("alpha-v2");
    expect(beta.content).toBe("beta-v1");
  });

  test("updates durationMs on existing reasoning part", () => {
    let msg = makeMessage();
    msg = upsertThinkingMeta(msg, makeEvent({ thinkingMs: 100 }));
    msg = upsertThinkingMeta(msg, makeEvent({ thinkingMs: 999 }));

    const reasoning = msg.parts!.find((p) => p.type === "reasoning") as ReasoningPart;
    expect(reasoning.durationMs).toBe(999);
  });
});

// ---------------------------------------------------------------------------
// Tests — Registry recovery (cloned/serialized messages)
// ---------------------------------------------------------------------------

describe("upsertThinkingMeta — registry recovery", () => {
  test("recovers registry from parts when WeakMap entry is missing (cloned message)", () => {
    let msg = makeMessage();
    msg = upsertThinkingMeta(msg, makeEvent({ thinkingSourceKey: "source:a", thinkingText: "original" }));

    // Simulate message cloning that breaks WeakMap reference
    const clonedMsg: ChatMessage = JSON.parse(JSON.stringify(msg));

    // Update should find the existing part by scanning parts
    const result = upsertThinkingMeta(
      clonedMsg,
      makeEvent({ thinkingSourceKey: "source:a", thinkingText: "updated after clone" }),
    );

    const reasoningParts = result.parts!.filter((p) => p.type === "reasoning");
    expect(reasoningParts).toHaveLength(1);
    expect((reasoningParts[0] as ReasoningPart).content).toBe("updated after clone");
  });

  test("cloned message does not create duplicate when scanning finds existing part", () => {
    let msg = makeMessage();
    msg = upsertThinkingMeta(msg, makeEvent({ thinkingSourceKey: "source:a", thinkingText: "thought" }));

    const clonedMsg: ChatMessage = JSON.parse(JSON.stringify(msg));

    let result = upsertThinkingMeta(
      clonedMsg,
      makeEvent({ thinkingSourceKey: "source:a", thinkingText: "v2" }),
    );
    result = upsertThinkingMeta(
      result,
      makeEvent({ thinkingSourceKey: "source:a", thinkingText: "v3" }),
    );

    const reasoningParts = result.parts!.filter((p) => p.type === "reasoning");
    expect(reasoningParts).toHaveLength(1);
    expect((reasoningParts[0] as ReasoningPart).content).toBe("v3");
  });

  test("registry cleanup when existingPartId no longer matches a part in the array", () => {
    let msg = makeMessage();
    msg = upsertThinkingMeta(msg, makeEvent({ thinkingSourceKey: "source:a", thinkingText: "thought" }));

    // Manually remove the reasoning part but keep registry intact via carry
    const strippedMsg = carryReasoningPartRegistry(msg, {
      ...msg,
      parts: msg.parts!.filter((p) => p.type !== "reasoning"),
    });

    // The registry still points to the old part ID, but it's gone from parts.
    // upsertThinkingMeta should detect the mismatch and create a new part.
    const result = upsertThinkingMeta(
      strippedMsg,
      makeEvent({ thinkingSourceKey: "source:a", thinkingText: "recreated" }),
    );

    const reasoningParts = result.parts!.filter((p) => p.type === "reasoning");
    expect(reasoningParts).toHaveLength(1);
    expect((reasoningParts[0] as ReasoningPart).content).toBe("recreated");
  });
});

// ---------------------------------------------------------------------------
// Tests — carryReasoningPartRegistry integration
// ---------------------------------------------------------------------------

describe("upsertThinkingMeta — carryReasoningPartRegistry", () => {
  test("carried registry allows update on the new message", () => {
    let msg = makeMessage();
    msg = upsertThinkingMeta(msg, makeEvent({ thinkingText: "first" }));

    // Simulate creating a new message with carried registry (e.g., message copy)
    const newMsg = carryReasoningPartRegistry(msg, {
      ...msg,
      id: "msg-copy",
    });

    const result = upsertThinkingMeta(newMsg, makeEvent({ thinkingText: "updated" }));

    const reasoningParts = result.parts!.filter((p) => p.type === "reasoning");
    expect(reasoningParts).toHaveLength(1);
    expect((reasoningParts[0] as ReasoningPart).content).toBe("updated");
  });
});

// ---------------------------------------------------------------------------
// Tests — finalizeThinkingSource interaction
// ---------------------------------------------------------------------------

describe("upsertThinkingMeta — finalizeThinkingSource interaction", () => {
  test("finalized sourceKey creates a new reasoning part on next upsert", () => {
    let msg = makeMessage();
    msg = upsertThinkingMeta(msg, makeEvent({ thinkingSourceKey: "source:a", thinkingText: "block-1" }));

    // Finalize the thinking source
    msg = finalizeThinkingSource(msg, "source:a", 500);

    const finalized = msg.parts!.find(
      (p) => p.type === "reasoning" && (p as ReasoningPart).thinkingSourceKey === "source:a",
    ) as ReasoningPart;
    expect(finalized.isStreaming).toBe(false);

    // Next upsert with same sourceKey should create a NEW reasoning part
    msg = upsertThinkingMeta(msg, makeEvent({ thinkingSourceKey: "source:a", thinkingText: "block-2" }));

    const reasoningParts = msg.parts!.filter((p) => p.type === "reasoning") as ReasoningPart[];
    expect(reasoningParts).toHaveLength(2);

    const block1 = reasoningParts.find((p) => p.content === "block-1")!;
    const block2 = reasoningParts.find((p) => p.content === "block-2")!;
    expect(block1.isStreaming).toBe(false);
    expect(block2.isStreaming).toBe(true);
    expectSortedById(msg.parts!);
  });

  test("finalized sourceKey does not interfere with other sourceKeys", () => {
    let msg = makeMessage();
    msg = upsertThinkingMeta(msg, makeEvent({ thinkingSourceKey: "source:a", thinkingText: "alpha" }));
    msg = upsertThinkingMeta(msg, makeEvent({ thinkingSourceKey: "source:b", thinkingText: "beta" }));

    msg = finalizeThinkingSource(msg, "source:a", 300);

    // Updating source:b should still work via registry
    msg = upsertThinkingMeta(msg, makeEvent({ thinkingSourceKey: "source:b", thinkingText: "beta-v2" }));

    const reasoningParts = msg.parts!.filter((p) => p.type === "reasoning") as ReasoningPart[];
    expect(reasoningParts).toHaveLength(2);

    const alpha = reasoningParts.find((p) => p.thinkingSourceKey === "source:a")!;
    const beta = reasoningParts.find((p) => p.thinkingSourceKey === "source:b")!;
    expect(alpha.isStreaming).toBe(false);
    expect(beta.content).toBe("beta-v2");
    expect(beta.isStreaming).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests — Immutability
// ---------------------------------------------------------------------------

describe("upsertThinkingMeta — immutability", () => {
  test("does not mutate the original message", () => {
    const text = makeTextPart("original");
    const msg = makeMessage([text]);
    const originalParts = [...msg.parts!];

    upsertThinkingMeta(msg, makeEvent());

    expect(msg.parts).toEqual(originalParts);
  });

  test("does not mutate existing parts when updating reasoning in-place", () => {
    let msg = makeMessage();
    msg = upsertThinkingMeta(msg, makeEvent({ thinkingText: "v1" }));

    const partsBefore = [...msg.parts!];
    const reasoningBefore = { ...msg.parts![0]! };

    msg = upsertThinkingMeta(msg, makeEvent({ thinkingText: "v2" }));

    expect(partsBefore[0]).toEqual(reasoningBefore);
  });

  test("returns new parts array reference on insertion", () => {
    const msg = makeMessage([makeTextPart()]);
    const result = upsertThinkingMeta(msg, makeEvent());
    expect(result.parts).not.toBe(msg.parts);
  });

  test("returns new parts array reference on update", () => {
    let msg = makeMessage();
    msg = upsertThinkingMeta(msg, makeEvent({ thinkingText: "v1" }));
    const partsBefore = msg.parts;

    msg = upsertThinkingMeta(msg, makeEvent({ thinkingText: "v2" }));
    expect(msg.parts).not.toBe(partsBefore);
  });
});

// ---------------------------------------------------------------------------
// Tests — Complex scenarios
// ---------------------------------------------------------------------------

describe("upsertThinkingMeta — complex scenarios", () => {
  test("reasoning among mixed part types stays sorted", () => {
    const text1 = makeTextPart("intro", false);
    const tool1 = makeToolPart("tool-1");
    const text2 = makeTextPart("between", false);
    const tool2 = makeToolPart("tool-2");
    const text3 = makeTextPart("outro");
    let msg = makeMessage([text1, tool1, text2, tool2, text3]);

    msg = upsertThinkingMeta(
      msg,
      makeEvent({ thinkingSourceKey: "source:a", thinkingText: "reasoning" }),
    );

    expect(msg.parts).toHaveLength(6);
    expectSortedById(msg.parts!);
  });

  test("rapid sequential updates for multiple sourceKeys maintain order and count", () => {
    let msg = makeMessage();
    const sourceKeys = ["src:1", "src:2", "src:3", "src:4", "src:5"];

    // Create all sources
    for (const key of sourceKeys) {
      msg = upsertThinkingMeta(
        msg,
        makeEvent({ thinkingSourceKey: key, thinkingText: `${key}-v1` }),
      );
    }

    // Update all sources multiple times
    for (let round = 2; round <= 5; round++) {
      for (const key of sourceKeys) {
        msg = upsertThinkingMeta(
          msg,
          makeEvent({ thinkingSourceKey: key, thinkingText: `${key}-v${round}`, thinkingMs: round * 100 }),
        );
      }
    }

    const reasoningParts = msg.parts!.filter((p) => p.type === "reasoning") as ReasoningPart[];
    expect(reasoningParts).toHaveLength(5);
    expectSortedById(msg.parts!);

    for (const key of sourceKeys) {
      const part = reasoningParts.find((p) => p.thinkingSourceKey === key)!;
      expect(part.content).toBe(`${key}-v5`);
      expect(part.durationMs).toBe(500);
    }
  });

  test("text parts interspersed between reasoning creation rounds stay sorted", () => {
    let msg = makeMessage();

    msg = upsertThinkingMeta(msg, makeEvent({ thinkingSourceKey: "src:1", thinkingText: "thought-1" }));

    const text1 = makeTextPart("text between");
    msg = { ...msg, parts: upsertPart(msg.parts!, text1) };

    msg = upsertThinkingMeta(msg, makeEvent({ thinkingSourceKey: "src:2", thinkingText: "thought-2" }));

    const text2 = makeTextPart("more text");
    msg = { ...msg, parts: upsertPart(msg.parts!, text2) };

    msg = upsertThinkingMeta(msg, makeEvent({ thinkingSourceKey: "src:3", thinkingText: "thought-3" }));

    expect(msg.parts).toHaveLength(5);
    expectSortedById(msg.parts!);
  });

  test("pre-existing reasoning part with matching sourceKey is found by scan fallback", () => {
    // Manually create a reasoning part without going through upsertThinkingMeta
    // (simulates a part that exists but has no registry entry)
    const reasoning = makeReasoningPart("source:manual", "manual thought");
    const text = makeTextPart("some text");
    const msg = makeMessage([reasoning, text]);

    const result = upsertThinkingMeta(
      msg,
      makeEvent({ thinkingSourceKey: "source:manual", thinkingText: "updated" }),
    );

    const reasoningParts = result.parts!.filter((p) => p.type === "reasoning");
    expect(reasoningParts).toHaveLength(1);
    expect((reasoningParts[0] as ReasoningPart).content).toBe("updated");
  });

  test("finalized reasoning part is not matched by scan fallback (isStreaming check)", () => {
    const finalizedReasoning: ReasoningPart = {
      ...makeReasoningPart("source:done", "done thought", false),
    };
    const msg = makeMessage([finalizedReasoning]);

    // upsertThinkingMeta should NOT match the finalized part (isStreaming: false)
    // and should create a new one
    const result = upsertThinkingMeta(
      msg,
      makeEvent({ thinkingSourceKey: "source:done", thinkingText: "new block" }),
    );

    const reasoningParts = result.parts!.filter((p) => p.type === "reasoning") as ReasoningPart[];
    expect(reasoningParts).toHaveLength(2);

    const finalized = reasoningParts.find((p) => !p.isStreaming)!;
    const streaming = reasoningParts.find((p) => p.isStreaming)!;
    expect(finalized.content).toBe("done thought");
    expect(streaming.content).toBe("new block");
    expectSortedById(result.parts!);
  });
});
