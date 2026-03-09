import type { TaskItem } from "@/components/task-list-indicator.tsx";

export function task(
  id: string | undefined,
  content: string,
  blockedBy: string[] = [],
  status: TaskItem["status"] = "pending",
): TaskItem {
  return {
    id,
    content,
    status,
    blockedBy,
  };
}
