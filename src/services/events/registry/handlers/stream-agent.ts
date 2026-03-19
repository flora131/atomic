/**
 * Handler descriptors for stream.agent.* events.
 *
 * Registers coalescing keys and stream-part mappers for:
 * - stream.agent.start   (coalesces by agentId; no stream-part — consumed by direct bus subscription)
 * - stream.agent.update  (coalesces by agentId; no stream-part — consumed by direct bus subscription)
 * - stream.agent.complete (coalesces by agentId; maps to agent-terminal StreamPartEvent)
 */

import type { BusEventDataMap } from "@/services/events/bus-events/index.ts";
import { getEventHandlerRegistry } from "@/services/events/registry/registry.ts";

const registry = getEventHandlerRegistry();

registry.register("stream.agent.start", {
  coalescingKey: (event) => {
    const data = event.data as BusEventDataMap["stream.agent.start"];
    return `agent.start:${data.agentId}`;
  },
  toStreamPart: () => null,
});

registry.register("stream.agent.update", {
  coalescingKey: (event) => {
    const data = event.data as BusEventDataMap["stream.agent.update"];
    return `agent.update:${data.agentId}`;
  },
  toStreamPart: () => null,
});

registry.register("stream.agent.complete", {
  coalescingKey: (event) => {
    const data = event.data as BusEventDataMap["stream.agent.complete"];
    return `agent.complete:${data.agentId}`;
  },
  toStreamPart: (event) => {
    const data = event.data as BusEventDataMap["stream.agent.complete"];
    return {
      type: "agent-terminal",
      runId: event.runId,
      agentId: data.agentId,
      status: data.success ? "completed" : "error",
      ...(typeof data.result === "string" ? { result: data.result } : {}),
      ...(typeof data.error === "string" ? { error: data.error } : {}),
      completedAt: new Date(event.timestamp).toISOString(),
    };
  },
});
