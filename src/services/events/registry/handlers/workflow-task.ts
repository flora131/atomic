/**
 * Handler descriptors for workflow task events:
 * - workflow.task.update
 * - workflow.task.statusChange
 *
 * Both events produce a task-list-update StreamPartEvent, plus
 * task-result-upsert events for any tasks carrying a taskResult envelope.
 */

import type { BusEventDataMap } from "@/services/events/bus-events/index.ts";
import type { EventRegistration } from "@/services/events/registry/types.ts";
import type { StreamPartEvent } from "@/state/streaming/pipeline-types.ts";
import type { WorkflowRuntimeTask } from "@/services/workflows/runtime-contracts.ts";
import { getEventHandlerRegistry } from "@/services/events/registry/registry.ts";

/**
 * Shared mapper logic: converts a tasks array into a task-list-update event
 * plus task-result-upsert events for each task with a result envelope.
 */
function mapTasksToStreamParts(
  runId: number,
  tasks: WorkflowRuntimeTask[],
): StreamPartEvent[] {
  const mapped: StreamPartEvent[] = [{
    type: "task-list-update",
    runId,
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      ...(task.blockedBy ? { blockedBy: task.blockedBy } : {}),
    })),
  }];

  for (const task of tasks) {
    if (!task.taskResult) {
      continue;
    }

    mapped.push({
      type: "task-result-upsert",
      runId,
      envelope: task.taskResult,
    });
  }

  return mapped;
}

export const workflowTaskRegistrations: EventRegistration<
  "workflow.task.update" | "workflow.task.statusChange"
>[] = [
  {
    eventType: "workflow.task.update",
    descriptor: {
      coalescingKey: (event) => {
        const data = event.data as BusEventDataMap["workflow.task.update"];
        return `workflow.tasks:${data.workflowId}`;
      },
      toStreamPart: (event) => {
        const data = event.data as BusEventDataMap["workflow.task.update"];
        return mapTasksToStreamParts(event.runId, data.tasks);
      },
    },
  },
  {
    eventType: "workflow.task.statusChange",
    descriptor: {
      toStreamPart: (event) => {
        const data = event.data as BusEventDataMap["workflow.task.statusChange"];
        return mapTasksToStreamParts(event.runId, data.tasks);
      },
    },
  },
];

// Self-registering side effect
getEventHandlerRegistry().registerBatch(workflowTaskRegistrations);
