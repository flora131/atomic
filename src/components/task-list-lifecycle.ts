import type { TaskItem } from "@/components/task-list-indicator.tsx";

/**
 * Delay in ms before the task panel is auto-hidden after all tasks complete.
 * The panel lingers for 5 seconds so the user can see the final state before
 * it is removed from the UI. Adjusting this value changes how long the
 * completed task list remains visible after workflow completion.
 */
export const AUTO_CLEAR_DELAY_MS = 5_000;

export function shouldAutoClearTaskPanel(tasks: readonly TaskItem[]): boolean {
  return tasks.length > 0 && tasks.every((task) => task.status === "completed");
}
