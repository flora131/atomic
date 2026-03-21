/**
 * Handler descriptors for workflow.step.* events.
 *
 * Registers coalescing keys and stream-part mappers for:
 * - workflow.step.start    (coalesces by nodeId; maps to workflow-step-start StreamPartEvent)
 * - workflow.step.complete  (coalesces by nodeId; maps to workflow-step-complete StreamPartEvent)
 */

import type { BusEventDataMap } from "@/services/events/bus-events/index.ts";
import { getEventHandlerRegistry } from "@/services/events/registry/registry.ts";

const registry = getEventHandlerRegistry();

registry.register("workflow.step.start", {
  coalescingKey: (event) => {
    const data = event.data as BusEventDataMap["workflow.step.start"];
    return `workflow.step.start:${data.workflowId}:${data.nodeId}`;
  },
  toStreamPart: (event) => {
    const data = event.data as BusEventDataMap["workflow.step.start"];
    return {
      type: "workflow-step-start" as const,
      runId: event.runId,
      workflowId: data.workflowId,
      nodeId: data.nodeId,
      nodeName: data.nodeName,
      indicator: data.indicator,
    };
  },
});

registry.register("workflow.step.complete", {
  coalescingKey: (event) => {
    const data = event.data as BusEventDataMap["workflow.step.complete"];
    return `workflow.step.complete:${data.workflowId}:${data.nodeId}`;
  },
  toStreamPart: (event) => {
    const data = event.data as BusEventDataMap["workflow.step.complete"];
    return {
      type: "workflow-step-complete" as const,
      runId: event.runId,
      workflowId: data.workflowId,
      nodeId: data.nodeId,
      nodeName: data.nodeName,
      status: data.status,
      durationMs: data.durationMs,
      ...(data.error ? { error: data.error } : {}),
      ...(data.compaction ? { compaction: data.compaction } : {}),
    };
  },
});
