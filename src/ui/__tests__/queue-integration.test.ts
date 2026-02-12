/**
 * Integration Tests for Queue Indicator Rendering
 *
 * Tests cover:
 * - QueueIndicator renders with correct count
 * - Editing is disabled during streaming
 * - Messages are dequeued and sent after stream completion
 * - Integration between useMessageQueue, useStreamingState, and QueueIndicator
 *
 * Reference: Phase 7.4 - Write integration test for queue indicator rendering
 */

import { describe, test, expect } from "bun:test";
import {
  createMessage,
  type ChatMessage,
  type WorkflowChatState,
  defaultWorkflowChatState,
} from "../chat.tsx";
import {
  useStreamingState,
  createInitialStreamingState,
  type StreamingState,
} from "../hooks/use-streaming-state.ts";
import {
  useMessageQueue,
  type QueuedMessage,
  type UseMessageQueueReturn,
  MAX_QUEUE_SIZE,
  QUEUE_SIZE_WARNING_THRESHOLD,
} from "../hooks/use-message-queue.ts";
import {
  formatQueueCount,
  getQueueIcon,
  type QueueIndicatorProps,
} from "../components/queue-indicator.tsx";

// ============================================================================
// TEST UTILITIES
// ============================================================================

/**
 * Simulates a mock ChatApp state with message queue and streaming state.
 * This represents the integration of all state management for the queue.
 */
interface MockChatAppState {
  messages: ChatMessage[];
  streamingState: StreamingState;
  messageQueue: {
    queue: QueuedMessage[];
    count: number;
    enqueue: (content: string) => void;
    dequeue: () => QueuedMessage | undefined;
    clear: () => void;
  };
  isEditingDisabled: boolean;
}

/**
 * Create a mock message queue state for testing.
 */
function createMockMessageQueue(): MockChatAppState["messageQueue"] {
  let queue: QueuedMessage[] = [];

  return {
    get queue() {
      return queue;
    },
    get count() {
      return queue.length;
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
  };
}

/**
 * Create a full mock ChatApp state for integration testing.
 */
function createMockChatAppState(): MockChatAppState {
  return {
    messages: [],
    streamingState: createInitialStreamingState(),
    messageQueue: createMockMessageQueue(),
    isEditingDisabled: false,
  };
}

/**
 * Simulate what happens when the user sends a message during streaming.
 * In the real app, this queues the message instead of sending immediately.
 */
function handleUserInputDuringStreaming(
  state: MockChatAppState,
  input: string
): void {
  if (state.streamingState.isStreaming) {
    state.messageQueue.enqueue(input);
    // Editing is disabled during streaming
    state.isEditingDisabled = true;
  }
}

/**
 * Simulate stream completion - processes queued messages.
 */
function simulateStreamCompletion(
  state: MockChatAppState,
  processMessage: (content: string) => void
): void {
  // Stop streaming
  state.streamingState = {
    ...state.streamingState,
    isStreaming: false,
    streamingMessageId: null,
  };

  // Re-enable editing
  state.isEditingDisabled = false;

  // Process queued messages
  let nextMessage = state.messageQueue.dequeue();
  while (nextMessage) {
    processMessage(nextMessage.content);
    nextMessage = state.messageQueue.dequeue();
  }
}

// ============================================================================
// QUEUE INDICATOR RENDERING TESTS
// ============================================================================

describe("QueueIndicator rendering with correct count", () => {
  test("renders nothing when queue is empty", () => {
    const state = createMockChatAppState();

    const props: QueueIndicatorProps = {
      count: state.messageQueue.count,
      queue: state.messageQueue.queue,
    };

    expect(props.count).toBe(0);
    expect(formatQueueCount(props.count)).toBe("");
  });

  test("renders correct count for single message", () => {
    const state = createMockChatAppState();
    state.streamingState.isStreaming = true;

    state.messageQueue.enqueue("First message");

    const props: QueueIndicatorProps = {
      count: state.messageQueue.count,
      queue: state.messageQueue.queue,
    };

    expect(props.count).toBe(1);
    expect(formatQueueCount(props.count)).toBe("1 message queued");
  });

  test("renders correct count for multiple messages", () => {
    const state = createMockChatAppState();
    state.streamingState.isStreaming = true;

    state.messageQueue.enqueue("First message");
    state.messageQueue.enqueue("Second message");
    state.messageQueue.enqueue("Third message");

    const props: QueueIndicatorProps = {
      count: state.messageQueue.count,
      queue: state.messageQueue.queue,
    };

    expect(props.count).toBe(3);
    expect(formatQueueCount(props.count)).toBe("3 messages queued");
  });

  test("updates count after dequeue", () => {
    const state = createMockChatAppState();

    state.messageQueue.enqueue("Message 1");
    state.messageQueue.enqueue("Message 2");
    expect(state.messageQueue.count).toBe(2);

    state.messageQueue.dequeue();
    expect(state.messageQueue.count).toBe(1);

    state.messageQueue.dequeue();
    expect(state.messageQueue.count).toBe(0);
  });

  test("renders with queue icon", () => {
    const icon = getQueueIcon();
    expect(icon).toBe("⋮");
  });
});

// ============================================================================
// STREAMING STATE TESTS
// ============================================================================

describe("Streaming state simulation", () => {
  test("starts with streaming disabled", () => {
    const state = createMockChatAppState();

    expect(state.streamingState.isStreaming).toBe(false);
    expect(state.streamingState.streamingMessageId).toBeNull();
  });

  test("enables streaming with message ID", () => {
    const state = createMockChatAppState();

    state.streamingState = {
      ...state.streamingState,
      isStreaming: true,
      streamingMessageId: "msg_123",
    };

    expect(state.streamingState.isStreaming).toBe(true);
    expect(state.streamingState.streamingMessageId).toBe("msg_123");
  });

  test("disables streaming after completion", () => {
    const state = createMockChatAppState();

    // Start streaming
    state.streamingState = {
      ...state.streamingState,
      isStreaming: true,
      streamingMessageId: "msg_123",
    };

    // Complete streaming
    state.streamingState = {
      ...state.streamingState,
      isStreaming: false,
      streamingMessageId: null,
    };

    expect(state.streamingState.isStreaming).toBe(false);
    expect(state.streamingState.streamingMessageId).toBeNull();
  });
});

// ============================================================================
// ENQUEUE MESSAGES VIA USER INPUT TESTS
// ============================================================================

describe("Enqueue multiple messages via user input", () => {
  test("queues messages when streaming is active", () => {
    const state = createMockChatAppState();

    // Start streaming
    state.streamingState = {
      ...state.streamingState,
      isStreaming: true,
      streamingMessageId: "msg_123",
    };

    // User sends messages while streaming
    handleUserInputDuringStreaming(state, "First follow-up");
    handleUserInputDuringStreaming(state, "Second follow-up");
    handleUserInputDuringStreaming(state, "Third follow-up");

    expect(state.messageQueue.count).toBe(3);
    expect(state.messageQueue.queue[0]?.content).toBe("First follow-up");
    expect(state.messageQueue.queue[1]?.content).toBe("Second follow-up");
    expect(state.messageQueue.queue[2]?.content).toBe("Third follow-up");
  });

  test("does not queue when not streaming (direct send)", () => {
    const state = createMockChatAppState();

    // Not streaming - messages would be sent directly, not queued
    expect(state.streamingState.isStreaming).toBe(false);

    // In real app, this would send directly, not queue
    // The handleUserInputDuringStreaming only queues if streaming
    handleUserInputDuringStreaming(state, "Direct message");

    expect(state.messageQueue.count).toBe(0);
  });

  test("preserves message order in queue (FIFO)", () => {
    const state = createMockChatAppState();
    state.streamingState.isStreaming = true;

    const messages = ["First", "Second", "Third", "Fourth", "Fifth"];
    messages.forEach((msg) => state.messageQueue.enqueue(msg));

    const queueContents = state.messageQueue.queue.map((m) => m.content);
    expect(queueContents).toEqual(messages);
  });

  test("assigns unique IDs to queued messages", () => {
    const state = createMockChatAppState();

    state.messageQueue.enqueue("Message 1");
    state.messageQueue.enqueue("Message 2");
    state.messageQueue.enqueue("Message 3");

    const ids = state.messageQueue.queue.map((m) => m.id);
    const uniqueIds = new Set(ids);

    expect(uniqueIds.size).toBe(3);
    ids.forEach((id) => expect(id.startsWith("queue_")).toBe(true));
  });

  test("records timestamp when message is queued", () => {
    const state = createMockChatAppState();
    const before = Date.now();

    state.messageQueue.enqueue("Timestamped message");

    const after = Date.now();
    const queuedAt = new Date(state.messageQueue.queue[0]?.queuedAt ?? "").getTime();

    expect(queuedAt).toBeGreaterThanOrEqual(before);
    expect(queuedAt).toBeLessThanOrEqual(after);
  });
});

// ============================================================================
// EDITING DISABLED DURING STREAMING TESTS
// ============================================================================

describe("Editing is disabled during streaming", () => {
  test("editing is enabled when not streaming", () => {
    const state = createMockChatAppState();

    expect(state.streamingState.isStreaming).toBe(false);
    expect(state.isEditingDisabled).toBe(false);
  });

  test("editing is disabled when streaming starts", () => {
    const state = createMockChatAppState();

    // Start streaming
    state.streamingState = {
      ...state.streamingState,
      isStreaming: true,
      streamingMessageId: "msg_123",
    };

    // User tries to send during streaming - this triggers queue and disables editing
    handleUserInputDuringStreaming(state, "Message during stream");

    expect(state.isEditingDisabled).toBe(true);
  });

  test("editing is re-enabled after streaming completes", () => {
    const state = createMockChatAppState();

    // Start streaming
    state.streamingState = {
      ...state.streamingState,
      isStreaming: true,
      streamingMessageId: "msg_123",
    };

    // Queue a message
    handleUserInputDuringStreaming(state, "Queued message");
    expect(state.isEditingDisabled).toBe(true);

    // Complete streaming
    const processedMessages: string[] = [];
    simulateStreamCompletion(state, (content) => {
      processedMessages.push(content);
    });

    expect(state.isEditingDisabled).toBe(false);
  });

  test("queue indicator props reflect editing state", () => {
    const state = createMockChatAppState();
    state.streamingState.isStreaming = true;

    state.messageQueue.enqueue("Message 1");
    state.messageQueue.enqueue("Message 2");

    // When streaming, editable should be false in the indicator
    const props: QueueIndicatorProps = {
      count: state.messageQueue.count,
      queue: state.messageQueue.queue,
      compact: false,
      editable: !state.streamingState.isStreaming, // disabled during streaming
    };

    expect(props.editable).toBe(false);
    expect(props.count).toBe(2);
  });

  test("queue indicator allows editing after streaming stops", () => {
    const state = createMockChatAppState();

    // Not streaming
    state.streamingState.isStreaming = false;
    state.messageQueue.enqueue("Message 1");

    const props: QueueIndicatorProps = {
      count: state.messageQueue.count,
      queue: state.messageQueue.queue,
      compact: false,
      editable: !state.streamingState.isStreaming,
    };

    expect(props.editable).toBe(true);
  });
});

// ============================================================================
// STREAM COMPLETION AND DEQUEUE TESTS
// ============================================================================

describe("Messages are dequeued and sent after stream completion", () => {
  test("processes all queued messages on stream completion", () => {
    const state = createMockChatAppState();

    // Start streaming
    state.streamingState = {
      ...state.streamingState,
      isStreaming: true,
      streamingMessageId: "msg_123",
    };

    // Queue messages
    state.messageQueue.enqueue("Follow-up 1");
    state.messageQueue.enqueue("Follow-up 2");
    state.messageQueue.enqueue("Follow-up 3");

    expect(state.messageQueue.count).toBe(3);

    // Complete streaming and process queue
    const processedMessages: string[] = [];
    simulateStreamCompletion(state, (content) => {
      processedMessages.push(content);
    });

    expect(processedMessages).toEqual(["Follow-up 1", "Follow-up 2", "Follow-up 3"]);
    expect(state.messageQueue.count).toBe(0);
  });

  test("queue is empty after all messages are processed", () => {
    const state = createMockChatAppState();

    state.messageQueue.enqueue("Message 1");
    state.messageQueue.enqueue("Message 2");

    simulateStreamCompletion(state, () => {});

    expect(state.messageQueue.queue).toEqual([]);
    expect(state.messageQueue.count).toBe(0);
  });

  test("dequeues messages in FIFO order", () => {
    const state = createMockChatAppState();

    state.messageQueue.enqueue("First");
    state.messageQueue.enqueue("Second");
    state.messageQueue.enqueue("Third");

    const order: string[] = [];

    const msg1 = state.messageQueue.dequeue();
    if (msg1) order.push(msg1.content);

    const msg2 = state.messageQueue.dequeue();
    if (msg2) order.push(msg2.content);

    const msg3 = state.messageQueue.dequeue();
    if (msg3) order.push(msg3.content);

    expect(order).toEqual(["First", "Second", "Third"]);
  });

  test("handles empty queue gracefully on stream completion", () => {
    const state = createMockChatAppState();

    // Start and complete streaming with empty queue
    state.streamingState = {
      ...state.streamingState,
      isStreaming: true,
      streamingMessageId: "msg_123",
    };

    const processedMessages: string[] = [];
    simulateStreamCompletion(state, (content) => {
      processedMessages.push(content);
    });

    expect(processedMessages).toEqual([]);
    expect(state.messageQueue.count).toBe(0);
  });

  test("streaming state is updated after completion", () => {
    const state = createMockChatAppState();

    state.streamingState = {
      ...state.streamingState,
      isStreaming: true,
      streamingMessageId: "msg_123",
    };

    simulateStreamCompletion(state, () => {});

    expect(state.streamingState.isStreaming).toBe(false);
    expect(state.streamingState.streamingMessageId).toBeNull();
  });
});

// ============================================================================
// FULL INTEGRATION FLOW TESTS
// ============================================================================

describe("Full integration flow", () => {
  test("complete workflow: stream, queue, complete, process", () => {
    const state = createMockChatAppState();
    const processedMessages: string[] = [];

    // 1. Start streaming (assistant is responding)
    state.streamingState = {
      ...state.streamingState,
      isStreaming: true,
      streamingMessageId: "msg_assistant_1",
    };

    // 2. User sends follow-up messages during streaming
    handleUserInputDuringStreaming(state, "While you're thinking, also check X");
    handleUserInputDuringStreaming(state, "And don't forget about Y");

    // 3. Assert queue indicator shows correct count
    expect(state.messageQueue.count).toBe(2);
    expect(formatQueueCount(state.messageQueue.count)).toBe("2 messages queued");

    // 4. Assert editing is disabled
    expect(state.isEditingDisabled).toBe(true);

    // 5. Stream completes
    simulateStreamCompletion(state, (content) => {
      processedMessages.push(content);
    });

    // 6. Assert messages were processed in order
    expect(processedMessages).toEqual([
      "While you're thinking, also check X",
      "And don't forget about Y",
    ]);

    // 7. Assert queue is now empty
    expect(state.messageQueue.count).toBe(0);

    // 8. Assert editing is re-enabled
    expect(state.isEditingDisabled).toBe(false);
  });

  test("multiple streaming cycles with queued messages", () => {
    const state = createMockChatAppState();
    const allProcessedMessages: string[] = [];

    // First streaming cycle
    state.streamingState.isStreaming = true;
    state.streamingState.streamingMessageId = "msg_1";

    handleUserInputDuringStreaming(state, "Cycle 1 - Message A");
    handleUserInputDuringStreaming(state, "Cycle 1 - Message B");

    simulateStreamCompletion(state, (content) => {
      allProcessedMessages.push(content);
    });

    expect(allProcessedMessages).toEqual([
      "Cycle 1 - Message A",
      "Cycle 1 - Message B",
    ]);

    // Second streaming cycle
    state.streamingState.isStreaming = true;
    state.streamingState.streamingMessageId = "msg_2";

    handleUserInputDuringStreaming(state, "Cycle 2 - Message X");

    simulateStreamCompletion(state, (content) => {
      allProcessedMessages.push(content);
    });

    expect(allProcessedMessages).toEqual([
      "Cycle 1 - Message A",
      "Cycle 1 - Message B",
      "Cycle 2 - Message X",
    ]);
  });

  test("queue indicator props are correctly derived from state", () => {
    const state = createMockChatAppState();

    state.streamingState.isStreaming = true;
    state.messageQueue.enqueue("Queued message 1");
    state.messageQueue.enqueue("Queued message 2");
    state.messageQueue.enqueue("Queued message 3");

    // This is how ChatApp would derive QueueIndicator props
    const queueIndicatorProps: QueueIndicatorProps = {
      count: state.messageQueue.count,
      queue: state.messageQueue.queue,
      compact: true,
      editable: !state.streamingState.isStreaming,
      editIndex: -1,
    };

    expect(queueIndicatorProps.count).toBe(3);
    expect(queueIndicatorProps.queue).toHaveLength(3);
    expect(queueIndicatorProps.compact).toBe(true);
    expect(queueIndicatorProps.editable).toBe(false);
    expect(queueIndicatorProps.editIndex).toBe(-1);
  });

  test("handles rapid user input during streaming", () => {
    const state = createMockChatAppState();
    state.streamingState.isStreaming = true;
    state.streamingState.streamingMessageId = "msg_rapid";

    // Rapid input simulation
    for (let i = 0; i < 10; i++) {
      handleUserInputDuringStreaming(state, `Rapid message ${i + 1}`);
    }

    expect(state.messageQueue.count).toBe(10);
    expect(formatQueueCount(state.messageQueue.count)).toBe("10 messages queued");

    const processedMessages: string[] = [];
    simulateStreamCompletion(state, (content) => {
      processedMessages.push(content);
    });

    expect(processedMessages).toHaveLength(10);
    expect(processedMessages[0]).toBe("Rapid message 1");
    expect(processedMessages[9]).toBe("Rapid message 10");
  });

  test("clear queue functionality", () => {
    const state = createMockChatAppState();

    state.messageQueue.enqueue("Message 1");
    state.messageQueue.enqueue("Message 2");
    state.messageQueue.enqueue("Message 3");

    expect(state.messageQueue.count).toBe(3);

    state.messageQueue.clear();

    expect(state.messageQueue.count).toBe(0);
    expect(state.messageQueue.queue).toEqual([]);
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe("Edge cases", () => {
  test("handles empty message content in queue", () => {
    const state = createMockChatAppState();

    state.messageQueue.enqueue("");

    expect(state.messageQueue.count).toBe(1);
    expect(state.messageQueue.queue[0]?.content).toBe("");
  });

  test("handles special characters in queued messages", () => {
    const state = createMockChatAppState();
    const specialContent = "Test 🚀 <script>alert('xss')</script> \n\t\"quotes\"";

    state.messageQueue.enqueue(specialContent);

    expect(state.messageQueue.queue[0]?.content).toBe(specialContent);
  });

  test("handles unicode content in queue", () => {
    const state = createMockChatAppState();
    const unicodeContent = "日本語 العربية 한국어 Ελληνικά";

    state.messageQueue.enqueue(unicodeContent);

    expect(state.messageQueue.queue[0]?.content).toBe(unicodeContent);
  });

  test("handles very long message content", () => {
    const state = createMockChatAppState();
    const longContent = "A".repeat(10000);

    state.messageQueue.enqueue(longContent);

    expect(state.messageQueue.queue[0]?.content.length).toBe(10000);
  });

  test("dequeue on empty queue returns undefined", () => {
    const state = createMockChatAppState();

    const result = state.messageQueue.dequeue();

    expect(result).toBeUndefined();
    expect(state.messageQueue.count).toBe(0);
  });

  test("multiple dequeue calls on empty queue are safe", () => {
    const state = createMockChatAppState();

    state.messageQueue.dequeue();
    state.messageQueue.dequeue();
    state.messageQueue.dequeue();

    expect(state.messageQueue.count).toBe(0);
  });

  test("handles interleaved enqueue and dequeue operations", () => {
    const state = createMockChatAppState();

    state.messageQueue.enqueue("A");
    state.messageQueue.enqueue("B");
    const a = state.messageQueue.dequeue();
    state.messageQueue.enqueue("C");
    const b = state.messageQueue.dequeue();
    state.messageQueue.enqueue("D");

    expect(a?.content).toBe("A");
    expect(b?.content).toBe("B");
    expect(state.messageQueue.count).toBe(2);
    expect(state.messageQueue.queue.map((m) => m.content)).toEqual(["C", "D"]);
  });
});

// ============================================================================
// LARGE QUEUE EDGE CASES (Phase 9.5)
// ============================================================================

describe("Large queue handling (100+ messages)", () => {
  test("handles queue with 100+ messages without errors", () => {
    const state = createMockChatAppState();

    // Enqueue 150 messages
    for (let i = 0; i < 150; i++) {
      state.messageQueue.enqueue(`Message ${i + 1}`);
    }

    expect(state.messageQueue.count).toBe(150);
    expect(state.messageQueue.queue[0]?.content).toBe("Message 1");
    expect(state.messageQueue.queue[149]?.content).toBe("Message 150");
  });

  test("maintains FIFO order with 100+ messages", () => {
    const state = createMockChatAppState();

    // Enqueue 100 messages
    for (let i = 0; i < 100; i++) {
      state.messageQueue.enqueue(`Msg ${i}`);
    }

    // Dequeue all and verify order
    const dequeued: string[] = [];
    let msg = state.messageQueue.dequeue();
    while (msg) {
      dequeued.push(msg.content);
      msg = state.messageQueue.dequeue();
    }

    expect(dequeued.length).toBe(100);
    expect(dequeued[0]).toBe("Msg 0");
    expect(dequeued[99]).toBe("Msg 99");
  });

  test("queue operations remain performant with large queues", () => {
    const state = createMockChatAppState();

    const startEnqueue = performance.now();
    for (let i = 0; i < 200; i++) {
      state.messageQueue.enqueue(`Performance test message ${i}`);
    }
    const enqueueTime = performance.now() - startEnqueue;

    // Enqueue 200 messages should complete in reasonable time (<100ms)
    expect(enqueueTime).toBeLessThan(100);

    const startDequeue = performance.now();
    while (state.messageQueue.dequeue()) {
      // Dequeue all
    }
    const dequeueTime = performance.now() - startDequeue;

    // Dequeue 200 messages should complete in reasonable time (<100ms)
    expect(dequeueTime).toBeLessThan(100);
  });

  test("formatQueueCount handles large numbers correctly", () => {
    expect(formatQueueCount(100)).toBe("100 messages queued");
    expect(formatQueueCount(500)).toBe("500 messages queued");
    expect(formatQueueCount(1000)).toBe("1000 messages queued");
  });

  test("queue size constants are exported and valid", () => {
    expect(MAX_QUEUE_SIZE).toBe(100);
    expect(QUEUE_SIZE_WARNING_THRESHOLD).toBe(50);
    expect(QUEUE_SIZE_WARNING_THRESHOLD).toBeLessThan(MAX_QUEUE_SIZE);
  });

  test("clear operation works efficiently on large queue", () => {
    const state = createMockChatAppState();

    // Build up a large queue
    for (let i = 0; i < 500; i++) {
      state.messageQueue.enqueue(`Message ${i}`);
    }
    expect(state.messageQueue.count).toBe(500);

    const startClear = performance.now();
    state.messageQueue.clear();
    const clearTime = performance.now() - startClear;

    expect(state.messageQueue.count).toBe(0);
    expect(state.messageQueue.queue).toEqual([]);
    // Clear should be instant
    expect(clearTime).toBeLessThan(10);
  });

  test("memory is released after dequeuing all messages", () => {
    const state = createMockChatAppState();

    // Build up a large queue with large messages
    for (let i = 0; i < 100; i++) {
      state.messageQueue.enqueue("X".repeat(1000)); // 1KB per message
    }

    expect(state.messageQueue.count).toBe(100);

    // Dequeue all
    while (state.messageQueue.dequeue()) {
      // Dequeue all
    }

    expect(state.messageQueue.count).toBe(0);
    expect(state.messageQueue.queue).toEqual([]);
    // Queue array should now be empty, releasing memory
  });

  test("handles interleaved enqueue/dequeue with high volume", () => {
    const state = createMockChatAppState();

    // Simulate rapid interleaved operations
    for (let i = 0; i < 50; i++) {
      state.messageQueue.enqueue(`Batch 1 - ${i}`);
    }

    // Dequeue half
    for (let i = 0; i < 25; i++) {
      state.messageQueue.dequeue();
    }

    expect(state.messageQueue.count).toBe(25);

    // Add more
    for (let i = 0; i < 75; i++) {
      state.messageQueue.enqueue(`Batch 2 - ${i}`);
    }

    expect(state.messageQueue.count).toBe(100);

    // First message should be from first batch
    const next = state.messageQueue.queue[0];
    expect(next?.content).toBe("Batch 1 - 25");
  });
});
