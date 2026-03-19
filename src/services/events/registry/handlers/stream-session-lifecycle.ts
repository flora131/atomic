/**
 * Handler descriptors for stream.session.* events.
 *
 * Lifecycle and metadata events are consumed by direct bus subscriptions in
 * useStreamSessionSubscriptions and do NOT produce StreamPartEvents for the
 * pipeline reducer.
 *
 * Lifecycle events each get their own coalescing key to prevent different
 * states from replacing each other within the same batch window. Metadata
 * events are discrete notifications, so they do not coalesce.
 */

import { getEventHandlerRegistry } from "@/services/events/registry/registry.ts";
import type { EventRegistration } from "@/services/events/registry/types.ts";
import type { BusEventType } from "@/services/events/bus-events/index.ts";

type SessionEventType = Extract<BusEventType, `stream.session.${string}`>;

const registrations: EventRegistration<SessionEventType>[] = [
  {
    eventType: "stream.session.start",
    descriptor: {
      coalescingKey: (event) => `session.start:${event.sessionId}`,
      toStreamPart: () => null,
    },
  },
  {
    eventType: "stream.session.idle",
    descriptor: {
      coalescingKey: (event) => `session.idle:${event.sessionId}`,
      toStreamPart: () => null,
    },
  },
  {
    eventType: "stream.session.partial-idle",
    descriptor: {
      coalescingKey: (event) => `session.partial-idle:${event.sessionId}`,
      toStreamPart: () => null,
    },
  },
  {
    eventType: "stream.session.error",
    descriptor: {
      coalescingKey: (event) => `session.error:${event.sessionId}`,
      toStreamPart: () => null,
    },
  },
  {
    eventType: "stream.session.retry",
    descriptor: {
      coalescingKey: (event) => `session.retry:${event.sessionId}`,
      toStreamPart: () => null,
    },
  },
  {
    eventType: "stream.session.info",
    descriptor: {
      toStreamPart: () => null,
    },
  },
  {
    eventType: "stream.session.warning",
    descriptor: {
      toStreamPart: () => null,
    },
  },
  {
    eventType: "stream.session.title_changed",
    descriptor: {
      toStreamPart: () => null,
    },
  },
  {
    eventType: "stream.session.truncation",
    descriptor: {
      toStreamPart: () => null,
    },
  },
  {
    eventType: "stream.session.compaction",
    descriptor: {
      toStreamPart: () => null,
    },
  },
];

getEventHandlerRegistry().registerBatch(registrations);

export { registrations as sessionLifecycleRegistrations };
