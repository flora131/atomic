/**
 * MessageBubble E2E Tests
 *
 * End-to-end rendering tests for the MessageBubble component using
 * OpenTUI's testRender. Validates visual output for user, assistant,
 * and system messages, collapsed mode, interrupted state, and edge cases.
 */

import { afterEach, describe, expect, test } from "bun:test";
import React from "react";
import { testRender } from "./test-support.ts";
import { ThemeProvider, darkTheme } from "@/theme/index.tsx";
import { MessageBubble } from "@/components/chat-message-bubble.tsx";
import { PROMPT, CONNECTOR, MISC, STATUS } from "@/theme/icons.ts";
import type { ChatMessage } from "@/state/chat/shared/types/message.ts";
import type { TextPart, ToolPart } from "@/state/parts/types.ts";

// ============================================================================
// HELPERS
// ============================================================================

const DEFAULT_WIDTH = 120;
const DEFAULT_HEIGHT = 30;

let activeRenderer: { renderer: { destroy(): void } } | null = null;

/**
 * Factory function for creating test ChatMessage objects.
 */
function createMessage(
  overrides: Partial<ChatMessage> & { role: ChatMessage["role"] },
): ChatMessage {
  return {
    id: `msg-${Date.now()}`,
    content: "Test message content",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Creates a simple TextPart for assistant message testing.
 */
function createTextPart(content: string, id?: string): TextPart {
  return {
    id: id ?? `part-${Date.now()}`,
    type: "text",
    content,
    isStreaming: false,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Creates a simple ToolPart for testing collapsed assistant messages.
 */
function createToolPart(toolName: string, id?: string): ToolPart {
  const partId = id ?? `tool-${Date.now()}`;
  return {
    id: partId,
    type: "tool",
    toolCallId: partId,
    toolName,
    input: {},
    state: { status: "completed", output: undefined, durationMs: 0 },
    createdAt: new Date().toISOString(),
  };
}

/**
 * Render the MessageBubble inside a ThemeProvider and capture the text frame.
 */
async function renderBubble(
  props: Parameters<typeof MessageBubble>[0],
  options?: { width?: number; height?: number },
): Promise<string> {
  const width = options?.width ?? DEFAULT_WIDTH;
  const height = options?.height ?? DEFAULT_HEIGHT;

  const result = await testRender(
    <ThemeProvider initialTheme={darkTheme}>
      <MessageBubble {...props} />
    </ThemeProvider>,
    { width, height },
  );

  activeRenderer = result;
  await result.renderOnce();
  return result.captureCharFrame();
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
// USER MESSAGE TESTS
// ============================================================================

describe("MessageBubble user messages E2E", () => {
  // --------------------------------------------------------------------------
  // 1. Renders user message with content
  // --------------------------------------------------------------------------
  test("renders user message with content", async () => {
    const message = createMessage({
      role: "user",
      content: "Hello, how are you?",
    });

    const frame = await renderBubble({ message });

    expect(frame).toContain("Hello, how are you?");
  });

  // --------------------------------------------------------------------------
  // 2. Renders user message cursor indicator
  // --------------------------------------------------------------------------
  test("renders user message cursor indicator", async () => {
    const message = createMessage({
      role: "user",
      content: "What is the meaning of life?",
    });

    const frame = await renderBubble({ message });

    // User messages show the ❯ cursor indicator
    expect(frame).toContain(PROMPT.cursor);
  });
});

// ============================================================================
// ASSISTANT MESSAGE TESTS
// ============================================================================

describe("MessageBubble assistant messages E2E", () => {
  // --------------------------------------------------------------------------
  // 3. Renders assistant message with text parts — shows ● bullet indicator
  //
  // Note: Text content is rendered via OpenTUI's <code> element with
  // drawUnstyledText={false}, which does not produce visible chars in
  // headless captureCharFrame(). The ● bullet prefix from TextPartDisplay
  // confirms the text part was dispatched and rendered.
  // --------------------------------------------------------------------------
  test("renders assistant message with text content via parts", async () => {
    const message = createMessage({
      role: "assistant",
      content: "",
      parts: [createTextPart("Hello from assistant")],
    });

    const frame = await renderBubble({ message });

    // TextPartDisplay renders a ● bullet for each text part
    expect(frame).toContain(STATUS.active);
  });

  // --------------------------------------------------------------------------
  // 4. Renders assistant message with simple content string (no parts)
  //
  // When parts is empty and content is non-empty, getRenderableAssistantParts
  // synthesizes a TextPart, so the ● bullet should still appear.
  // --------------------------------------------------------------------------
  test("renders assistant message with simple content string", async () => {
    const message = createMessage({
      role: "assistant",
      content: "I can help you with that!",
      parts: [],
    });

    const frame = await renderBubble({ message });

    // Synthetic TextPart created from content string → ● bullet rendered
    expect(frame).toContain(STATUS.active);
  });
});

// ============================================================================
// SYSTEM MESSAGE TESTS
// ============================================================================

describe("MessageBubble system messages E2E", () => {
  // --------------------------------------------------------------------------
  // 5. Renders system message text
  // --------------------------------------------------------------------------
  test("renders system message text", async () => {
    const message = createMessage({
      role: "system",
      content: "System initialization complete",
    });

    const frame = await renderBubble({ message });

    expect(frame).toContain("System initialization complete");
  });

  // --------------------------------------------------------------------------
  // 6. Renders system error message
  // --------------------------------------------------------------------------
  test("renders system error message with error prefix", async () => {
    const message = createMessage({
      role: "system",
      content: "[error] Connection failed: timeout exceeded",
    });

    const frame = await renderBubble({ message });

    // Error messages should still display the content
    expect(frame).toContain("[error] Connection failed: timeout exceeded");
  });
});

// ============================================================================
// COLLAPSED MODE TESTS
// ============================================================================

describe("MessageBubble collapsed mode E2E", () => {
  // --------------------------------------------------------------------------
  // 7. User message in collapsed mode shows truncated content
  // --------------------------------------------------------------------------
  test("user message in collapsed mode shows truncated content", async () => {
    const longContent =
      "This is a very long user message that should be truncated when displayed in collapsed mode because it exceeds the maximum allowed length for display";
    const message = createMessage({
      role: "user",
      content: longContent,
    });

    const frame = await renderBubble({ message, collapsed: true });

    // Should show the cursor indicator
    expect(frame).toContain(PROMPT.cursor);
    // Should NOT contain the full long content (it gets truncated at 78 chars)
    expect(frame).not.toContain(longContent);
    // Should contain the truncation ellipsis
    expect(frame).toContain("…");
  });

  // --------------------------------------------------------------------------
  // 8. Assistant message in collapsed mode shows truncated content with tool count
  // --------------------------------------------------------------------------
  test("assistant message in collapsed mode shows truncated content with tool count", async () => {
    const message = createMessage({
      role: "assistant",
      content: "I analyzed the codebase and found several issues",
      parts: [
        createToolPart("bash", "tool-1"),
        createToolPart("read", "tool-2"),
        createToolPart("edit", "tool-3"),
      ],
    });

    const frame = await renderBubble({ message, collapsed: true });

    // Should show the connector indicator (╰)
    expect(frame).toContain(CONNECTOR.subStatus);
    // Should show tool count with separator (· 3 tools)
    expect(frame).toContain(MISC.separator);
    expect(frame).toContain("3 tools");
  });
});

// ============================================================================
// INTERRUPTED TESTS
// ============================================================================

describe("MessageBubble interrupted state E2E", () => {
  // --------------------------------------------------------------------------
  // 9. Shows interruption warning when wasInterrupted
  // --------------------------------------------------------------------------
  test("shows interruption warning when wasInterrupted", async () => {
    const message = createMessage({
      role: "assistant",
      content: "I was working on something",
      wasInterrupted: true,
      streaming: false,
    });

    const frame = await renderBubble({ message });

    // Should show the cancellation warning text
    expect(frame).toContain("cancelled");
    expect(frame).toContain("Operation cancelled by user");
  });
});

// ============================================================================
// EDGE CASE TESTS
// ============================================================================

describe("MessageBubble edge cases E2E", () => {
  // --------------------------------------------------------------------------
  // 10. Renders empty content gracefully
  // --------------------------------------------------------------------------
  test("renders empty content gracefully", async () => {
    const message = createMessage({
      role: "user",
      content: "",
    });

    // Should not crash on empty content
    const frame = await renderBubble({ message });

    // Frame should be a string (component rendered without error)
    expect(typeof frame).toBe("string");
    // Should still show the cursor for user messages
    expect(frame).toContain(PROMPT.cursor);
  });
});
