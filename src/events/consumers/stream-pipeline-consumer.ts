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
 * const consumer = new StreamPipelineConsumer(correlationService, echoSuppressor);
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

import type { EnrichedBusEvent, BusEventDataMap } from "../bus-events.ts";
import type { CorrelationService } from "./correlation-service.ts";
import type { EchoSuppressor } from "./echo-suppressor.ts";
import type { StreamPartEvent } from "../../ui/parts/stream-pipeline.ts";
import { pipelineLog } from "../pipeline-logger.ts";

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
 * 4. Coordinating with CorrelationService for enrichment metadata
 *
 * The consumer is designed to work with the BatchDispatcher's frame-aligned
 * batching system, processing all events from a batch and then delivering
 * the resulting StreamPartEvents in a single callback invocation.
 */
export class StreamPipelineConsumer {
  private correlation: CorrelationService;
  private echoSuppressor: EchoSuppressor;
  private callback: StreamPartEventCallback | null = null;

  /**
   * Construct a new StreamPipelineConsumer.
   *
   * @param correlation - Service for event correlation and enrichment
   * @param echoSuppressor - Service for filtering duplicate text echoes
   */
  constructor(correlation: CorrelationService, echoSuppressor: EchoSuppressor) {
    this.correlation = correlation;
    this.echoSuppressor = echoSuppressor;
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
      pipelineLog("Consumer", "batch_deliver", { count: parts.length });
      this.callback(parts);
    }
  }

  /**
   * Map a single BusEvent to zero or more StreamPartEvents.
   *
   * This method handles the type-specific transformation logic for each
   * BusEvent type. Some events map to a single StreamPartEvent, some map
   * to multiple, and some are ignored (return null).
   *
   * @param event - The enriched BusEvent to map
   * @returns Array of StreamPartEvents, or null if the event should be ignored
   */
  private mapToStreamPart(event: EnrichedBusEvent): StreamPartEvent[] | null {
    switch (event.type) {
      case "stream.text.delta": {
        const data = event.data as BusEventDataMap["stream.text.delta"];
        // Run through echo suppressor to filter duplicate tool result echoes
        const filtered = this.echoSuppressor.filterDelta(data.delta);
        if (!filtered) return null;
        return [{ type: "text-delta", delta: filtered, ...(data.agentId ? { agentId: data.agentId } : {}) }];
      }

      case "stream.thinking.delta": {
        const data = event.data as BusEventDataMap["stream.thinking.delta"];
        return [{
          type: "thinking-meta",
          thinkingSourceKey: data.sourceKey,
          targetMessageId: data.messageId,
          streamGeneration: 0, // Default value - updated by correlation service if needed
          thinkingText: data.delta,
          thinkingMs: 0, // Duration tracking handled elsewhere
        }];
      }

      case "stream.tool.start": {
        const data = event.data as BusEventDataMap["stream.tool.start"];
        return [{
          type: "tool-start",
          toolId: data.toolId,
          toolName: data.toolName,
          input: data.toolInput,
          ...(data.parentAgentId ? { agentId: data.parentAgentId } : {}),
        }];
      }

      case "stream.tool.complete": {
        const data = event.data as BusEventDataMap["stream.tool.complete"];
        const mapped: StreamPartEvent = {
          type: "tool-complete",
          toolId: data.toolId,
          toolName: data.toolName,
          output: data.toolResult,
          success: data.success,
          error: data.error,
          ...(data.toolInput ? { input: data.toolInput } : {}),
          ...(data.parentAgentId ? { agentId: data.parentAgentId } : {}),
        };
        return [mapped];
      }

      case "stream.tool.partial_result": {
        const data = event.data as BusEventDataMap["stream.tool.partial_result"];
        return [{
          type: "tool-partial-result",
          toolId: data.toolCallId,
          partialOutput: data.partialOutput,
        }];
      }

      case "stream.text.complete": {
        const data = event.data as BusEventDataMap["stream.text.complete"];
        return [{ type: "text-complete", fullText: data.fullText, messageId: data.messageId }];
      }

      case "workflow.step.start": {
        const data = event.data as BusEventDataMap["workflow.step.start"];
        return [{
          type: "workflow-step-start",
          nodeId: data.nodeId,
          nodeName: data.nodeName,
          startedAt: event.timestamp,
        }];
      }

      case "workflow.step.complete": {
        const data = event.data as BusEventDataMap["workflow.step.complete"];
        return [{
          type: "workflow-step-complete",
          nodeId: data.nodeId,
          status: data.status,
          completedAt: event.timestamp,
        }];
      }

      case "workflow.task.update": {
        const data = event.data as BusEventDataMap["workflow.task.update"];
        return [{
          type: "task-list-update",
          tasks: data.tasks,
        }];
      }

      default:
        // Other event types are not mapped to StreamPartEvents
        // (they may be handled by other consumers)
        pipelineLog("Consumer", "unmapped", { type: event.type });
        return null;
    }
  }

  /**
   * Reset all consumer state.
   *
   * This method delegates reset to the correlation service and echo suppressor,
   * preparing the consumer for a new streaming session.
   *
   * Should be called:
   * - Before starting a new stream
   * - On error recovery
   * - When switching conversations
   */
  reset(): void {
    this.echoSuppressor.reset();
    this.correlation.reset();
  }
}
