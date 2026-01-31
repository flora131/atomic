/**
 * Unit tests for terminal chat UI components
 *
 * Tests cover:
 * - Helper functions (generateMessageId, createMessage, formatTimestamp)
 * - ChatMessage type validation
 * - Component prop interfaces
 */

import { describe, test, expect, beforeEach } from "bun:test";
import {
  generateMessageId,
  createMessage,
  formatTimestamp,
  type ChatMessage,
  type MessageRole,
  type ChatAppProps,
  type MessageBubbleProps,
} from "../../src/ui/chat.tsx";

// ============================================================================
// Helper Function Tests
// ============================================================================

describe("generateMessageId", () => {
  test("generates unique IDs", () => {
    const id1 = generateMessageId();
    const id2 = generateMessageId();
    const id3 = generateMessageId();

    expect(id1).not.toBe(id2);
    expect(id2).not.toBe(id3);
    expect(id1).not.toBe(id3);
  });

  test("generates IDs with correct prefix", () => {
    const id = generateMessageId();
    expect(id).toMatch(/^msg_\d+_[a-z0-9]+$/);
  });

  test("generates IDs with timestamp component", () => {
    const before = Date.now();
    const id = generateMessageId();
    const after = Date.now();

    // Extract timestamp from ID
    const timestampStr = id.split("_")[1];
    const timestamp = Number(timestampStr);

    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after);
  });
});

describe("createMessage", () => {
  test("creates a user message", () => {
    const msg = createMessage("user", "Hello world");

    expect(msg.role).toBe("user");
    expect(msg.content).toBe("Hello world");
    expect(msg.id).toMatch(/^msg_/);
    expect(msg.timestamp).toBeDefined();
    expect(msg.streaming).toBeUndefined();
  });

  test("creates an assistant message", () => {
    const msg = createMessage("assistant", "Hi there!");

    expect(msg.role).toBe("assistant");
    expect(msg.content).toBe("Hi there!");
  });

  test("creates a system message", () => {
    const msg = createMessage("system", "System notification");

    expect(msg.role).toBe("system");
    expect(msg.content).toBe("System notification");
  });

  test("creates a streaming message", () => {
    const msg = createMessage("assistant", "", true);

    expect(msg.streaming).toBe(true);
    expect(msg.content).toBe("");
  });

  test("creates a non-streaming message explicitly", () => {
    const msg = createMessage("user", "Test", false);

    expect(msg.streaming).toBe(false);
  });

  test("generates valid ISO timestamp", () => {
    const before = new Date().toISOString();
    const msg = createMessage("user", "Test");
    const after = new Date().toISOString();

    // Verify timestamp is valid ISO format
    expect(() => new Date(msg.timestamp)).not.toThrow();

    // Verify timestamp is within expected range
    expect(msg.timestamp >= before).toBe(true);
    expect(msg.timestamp <= after).toBe(true);
  });
});

describe("formatTimestamp", () => {
  test("formats timestamp to time string", () => {
    const isoString = "2024-01-15T14:30:00.000Z";
    const formatted = formatTimestamp(isoString);

    // Should contain hour and minute
    expect(formatted).toMatch(/\d{1,2}:\d{2}/);
  });

  test("handles different timezones", () => {
    const isoString = new Date().toISOString();
    const formatted = formatTimestamp(isoString);

    // Should produce some output
    expect(formatted.length).toBeGreaterThan(0);
  });

  test("handles edge case timestamps", () => {
    // Midnight
    const midnight = formatTimestamp("2024-01-15T00:00:00.000Z");
    expect(midnight).toBeDefined();

    // End of day
    const endOfDay = formatTimestamp("2024-01-15T23:59:59.999Z");
    expect(endOfDay).toBeDefined();
  });
});

// ============================================================================
// Type Tests
// ============================================================================

describe("ChatMessage type", () => {
  test("allows valid message roles", () => {
    const roles: MessageRole[] = ["user", "assistant", "system"];

    for (const role of roles) {
      const msg: ChatMessage = {
        id: "test",
        role,
        content: "test",
        timestamp: new Date().toISOString(),
      };
      expect(msg.role).toBe(role);
    }
  });

  test("allows optional streaming property", () => {
    const msgWithStreaming: ChatMessage = {
      id: "test",
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
      streaming: true,
    };

    const msgWithoutStreaming: ChatMessage = {
      id: "test",
      role: "user",
      content: "Hello",
      timestamp: new Date().toISOString(),
    };

    expect(msgWithStreaming.streaming).toBe(true);
    expect(msgWithoutStreaming.streaming).toBeUndefined();
  });
});

describe("ChatAppProps interface", () => {
  test("allows minimal props", () => {
    const props: ChatAppProps = {};

    expect(props.initialMessages).toBeUndefined();
    expect(props.onSendMessage).toBeUndefined();
    expect(props.onExit).toBeUndefined();
  });

  test("allows all optional props", () => {
    const props: ChatAppProps = {
      initialMessages: [createMessage("user", "Hello")],
      onSendMessage: (_content: string) => {},
      onStreamMessage: (_content, _onChunk, _onComplete) => {},
      onExit: () => {},
      placeholder: "Custom placeholder",
      title: "Custom Title",
    };

    expect(props.initialMessages?.length).toBe(1);
    expect(props.placeholder).toBe("Custom placeholder");
    expect(props.title).toBe("Custom Title");
  });

  test("allows async callbacks", () => {
    const props: ChatAppProps = {
      onSendMessage: async (_content: string) => {
        await Promise.resolve();
      },
      onStreamMessage: async (_content, _onChunk, onComplete) => {
        await Promise.resolve();
        onComplete();
      },
      onExit: async () => {
        await Promise.resolve();
      },
    };

    expect(typeof props.onSendMessage).toBe("function");
    expect(typeof props.onStreamMessage).toBe("function");
    expect(typeof props.onExit).toBe("function");
  });
});

describe("MessageBubbleProps interface", () => {
  test("requires message prop", () => {
    const props: MessageBubbleProps = {
      message: createMessage("user", "Test"),
    };

    expect(props.message).toBeDefined();
    expect(props.message.role).toBe("user");
  });

  test("allows optional isLast prop", () => {
    const propsWithIsLast: MessageBubbleProps = {
      message: createMessage("user", "Test"),
      isLast: true,
    };

    const propsWithoutIsLast: MessageBubbleProps = {
      message: createMessage("user", "Test"),
    };

    expect(propsWithIsLast.isLast).toBe(true);
    expect(propsWithoutIsLast.isLast).toBeUndefined();
  });
});

// ============================================================================
// Message Flow Tests
// ============================================================================

describe("Message flow simulation", () => {
  let messages: ChatMessage[];

  beforeEach(() => {
    messages = [];
  });

  test("simulates user message flow", () => {
    // User sends a message
    const userMsg = createMessage("user", "Hello");
    messages.push(userMsg);

    expect(messages.length).toBe(1);
    expect(messages[0]?.role).toBe("user");
  });

  test("simulates streaming response flow", () => {
    // User sends message
    messages.push(createMessage("user", "Hello"));

    // Assistant starts streaming response
    const assistantMsg = createMessage("assistant", "", true);
    messages.push(assistantMsg);

    expect(messages.length).toBe(2);
    expect(messages[1]?.streaming).toBe(true);
    expect(messages[1]?.content).toBe("");

    // Simulate chunks arriving
    messages[1] = { ...messages[1]!, content: messages[1]!.content + "Hi" };
    messages[1] = { ...messages[1]!, content: messages[1]!.content + " there" };
    messages[1] = { ...messages[1]!, content: messages[1]!.content + "!" };

    expect(messages[1]?.content).toBe("Hi there!");

    // Complete streaming
    messages[1] = { ...messages[1]!, streaming: false };
    expect(messages[1]?.streaming).toBe(false);
  });

  test("simulates multi-turn conversation", () => {
    const turns = [
      { role: "user" as const, content: "What is 2+2?" },
      { role: "assistant" as const, content: "2+2 equals 4." },
      { role: "user" as const, content: "And 3+3?" },
      { role: "assistant" as const, content: "3+3 equals 6." },
    ];

    for (const turn of turns) {
      messages.push(createMessage(turn.role, turn.content));
    }

    expect(messages.length).toBe(4);
    expect(messages[0]?.role).toBe("user");
    expect(messages[1]?.role).toBe("assistant");
    expect(messages[2]?.role).toBe("user");
    expect(messages[3]?.role).toBe("assistant");
  });
});

// ============================================================================
// Edge Case Tests
// ============================================================================

describe("Edge cases", () => {
  test("handles empty content", () => {
    const msg = createMessage("user", "");
    expect(msg.content).toBe("");
  });

  test("handles very long content", () => {
    const longContent = "a".repeat(10000);
    const msg = createMessage("user", longContent);
    expect(msg.content.length).toBe(10000);
  });

  test("handles special characters in content", () => {
    const specialContent = "Hello <script>alert('xss')</script> & \"quotes\"";
    const msg = createMessage("user", specialContent);
    expect(msg.content).toBe(specialContent);
  });

  test("handles unicode content", () => {
    const unicodeContent = "Hello 世界 🌍 مرحبا";
    const msg = createMessage("user", unicodeContent);
    expect(msg.content).toBe(unicodeContent);
  });

  test("handles newlines in content", () => {
    const multilineContent = "Line 1\nLine 2\nLine 3";
    const msg = createMessage("user", multilineContent);
    expect(msg.content).toBe(multilineContent);
    expect(msg.content.split("\n").length).toBe(3);
  });
});
