/**
 * Batch Dispatcher with Frame-Aligned Batching
 *
 * This module implements the BatchDispatcher class for efficient event batching
 * with coalescing. Events are accumulated in a write buffer and flushed to the
 * event bus at regular intervals (~60fps by default).
 *
 * Key features:
 * - Double-buffer swap pattern for zero-allocation flushes
 * - Key-based coalescing for state updates (only latest state matters)
 * - Text deltas are NEVER coalesced (they accumulate)
 * - Auto-start/stop timer based on buffer activity
 * - Frame-aligned 16ms default flush interval
 */

import type { BusEvent } from "./bus-events.ts";
import { coalescingKey } from "./coalescing.ts";
import type { AtomicEventBus } from "./event-bus.ts";

/**
 * Metrics tracking for batch dispatcher operations.
 */
export interface BatchMetrics {
  /** Total events published across all flushes */
  totalFlushed: number;
  /** Total events that were coalesced (replaced in-place) */
  totalCoalesced: number;
  /** Number of flush cycles */
  flushCount: number;
  /** Duration of last flush in milliseconds */
  lastFlushDuration: number;
  /** Number of events in last flush */
  lastFlushSize: number;
}

/**
 * Batch dispatcher for frame-aligned event batching with coalescing.
 *
 * Manages efficient event batching using a double-buffer pattern. Events are
 * enqueued into a write buffer and periodically flushed to the event bus.
 * State updates with the same coalescing key are replaced in-place (only the
 * latest state matters), while text deltas accumulate normally.
 *
 * The timer automatically starts on the first enqueued event and stops when
 * the buffer is empty, minimizing overhead when idle.
 *
 * Usage:
 * ```typescript
 * const bus = new AtomicEventBus();
 * const dispatcher = new BatchDispatcher(bus, 16); // 16ms = ~60fps
 *
 * // Enqueue events - they batch automatically
 * dispatcher.enqueue({
 *   type: "stream.text.delta",
 *   sessionId: "abc123",
 *   runId: 1,
 *   timestamp: Date.now(),
 *   data: { delta: "Hello", messageId: "msg1" }
 * });
 *
 * // Events flush automatically every 16ms
 * // Or manually flush:
 * dispatcher.flush();
 *
 * // Clean up when done
 * dispatcher.dispose();
 * ```
 */
export class BatchDispatcher {
  private bus: AtomicEventBus;
  private writeBuffer: BusEvent[] = [];
  private readBuffer: BusEvent[] = [];
  private coalescingMap = new Map<string, number>(); // key → index in writeBuffer
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushIntervalMs: number;
  private _metrics: BatchMetrics = {
    totalFlushed: 0,
    totalCoalesced: 0,
    flushCount: 0,
    lastFlushDuration: 0,
    lastFlushSize: 0,
  };

  /**
   * Create a new batch dispatcher.
   *
   * @param bus - The event bus to flush events to
   * @param flushIntervalMs - Milliseconds between automatic flushes (default: 16ms ~= 60fps)
   */
  constructor(bus: AtomicEventBus, flushIntervalMs = 16) {
    this.bus = bus;
    this.flushIntervalMs = flushIntervalMs;
  }

  /**
   * Get read-only metrics for observability.
   *
   * Provides lightweight performance metrics including total events flushed,
   * coalescing ratio, flush count, and timing information.
   */
  get metrics(): Readonly<BatchMetrics> {
    return this._metrics;
  }

  /**
   * Enqueue an event for batched delivery.
   *
   * If the event has a coalescing key and another event with the same key
   * is already in the write buffer, the old event is replaced in-place.
   * Text deltas (key = undefined) are never coalesced and always accumulate.
   *
   * @param event - The event to enqueue
   */
  enqueue(event: BusEvent): void {
    const key = coalescingKey(event);
    if (key !== undefined) {
      const idx = this.coalescingMap.get(key);
      if (idx !== undefined) {
        // Replace in-place — only latest state matters
        this.writeBuffer[idx] = event;
        this._metrics.totalCoalesced++;
        return;
      }
      this.coalescingMap.set(key, this.writeBuffer.length);
    }
    this.writeBuffer.push(event);
    this.ensureTimer();
  }

  /**
   * Flush all buffered events to the event bus immediately.
   *
   * Uses a double-buffer swap pattern for efficient zero-allocation flushing.
   * The write buffer and read buffer are swapped, then the read buffer is
   * published while the write buffer (now empty) accepts new events.
   */
  flush(): void {
    const startTime = performance.now();

    // Double-buffer swap
    const toFlush = this.writeBuffer;
    this.writeBuffer = this.readBuffer;
    this.readBuffer = toFlush;
    this.writeBuffer.length = 0;
    this.coalescingMap.clear();

    // Publish each event on the bus
    for (const event of toFlush) {
      this.bus.publish(event);
    }

    // Update metrics
    const flushSize = toFlush.length;
    this._metrics.totalFlushed += flushSize;
    this._metrics.flushCount++;
    this._metrics.lastFlushSize = flushSize;
    this._metrics.lastFlushDuration = performance.now() - startTime;
  }

  /**
   * Ensure the flush timer is running.
   *
   * The timer is automatically started when the first event is enqueued.
   * It stops automatically when the buffer is empty (no work to do).
   */
  private ensureTimer(): void {
    if (this.timer === null) {
      this.timer = setInterval(() => {
        if (this.writeBuffer.length > 0) {
          this.flush();
        } else {
          clearInterval(this.timer!);
          this.timer = null;
        }
      }, this.flushIntervalMs);
    }
  }

  /**
   * Clean up resources.
   *
   * Stops the flush timer and clears all buffered events. Should be called
   * when the dispatcher is no longer needed to prevent memory leaks.
   */
  dispose(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.writeBuffer.length = 0;
    this.readBuffer.length = 0;
    this.coalescingMap.clear();
    this._metrics = {
      totalFlushed: 0,
      totalCoalesced: 0,
      flushCount: 0,
      lastFlushDuration: 0,
      lastFlushSize: 0,
    };
  }
}
