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
import { pipelineLog } from "./pipeline-logger.ts";

const FLUSH_INTERVAL_MS = 16; // ~60 FPS alignment

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
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private lastFlush = Date.now();
  private flushIntervalMs: number;
  private consumers: Array<(events: BusEvent[]) => void> = [];
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
  constructor(bus: AtomicEventBus, flushIntervalMs = FLUSH_INTERVAL_MS) {
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
        pipelineLog("Dispatcher", "coalesce", { key, type: event.type });
        return;
      }
      this.coalescingMap.set(key, this.writeBuffer.length);
    }
    this.writeBuffer.push(event);
    this.scheduleFlush();
  }

  /**
   * Register a consumer that receives batched events on flush.
   *
   * @param consumer - Callback receiving an array of batched events
   * @returns Unsubscribe function to remove the consumer
   */
  addConsumer(consumer: (events: BusEvent[]) => void): () => void {
    this.consumers.push(consumer);
    return () => {
      const idx = this.consumers.indexOf(consumer);
      if (idx !== -1) this.consumers.splice(idx, 1);
    };
  }

  /**
   * Flush all buffered events immediately.
   *
   * Uses a double-buffer swap pattern for efficient zero-allocation flushing.
   * Dispatches batched events to all registered consumers.
   */
  flush(): void {
    this.flushTimer = null;
    const startTime = performance.now();

    // Double-buffer swap
    const toFlush = this.writeBuffer;
    this.writeBuffer = this.readBuffer;
    this.readBuffer = toFlush;
    this.writeBuffer.length = 0;
    this.coalescingMap.clear();
    this.lastFlush = Date.now();

    // Dispatch batched events to all consumers
    for (const consumer of this.consumers) {
      consumer(toFlush);
    }

    // Update metrics
    const flushSize = toFlush.length;
    this._metrics.totalFlushed += flushSize;
    this._metrics.flushCount++;
    this._metrics.lastFlushSize = flushSize;
    this._metrics.lastFlushDuration = performance.now() - startTime;

    pipelineLog("Dispatcher", "flush", { count: flushSize, durationMs: this._metrics.lastFlushDuration });
  }

  /**
   * Schedule a flush using setTimeout with elapsed time calculation.
   * If enough time has passed since last flush, flush immediately.
   */
  private scheduleFlush(): void {
    if (this.flushTimer !== null) return;
    const elapsed = Date.now() - this.lastFlush;
    if (elapsed >= this.flushIntervalMs) {
      this.flush();
    } else {
      this.flushTimer = setTimeout(
        () => this.flush(),
        this.flushIntervalMs - elapsed,
      );
    }
  }

  /**
   * Clean up resources.
   *
   * Stops the flush timer and clears all buffered events. Should be called
   * when the dispatcher is no longer needed to prevent memory leaks.
   */
  dispose(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.writeBuffer.length = 0;
    this.readBuffer.length = 0;
    this.coalescingMap.clear();
    this.consumers.length = 0;
    this._metrics = {
      totalFlushed: 0,
      totalCoalesced: 0,
      flushCount: 0,
      lastFlushDuration: 0,
      lastFlushSize: 0,
    };
  }
}
