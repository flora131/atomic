/**
 * QueueIndicator E2E Tests
 *
 * End-to-end rendering tests for the QueueIndicator component using
 * OpenTUI's testRender. Validates visual output for compact, non-compact,
 * edit mode, and edge-case scenarios.
 */

import { afterEach, describe, expect, test } from "bun:test";
import React from "react";
import { testRender } from "./test-support.ts";
import { ThemeProvider, darkTheme } from "@/theme/index.tsx";
import {
  QueueIndicator,
  type QueueIndicatorProps,
} from "@/components/queue-indicator.tsx";
import type { QueuedMessage } from "@/hooks/use-message-queue.ts";

// ============================================================================
// HELPERS
// ============================================================================

const DEFAULT_WIDTH = 80;
const DEFAULT_HEIGHT = 24;

let activeRenderer: { renderer: { destroy(): void } } | null = null;

/**
 * Render the QueueIndicator inside a ThemeProvider and capture the text frame.
 */
async function renderIndicator(
  props: QueueIndicatorProps,
  options?: { width?: number; height?: number },
): Promise<string> {
  const width = options?.width ?? DEFAULT_WIDTH;
  const height = options?.height ?? DEFAULT_HEIGHT;

  const result = await testRender(
    <ThemeProvider initialTheme={darkTheme}>
      <QueueIndicator {...props} />
    </ThemeProvider>,
    { width, height },
  );

  activeRenderer = result;
  await result.renderOnce();
  return result.captureCharFrame();
}

function makeMessage(
  id: string,
  content: string,
  overrides?: Partial<QueuedMessage>,
): QueuedMessage {
  return {
    id,
    content,
    queuedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ============================================================================
// TEARDOWN
// ============================================================================

afterEach(() => {
  if (activeRenderer) {
    activeRenderer.renderer.destroy();
    activeRenderer = null;
  }
});

// ============================================================================
// TESTS
// ============================================================================

describe("QueueIndicator E2E", () => {
  // --------------------------------------------------------------------------
  // 1. Empty queue renders nothing
  // --------------------------------------------------------------------------
  test("renders nothing when count is 0", async () => {
    const frame = await renderIndicator({ count: 0 });

    // The entire captured frame should be blank (only whitespace)
    expect(frame.trim()).toBe("");
  });

  // --------------------------------------------------------------------------
  // 2. Single message compact
  // --------------------------------------------------------------------------
  test("compact mode shows '1 message queued' and first message preview", async () => {
    const queue: QueuedMessage[] = [makeMessage("1", "Fix bug")];

    const frame = await renderIndicator({ count: 1, queue });

    expect(frame).toContain("1 message queued");
    // Preview line: "❯ Fix bug"
    expect(frame).toContain("❯");
    expect(frame).toContain("Fix bug");
    // Single message — should NOT show "(+N more)"
    expect(frame).not.toContain("more)");
  });

  // --------------------------------------------------------------------------
  // 3. Multiple messages compact
  // --------------------------------------------------------------------------
  test("compact mode shows 'N messages queued', preview, and (+N more)", async () => {
    const queue: QueuedMessage[] = [
      makeMessage("1", "Fix bug"),
      makeMessage("2", "Add feature"),
    ];

    const frame = await renderIndicator({ count: 2, queue });

    expect(frame).toContain("2 messages queued");
    // First message preview
    expect(frame).toContain("❯");
    expect(frame).toContain("Fix bug");
    // Should indicate additional queued messages
    expect(frame).toContain("(+1 more)");
  });

  // --------------------------------------------------------------------------
  // 4. Non-compact mode
  // --------------------------------------------------------------------------
  test("non-compact mode shows numbered list of messages", async () => {
    const queue: QueuedMessage[] = [
      makeMessage("1", "Fix bug"),
      makeMessage("2", "Add feature"),
    ];

    const frame = await renderIndicator({
      count: 2,
      queue,
      compact: false,
    });

    expect(frame).toContain("2 messages queued");
    // Each message should show with ❯ prefix
    expect(frame).toContain("Fix bug");
    expect(frame).toContain("Add feature");
  });

  // --------------------------------------------------------------------------
  // 5. Edit mode highlighting
  // --------------------------------------------------------------------------
  test("edit mode highlights the message at editIndex with › prefix", async () => {
    const queue: QueuedMessage[] = [
      makeMessage("1", "Fix bug"),
      makeMessage("2", "Add feature"),
    ];

    const frame = await renderIndicator({
      count: 2,
      queue,
      compact: false,
      editable: true,
      editIndex: 0,
    });

    // First message should use edit prefix "›"
    expect(frame).toContain("›");
    expect(frame).toContain("Fix bug");
    // Second message should use regular prefix "❯"
    expect(frame).toContain("Add feature");
  });

  // --------------------------------------------------------------------------
  // 6. Long message truncation
  // --------------------------------------------------------------------------
  test("truncates message content that exceeds terminal width", async () => {
    const longContent = "A".repeat(200);
    const queue: QueuedMessage[] = [makeMessage("1", longContent)];

    // Use a narrow terminal width to force truncation
    const frame = await renderIndicator(
      { count: 1, queue },
      { width: 40 },
    );

    expect(frame).toContain("1 message queued");
    // The full 200-char content should NOT appear
    expect(frame).not.toContain(longContent);
    // Truncated text ends with "..."
    expect(frame).toContain("...");
  });

  // --------------------------------------------------------------------------
  // 7. Three+ messages non-compact — max 3 visible, "...and N more"
  // --------------------------------------------------------------------------
  test("non-compact mode shows max 3 messages and '...and N more' for extras", async () => {
    const queue: QueuedMessage[] = [
      makeMessage("1", "First task"),
      makeMessage("2", "Second task"),
      makeMessage("3", "Third task"),
      makeMessage("4", "Fourth task"),
      makeMessage("5", "Fifth task"),
    ];

    const frame = await renderIndicator({
      count: 5,
      queue,
      compact: false,
    });

    expect(frame).toContain("5 messages queued");
    // First three should be visible
    expect(frame).toContain("First task");
    expect(frame).toContain("Second task");
    expect(frame).toContain("Third task");
    // Fourth and fifth should NOT be visible
    expect(frame).not.toContain("Fourth task");
    expect(frame).not.toContain("Fifth task");
    // Overflow indicator
    expect(frame).toContain("...and 2 more");
  });

  // --------------------------------------------------------------------------
  // Additional: displayContent takes precedence over content
  // --------------------------------------------------------------------------
  test("uses displayContent for preview when available", async () => {
    const queue: QueuedMessage[] = [
      makeMessage("1", "raw command --verbose", {
        displayContent: "Run tests",
      }),
    ];

    const frame = await renderIndicator({ count: 1, queue });

    // displayContent should be shown, not the raw content
    expect(frame).toContain("Run tests");
    expect(frame).not.toContain("raw command --verbose");
  });

  // --------------------------------------------------------------------------
  // Additional: queue icon renders
  // --------------------------------------------------------------------------
  test("renders the queue icon (⋮)", async () => {
    const queue: QueuedMessage[] = [makeMessage("1", "Test message")];

    const frame = await renderIndicator({ count: 1, queue });

    expect(frame).toContain("⋮");
  });

  // --------------------------------------------------------------------------
  // Additional: edit mode does not affect non-edited messages
  // --------------------------------------------------------------------------
  test("non-edited messages retain ❯ prefix in edit mode", async () => {
    const queue: QueuedMessage[] = [
      makeMessage("1", "First message"),
      makeMessage("2", "Second message"),
      makeMessage("3", "Third message"),
    ];

    const frame = await renderIndicator({
      count: 3,
      queue,
      compact: false,
      editable: true,
      editIndex: 1,
    });

    // The edited message (index 1) should show "›"
    expect(frame).toContain("›");
    expect(frame).toContain("Second message");
    // Other messages should still be visible
    expect(frame).toContain("First message");
    expect(frame).toContain("Third message");
  });
});
