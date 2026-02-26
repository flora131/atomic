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
import { CorrelationService } from "./correlation-service.ts";
import { EchoSuppressor } from "./echo-suppressor.ts";
import { StreamPipelineConsumer } from "./stream-pipeline-consumer.ts";

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
 * Wire all consumers to the event bus.
 *
 * Establishes the complete event processing pipeline:
 * 1. Creates instances of all consumer services
 * 2. Wires them together: Bus → enrich → pipeline consumer
 * 3. Returns handles for external access and cleanup
 *
 * The pipeline works as follows:
 * - All events published to the bus are received by the wildcard subscriber
 * - Each event is enriched with correlation metadata
 * - Enriched events are batched and processed by the pipeline consumer
 * - Pipeline consumer transforms them to StreamPartEvents for the UI
 *
 * @param bus - The event bus to subscribe to
 * @returns Container with consumer instances and dispose function
 *
 * @example
 * ```typescript
 * const bus = new AtomicEventBus();
 * const consumers = wireConsumers(bus);
 *
 * // Register a callback to receive StreamPartEvents
 * consumers.pipeline.onStreamParts((events) => {
 *   for (const event of events) {
 *     message = applyStreamPartEvent(message, event);
 *   }
 * });
 *
 * // Clean up when done
 * consumers.dispose();
 * ```
 */
export function wireConsumers(bus: AtomicEventBus): WiredConsumers {
  const correlation = new CorrelationService();
  const echoSuppressor = new EchoSuppressor();
  const pipeline = new StreamPipelineConsumer(correlation, echoSuppressor);

  // Subscribe to all bus events, enrich them, and pass to pipeline
  // Note: We process events one at a time, but the pipeline consumer
  // expects an array, so we wrap each enriched event in an array.
  // The pipeline consumer batches internally via its callback mechanism.
  const unsubscribe = bus.onAll((event) => {
    const enriched = correlation.enrich(event);
    pipeline.processBatch([enriched]);
  });

  return {
    correlation,
    echoSuppressor,
    pipeline,
    dispose: () => {
      unsubscribe();
      pipeline.reset();
    },
  };
}
