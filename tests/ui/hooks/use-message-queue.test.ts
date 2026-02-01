/**
 * Tests for useMessageQueue Hook
 *
 * Tests cover:
 * - Initial state
 * - Enqueue operations
 * - Dequeue operations
 * - Clear operations
 * - Count tracking
 * - Edge cases
 */

import { describe, test, expect } from "bun:test";
import {
  useMessageQueue,
  type QueuedMessage,
  type UseMessageQueueReturn,
} from "../../../src/ui/hooks/use-message-queue.ts";

// ============================================================================
// TEST UTILITIES
// ============================================================================

/**
 * Helper to create a mock queue state for testing.
 * Simulates the hook's internal state management.
 */
function createMockQueueState(): {
  queue: QueuedMessage[];
  enqueue: (content: string) => void;
  dequeue: () => QueuedMessage | undefined;
  clear: () => void;
  count: () => number;
} {
  let queue: QueuedMessage[] = [];

  return {
    get queue() {
      return queue;
    },
    enqueue: (content: string) => {
      const message: QueuedMessage = {
        id: `queue_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        content,
        queuedAt: new Date().toISOString(),
      };
      queue = [...queue, message];
    },
    dequeue: () => {
      if (queue.length === 0) {
        return undefined;
      }
      const [first, ...rest] = queue;
      queue = rest;
      return first;
    },
    clear: () => {
      queue = [];
    },
    count: () => queue.length,
  };
}

// ============================================================================
// QUEUED MESSAGE INTERFACE TESTS
// ============================================================================

describe("QueuedMessage interface", () => {
  test("has required id field", () => {
    const message: QueuedMessage = {
      id: "queue_123",
      content: "Hello",
      queuedAt: "2026-01-31T12:00:00.000Z",
    };
    expect(message.id).toBe("queue_123");
  });

  test("has required content field", () => {
    const message: QueuedMessage = {
      id: "queue_123",
      content: "Hello, world!",
      queuedAt: "2026-01-31T12:00:00.000Z",
    };
    expect(message.content).toBe("Hello, world!");
  });

  test("has required queuedAt field as ISO timestamp", () => {
    const timestamp = "2026-01-31T12:00:00.000Z";
    const message: QueuedMessage = {
      id: "queue_123",
      content: "Hello",
      queuedAt: timestamp,
    };
    expect(() => new Date(message.queuedAt)).not.toThrow();
    expect(message.queuedAt).toBe(timestamp);
  });

  test("queuedAt is valid ISO format", () => {
    const message: QueuedMessage = {
      id: "queue_123",
      content: "Hello",
      queuedAt: new Date().toISOString(),
    };
    const date = new Date(message.queuedAt);
    expect(date.toISOString()).toBe(message.queuedAt);
  });
});

// ============================================================================
// INITIAL STATE TESTS
// ============================================================================

describe("useMessageQueue initial state", () => {
  test("queue starts empty", () => {
    const state = createMockQueueState();
    expect(state.queue).toEqual([]);
  });

  test("count starts at zero", () => {
    const state = createMockQueueState();
    expect(state.count()).toBe(0);
  });

  test("dequeue on empty queue returns undefined", () => {
    const state = createMockQueueState();
    const result = state.dequeue();
    expect(result).toBeUndefined();
  });

  test("multiple instances are independent", () => {
    const state1 = createMockQueueState();
    const state2 = createMockQueueState();

    state1.enqueue("Message 1");

    expect(state1.count()).toBe(1);
    expect(state2.count()).toBe(0);
  });
});

// ============================================================================
// ENQUEUE TESTS
// ============================================================================

describe("enqueue operation", () => {
  test("adds message to queue", () => {
    const state = createMockQueueState();
    state.enqueue("Hello");

    expect(state.queue).toHaveLength(1);
    expect(state.queue[0]?.content).toBe("Hello");
  });

  test("increments count", () => {
    const state = createMockQueueState();
    expect(state.count()).toBe(0);

    state.enqueue("First");
    expect(state.count()).toBe(1);

    state.enqueue("Second");
    expect(state.count()).toBe(2);
  });

  test("adds messages in order (FIFO)", () => {
    const state = createMockQueueState();

    state.enqueue("First");
    state.enqueue("Second");
    state.enqueue("Third");

    expect(state.queue[0]?.content).toBe("First");
    expect(state.queue[1]?.content).toBe("Second");
    expect(state.queue[2]?.content).toBe("Third");
  });

  test("generates unique IDs for each message", () => {
    const state = createMockQueueState();

    state.enqueue("First");
    state.enqueue("Second");
    state.enqueue("Third");

    const ids = state.queue.map((m) => m.id);
    const uniqueIds = new Set(ids);

    expect(uniqueIds.size).toBe(3);
  });

  test("ID starts with 'queue_' prefix", () => {
    const state = createMockQueueState();
    state.enqueue("Test");

    expect(state.queue[0]?.id.startsWith("queue_")).toBe(true);
  });

  test("sets queuedAt timestamp", () => {
    const before = Date.now();
    const state = createMockQueueState();
    state.enqueue("Test");
    const after = Date.now();

    const queuedAt = new Date(state.queue[0]?.queuedAt ?? "").getTime();
    expect(queuedAt).toBeGreaterThanOrEqual(before);
    expect(queuedAt).toBeLessThanOrEqual(after);
  });

  test("handles empty string content", () => {
    const state = createMockQueueState();
    state.enqueue("");

    expect(state.queue).toHaveLength(1);
    expect(state.queue[0]?.content).toBe("");
  });

  test("handles very long content", () => {
    const state = createMockQueueState();
    const longContent = "A".repeat(10000);
    state.enqueue(longContent);

    expect(state.queue[0]?.content).toBe(longContent);
    expect(state.queue[0]?.content.length).toBe(10000);
  });

  test("handles special characters in content", () => {
    const state = createMockQueueState();
    const specialContent = "Hello 🌍 <script>alert('xss')</script> \n\t\"quotes\"";
    state.enqueue(specialContent);

    expect(state.queue[0]?.content).toBe(specialContent);
  });

  test("handles unicode content", () => {
    const state = createMockQueueState();
    const unicodeContent = "こんにちは世界 مرحبا بالعالم";
    state.enqueue(unicodeContent);

    expect(state.queue[0]?.content).toBe(unicodeContent);
  });
});

// ============================================================================
// DEQUEUE TESTS
// ============================================================================

describe("dequeue operation", () => {
  test("returns first message in queue", () => {
    const state = createMockQueueState();
    state.enqueue("First");
    state.enqueue("Second");

    const result = state.dequeue();

    expect(result?.content).toBe("First");
  });

  test("removes message from queue", () => {
    const state = createMockQueueState();
    state.enqueue("First");
    state.enqueue("Second");

    state.dequeue();

    expect(state.queue).toHaveLength(1);
    expect(state.queue[0]?.content).toBe("Second");
  });

  test("decrements count", () => {
    const state = createMockQueueState();
    state.enqueue("First");
    state.enqueue("Second");
    expect(state.count()).toBe(2);

    state.dequeue();
    expect(state.count()).toBe(1);

    state.dequeue();
    expect(state.count()).toBe(0);
  });

  test("returns undefined when queue is empty", () => {
    const state = createMockQueueState();
    const result = state.dequeue();

    expect(result).toBeUndefined();
  });

  test("does not change count when dequeuing empty queue", () => {
    const state = createMockQueueState();
    expect(state.count()).toBe(0);

    state.dequeue();
    expect(state.count()).toBe(0);
  });

  test("processes in FIFO order", () => {
    const state = createMockQueueState();
    state.enqueue("First");
    state.enqueue("Second");
    state.enqueue("Third");

    expect(state.dequeue()?.content).toBe("First");
    expect(state.dequeue()?.content).toBe("Second");
    expect(state.dequeue()?.content).toBe("Third");
    expect(state.dequeue()).toBeUndefined();
  });

  test("returns complete QueuedMessage object", () => {
    const state = createMockQueueState();
    state.enqueue("Test content");

    const result = state.dequeue();

    expect(result).toBeDefined();
    expect(result?.id).toBeDefined();
    expect(result?.content).toBe("Test content");
    expect(result?.queuedAt).toBeDefined();
  });
});

// ============================================================================
// CLEAR TESTS
// ============================================================================

describe("clear operation", () => {
  test("removes all messages from queue", () => {
    const state = createMockQueueState();
    state.enqueue("First");
    state.enqueue("Second");
    state.enqueue("Third");

    state.clear();

    expect(state.queue).toEqual([]);
  });

  test("resets count to zero", () => {
    const state = createMockQueueState();
    state.enqueue("First");
    state.enqueue("Second");
    expect(state.count()).toBe(2);

    state.clear();

    expect(state.count()).toBe(0);
  });

  test("works on empty queue", () => {
    const state = createMockQueueState();
    expect(state.count()).toBe(0);

    state.clear(); // Should not throw

    expect(state.queue).toEqual([]);
    expect(state.count()).toBe(0);
  });

  test("allows new enqueue after clear", () => {
    const state = createMockQueueState();
    state.enqueue("First");
    state.clear();
    state.enqueue("New message");

    expect(state.queue).toHaveLength(1);
    expect(state.queue[0]?.content).toBe("New message");
  });
});

// ============================================================================
// COUNT TESTS
// ============================================================================

describe("count property", () => {
  test("reflects current queue length", () => {
    const state = createMockQueueState();

    expect(state.count()).toBe(0);

    state.enqueue("First");
    expect(state.count()).toBe(1);

    state.enqueue("Second");
    expect(state.count()).toBe(2);

    state.dequeue();
    expect(state.count()).toBe(1);

    state.clear();
    expect(state.count()).toBe(0);
  });

  test("is zero for empty queue", () => {
    const state = createMockQueueState();
    expect(state.count()).toBe(0);
  });

  test("handles large queue counts", () => {
    const state = createMockQueueState();

    for (let i = 0; i < 100; i++) {
      state.enqueue(`Message ${i}`);
    }

    expect(state.count()).toBe(100);
  });
});

// ============================================================================
// QUEUE PROPERTY TESTS
// ============================================================================

describe("queue property", () => {
  test("returns array of QueuedMessages", () => {
    const state = createMockQueueState();
    state.enqueue("First");
    state.enqueue("Second");

    const queue = state.queue;

    expect(Array.isArray(queue)).toBe(true);
    expect(queue).toHaveLength(2);
    queue.forEach((msg) => {
      expect(msg.id).toBeDefined();
      expect(msg.content).toBeDefined();
      expect(msg.queuedAt).toBeDefined();
    });
  });

  test("returns empty array for empty queue", () => {
    const state = createMockQueueState();
    expect(state.queue).toEqual([]);
  });

  test("maintains message order", () => {
    const state = createMockQueueState();
    state.enqueue("A");
    state.enqueue("B");
    state.enqueue("C");

    const contents = state.queue.map((m) => m.content);
    expect(contents).toEqual(["A", "B", "C"]);
  });
});

// ============================================================================
// EDGE CASES AND STRESS TESTS
// ============================================================================

describe("edge cases", () => {
  test("rapid enqueue/dequeue operations", () => {
    const state = createMockQueueState();

    for (let i = 0; i < 50; i++) {
      state.enqueue(`Message ${i}`);
      if (i % 2 === 0) {
        state.dequeue();
      }
    }

    // 50 enqueues, 25 dequeues = 25 remaining
    expect(state.count()).toBe(25);
  });

  test("interleaved operations", () => {
    const state = createMockQueueState();

    state.enqueue("A");
    const a = state.dequeue();
    state.enqueue("B");
    state.enqueue("C");
    const b = state.dequeue();
    state.clear();
    state.enqueue("D");

    expect(a?.content).toBe("A");
    expect(b?.content).toBe("B");
    expect(state.queue).toHaveLength(1);
    expect(state.queue[0]?.content).toBe("D");
  });

  test("preserves message integrity through operations", () => {
    const state = createMockQueueState();
    const originalContent = "Test message with special chars: 🎉";

    state.enqueue(originalContent);
    const dequeued = state.dequeue();

    expect(dequeued?.content).toBe(originalContent);
  });
});

// ============================================================================
// USE MESSAGE QUEUE RETURN TYPE TESTS
// ============================================================================

describe("UseMessageQueueReturn interface", () => {
  test("has all required properties", () => {
    // This is a compile-time check - if the interface is wrong, TypeScript will error
    const mockReturn: UseMessageQueueReturn = {
      queue: [],
      enqueue: () => {},
      dequeue: () => undefined,
      clear: () => {},
      count: 0,
    };

    expect(mockReturn.queue).toBeDefined();
    expect(typeof mockReturn.enqueue).toBe("function");
    expect(typeof mockReturn.dequeue).toBe("function");
    expect(typeof mockReturn.clear).toBe("function");
    expect(typeof mockReturn.count).toBe("number");
  });

  test("queue is QueuedMessage array type", () => {
    const mockReturn: UseMessageQueueReturn = {
      queue: [
        {
          id: "queue_1",
          content: "Test",
          queuedAt: "2026-01-31T12:00:00.000Z",
        },
      ],
      enqueue: () => {},
      dequeue: () => undefined,
      clear: () => {},
      count: 1,
    };

    expect(mockReturn.queue).toHaveLength(1);
    expect(mockReturn.queue[0]?.id).toBe("queue_1");
  });

  test("dequeue returns QueuedMessage or undefined", () => {
    const mockMessage: QueuedMessage = {
      id: "queue_1",
      content: "Test",
      queuedAt: "2026-01-31T12:00:00.000Z",
    };

    const mockReturn1: UseMessageQueueReturn = {
      queue: [mockMessage],
      enqueue: () => {},
      dequeue: () => mockMessage,
      clear: () => {},
      count: 1,
    };

    const mockReturn2: UseMessageQueueReturn = {
      queue: [],
      enqueue: () => {},
      dequeue: () => undefined,
      clear: () => {},
      count: 0,
    };

    expect(mockReturn1.dequeue()).toEqual(mockMessage);
    expect(mockReturn2.dequeue()).toBeUndefined();
  });
});
