/**
 * Unit tests verifying that version counter patterns have been
 * eliminated from the stream state module.
 *
 * The refactoring replaced:
 * - toolCompletionVersion (number counter) → hasRunningTool (boolean)
 * - agentAnchorSyncVersion (number counter) → direct message ID state values
 *
 * These tests verify the elimination is structurally correct and the
 * new patterns are in place.
 */

import { describe, test, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

import { useStreamState, type UseStreamStateResult } from "@/state/chat/stream/use-stream-state.ts";

const SRC_ROOT = path.resolve(import.meta.dir, "../../../../src");

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(SRC_ROOT, relativePath), "utf-8");
}

// ============================================================================
// Tests: Version counter elimination
// ============================================================================

describe("version counter elimination", () => {
  test("useStreamState is exported as a function", () => {
    expect(typeof useStreamState).toBe("function");
  });

  test("UseStreamStateResult type is the return type of useStreamState", () => {
    type Expected = ReturnType<typeof useStreamState>;
    const _check: Expected extends UseStreamStateResult ? true : never = true;
    expect(_check).toBe(true);
  });

  test("source does not contain toolCompletionVersion", () => {
    const source = readSource("state/chat/stream/use-stream-state.ts");
    expect(source).not.toContain("toolCompletionVersion");
  });

  test("source does not contain agentAnchorSyncVersion", () => {
    const source = readSource("state/chat/stream/use-stream-state.ts");
    expect(source).not.toContain("agentAnchorSyncVersion");
  });

  test("source uses hasRunningTool boolean instead of toolCompletionVersion counter", () => {
    const source = readSource("state/chat/stream/use-stream-state.ts");

    // hasRunningTool should be a boolean state
    expect(source).toContain("hasRunningTool");
    expect(source).toContain("setHasRunningTool");
    expect(source).toContain("useState(false)");
  });

  test("source uses direct message ID state instead of agentAnchorSyncVersion counter", () => {
    const source = readSource("state/chat/stream/use-stream-state.ts");

    // Direct message ID state values
    expect(source).toContain("streamingMessageId");
    expect(source).toContain("lastStreamedMessageId");
    expect(source).toContain("backgroundAgentMessageId");

    // Each is a string | null state
    expect(source).toContain("useState<string | null>(null)");
  });

  test("source does not use version counter increment patterns", () => {
    const source = readSource("state/chat/stream/use-stream-state.ts");

    // Version counter patterns like `prev + 1` or `v + 1` should not exist
    expect(source).not.toContain("prev + 1");
    expect(source).not.toContain("v + 1");

    // useState(0) IS legitimate for numeric state like activeBackgroundAgentCount
    // and streamingElapsedMs — just verify no *Version variable uses it
    expect(source).not.toMatch(/Version.*useState\(\s*0\s*\)/);
    expect(source).not.toMatch(/useState\(\s*0\s*\).*Version/);
  });
});

// ============================================================================
// Tests: Consumers don't reference old version counters
// ============================================================================

describe("version counter elimination across consumers", () => {
  test("use-runtime.ts does not reference toolCompletionVersion", () => {
    const source = readSource("state/chat/stream/use-runtime.ts");
    expect(source).not.toContain("toolCompletionVersion");
  });

  test("use-runtime.ts does not reference agentAnchorSyncVersion", () => {
    const source = readSource("state/chat/stream/use-runtime.ts");
    expect(source).not.toContain("agentAnchorSyncVersion");
  });

  test("use-runtime.ts uses hasRunningTool from useStreamState", () => {
    const source = readSource("state/chat/stream/use-runtime.ts");
    expect(source).toContain("hasRunningTool");
  });

  test("use-runtime.ts uses direct message ID state from useStreamState", () => {
    const source = readSource("state/chat/stream/use-runtime.ts");

    // At least one of the message ID state values should be referenced
    const hasMessageIdRef =
      source.includes("streamingMessageId") ||
      source.includes("lastStreamedMessageId") ||
      source.includes("backgroundAgentMessageId");

    expect(hasMessageIdRef).toBe(true);
  });
});

// ============================================================================
// Tests: Return shape includes new state values
// ============================================================================

describe("useStreamState return shape has new state values", () => {
  test("return block contains hasRunningTool", () => {
    const source = readSource("state/chat/stream/use-stream-state.ts");
    const returnBlock = source.slice(source.indexOf("return {"));

    expect(returnBlock).toContain("hasRunningTool");
    expect(returnBlock).toContain("setHasRunningTool");
  });

  test("return block contains direct message ID state values", () => {
    const source = readSource("state/chat/stream/use-stream-state.ts");
    const returnBlock = source.slice(source.indexOf("return {"));

    expect(returnBlock).toContain("streamingMessageId");
    expect(returnBlock).toContain("lastStreamedMessageId");
    expect(returnBlock).toContain("backgroundAgentMessageId");
  });

  test("return block contains message ID setters", () => {
    const source = readSource("state/chat/stream/use-stream-state.ts");
    const returnBlock = source.slice(source.indexOf("return {"));

    expect(returnBlock).toContain("setStreamingMessageIdState");
    expect(returnBlock).toContain("setLastStreamedMessageIdState");
    expect(returnBlock).toContain("setBackgroundAgentMessageIdState");
  });
});
