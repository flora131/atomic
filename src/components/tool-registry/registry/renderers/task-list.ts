import { CHECKBOX, STATUS } from "@/theme/icons.ts";
import type {
  ToolRenderProps,
  ToolRenderResult,
  ToolRenderer,
} from "@/components/tool-registry/registry/types.ts";

interface TaskListItem {
  id?: string;
  description?: string;
  status?: string;
  summary?: string;
}

function getAction(props: ToolRenderProps): string {
  return (props.input.action as string) ?? "unknown";
}

function getTasks(props: ToolRenderProps): TaskListItem[] {
  const action = getAction(props);
  if (action === "create_tasks") {
    const tasks = props.input.tasks;
    return Array.isArray(tasks) ? tasks : [];
  }
  if (action === "add_task") {
    const task = props.input.task;
    return task && typeof task === "object" ? [task as TaskListItem] : [];
  }
  return [];
}

function getTaskListTitle(props: ToolRenderProps): string {
  const action = getAction(props);
  switch (action) {
    case "create_tasks": {
      const tasks = getTasks(props);
      return `Creating ${tasks.length} tasks`;
    }
    case "list_tasks":
      return "Listing tasks";
    case "update_task_status": {
      const taskId = (props.input.taskId as string) ?? "?";
      const status = (props.input.status as string) ?? "?";
      return `Task ${taskId} → ${status}`;
    }
    case "add_task": {
      const task = props.input.task as TaskListItem | undefined;
      return `Adding task: ${task?.description ?? "unknown"}`;
    }
    case "update_task_progress":
      return `Progress update for task ${(props.input.taskId as string) ?? "?"}`;
    case "get_task_progress":
      return `Reading progress${props.input.taskId ? ` for task ${props.input.taskId}` : ""}`;
    case "delete_task":
      return `Deleting task ${(props.input.taskId as string) ?? "?"}`;
    default:
      return `task_list: ${action}`;
  }
}

function statusIcon(status: string | undefined): string {
  switch (status) {
    case "completed":
      return STATUS.success;
    case "in_progress":
      return STATUS.selected;
    case "error":
      return STATUS.error;
    default:
      return STATUS.pending;
  }
}

export const taskListToolRenderer: ToolRenderer = {
  icon: CHECKBOX.checked,

  getTitle(props: ToolRenderProps): string {
    return getTaskListTitle(props);
  },

  render(props: ToolRenderProps): ToolRenderResult {
    const action = getAction(props);
    const tasks = getTasks(props);

    if (
      (action === "create_tasks" || action === "add_task") &&
      tasks.length > 0
    ) {
      const content = tasks.map((task) => {
        const prefix = `${statusIcon(task.status)} `;
        return prefix + (task.description ?? task.summary ?? "");
      });
      return {
        title: getTaskListTitle(props),
        content,
        expandable: false,
      };
    }

    if (action === "update_task_status") {
      const taskId = (props.input.taskId as string) ?? "?";
      const status = (props.input.status as string) ?? "?";
      return {
        title: getTaskListTitle(props),
        content: [`${statusIcon(status)} Task ${taskId} → ${status}`],
        expandable: false,
      };
    }

    return {
      title: getTaskListTitle(props),
      content: [],
      expandable: false,
    };
  },
};
