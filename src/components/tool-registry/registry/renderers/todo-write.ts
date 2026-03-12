import { CHECKBOX, STATUS } from "@/theme/icons.ts";
import type { ToolRenderProps, ToolRenderResult, ToolRenderer } from "@/components/tool-registry/registry/types.ts";

interface TodoWriteItem {
  description?: string;
  content?: string;
  status: string;
}

function getTodos(props: ToolRenderProps): TodoWriteItem[] {
  return (props.input.todos as TodoWriteItem[] | undefined) ?? [];
}

function getTodoWriteTitle(props: ToolRenderProps): string {
  const todos = getTodos(props);
  const done = todos.filter((todo) => todo.status === "completed").length;
  const open = todos.length - done;
  return `${todos.length} tasks (${done} done, ${open} open)`;
}

export const todoWriteToolRenderer: ToolRenderer = {
  icon: CHECKBOX.checked,

  getTitle(props: ToolRenderProps): string {
    return getTodoWriteTitle(props);
  },

  render(props: ToolRenderProps): ToolRenderResult {
    const content = getTodos(props).map((todo) => {
      const prefix = todo.status === "completed"
        ? `${STATUS.success} `
        : todo.status === "in_progress"
          ? `${STATUS.selected} `
          : `${STATUS.pending} `;
      return prefix + (todo.description ?? todo.content ?? "");
    });

    return {
      title: getTodoWriteTitle(props),
      content,
      expandable: false,
    };
  },
};
