/**
 * Message Queue Hook
 *
 * Custom React hook for managing a message queue state.
 * Allows queuing messages during streaming and processing them sequentially.
 *
 * Reference: Feature - Create useMessageQueue hook for message queue state management
 */

import { useState, useCallback } from "react";

// ============================================================================
// TYPES
// ============================================================================

/**
 * A message queued for sending.
 */
export interface QueuedMessage {
  /** Unique message identifier */
  id: string;
  /** Message content text */
  content: string;
  /** ISO timestamp of when the message was queued */
  queuedAt: string;
}

/**
 * Return type for the useMessageQueue hook.
 */
export interface UseMessageQueueReturn {
  /** Current queue of messages */
  queue: QueuedMessage[];
  /** Add a message to the end of the queue */
  enqueue: (content: string) => void;
  /** Remove and return the first message from the queue */
  dequeue: () => QueuedMessage | undefined;
  /** Clear all messages from the queue */
  clear: () => void;
  /** Number of messages currently in the queue */
  count: number;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate a unique queue message ID.
 */
function generateQueueId(): string {
  return `queue_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Get current ISO timestamp.
 */
function getCurrentTimestamp(): string {
  return new Date().toISOString();
}

// ============================================================================
// HOOK IMPLEMENTATION
// ============================================================================

/**
 * Custom hook for managing a message queue.
 *
 * Provides queue, enqueue, dequeue, clear operations and a count
 * of messages in the queue. Messages are stored with unique IDs
 * and timestamps.
 *
 * @example
 * ```tsx
 * const { queue, enqueue, dequeue, clear, count } = useMessageQueue();
 *
 * // Queue a message during streaming
 * if (isStreaming) {
 *   enqueue(userInput);
 * }
 *
 * // Process next message after stream completes
 * const nextMessage = dequeue();
 * if (nextMessage) {
 *   sendMessage(nextMessage.content);
 * }
 * ```
 */
export function useMessageQueue(): UseMessageQueueReturn {
  const [queue, setQueue] = useState<QueuedMessage[]>([]);

  /**
   * Add a message to the end of the queue.
   */
  const enqueue = useCallback((content: string) => {
    const message: QueuedMessage = {
      id: generateQueueId(),
      content,
      queuedAt: getCurrentTimestamp(),
    };
    setQueue((prev) => [...prev, message]);
  }, []);

  /**
   * Remove and return the first message from the queue.
   * Returns undefined if the queue is empty.
   */
  const dequeue = useCallback((): QueuedMessage | undefined => {
    let dequeuedMessage: QueuedMessage | undefined;

    setQueue((prev) => {
      if (prev.length === 0) {
        return prev;
      }
      dequeuedMessage = prev[0];
      return prev.slice(1);
    });

    return dequeuedMessage;
  }, []);

  /**
   * Clear all messages from the queue.
   */
  const clear = useCallback(() => {
    setQueue([]);
  }, []);

  return {
    queue,
    enqueue,
    dequeue,
    clear,
    count: queue.length,
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export default useMessageQueue;
