/**
 * Stream Pipeline Consumer
 *
 * Transforms enriched BusEvents into StreamPartEvents for the UI reducer.
 * This consumer bridges the new event bus architecture with the existing
 * streaming UI pipeline (applyStreamPartEvent reducer).
 *
 * Key responsibilities:
 * - Map BusEvents to StreamPartEvents
 * - Apply echo suppression to text deltas
 * - Batch events and deliver via callback
 * - Support reset() for cleanup between runs
 *
 * Usage:
 * ```typescript
 * const consumer = new StreamPipelineConsumer(echoSuppressor);
 *
 * // Register callback to receive batched StreamPartEvents
 * const unsubscribe = consumer.onStreamParts((events) => {
 *   for (const event of events) {
 *     message = applyStreamPartEvent(message, event);
 *   }
 * });
 *
 * // Process a batch of BusEvents from BatchDispatcher
 * consumer.processBatch(enrichedEvents);
 *
 * // Cleanup
 * unsubscribe();
 * consumer.reset();
 * ```
 */

import type { EnrichedBusEvent } from "@/services/events/bus-events/index.ts";
import type { EchoSuppressor } from "@/services/events/consumers/echo-suppressor.ts";
import { getEventHandlerRegistry, type StreamPartContext } from "@/services/events/registry/index.ts";
import type { StreamPartEvent } from "@/state/parts/stream-pipeline.ts";
import { pipelineLog } from "@/services/events/pipeline-logger.ts";

/**
 * Callback type for receiving batches of StreamPartEvents.
 *
 * This callback is invoked once per frame flush with all the StreamPartEvents
 * that were mapped from the BusEvents in that batch.
 */
export type StreamPartEventCallback = (events: StreamPartEvent[]) => void;

/**
 * Consumer that transforms BusEvents into StreamPartEvents.
 *
 * This class is responsible for:
 * 1. Mapping enriched BusEvents to the appropriate StreamPartEvent types
 * 2. Filtering text deltas through the EchoSuppressor
 * 3. Batching mapped events and delivering them via callback
 *
 * The consumer is designed to work with the BatchDispatcher's frame-aligned
 * batching system, processing all events from a batch and then delivering
 * the resulting StreamPartEvents in a single callback invocation.
 */
export class StreamPipelineConsumer {
  private echoSuppressor: EchoSuppressor;
  private callback: StreamPartEventCallback | null = null;
  private readonly streamPartContext: StreamPartContext;

  /**
   * Construct a new StreamPipelineConsumer.
   *
   * @param echoSuppressor - Service for filtering duplicate text echoes
   */
  constructor(echoSuppressor: EchoSuppressor) {
    this.echoSuppressor = echoSuppressor;
    this.streamPartContext = {
      filterDelta: (delta) => this.echoSuppressor.filterDelta(delta),
    };
  }

  /**
   * Register the callback that receives batches of StreamPartEvents.
   *
   * Only one callback can be registered at a time. Calling this method
   * multiple times will replace the previous callback.
   *
   * @param callback - Function to receive batched StreamPartEvents
   * @returns Cleanup function to unregister the callback
   */
  onStreamParts(callback: StreamPartEventCallback): () => void {
    this.callback = callback;
    return () => {
      this.callback = null;
    };
  }

  /**
   * Process a batch of enriched BusEvents.
   *
   * This method is called by the BatchDispatcher subscriber for each
   * frame-aligned batch. It maps each BusEvent to zero or more StreamPartEvents,
   * collects them, and delivers the batch via the registered callback.
   *
   * @param events - Array of enriched BusEvents from the BatchDispatcher
   */
  processBatch(events: EnrichedBusEvent[]): void {
    const parts: StreamPartEvent[] = [];

    for (const event of events) {
      const mapped = this.mapToStreamPart(event);
      if (mapped) {
        parts.push(...mapped);
      }
    }

    if (parts.length > 0 && this.callback) {
      const coalescedParts = this.coalesceStreamParts(parts);
      pipelineLog("Consumer", "batch_deliver", { count: coalescedParts.length });
      this.callback(coalescedParts);
    }
  }

  /**
   * Coalesce adjacent additive stream events within a single batch.
   *
   * This keeps visual parity while reducing reducer/state update churn in the UI.
   * Only strictly adjacent events with matching scope are merged.
   */
  private coalesceStreamParts(parts: StreamPartEvent[]): StreamPartEvent[] {
    if (parts.length <= 1) {
      return parts;
    }

    const coalesced: StreamPartEvent[] = [];

    for (const part of parts) {
      const previous = coalesced.length > 0 ? coalesced[coalesced.length - 1] : undefined;

      if (
        previous
        && previous.type === "text-delta"
        && part.type === "text-delta"
        && previous.runId === part.runId
        && previous.agentId === part.agentId
      ) {
        previous.delta += part.delta;
        continue;
      }

      if (
        previous
        && previous.type === "thinking-meta"
        && part.type === "thinking-meta"
        && previous.runId === part.runId
        && previous.agentId === part.agentId
        && previous.thinkingSourceKey === part.thinkingSourceKey
        && previous.targetMessageId === part.targetMessageId
        && previous.streamGeneration === part.streamGeneration
        && previous.includeReasoningPart === part.includeReasoningPart
        && previous.provider === part.provider
      ) {
        previous.thinkingText += part.thinkingText;
        previous.thinkingMs = Math.max(previous.thinkingMs, part.thinkingMs);
        continue;
      }

      coalesced.push(part);
    }

    return coalesced;
  }

  /**
   * Map a single BusEvent to zero or more StreamPartEvents.
   *
   * Dispatches through the event handler registry so per-event mapping logic
   * stays colocated with the registered descriptors. Some events map to a
   * single StreamPartEvent, some map to multiple, and some are ignored.
   *
   * @param event - The enriched BusEvent to map
   * @returns Array of StreamPartEvents, or null if the event should be ignored
   */
  private mapToStreamPart(event: EnrichedBusEvent): StreamPartEvent[] | null {
    const mapper = getEventHandlerRegistry().getStreamPartMapper(event.type);
    if (!mapper) {
      return null;
    }

    const mapped = mapper(event, this.streamPartContext);
    if (!mapped) {
      return null;
    }

    return Array.isArray(mapped) ? mapped : [mapped];
  }

  /**
   * Reset all consumer state.
   *
   * Resets the echo suppressor, preparing the consumer for a new streaming session.
   *
   * Should be called:
   * - Before starting a new stream
   * - On error recovery
   * - When switching conversations
   */
  reset(): void {
    this.echoSuppressor.reset();
  }
}
