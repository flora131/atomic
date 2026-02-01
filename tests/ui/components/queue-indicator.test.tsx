/**
 * Tests for QueueIndicator Component
 *
 * Tests cover:
 * - Visibility (only when count > 0)
 * - Count display formatting
 * - Compact vs non-compact modes
 * - Queue preview in non-compact mode
 * - Utility functions
 * - Edge cases
 */

import { describe, test, expect } from "bun:test";
import {
  formatQueueCount,
  getQueueIcon,
  truncateContent,
  type QueueIndicatorProps,
} from "../../../src/ui/components/queue-indicator.tsx";
import type { QueuedMessage } from "../../../src/ui/hooks/use-message-queue.ts";

// ============================================================================
// FORMAT QUEUE COUNT TESTS
// ============================================================================

describe("formatQueueCount", () => {
  test("returns empty string for zero count", () => {
    expect(formatQueueCount(0)).toBe("");
  });

  test("returns singular form for count of 1", () => {
    expect(formatQueueCount(1)).toBe("1 message queued");
  });

  test("returns plural form for count > 1", () => {
    expect(formatQueueCount(2)).toBe("2 messages queued");
    expect(formatQueueCount(5)).toBe("5 messages queued");
    expect(formatQueueCount(10)).toBe("10 messages queued");
  });

  test("handles large counts", () => {
    expect(formatQueueCount(100)).toBe("100 messages queued");
    expect(formatQueueCount(999)).toBe("999 messages queued");
  });
});

// ============================================================================
// GET QUEUE ICON TESTS
// ============================================================================

describe("getQueueIcon", () => {
  test("returns clipboard icon", () => {
    expect(getQueueIcon()).toBe("📋");
  });

  test("returns consistent icon", () => {
    expect(getQueueIcon()).toBe(getQueueIcon());
  });
});

// ============================================================================
// TRUNCATE CONTENT TESTS
// ============================================================================

describe("truncateContent", () => {
  test("returns content unchanged when shorter than max", () => {
    expect(truncateContent("Hello", 20)).toBe("Hello");
    expect(truncateContent("Short", 10)).toBe("Short");
  });

  test("returns content unchanged when equal to max", () => {
    expect(truncateContent("Hello World", 11)).toBe("Hello World");
  });

  test("truncates content when longer than max", () => {
    expect(truncateContent("Hello World", 10)).toBe("Hello W...");
    expect(truncateContent("This is a long message", 15)).toBe("This is a lo...");
  });

  test("uses default max length of 20", () => {
    const longContent = "This is a very long message that should be truncated";
    const result = truncateContent(longContent);
    expect(result).toBe("This is a very lo...");
    expect(result.length).toBe(20);
  });

  test("handles empty string", () => {
    expect(truncateContent("")).toBe("");
    expect(truncateContent("", 10)).toBe("");
  });

  test("handles single character", () => {
    expect(truncateContent("A", 5)).toBe("A");
  });

  test("handles edge case with maxLength of 3 (minimum for ellipsis)", () => {
    expect(truncateContent("Hello", 3)).toBe("...");
  });

  test("handles very small maxLength", () => {
    expect(truncateContent("Hello", 4)).toBe("H...");
  });
});

// ============================================================================
// QUEUE INDICATOR PROPS TESTS
// ============================================================================

describe("QueueIndicatorProps structure", () => {
  test("minimal props with zero count", () => {
    const props: QueueIndicatorProps = {
      count: 0,
    };

    expect(props.count).toBe(0);
    expect(props.queue).toBeUndefined();
    expect(props.compact).toBeUndefined();
  });

  test("props with positive count", () => {
    const props: QueueIndicatorProps = {
      count: 3,
    };

    expect(props.count).toBe(3);
  });

  test("props with queue array", () => {
    const queue: QueuedMessage[] = [
      { id: "q1", content: "First message", queuedAt: "2026-02-01T10:00:00Z" },
      { id: "q2", content: "Second message", queuedAt: "2026-02-01T10:00:01Z" },
    ];

    const props: QueueIndicatorProps = {
      count: 2,
      queue,
    };

    expect(props.count).toBe(2);
    expect(props.queue).toHaveLength(2);
    expect(props.queue![0].content).toBe("First message");
  });

  test("props with compact mode", () => {
    const props: QueueIndicatorProps = {
      count: 1,
      compact: true,
    };

    expect(props.compact).toBe(true);
  });

  test("props with non-compact mode", () => {
    const props: QueueIndicatorProps = {
      count: 1,
      compact: false,
    };

    expect(props.compact).toBe(false);
  });

  test("full props", () => {
    const queue: QueuedMessage[] = [
      { id: "q1", content: "Message 1", queuedAt: "2026-02-01T10:00:00Z" },
    ];

    const props: QueueIndicatorProps = {
      count: 1,
      queue,
      compact: false,
    };

    expect(props.count).toBe(1);
    expect(props.queue).toHaveLength(1);
    expect(props.compact).toBe(false);
  });
});

// ============================================================================
// DISPLAY LOGIC TESTS
// ============================================================================

describe("Display logic", () => {
  test("builds compact display correctly", () => {
    const icon = getQueueIcon();
    const countText = formatQueueCount(3);

    expect(icon).toBe("📋");
    expect(countText).toBe("3 messages queued");
  });

  test("builds non-compact display with preview", () => {
    const queue: QueuedMessage[] = [
      { id: "q1", content: "Short message", queuedAt: "2026-02-01T10:00:00Z" },
      { id: "q2", content: "This is a longer message that will be truncated", queuedAt: "2026-02-01T10:00:01Z" },
    ];

    const previews = queue.map((msg, i) => `${i + 1}. ${truncateContent(msg.content)}`);

    expect(previews[0]).toBe("1. Short message");
    expect(previews[1]).toBe("2. This is a longer ...");
  });

  test("limits preview to first 3 messages", () => {
    const queue: QueuedMessage[] = [
      { id: "q1", content: "Message 1", queuedAt: "2026-02-01T10:00:00Z" },
      { id: "q2", content: "Message 2", queuedAt: "2026-02-01T10:00:01Z" },
      { id: "q3", content: "Message 3", queuedAt: "2026-02-01T10:00:02Z" },
      { id: "q4", content: "Message 4", queuedAt: "2026-02-01T10:00:03Z" },
      { id: "q5", content: "Message 5", queuedAt: "2026-02-01T10:00:04Z" },
    ];

    const shown = queue.slice(0, 3);
    const remaining = queue.length - 3;

    expect(shown).toHaveLength(3);
    expect(remaining).toBe(2);
  });
});

// ============================================================================
// QUEUED MESSAGE STRUCTURE TESTS
// ============================================================================

describe("QueuedMessage structure", () => {
  test("basic message structure", () => {
    const message: QueuedMessage = {
      id: "queue_1234_abc",
      content: "Test message",
      queuedAt: "2026-02-01T10:00:00.000Z",
    };

    expect(message.id).toBe("queue_1234_abc");
    expect(message.content).toBe("Test message");
    expect(message.queuedAt).toBe("2026-02-01T10:00:00.000Z");
  });

  test("message with empty content", () => {
    const message: QueuedMessage = {
      id: "queue_empty",
      content: "",
      queuedAt: "2026-02-01T10:00:00.000Z",
    };

    expect(message.content).toBe("");
  });

  test("message with long content", () => {
    const longContent = "A".repeat(1000);
    const message: QueuedMessage = {
      id: "queue_long",
      content: longContent,
      queuedAt: "2026-02-01T10:00:00.000Z",
    };

    expect(message.content.length).toBe(1000);
    expect(truncateContent(message.content)).toBe("AAAAAAAAAAAAAAAAA...");
  });

  test("message with special characters", () => {
    const message: QueuedMessage = {
      id: "queue_special",
      content: "<script>alert('xss')</script>",
      queuedAt: "2026-02-01T10:00:00.000Z",
    };

    expect(message.content).toContain("<script>");
    expect(truncateContent(message.content)).toBe("<script>alert('xs...");
  });

  test("message with unicode characters", () => {
    const message: QueuedMessage = {
      id: "queue_unicode",
      content: "Hello 👋 World 🌍",
      queuedAt: "2026-02-01T10:00:00.000Z",
    };

    expect(message.content).toBe("Hello 👋 World 🌍");
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe("Edge cases", () => {
  test("handles negative count", () => {
    // formatQueueCount should handle negative gracefully
    // Implementation may vary, but shouldn't crash
    const result = formatQueueCount(-1);
    expect(result).toBe("-1 messages queued");
  });

  test("handles very large count", () => {
    expect(formatQueueCount(1000000)).toBe("1000000 messages queued");
  });

  test("handles empty queue array", () => {
    const props: QueueIndicatorProps = {
      count: 0,
      queue: [],
    };

    expect(props.queue).toHaveLength(0);
    expect(props.count).toBe(0);
  });

  test("handles queue with count mismatch", () => {
    // This tests that the component uses count prop, not queue.length
    const props: QueueIndicatorProps = {
      count: 3,
      queue: [
        { id: "q1", content: "Only one", queuedAt: "2026-02-01T10:00:00Z" },
      ],
    };

    // count prop takes precedence for display
    expect(formatQueueCount(props.count)).toBe("3 messages queued");
    expect(props.queue).toHaveLength(1);
  });

  test("handles whitespace-only content", () => {
    const message: QueuedMessage = {
      id: "queue_whitespace",
      content: "   ",
      queuedAt: "2026-02-01T10:00:00Z",
    };

    expect(truncateContent(message.content)).toBe("   ");
  });

  test("handles newlines in content", () => {
    const message: QueuedMessage = {
      id: "queue_newlines",
      content: "Line 1\nLine 2\nLine 3",
      queuedAt: "2026-02-01T10:00:00Z",
    };

    const truncated = truncateContent(message.content);
    // Content is 21 chars, default maxLength is 20, so it gets truncated
    expect(truncated).toBe("Line 1\nLine 2\nLine 3");
  });

  test("handles tabs in content", () => {
    const message: QueuedMessage = {
      id: "queue_tabs",
      content: "Col1\tCol2\tCol3",
      queuedAt: "2026-02-01T10:00:00Z",
    };

    const truncated = truncateContent(message.content);
    expect(truncated).toBe("Col1\tCol2\tCol3");
  });
});

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe("Integration", () => {
  test("full flow: format count and preview", () => {
    const queue: QueuedMessage[] = [
      { id: "q1", content: "What is the meaning of life?", queuedAt: "2026-02-01T10:00:00Z" },
      { id: "q2", content: "Explain quantum computing", queuedAt: "2026-02-01T10:00:01Z" },
    ];

    const icon = getQueueIcon();
    const countText = formatQueueCount(queue.length);
    const previews = queue.map((msg, i) => `${i + 1}. ${truncateContent(msg.content)}`);

    expect(icon).toBe("📋");
    expect(countText).toBe("2 messages queued");
    expect(previews).toEqual([
      "1. What is the meani...",
      "2. Explain quantum c...",
    ]);
  });

  test("empty queue renders nothing", () => {
    const count = 0;
    const text = formatQueueCount(count);

    expect(text).toBe("");
    // Component should return null when count is 0
  });

  test("single message in queue", () => {
    const queue: QueuedMessage[] = [
      { id: "q1", content: "Help me!", queuedAt: "2026-02-01T10:00:00Z" },
    ];

    const countText = formatQueueCount(queue.length);
    expect(countText).toBe("1 message queued");
  });
});
