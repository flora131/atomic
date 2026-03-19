/**
 * Handler descriptors for stream.tool.* events.
 *
 * Registers coalescing key functions and stream-part mappers for:
 * - stream.tool.start
 * - stream.tool.complete
 * - stream.tool.partial_result
 */

import type { BusEventDataMap } from "@/services/events/bus-events/index.ts";
import type { EventRegistration } from "@/services/events/registry/types.ts";
import { getEventHandlerRegistry } from "@/services/events/registry/registry.ts";

const registrations: EventRegistration<"stream.tool.start" | "stream.tool.complete" | "stream.tool.partial_result">[] = [
  {
    eventType: "stream.tool.start",
    descriptor: {
      coalescingKey: (event) => {
        const data = event.data as BusEventDataMap["stream.tool.start"];
        return `tool.start:${data.toolId}`;
      },
      toStreamPart: (event) => {
        const data = event.data as BusEventDataMap["stream.tool.start"];
        return {
          type: "tool-start",
          runId: event.runId,
          toolId: data.toolId,
          toolName: data.toolName,
          input: data.toolInput,
          ...(data.toolMetadata ? { toolMetadata: data.toolMetadata } : {}),
          ...(data.parentAgentId ? { agentId: data.parentAgentId } : {}),
        };
      },
    },
  },
  {
    eventType: "stream.tool.complete",
    descriptor: {
      coalescingKey: (event) => {
        const data = event.data as BusEventDataMap["stream.tool.complete"];
        return `tool.complete:${data.toolId}`;
      },
      toStreamPart: (event) => {
        const data = event.data as BusEventDataMap["stream.tool.complete"];
        return {
          type: "tool-complete",
          runId: event.runId,
          toolId: data.toolId,
          toolName: data.toolName,
          output: data.toolResult,
          success: data.success,
          error: data.error,
          ...(data.toolInput ? { input: data.toolInput } : {}),
          ...(data.toolMetadata ? { toolMetadata: data.toolMetadata } : {}),
          ...(data.parentAgentId ? { agentId: data.parentAgentId } : {}),
        };
      },
    },
  },
  {
    eventType: "stream.tool.partial_result",
    descriptor: {
      // Partial results are additive — never coalesced
      toStreamPart: (event) => {
        const data = event.data as BusEventDataMap["stream.tool.partial_result"];
        return {
          type: "tool-partial-result",
          runId: event.runId,
          toolId: data.toolCallId,
          partialOutput: data.partialOutput,
          ...(data.parentAgentId ? { agentId: data.parentAgentId } : {}),
        };
      },
    },
  },
];

// Self-registering side effect
getEventHandlerRegistry().registerBatch(registrations);
