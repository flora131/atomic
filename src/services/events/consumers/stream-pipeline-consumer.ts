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

import type { EnrichedBusEvent, BusEventDataMap } from "@/services/events/bus-events/index.ts";
import type { CorrelationService } from "@/services/events/consumers/correlation-service.ts";
import type { EchoSuppressor } from "@/services/events/consumers/echo-suppressor.ts";
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
        if (data.agentId) {
          return [{ type: "text-delta", runId: event.runId, delta: data.delta, agentId: data.agentId }];
        }
        // Run through echo suppressor to filter duplicate tool result echoes
        const filtered = this.echoSuppressor.filterDelta(data.delta);
        if (!filtered) return null;
        return [{ type: "text-delta", runId: event.runId, delta: filtered }];
      }

      case "stream.thinking.delta": {
        const data = event.data as BusEventDataMap["stream.thinking.delta"];
        return [{
          type: "thinking-meta",
          runId: event.runId,
          thinkingSourceKey: data.sourceKey,
          targetMessageId: data.messageId,
          streamGeneration: 0,
          thinkingText: data.delta,
          thinkingMs: 0, // Duration tracking handled elsewhere
          ...(data.agentId ? { agentId: data.agentId } : {}),
        }];
      }

      case "stream.tool.start": {
        const data = event.data as BusEventDataMap["stream.tool.start"];
        const correlatedAgentId = data.parentAgentId
          ?? (event.isSubagentTool ? event.resolvedAgentId : undefined);
        return [{
          type: "tool-start",
          runId: event.runId,
          toolId: data.toolId,
          toolName: data.toolName,
          input: data.toolInput,
          ...(data.toolMetadata ? { toolMetadata: data.toolMetadata } : {}),
          ...(correlatedAgentId ? { agentId: correlatedAgentId } : {}),
        }];
      }

      case "stream.tool.complete": {
        const data = event.data as BusEventDataMap["stream.tool.complete"];
        const correlatedAgentId = data.parentAgentId
          ?? (event.isSubagentTool ? event.resolvedAgentId : undefined);
        const mapped: StreamPartEvent = {
          type: "tool-complete",
          runId: event.runId,
          toolId: data.toolId,
          toolName: data.toolName,
          output: data.toolResult,
          success: data.success,
          error: data.error,
          ...(data.toolInput ? { input: data.toolInput } : {}),
          ...(data.toolMetadata ? { toolMetadata: data.toolMetadata } : {}),
          ...(correlatedAgentId ? { agentId: correlatedAgentId } : {}),
        };
        return [mapped];
      }

      case "stream.tool.partial_result": {
        const data = event.data as BusEventDataMap["stream.tool.partial_result"];
        const correlatedAgentId = data.parentAgentId
          ?? (event.isSubagentTool ? event.resolvedAgentId : undefined);
        return [{
          type: "tool-partial-result",
          runId: event.runId,
          toolId: data.toolCallId,
          partialOutput: data.partialOutput,
          ...(correlatedAgentId ? { agentId: correlatedAgentId } : {}),
        }];
      }

      case "stream.text.complete": {
        const data = event.data as BusEventDataMap["stream.text.complete"];
        if (!data.fullText) return [];
        return [{ type: "text-complete", runId: event.runId, fullText: data.fullText, messageId: data.messageId }];
      }

      case "stream.agent.complete": {
        const data = event.data as BusEventDataMap["stream.agent.complete"];
        return [{
          type: "agent-terminal",
          runId: event.runId,
          agentId: data.agentId,
          status: data.success ? "completed" : "error",
          ...(typeof data.result === "string" ? { result: data.result } : {}),
          ...(typeof data.error === "string" ? { error: data.error } : {}),
          completedAt: new Date(event.timestamp).toISOString(),
        }];
      }

      case "workflow.task.update": {
        const data = event.data as BusEventDataMap["workflow.task.update"];
        const mapped: StreamPartEvent[] = [{
          type: "task-list-update",
          runId: event.runId,
          tasks: data.tasks.map((task) => ({
            id: task.id,
            title: task.title,
            status: task.status,
            ...(task.blockedBy ? { blockedBy: task.blockedBy } : {}),
          })),
        }];

        for (const task of data.tasks) {
          if (!task.taskResult) {
            continue;
          }

          mapped.push({
            type: "task-result-upsert",
            runId: event.runId,
            envelope: task.taskResult,
          });
        }

        return mapped;
      }

      case "workflow.task.statusChange": {
        const data = event.data as BusEventDataMap["workflow.task.statusChange"];
        const mapped: StreamPartEvent[] = [{
          type: "task-list-update",
          runId: event.runId,
          tasks: data.tasks.map((task) => ({
            id: task.id,
            title: task.title,
            status: task.status,
            ...(task.blockedBy ? { blockedBy: task.blockedBy } : {}),
          })),
        }];

        for (const task of data.tasks) {
          if (!task.taskResult) {
            continue;
          }

          mapped.push({
            type: "task-result-upsert",
            runId: event.runId,
            envelope: task.taskResult,
          });
        }

        return mapped;
      }

      case "workflow.step.start": {
        const data = event.data as BusEventDataMap["workflow.step.start"];
        return [{
          type: "workflow-step-start",
          runId: event.runId,
          workflowId: data.workflowId,
          nodeId: data.nodeId,
          nodeName: data.nodeName,
          startedAt: new Date(event.timestamp).toISOString(),
        }];
      }

      case "workflow.step.complete": {
        const data = event.data as BusEventDataMap["workflow.step.complete"];
        return [{
          type: "workflow-step-complete",
          runId: event.runId,
          workflowId: data.workflowId,
          nodeId: data.nodeId,
          nodeName: data.nodeName,
          status: data.status,
          ...(data.result !== undefined ? { result: data.result } : {}),
          completedAt: new Date(event.timestamp).toISOString(),
        }];
      }

      // ─── Intentionally unhandled in the pipeline consumer ───
      //
      // The following canonical bus events are NOT mapped to StreamPartEvents
      // because they are consumed by direct bus subscriptions elsewhere in the
      // UI layer. The pipeline consumer only produces StreamPartEvents for the
      // streaming message reducer (applyStreamPartEvent); all other UI effects
      // are driven by the typed bus subscriptions listed below.
      //
      // Modifying this list? Update event-coverage-policy.ts and the
      // corresponding useStream*Subscriptions hooks in state/chat/stream/.

      // Session lifecycle — consumed by useStreamSessionSubscriptions (direct bus subscriptions)
      case "stream.session.start":
      case "stream.session.idle":
      case "stream.session.partial-idle":
      case "stream.session.error":
        return null;

      // Session retry — emitted by the adapter retry loop for diagnostics.
      // Consumed by the debug-subscriber for logging; no UI representation
      // because retries are transparent to the user (the adapter re-enters
      // the streaming loop automatically).
      case "stream.session.retry":
        return null;

      // Session metadata — consumed by useStreamSessionSubscriptions (direct bus subscriptions)
      case "stream.session.info":
      case "stream.session.warning":
      case "stream.session.title_changed":
      case "stream.session.truncation":
      case "stream.session.compaction":
        return null;

      // Turn lifecycle — consumed by useStreamSessionSubscriptions (direct bus subscriptions)
      case "stream.turn.start":
      case "stream.turn.end":
        return null;

      // Agent lifecycle — consumed by useStreamAgentSubscriptions (direct bus subscriptions)
      case "stream.agent.start":
      case "stream.agent.update":
        return null;

      // Thinking finalization — also consumed by useStreamSessionSubscriptions
      // (direct bus subscriptions) for thinkingMs metadata.  The pipeline
      // event finalizes the reasoning part so subsequent thinking deltas
      // with the same sourceKey create a new part in chronological order.
      case "stream.thinking.complete": {
        const data = event.data as BusEventDataMap["stream.thinking.complete"];
        return [{
          type: "thinking-complete",
          runId: event.runId,
          sourceKey: data.sourceKey,
          durationMs: data.durationMs,
          ...(data.agentId ? { agentId: data.agentId } : {}),
        }];
      }

      // Interactive flows — consumed by useStreamSessionSubscriptions (direct bus subscriptions)
      case "stream.permission.requested":
      case "stream.human_input_required":
        return null;

      // Metadata — consumed by useStreamSessionSubscriptions (direct bus subscriptions)
      case "stream.usage":
      case "stream.skill.invoked":
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
