/**
 * Wire Consumers to Event Bus
 *
 * This module provides the wireConsumers() function that instantiates and connects
 * all consumer services to the event bus. It establishes the event processing pipeline:
 *
 * Event flow: Bus → CorrelationService.enrich() → StreamPipelineConsumer → UI
 *
 * The function returns handles to all consumer instances and a dispose function
 * for cleanup, making it easy to manage the lifecycle of the entire consumer pipeline.
 *
 * Usage:
 * ```typescript
 * const bus = new AtomicEventBus();
 * const consumers = wireConsumers(bus);
 *
 * // Consumers are now wired and processing events
 * // Access individual services if needed:
 * consumers.correlation.registerTool(toolId, agentId, isSubagent);
 *
 * // Clean up when done:
 * consumers.dispose();
 * ```
 */

import type { AtomicEventBus } from "../event-bus.ts";
import type { BatchDispatcher } from "../batch-dispatcher.ts";
import { CorrelationService } from "./correlation-service.ts";
import { EchoSuppressor } from "./echo-suppressor.ts";
import { StreamPipelineConsumer } from "./stream-pipeline-consumer.ts";
import { pipelineLog } from "../pipeline-logger.ts";

/**
 * Container for wired consumer instances and cleanup.
 *
 * Provides access to all consumer service instances and a dispose function
 * to cleanly shut down the entire consumer pipeline.
 */
export interface WiredConsumers {
  /** Correlation service for enriching events with metadata */
  correlation: CorrelationService;
  /** Echo suppressor for filtering duplicate text */
  echoSuppressor: EchoSuppressor;
  /** Pipeline consumer for transforming bus events to stream parts */
  pipeline: StreamPipelineConsumer;
  /** Cleanup function to unsubscribe and reset all consumers */
  dispose: () => void;
}

/**
 * Wire all consumers to the event bus via the BatchDispatcher.
 *
 * Establishes the complete event processing pipeline:
 * 1. Creates instances of all consumer services
 * 2. Subscribes the dispatcher to the bus to enqueue events
 * 3. Registers the consumer pipeline as a batch consumer of the dispatcher
 * 4. Returns handles for external access and cleanup
 *
 * Event flow: Bus → BatchDispatcher.enqueue() → flush() → enrich → pipeline
 *
 * @param bus - The event bus to subscribe to
 * @param dispatcher - The batch dispatcher for frame-aligned batching
 * @returns Container with consumer instances and dispose function
 */
export function wireConsumers(bus: AtomicEventBus, dispatcher: BatchDispatcher): WiredConsumers {
  const correlation = new CorrelationService();
  const echoSuppressor = new EchoSuppressor();
  const pipeline = new StreamPipelineConsumer(correlation, echoSuppressor);

  // Subscribe BatchDispatcher to all bus events for enqueuing
  const unsubscribeBus = bus.onAll((event) => {
    dispatcher.enqueue(event);
  });

  // Register the consumer pipeline as a batch consumer of the dispatcher
  const unsubscribeConsumer = dispatcher.addConsumer((events) => {
    const owned = [];
    for (const event of events) {
      if (event.type === "stream.session.start") {
        correlation.startRun(event.runId, event.sessionId);
        owned.push(event);
        continue;
      }
      if (correlation.isOwnedEvent(event)) {
        owned.push(event);
      }
    }
    const droppedUnowned = events.length - owned.length;
    if (droppedUnowned > 0) {
      pipelineLog("Wire", "filter_unowned", { total: events.length, owned: owned.length, droppedUnowned });
    }
    const enriched = owned.map((event) => correlation.enrich(event));
    // Filter out events marked for suppression (e.g., sub-agent text-complete)
    const unsuppressed = enriched.filter((event) => !event.suppressFromMainChat);
    pipeline.processBatch(unsuppressed);
  });

  return {
    correlation,
    echoSuppressor,
    pipeline,
    dispose: () => {
      unsubscribeBus();
      unsubscribeConsumer();
      pipeline.reset();
    },
  };
}
