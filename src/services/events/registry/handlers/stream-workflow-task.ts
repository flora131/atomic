/**
 * Handler descriptor for workflow.task.update events.
 *
 * Registers a coalescing key and stream-part mapper for:
 * - workflow.task.update  (coalesces by sessionId; maps to task-list-update StreamPartEvent)
 *
 * The conductor publishes workflow.task.update whenever the internal task list
 * changes (e.g., after the planner parses tasks or the orchestrator updates
 * statuses). The handler maps the full task snapshot to a task-list-update
 * StreamPartEvent consumed by the UI reducer.
 */

import type { BusEventDataMap } from "@/services/events/bus-events/index.ts";
import type { WorkflowRuntimeTaskStatus } from "@/services/workflows/runtime-contracts.ts";
import { normalizeWorkflowRuntimeTaskStatus } from "@/services/workflows/runtime-contracts.ts";
import { getEventHandlerRegistry } from "@/services/events/registry/registry.ts";

const registry = getEventHandlerRegistry();

/**
 * workflow.tasks.updated is a direct-to-UI event published by the task_list
 * tool handler on every mutation. The TaskListPanel subscribes to this event
 * directly via the bus — it does NOT flow through the stream-part pipeline,
 * so no toStreamPart mapper is needed.
 */
registry.register("workflow.tasks.updated", {});

registry.register("workflow.task.update", {
  coalescingKey: (event) => `workflow.task.update:${event.sessionId}`,
  toStreamPart: (event) => {
    const data = event.data as BusEventDataMap["workflow.task.update"];
    return {
      type: "task-list-update" as const,
      runId: event.runId,
      tasks: data.tasks.map((task) => ({
        id: task.id ?? task.description.slice(0, 40),
        title: task.description,
        status: normalizeWorkflowRuntimeTaskStatus(task.status) as WorkflowRuntimeTaskStatus,
        ...(task.blockedBy ? { blockedBy: task.blockedBy } : {}),
      })),
    };
  },
});
