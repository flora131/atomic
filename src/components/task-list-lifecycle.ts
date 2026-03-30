import type { TaskItem } from "@/components/task-list-indicator.tsx";

/** Delay in ms before the task panel is removed after all tasks complete. */
export const AUTO_CLEAR_DELAY_MS = 5_000;

export function shouldAutoClearTaskPanel(tasks: readonly TaskItem[]): boolean {
  return tasks.length > 0 && tasks.every((task) => task.status === "completed");
}
