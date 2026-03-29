/**
 * Unit tests for useStreamState hook
 *
 * Since renderHook is not yet available from @opentui/react/test-utils,
 * these tests verify:
 * - Module exports are correct functions/types
 * - The hook signature is correct
 * - UseStreamStateResult type is re-exported
 *
 * Full React lifecycle testing (renderHook, act) is deferred to the
 * integration test task.
 */

import { describe, test, expect } from "bun:test";

import {
  useStreamState,
  type UseStreamStateResult,
} from "@/state/chat/stream/use-stream-state.ts";

// ============================================================================
// Tests: Module exports
// ============================================================================

describe("useStreamState module exports", () => {
  test("useStreamState is exported as a function", () => {
    expect(typeof useStreamState).toBe("function");
  });

  test("useStreamState accepts one argument (messages)", () => {
    // The hook takes a single `messages: ChatMessage[]` parameter
    expect(useStreamState.length).toBe(1);
  });

  test("UseStreamStateResult type is usable for type narrowing", () => {
    // Type-level check: UseStreamStateResult should be the return type of useStreamState
    type Expected = ReturnType<typeof useStreamState>;
    const _check: Expected extends UseStreamStateResult ? true : never = true;
    expect(_check).toBe(true);
  });
});

// ============================================================================
// Tests: Structural verification of return shape
// ============================================================================

describe("useStreamState return shape (structural)", () => {
  /**
   * The return object should expose specific state values and setters.
   * Since we can't call the hook outside React, we verify the source
   * code structurally to ensure all expected keys are present in the
   * return statement.
   */

  test("source contains all expected state declarations", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const source = fs.readFileSync(
      path.resolve(import.meta.dir, "../../../../src/state/chat/stream/use-stream-state.ts"),
      "utf-8",
    );

    // State values
    const expectedStateValues = [
      "parallelAgents",
      "compactionSummary",
      "showCompactionHistory",
      "todoItems",
      "workflowSessionDir",
      "workflowSessionId",
      "hasRunningTool",
      "activeBackgroundAgentCount",
      "streamingMessageId",
      "lastStreamedMessageId",
      "backgroundAgentMessageId",
      "agentMessageBindings",
      "streamingElapsedMs",
    ];

    for (const key of expectedStateValues) {
      expect(source).toContain(`[${key},`);
    }
  });

  test("source contains all expected setters in return", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const source = fs.readFileSync(
      path.resolve(import.meta.dir, "../../../../src/state/chat/stream/use-stream-state.ts"),
      "utf-8",
    );

    // Extract the return block
    const returnBlock = source.slice(source.indexOf("return {"));

    const expectedSetters = [
      "setParallelAgents",
      "setCompactionSummary",
      "setShowCompactionHistory",
      "setIsAutoCompacting",
      "setTodoItems",
      "setWorkflowSessionDir",
      "setWorkflowSessionId",
      "setHasRunningTool",
      "setActiveBackgroundAgentCount",
      "setStreamingMessageIdState",
      "setLastStreamedMessageIdState",
      "setBackgroundAgentMessageIdState",
      "setAgentMessageBindings",
      "setStreamingElapsedMs",
    ];

    for (const setter of expectedSetters) {
      expect(returnBlock).toContain(setter);
    }
  });

  test("source contains derived memos", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const source = fs.readFileSync(
      path.resolve(import.meta.dir, "../../../../src/state/chat/stream/use-stream-state.ts"),
      "utf-8",
    );

    // Derived memos
    expect(source).toContain("hasInProgressTask");
    expect(source).toContain("hasLiveLoadingIndicator");

    // hasInProgressTask checks for "in_progress" status
    expect(source).toContain('item.status === "in_progress"');

    // hasLiveLoadingIndicator checks multiple signals
    expect(source).toContain("activeBackgroundAgentCount > 0");
    expect(source).toContain("hasInProgressTask");
    expect(source).toContain("message.streaming");
  });

  test("does NOT contain version counter state", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const source = fs.readFileSync(
      path.resolve(import.meta.dir, "../../../../src/state/chat/stream/use-stream-state.ts"),
      "utf-8",
    );

    // Verify old version counters are gone
    expect(source).not.toContain("toolCompletionVersion");
    expect(source).not.toContain("agentAnchorSyncVersion");
  });

  test("uses hasRunningTool boolean instead of version counter", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const source = fs.readFileSync(
      path.resolve(import.meta.dir, "../../../../src/state/chat/stream/use-stream-state.ts"),
      "utf-8",
    );

    // hasRunningTool is a boolean state, not a version counter
    expect(source).toContain("useState(false)");
    expect(source).toContain("hasRunningTool");
    expect(source).toContain("setHasRunningTool");
  });

  test("uses direct message ID state instead of sync version counter", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const source = fs.readFileSync(
      path.resolve(import.meta.dir, "../../../../src/state/chat/stream/use-stream-state.ts"),
      "utf-8",
    );

    // Direct message ID state values replace agentAnchorSyncVersion
    expect(source).toContain("streamingMessageId");
    expect(source).toContain("lastStreamedMessageId");
    expect(source).toContain("backgroundAgentMessageId");

    // Each initialized to null
    expect(source).toContain("useState<string | null>(null)");
  });
});
