import type { TaskItem } from "../components/task-list-indicator.tsx";

export function shouldAutoClearTaskPanel(tasks: readonly TaskItem[]): boolean {
  return tasks.length > 0 && tasks.every((task) => task.status === "completed");
}
