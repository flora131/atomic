/**
 * Conductor → EventBus Bridge
 *
 * Factory functions that create ConductorConfig callbacks wired to the
 * EventBus. This bridges the conductor's callback-based notification
 * model with the pub/sub event system, keeping the conductor itself
 * decoupled from the EventBus.
 *
 * Usage:
 * ```ts
 * const config: ConductorConfig = {
 *   ...otherConfig,
 *   onTaskUpdate: createTaskUpdatePublisher(bus, sessionId, runId),
 * };
 * ```
 */

import type { EventBus } from "@/services/events/event-bus.ts";
import type { BusEvent } from "@/services/events/bus-events/types.ts";
import type { TaskItem } from "@/services/workflows/builtin/ralph/helpers/prompts.ts";

/**
 * Create an `onTaskUpdate` callback that publishes `workflow.task.update`
 * events to the EventBus.
 *
 * Each invocation constructs a BusEvent with the full task snapshot,
 * optionally tagged with the source stage that triggered the update.
 *
 * @param bus - The EventBus instance to publish events on
 * @param sessionId - Session ID for event correlation
 * @param runId - Run ID for event correlation
 * @param sourceStageId - Optional stage ID that sourced the task change
 * @returns A callback compatible with ConductorConfig.onTaskUpdate
 */
export function createTaskUpdatePublisher(
  bus: EventBus,
  sessionId: string,
  runId: number,
  sourceStageId?: string,
): (tasks: TaskItem[]) => void {
  return (tasks: TaskItem[]) => {
    const event: BusEvent<"workflow.task.update"> = {
      type: "workflow.task.update",
      sessionId,
      runId,
      timestamp: Date.now(),
      data: {
        tasks: tasks.map((task) => ({
          ...(task.id !== undefined ? { id: task.id } : {}),
          description: task.description,
          status: task.status,
          summary: task.summary,
          ...(task.blockedBy ? { blockedBy: task.blockedBy } : {}),
        })),
        ...(sourceStageId ? { sourceStageId } : {}),
      },
    };
    bus.publish(event);
  };
}
