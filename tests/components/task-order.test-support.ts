import type { TaskItem } from "@/components/task-list-indicator.tsx";

export function task(
  id: string | undefined,
  description: string,
  blockedBy: string[] = [],
  status: TaskItem["status"] = "pending",
): TaskItem {
  return {
    id,
    description,
    status,
    blockedBy,
  };
}
