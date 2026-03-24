import { describe, expect, test } from "bun:test";
import {
  createThinkingDropDiagnostics,
  traceThinkingSourceLifecycle,
  mergeClosedThinkingSources,
  resolveValidatedThinkingMetaEvent,
} from "@/state/chat/shared/helpers/thinking.ts";
import type { StreamingMeta, ThinkingDropDiagnostics } from "@/state/chat/shared/types/message.ts";

function makeMeta(overrides: Partial<StreamingMeta> = {}): StreamingMeta {
  return {
    outputTokens: 0,
    thinkingMs: 0,
    thinkingText: "",
    ...overrides,
  };
}

describe("createThinkingDropDiagnostics", () => {
  test("returns zeroed counters", () => {
    const result = createThinkingDropDiagnostics();
    expect(result).toEqual({
      droppedStaleOrClosedThinkingEvents: 0,
      droppedMissingBindingThinkingEvents: 0,
    });
  });

  test("returns a new object each time", () => {
    const a = createThinkingDropDiagnostics();
    const b = createThinkingDropDiagnostics();
    expect(a).not.toBe(b);
  });
});

describe("traceThinkingSourceLifecycle", () => {
  test("does not throw without debug env var", () => {
    expect(() => traceThinkingSourceLifecycle("create", "src-1")).not.toThrow();
  });

  test("does not throw with detail", () => {
    expect(() => traceThinkingSourceLifecycle("drop", "src-2", "some detail")).not.toThrow();
  });
});

describe("mergeClosedThinkingSources", () => {
  test("returns copy of existing closed sources when meta is null", () => {
    const existing = new Set(["key-1"]);
    const result = mergeClosedThinkingSources(existing, null);
    expect(result).toEqual(new Set(["key-1"]));
    expect(result).not.toBe(existing);
  });

  test("returns copy of existing closed sources when meta is undefined", () => {
    const existing = new Set(["key-1"]);
    const result = mergeClosedThinkingSources(existing, undefined);
    expect(result).toEqual(new Set(["key-1"]));
  });

  test("merges thinkingSourceKey from meta", () => {
    const result = mergeClosedThinkingSources(new Set(), makeMeta({ thinkingSourceKey: "src-A" }));
    expect(result.has("src-A")).toBe(true);
  });

  test("merges keys from thinkingTextBySource", () => {
    const result = mergeClosedThinkingSources(
      new Set(),
      makeMeta({ thinkingTextBySource: { "src-B": "text", "src-C": "text2" } }),
    );
    expect(result.has("src-B")).toBe(true);
    expect(result.has("src-C")).toBe(true);
  });

  test("merges keys from thinkingGenerationBySource", () => {
    const result = mergeClosedThinkingSources(
      new Set(),
      makeMeta({ thinkingGenerationBySource: { "gen-1": 1 } }),
    );
    expect(result.has("gen-1")).toBe(true);
  });

  test("merges keys from thinkingMessageBySource", () => {
    const result = mergeClosedThinkingSources(
      new Set(),
      makeMeta({ thinkingMessageBySource: { "msg-1": "id-1" } }),
    );
    expect(result.has("msg-1")).toBe(true);
  });

  test("preserves existing closed sources", () => {
    const existing = new Set(["old-key"]);
    const result = mergeClosedThinkingSources(
      existing,
      makeMeta({ thinkingSourceKey: "new-key" }),
    );
    expect(result.has("old-key")).toBe(true);
    expect(result.has("new-key")).toBe(true);
  });

  test("ignores empty/whitespace-only source keys", () => {
    const result = mergeClosedThinkingSources(
      new Set(),
      makeMeta({ thinkingSourceKey: "  " }),
    );
    expect(result.size).toBe(0);
  });

  test("trims source key before adding", () => {
    const result = mergeClosedThinkingSources(
      new Set(),
      makeMeta({ thinkingSourceKey: "  key-with-spaces  " }),
    );
    expect(result.has("key-with-spaces")).toBe(true);
  });
});

describe("resolveValidatedThinkingMetaEvent", () => {
  const messageId = "msg-123";

  test("returns valid event for well-formed input", () => {
    const meta = makeMeta({
      thinkingSourceKey: "src-1",
      thinkingGenerationBySource: { "src-1": 5 },
      thinkingTextBySource: { "src-1": "thinking text here" },
    });
    const result = resolveValidatedThinkingMetaEvent(meta, messageId);
    expect(result).toEqual({
      thinkingSourceKey: "src-1",
      targetMessageId: messageId,
      streamGeneration: 5,
      thinkingText: "thinking text here",
    });
  });

  test("falls back to meta.thinkingText when source text is missing", () => {
    const meta = makeMeta({
      thinkingSourceKey: "src-1",
      thinkingGenerationBySource: { "src-1": 1 },
      thinkingText: "fallback text",
    });
    const result = resolveValidatedThinkingMetaEvent(meta, messageId);
    expect(result).not.toBeNull();
    expect(result!.thinkingText).toBe("fallback text");
  });

  test("returns null for empty source key", () => {
    const meta = makeMeta({ thinkingSourceKey: "" });
    expect(resolveValidatedThinkingMetaEvent(meta, messageId)).toBeNull();
  });

  test("returns null for whitespace-only source key", () => {
    const meta = makeMeta({ thinkingSourceKey: "   " });
    expect(resolveValidatedThinkingMetaEvent(meta, messageId)).toBeNull();
  });

  test("returns null for missing source key", () => {
    const meta = makeMeta({});
    expect(resolveValidatedThinkingMetaEvent(meta, messageId)).toBeNull();
  });

  test("returns null for closed source and increments stale counter", () => {
    const meta = makeMeta({
      thinkingSourceKey: "src-closed",
      thinkingGenerationBySource: { "src-closed": 1 },
    });
    const diagnostics = createThinkingDropDiagnostics();
    const closedSources = new Set(["src-closed"]);
    const result = resolveValidatedThinkingMetaEvent(meta, messageId, closedSources, diagnostics);
    expect(result).toBeNull();
    expect(diagnostics.droppedStaleOrClosedThinkingEvents).toBe(1);
  });

  test("returns null for message ID mismatch and increments stale counter", () => {
    const meta = makeMeta({
      thinkingSourceKey: "src-1",
      thinkingGenerationBySource: { "src-1": 1 },
      thinkingMessageBySource: { "src-1": "different-msg" },
    });
    const diagnostics = createThinkingDropDiagnostics();
    const result = resolveValidatedThinkingMetaEvent(meta, messageId, undefined, diagnostics);
    expect(result).toBeNull();
    expect(diagnostics.droppedStaleOrClosedThinkingEvents).toBe(1);
  });

  test("returns null for missing generation binding and increments missing counter", () => {
    const meta = makeMeta({
      thinkingSourceKey: "src-1",
      // no thinkingGenerationBySource
    });
    const diagnostics = createThinkingDropDiagnostics();
    const result = resolveValidatedThinkingMetaEvent(meta, messageId, undefined, diagnostics);
    expect(result).toBeNull();
    expect(diagnostics.droppedMissingBindingThinkingEvents).toBe(1);
  });

  test("returns null for non-finite generation", () => {
    const meta = makeMeta({
      thinkingSourceKey: "src-1",
      thinkingGenerationBySource: { "src-1": NaN },
    });
    const diagnostics = createThinkingDropDiagnostics();
    const result = resolveValidatedThinkingMetaEvent(meta, messageId, undefined, diagnostics);
    expect(result).toBeNull();
    expect(diagnostics.droppedMissingBindingThinkingEvents).toBe(1);
  });

  test("uses expectedMessageId when source message entry is absent", () => {
    const meta = makeMeta({
      thinkingSourceKey: "src-1",
      thinkingGenerationBySource: { "src-1": 3 },
    });
    const result = resolveValidatedThinkingMetaEvent(meta, messageId);
    expect(result).not.toBeNull();
    expect(result!.targetMessageId).toBe(messageId);
  });

  test("uses expectedMessageId when source message entry matches", () => {
    const meta = makeMeta({
      thinkingSourceKey: "src-1",
      thinkingGenerationBySource: { "src-1": 2 },
      thinkingMessageBySource: { "src-1": messageId },
    });
    const result = resolveValidatedThinkingMetaEvent(meta, messageId);
    expect(result).not.toBeNull();
    expect(result!.targetMessageId).toBe(messageId);
  });

  test("accumulates multiple drops in diagnostics", () => {
    const diagnostics = createThinkingDropDiagnostics();
    // Two drops: one closed, one missing generation
    resolveValidatedThinkingMetaEvent(
      makeMeta({ thinkingSourceKey: "src-1", thinkingGenerationBySource: { "src-1": 1 } }),
      messageId,
      new Set(["src-1"]),
      diagnostics,
    );
    resolveValidatedThinkingMetaEvent(
      makeMeta({ thinkingSourceKey: "src-2" }),
      messageId,
      undefined,
      diagnostics,
    );
    expect(diagnostics.droppedStaleOrClosedThinkingEvents).toBe(1);
    expect(diagnostics.droppedMissingBindingThinkingEvents).toBe(1);
  });
});
