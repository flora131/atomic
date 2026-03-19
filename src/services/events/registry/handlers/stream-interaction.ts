/**
 * Handler descriptors for interactive and auxiliary stream events.
 *
 * These events are consumed by direct bus subscriptions in the UI layer and
 * intentionally do not produce StreamPartEvents for the message reducer.
 */

import type { BusEventType } from "@/services/events/bus-events/index.ts";
import { getEventHandlerRegistry } from "@/services/events/registry/registry.ts";
import type { EventRegistration } from "@/services/events/registry/types.ts";

type InteractionEventType =
  | "stream.permission.requested"
  | "stream.human_input_required"
  | "stream.skill.invoked";

const registrations: EventRegistration<Extract<BusEventType, InteractionEventType>>[] = [
  {
    eventType: "stream.permission.requested",
    descriptor: {
      toStreamPart: () => null,
    },
  },
  {
    eventType: "stream.human_input_required",
    descriptor: {
      toStreamPart: () => null,
    },
  },
  {
    eventType: "stream.skill.invoked",
    descriptor: {
      toStreamPart: () => null,
    },
  },
];

getEventHandlerRegistry().registerBatch(registrations);

export { registrations as interactionRegistrations };
