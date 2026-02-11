/**
 * Message Queue Hook
 *
 * Custom React hook for managing a message queue state.
 * Allows queuing messages during streaming and processing them sequentially.
 *
 * Reference: Feature - Create useMessageQueue hook for message queue state management
 */

import { useState, useCallback, useRef } from "react";

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
  /** Current edit index for message editing (-1 if not editing) */
  currentEditIndex: number;
  /** Set the current edit index */
  setEditIndex: (index: number) => void;
  /** Update the content of a message at a specific index */
  updateAt: (index: number, content: string) => void;
  /** Move a message up in the queue (swap with previous) */
  moveUp: (index: number) => void;
  /** Move a message down in the queue (swap with next) */
  moveDown: (index: number) => void;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Maximum recommended queue size.
 * Exceeding this triggers a warning to prevent memory issues.
 */
export const MAX_QUEUE_SIZE = 100;

/**
 * Warning threshold for queue size.
 * When queue reaches this size, a warning is logged.
 */
export const QUEUE_SIZE_WARNING_THRESHOLD = 50;

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
  const [currentEditIndex, setCurrentEditIndex] = useState<number>(-1);
  // Ref to hold the current queue for dequeue to avoid stale closure issues
  const queueRef = useRef<QueuedMessage[]>([]);

  // Sync ref during render (not in useEffect) so dequeue always sees the
  // latest queue state, even when called before post-render effects fire.
  queueRef.current = queue;

  /**
   * Add a message to the end of the queue.
   * Logs warnings when queue grows too large to prevent memory issues.
   */
  const enqueue = useCallback((content: string) => {
    const message: QueuedMessage = {
      id: generateQueueId(),
      content,
      queuedAt: getCurrentTimestamp(),
    };
    setQueue((prev) => {
      const newQueue = [...prev, message];
      const count = newQueue.length;
      console.debug(`[useMessageQueue] queue_count: ${count}`);

      // Warn when queue grows large
      if (count === QUEUE_SIZE_WARNING_THRESHOLD) {
        console.warn(
          `[useMessageQueue] Queue has ${count} messages. Consider processing queued messages to avoid memory issues.`
        );
      } else if (count === MAX_QUEUE_SIZE) {
        console.warn(
          `[useMessageQueue] Queue has reached maximum recommended size (${MAX_QUEUE_SIZE}). ` +
            `New messages may impact UI responsiveness.`
        );
      } else if (count > MAX_QUEUE_SIZE && count % 50 === 0) {
        console.warn(
          `[useMessageQueue] Queue size is ${count}, well above recommended maximum of ${MAX_QUEUE_SIZE}.`
        );
      }

      return newQueue;
    });
  }, []);

  /**
   * Remove and return the first message from the queue.
   * Returns undefined if the queue is empty.
   *
   * Note: We read from the ref to avoid stale closure issues when this function
   * is called from callbacks created earlier (e.g., handleComplete in sendMessage).
   */
  const dequeue = useCallback((): QueuedMessage | undefined => {
    // Read the first message from the ref (always current)
    const firstMessage = queueRef.current[0];

    if (!firstMessage) {
      return undefined;
    }

    // Log processing delay
    const delayMs = Date.now() - new Date(firstMessage.queuedAt).getTime();
    console.debug(`[useMessageQueue] queue_processing_delay_ms: ${delayMs}`);

    // Remove the first message from the queue
    setQueue((prev) => prev.slice(1));

    return firstMessage;
  }, []);

  /**
   * Clear all messages from the queue.
   */
  const clear = useCallback(() => {
    setQueue([]);
  }, []);

  /**
   * Set the current edit index.
   */
  const setEditIndex = useCallback((index: number) => {
    setCurrentEditIndex(index);
  }, []);

  /**
   * Update the content of a message at a specific index.
   */
  const updateAt = useCallback((index: number, content: string) => {
    setQueue((prev) => {
      if (index < 0 || index >= prev.length) {
        return prev;
      }
      const message = prev[index];
      if (!message) {
        return prev;
      }
      const updated = [...prev];
      updated[index] = {
        id: message.id,
        queuedAt: message.queuedAt,
        content,
      };
      return updated;
    });
  }, []);

  /**
   * Move a message up in the queue (swap with previous).
   */
  const moveUp = useCallback((index: number) => {
    setQueue((prev) => {
      if (index <= 0 || index >= prev.length) {
        return prev;
      }
      const updated = [...prev];
      const temp = updated[index - 1]!;
      updated[index - 1] = updated[index]!;
      updated[index] = temp;
      return updated;
    });
    setCurrentEditIndex((prev) => (prev > 0 ? prev - 1 : prev));
  }, []);

  /**
   * Move a message down in the queue (swap with next).
   */
  const moveDown = useCallback(
    (index: number) => {
      setQueue((prev) => {
        if (index < 0 || index >= prev.length - 1) {
          return prev;
        }
        const updated = [...prev];
        [updated[index], updated[index + 1]] = [updated[index + 1]!, updated[index]!];
        return updated;
      });
      setCurrentEditIndex((prev) => (prev < queue.length - 1 ? prev + 1 : prev));
    },
    [queue.length]
  );

  return {
    queue,
    enqueue,
    dequeue,
    clear,
    count: queue.length,
    currentEditIndex,
    setEditIndex,
    updateAt,
    moveUp,
    moveDown,
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export default useMessageQueue;
