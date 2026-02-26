import { describe, expect, test } from "bun:test";
import {
  mergeClosedThinkingSources,
  resolveValidatedThinkingMetaEvent,
  type ThinkingDropDiagnostics,
  type StreamingMeta,
} from "./chat.tsx";

const sourceKey = "claude:block:0";

function createMeta(overrides?: Partial<StreamingMeta>): StreamingMeta {
  return {
    outputTokens: 12,
    thinkingMs: 250,
    thinkingText: "aggregate",
    thinkingSourceKey: sourceKey,
    thinkingTextBySource: { [sourceKey]: "source thought" },
    thinkingGenerationBySource: { [sourceKey]: 3 },
    thinkingMessageBySource: { [sourceKey]: "msg-1" },
    ...overrides,
  };
}

function createDiagnostics(): ThinkingDropDiagnostics {
  return {
    droppedStaleOrClosedThinkingEvents: 0,
    droppedMissingBindingThinkingEvents: 0,
  };
}

describe("resolveValidatedThinkingMetaEvent", () => {
  test("returns null when source generation binding is missing", () => {
    const meta = createMeta({
      thinkingGenerationBySource: {},
    });
    const diagnostics = createDiagnostics();

    const event = resolveValidatedThinkingMetaEvent(meta, "msg-1", undefined, diagnostics);

    expect(event).toBeNull();
    expect(diagnostics).toEqual({
      droppedStaleOrClosedThinkingEvents: 0,
      droppedMissingBindingThinkingEvents: 1,
    });
  });

  test("returns null when source message binding does not match current message", () => {
    const meta = createMeta({
      thinkingMessageBySource: { [sourceKey]: "msg-stale" },
    });
    const diagnostics = createDiagnostics();

    const event = resolveValidatedThinkingMetaEvent(meta, "msg-1", undefined, diagnostics);

    expect(event).toBeNull();
    expect(diagnostics).toEqual({
      droppedStaleOrClosedThinkingEvents: 1,
      droppedMissingBindingThinkingEvents: 0,
    });
  });

  test("defaults to expectedMessageId when source message binding is absent", () => {
    const diagnostics = createDiagnostics();

    const event = resolveValidatedThinkingMetaEvent(createMeta({
      thinkingMessageBySource: {},
    }), "msg-1", undefined, diagnostics);

    expect(event).toEqual({
      thinkingSourceKey: sourceKey,
      targetMessageId: "msg-1",
      streamGeneration: 3,
      thinkingText: "source thought",
    });
    expect(diagnostics).toEqual({
      droppedStaleOrClosedThinkingEvents: 0,
      droppedMissingBindingThinkingEvents: 0,
    });
  });

  test("returns a thinking-meta event when source binding and generation match", () => {
    const meta = createMeta();
    const diagnostics = createDiagnostics();

    const event = resolveValidatedThinkingMetaEvent(meta, "msg-1", undefined, diagnostics);

    expect(event).toEqual({
      thinkingSourceKey: sourceKey,
      targetMessageId: "msg-1",
      streamGeneration: 3,
      thinkingText: "source thought",
    });
    expect(diagnostics).toEqual({
      droppedStaleOrClosedThinkingEvents: 0,
      droppedMissingBindingThinkingEvents: 0,
    });
  });

  test("returns null when the source has already been finalized", () => {
    const meta = createMeta();
    const closedSources = new Set([sourceKey]);
    const diagnostics = createDiagnostics();

    const event = resolveValidatedThinkingMetaEvent(meta, "msg-1", closedSources, diagnostics);

    expect(event).toBeNull();
    expect(diagnostics).toEqual({
      droppedStaleOrClosedThinkingEvents: 1,
      droppedMissingBindingThinkingEvents: 0,
    });
  });

  test("rejects late thinking events after finalize closes the source", () => {
    const closedSources = mergeClosedThinkingSources(new Set(), createMeta());

    const lateEvent = resolveValidatedThinkingMetaEvent(
      createMeta({
        thinkingTextBySource: { [sourceKey]: "late thought" },
      }),
      "msg-1",
      closedSources,
    );

    expect(lateEvent).toBeNull();
  });

  test("collects source keys for finalize cleanup", () => {
    const closedSources = mergeClosedThinkingSources(new Set(["existing:source"]), createMeta({
      thinkingSourceKey: " source:current ",
      thinkingTextBySource: {
        [sourceKey]: "source thought",
        "source:text": "text",
      },
      thinkingGenerationBySource: {
        "source:generation": 3,
      },
      thinkingMessageBySource: {
        " source:message ": "msg-2",
      },
    }));

    expect(closedSources).toEqual(new Set([
      "existing:source",
      sourceKey,
      "source:current",
      "source:text",
      "source:generation",
      "source:message",
    ]));
  });
});
