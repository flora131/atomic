/**
 * Wire Consumers to Event Bus
 *
 * This module provides the wireConsumers() function that instantiates and connects
 * all consumer services to the event bus. It establishes the event processing pipeline:
 *
 * Event flow: Bus → BatchDispatcher → ownership filter → StreamPipelineConsumer → UI
 *
 * Events arrive pre-enriched with correlation metadata from the adapter layer
 * (via the shared correlate() utility in adapters/shared/adapter-correlation.ts).
 * The consumer pipeline only needs to filter by session ownership and suppress
 * sub-agent events before passing to the StreamPipelineConsumer.
 *
 * The function returns handles to all consumer instances and a dispose function
 * for cleanup, making it easy to manage the lifecycle of the entire consumer pipeline.
 */

import type { BusEvent, EnrichedBusEvent } from "@/services/events/bus-events/index.ts";
import type { EventBus } from "@/services/events/event-bus.ts";
import type { BatchDispatcher } from "@/services/events/batch-dispatcher.ts";
import { EchoSuppressor } from "@/services/events/consumers/echo-suppressor.ts";
import { StreamPipelineConsumer } from "@/services/events/consumers/stream-pipeline-consumer.ts";
import { pipelineLog } from "@/services/events/pipeline-logger.ts";

/**
 * Tracks which sessions and runs are "owned" by the current consumer pipeline.
 *
 * Events that do not belong to an owned session or run are dropped before
 * reaching the StreamPipelineConsumer, preventing cross-session event leakage.
 */
export interface OwnershipTracker {
  /** Register a new run and its initial session as owned. Resets prior state. */
  startRun(runId: number, sessionId: string): void;
  /** Check if an event belongs to an owned run or session. */
  isOwnedEvent(event: BusEvent): boolean;
  /** Add a session ID to the owned set without resetting state. */
  addOwnedSession(sessionId: string): void;
  /** Clear all ownership state. */
  reset(): void;
}

function createOwnershipTracker(): OwnershipTracker {
  let activeRunId: number | null = null;
  const ownedSessionIds = new Set<string>();

  return {
    startRun(runId: number, sessionId: string) {
      activeRunId = null;
      ownedSessionIds.clear();
      activeRunId = runId;
      ownedSessionIds.add(sessionId);
    },
    isOwnedEvent(event: BusEvent): boolean {
      return (
        event.runId === activeRunId ||
        ownedSessionIds.has(event.sessionId)
      );
    },
    addOwnedSession(sessionId: string) {
      ownedSessionIds.add(sessionId);
    },
    reset() {
      activeRunId = null;
      ownedSessionIds.clear();
    },
  };
}

/**
 * Container for wired consumer instances and cleanup.
 *
 * Provides access to all consumer service instances and a dispose function
 * to cleanly shut down the entire consumer pipeline.
 */
export interface WiredConsumers {
  /** Ownership tracker for filtering events by session/run */
  ownership: OwnershipTracker;
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
 * Events arrive pre-enriched from adapters. The pipeline only performs
 * ownership filtering and suppression before delivering to the consumer.
 *
 * Event flow: Bus → BatchDispatcher.enqueue() → flush() → ownership filter → pipeline
 *
 * @param bus - The event bus to subscribe to
 * @param dispatcher - The batch dispatcher for frame-aligned batching
 * @returns Container with consumer instances and dispose function
 */
export function wireConsumers(bus: EventBus, dispatcher: BatchDispatcher): WiredConsumers {
  const ownership = createOwnershipTracker();
  const echoSuppressor = new EchoSuppressor();
  const pipeline = new StreamPipelineConsumer(echoSuppressor);

  // Subscribe BatchDispatcher to all bus events for enqueuing
  const unsubscribeBus = bus.onAll((event) => {
    dispatcher.enqueue(event);
  });

  // Register the consumer pipeline as a batch consumer of the dispatcher
  const unsubscribeConsumer = dispatcher.addConsumer((events) => {
    const owned = [];
    for (const event of events) {
      if (event.type === "stream.session.start") {
        ownership.startRun(event.runId, event.sessionId);
        owned.push(event);
        continue;
      }
      if (ownership.isOwnedEvent(event)) {
        owned.push(event);
      }
    }
    const droppedUnowned = events.length - owned.length;
    if (droppedUnowned > 0) {
      pipelineLog("Wire", "filter_unowned", { total: events.length, owned: owned.length, droppedUnowned });
    }
    // Events arrive pre-enriched from adapters; cast to EnrichedBusEvent
    const enriched = owned as EnrichedBusEvent[];
    // Filter out events marked for suppression (e.g., sub-agent text-complete)
    const unsuppressed = enriched.filter((event) => !event.suppressFromMainChat);
    pipeline.processBatch(unsuppressed);
  });

  return {
    ownership,
    echoSuppressor,
    pipeline,
    dispose: () => {
      unsubscribeBus();
      unsubscribeConsumer();
      pipeline.reset();
      ownership.reset();
    },
  };
}
