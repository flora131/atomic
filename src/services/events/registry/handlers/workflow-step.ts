/**
 * Event handler descriptors for workflow step lifecycle events:
 * - workflow.step.start
 * - workflow.step.complete
 *
 * These events are emitted by the graph engine when workflow nodes
 * begin and finish execution. They are never coalesced (each
 * start/complete is a discrete state transition that must be preserved).
 */

import type { BusEventDataMap } from "@/services/events/bus-events/index.ts";
import { getEventHandlerRegistry } from "@/services/events/registry/registry.ts";
import type { EventRegistration } from "@/services/events/registry/types.ts";

export const workflowStepRegistrations: EventRegistration<
  "workflow.step.start" | "workflow.step.complete"
>[] = [
  {
    eventType: "workflow.step.start",
    descriptor: {
      toStreamPart: (event) => {
        const data = event.data as BusEventDataMap["workflow.step.start"];
        return {
          type: "workflow-step-start",
          runId: event.runId,
          workflowId: data.workflowId,
          nodeId: data.nodeId,
          nodeName: data.nodeName,
          startedAt: new Date(event.timestamp).toISOString(),
        };
      },
    },
  },
  {
    eventType: "workflow.step.complete",
    descriptor: {
      toStreamPart: (event) => {
        const data = event.data as BusEventDataMap["workflow.step.complete"];
        return {
          type: "workflow-step-complete",
          runId: event.runId,
          workflowId: data.workflowId,
          nodeId: data.nodeId,
          nodeName: data.nodeName,
          status: data.status,
          ...(data.result !== undefined ? { result: data.result } : {}),
          completedAt: new Date(event.timestamp).toISOString(),
        };
      },
    },
  },
];

getEventHandlerRegistry().registerBatch(workflowStepRegistrations);
