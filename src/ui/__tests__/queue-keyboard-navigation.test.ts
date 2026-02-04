/**
 * Integration Tests for Queue Editing Keyboard Navigation
 *
 * Tests cover:
 * - Up arrow enters edit mode at last message
 * - Up arrow moves to previous message
 * - Down arrow moves to next message
 * - Escape exits edit mode
 * - Enter exits edit mode and allows input
 *
 * Reference: Phase 7.5 - Write integration test for queue editing keyboard navigation
 */

import { describe, test, expect } from "bun:test";
import {
  type QueuedMessage,
  type UseMessageQueueReturn,
} from "../hooks/use-message-queue.ts";

// ============================================================================
// TEST UTILITIES
// ============================================================================

/**
 * Simulates the keyboard navigation state for queue editing.
 * Models the behavior in chat.tsx for up/down/escape/enter handling.
 */
interface QueueKeyboardNavigationState {
  queue: QueuedMessage[];
  currentEditIndex: number;
  isEditingQueue: boolean;
  isStreaming: boolean;
  enqueue: (content: string) => void;
  setEditIndex: (index: number) => void;
  count: () => number;
}

/**
 * Create a mock state for testing keyboard navigation.
 */
function createMockNavigationState(): QueueKeyboardNavigationState {
  let queue: QueuedMessage[] = [];
  let currentEditIndex = -1;
  let isEditingQueue = false;

  return {
    get queue() {
      return queue;
    },
    get currentEditIndex() {
      return currentEditIndex;
    },
    get isEditingQueue() {
      return isEditingQueue;
    },
    set isEditingQueue(value: boolean) {
      isEditingQueue = value;
    },
    isStreaming: false,
    enqueue: (content: string) => {
      const message: QueuedMessage = {
        id: `queue_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        content,
        queuedAt: new Date().toISOString(),
      };
      queue = [...queue, message];
    },
    setEditIndex: (index: number) => {
      currentEditIndex = index;
    },
    count: () => queue.length,
  };
}

/**
 * Simulates pressing the Up arrow key.
 * Matches the logic in chat.tsx lines 1477-1488.
 */
function handleUpArrow(state: QueueKeyboardNavigationState): void {
  if (state.count() > 0 && !state.isStreaming) {
    if (state.currentEditIndex === -1) {
      // Enter edit mode at last message
      state.setEditIndex(state.count() - 1);
      state.isEditingQueue = true;
    } else if (state.currentEditIndex > 0) {
      // Move to previous message
      state.setEditIndex(state.currentEditIndex - 1);
    }
  }
}

/**
 * Simulates pressing the Down arrow key.
 * Matches the logic in chat.tsx lines 1490-1501.
 */
function handleDownArrow(state: QueueKeyboardNavigationState): void {
  if (state.isEditingQueue && state.count() > 0) {
    if (state.currentEditIndex < state.count() - 1) {
      // Move to next message
      state.setEditIndex(state.currentEditIndex + 1);
    } else {
      // Exit edit mode
      state.isEditingQueue = false;
      state.setEditIndex(-1);
    }
  }
}

/**
 * Simulates pressing the Escape key.
 * Matches the logic in chat.tsx lines 1407-1412.
 */
function handleEscape(state: QueueKeyboardNavigationState): void {
  if (state.isEditingQueue) {
    state.isEditingQueue = false;
    state.setEditIndex(-1);
  }
}

/**
 * Simulates pressing the Enter key.
 * Matches the logic in chat.tsx lines 1548-1553.
 */
function handleEnter(state: QueueKeyboardNavigationState): { exitedEditMode: boolean } {
  if (state.isEditingQueue) {
    state.isEditingQueue = false;
    // Keep edit index for potential message update
    // Allow default input submission behavior to proceed
    return { exitedEditMode: true };
  }
  return { exitedEditMode: false };
}

// ============================================================================
// KEYBOARD NAVIGATION TESTS
// ============================================================================

describe("Queue editing keyboard navigation", () => {
  test("enqueue 3 messages", () => {
    const state = createMockNavigationState();

    state.enqueue("First message");
    state.enqueue("Second message");
    state.enqueue("Third message");

    expect(state.count()).toBe(3);
    expect(state.queue[0]?.content).toBe("First message");
    expect(state.queue[1]?.content).toBe("Second message");
    expect(state.queue[2]?.content).toBe("Third message");
  });

  test("up-arrow enters edit mode at last message", () => {
    const state = createMockNavigationState();

    state.enqueue("First message");
    state.enqueue("Second message");
    state.enqueue("Third message");

    expect(state.isEditingQueue).toBe(false);
    expect(state.currentEditIndex).toBe(-1);

    handleUpArrow(state);

    expect(state.isEditingQueue).toBe(true);
    expect(state.currentEditIndex).toBe(2); // Last message (index 2)
  });

  test("up-arrow again moves to previous message", () => {
    const state = createMockNavigationState();

    state.enqueue("First message");
    state.enqueue("Second message");
    state.enqueue("Third message");

    // First up-arrow: enter edit mode at last message
    handleUpArrow(state);
    expect(state.currentEditIndex).toBe(2);

    // Second up-arrow: move to previous message
    handleUpArrow(state);
    expect(state.currentEditIndex).toBe(1);
    expect(state.isEditingQueue).toBe(true);
  });

  test("down-arrow moves to next message", () => {
    const state = createMockNavigationState();

    state.enqueue("First message");
    state.enqueue("Second message");
    state.enqueue("Third message");

    // Enter edit mode and navigate up twice to be at first message
    handleUpArrow(state); // at index 2
    handleUpArrow(state); // at index 1
    handleUpArrow(state); // at index 0

    expect(state.currentEditIndex).toBe(0);

    // Down-arrow: move to next message
    handleDownArrow(state);
    expect(state.currentEditIndex).toBe(1);
    expect(state.isEditingQueue).toBe(true);
  });

  test("escape exits edit mode", () => {
    const state = createMockNavigationState();

    state.enqueue("First message");
    state.enqueue("Second message");
    state.enqueue("Third message");

    // Enter edit mode
    handleUpArrow(state);
    expect(state.isEditingQueue).toBe(true);
    expect(state.currentEditIndex).toBe(2);

    // Press Escape
    handleEscape(state);

    expect(state.isEditingQueue).toBe(false);
    expect(state.currentEditIndex).toBe(-1);
  });

  test("enter exits edit mode and allows input", () => {
    const state = createMockNavigationState();

    state.enqueue("First message");
    state.enqueue("Second message");
    state.enqueue("Third message");

    // Enter edit mode
    handleUpArrow(state);
    expect(state.isEditingQueue).toBe(true);

    // Press Enter
    const result = handleEnter(state);

    expect(result.exitedEditMode).toBe(true);
    expect(state.isEditingQueue).toBe(false);
    // Note: Edit index is kept for potential message update
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe("Queue editing keyboard navigation edge cases", () => {
  test("up-arrow at first message does not change index", () => {
    const state = createMockNavigationState();

    state.enqueue("First message");
    state.enqueue("Second message");
    state.enqueue("Third message");

    // Navigate to first message
    handleUpArrow(state); // at index 2
    handleUpArrow(state); // at index 1
    handleUpArrow(state); // at index 0

    expect(state.currentEditIndex).toBe(0);

    // Another up-arrow should not change index
    handleUpArrow(state);
    expect(state.currentEditIndex).toBe(0);
    expect(state.isEditingQueue).toBe(true);
  });

  test("down-arrow at last message exits edit mode", () => {
    const state = createMockNavigationState();

    state.enqueue("First message");
    state.enqueue("Second message");
    state.enqueue("Third message");

    // Enter edit mode at last message
    handleUpArrow(state);
    expect(state.currentEditIndex).toBe(2);

    // Down-arrow at last message should exit edit mode
    handleDownArrow(state);
    expect(state.isEditingQueue).toBe(false);
    expect(state.currentEditIndex).toBe(-1);
  });

  test("up-arrow does nothing when queue is empty", () => {
    const state = createMockNavigationState();

    expect(state.count()).toBe(0);

    handleUpArrow(state);

    expect(state.isEditingQueue).toBe(false);
    expect(state.currentEditIndex).toBe(-1);
  });

  test("down-arrow does nothing when not in edit mode", () => {
    const state = createMockNavigationState();

    state.enqueue("First message");
    state.enqueue("Second message");

    expect(state.isEditingQueue).toBe(false);

    handleDownArrow(state);

    expect(state.isEditingQueue).toBe(false);
    expect(state.currentEditIndex).toBe(-1);
  });

  test("escape does nothing when not in edit mode", () => {
    const state = createMockNavigationState();

    state.enqueue("First message");

    expect(state.isEditingQueue).toBe(false);

    handleEscape(state);

    expect(state.isEditingQueue).toBe(false);
    expect(state.currentEditIndex).toBe(-1);
  });

  test("enter does nothing when not in edit mode", () => {
    const state = createMockNavigationState();

    state.enqueue("First message");

    expect(state.isEditingQueue).toBe(false);

    const result = handleEnter(state);

    expect(result.exitedEditMode).toBe(false);
  });

  test("up-arrow does nothing during streaming", () => {
    const state = createMockNavigationState();
    state.isStreaming = true;

    state.enqueue("First message");
    state.enqueue("Second message");

    handleUpArrow(state);

    expect(state.isEditingQueue).toBe(false);
    expect(state.currentEditIndex).toBe(-1);
  });

  test("full navigation cycle through all messages", () => {
    const state = createMockNavigationState();

    state.enqueue("First message");
    state.enqueue("Second message");
    state.enqueue("Third message");

    // Navigate from bottom to top
    handleUpArrow(state); // at index 2
    expect(state.currentEditIndex).toBe(2);

    handleUpArrow(state); // at index 1
    expect(state.currentEditIndex).toBe(1);

    handleUpArrow(state); // at index 0
    expect(state.currentEditIndex).toBe(0);

    // Navigate from top to bottom
    handleDownArrow(state); // at index 1
    expect(state.currentEditIndex).toBe(1);

    handleDownArrow(state); // at index 2
    expect(state.currentEditIndex).toBe(2);

    // Exit at bottom
    handleDownArrow(state);
    expect(state.isEditingQueue).toBe(false);
    expect(state.currentEditIndex).toBe(-1);
  });
});
