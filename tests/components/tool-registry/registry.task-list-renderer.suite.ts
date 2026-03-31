import { describe, expect, test } from "bun:test";
import {
  STATUS,
  getToolRenderer,
  taskListToolRenderer,
  type ToolRenderProps,
} from "./registry.test-support.ts";

describe("taskListToolRenderer", () => {
  test("icon is the checked checkbox", () => {
    expect(taskListToolRenderer.icon).toBe("✓");
  });

  describe("getTitle()", () => {
    test("create_tasks shows task count", () => {
      const props: ToolRenderProps = {
        input: {
          action: "create_tasks",
          tasks: [
            { id: "1", description: "Task A", status: "pending", summary: "A" },
            { id: "2", description: "Task B", status: "pending", summary: "B" },
            { id: "3", description: "Task C", status: "pending", summary: "C" },
          ],
        },
      };
      expect(taskListToolRenderer.getTitle(props)).toBe("Creating 3 tasks");
    });

    test("list_tasks returns static title", () => {
      const props: ToolRenderProps = {
        input: { action: "list_tasks" },
      };
      expect(taskListToolRenderer.getTitle(props)).toBe("Listing tasks");
    });

    test("update_task_status shows task ID and status", () => {
      const props: ToolRenderProps = {
        input: { action: "update_task_status", taskId: "42", status: "completed" },
      };
      expect(taskListToolRenderer.getTitle(props)).toBe("Task 42 → completed");
    });

    test("update_task_status with missing fields uses fallback", () => {
      const props: ToolRenderProps = {
        input: { action: "update_task_status" },
      };
      expect(taskListToolRenderer.getTitle(props)).toBe("Task ? → ?");
    });

    test("add_task shows task description", () => {
      const props: ToolRenderProps = {
        input: {
          action: "add_task",
          task: { id: "5", description: "New feature", status: "pending", summary: "feat" },
        },
      };
      expect(taskListToolRenderer.getTitle(props)).toBe("Adding task: New feature");
    });

    test("add_task with missing task falls back to unknown", () => {
      const props: ToolRenderProps = {
        input: { action: "add_task" },
      };
      expect(taskListToolRenderer.getTitle(props)).toBe("Adding task: unknown");
    });

    test("update_task_progress shows task ID", () => {
      const props: ToolRenderProps = {
        input: { action: "update_task_progress", taskId: "7" },
      };
      expect(taskListToolRenderer.getTitle(props)).toBe("Progress update for task 7");
    });

    test("update_task_progress with missing taskId uses fallback", () => {
      const props: ToolRenderProps = {
        input: { action: "update_task_progress" },
      };
      expect(taskListToolRenderer.getTitle(props)).toBe("Progress update for task ?");
    });

    test("get_task_progress with taskId shows it", () => {
      const props: ToolRenderProps = {
        input: { action: "get_task_progress", taskId: "3" },
      };
      expect(taskListToolRenderer.getTitle(props)).toBe("Reading progress for task 3");
    });

    test("get_task_progress without taskId shows generic title", () => {
      const props: ToolRenderProps = {
        input: { action: "get_task_progress" },
      };
      expect(taskListToolRenderer.getTitle(props)).toBe("Reading progress");
    });

    test("delete_task shows task ID", () => {
      const props: ToolRenderProps = {
        input: { action: "delete_task", taskId: "9" },
      };
      expect(taskListToolRenderer.getTitle(props)).toBe("Deleting task 9");
    });

    test("delete_task with missing taskId uses fallback", () => {
      const props: ToolRenderProps = {
        input: { action: "delete_task" },
      };
      expect(taskListToolRenderer.getTitle(props)).toBe("Deleting task ?");
    });

    test("unknown action shows action name", () => {
      const props: ToolRenderProps = {
        input: { action: "unknown_action" },
      };
      expect(taskListToolRenderer.getTitle(props)).toBe("task_list: unknown_action");
    });

    test("missing action field defaults to 'unknown'", () => {
      const props: ToolRenderProps = {
        input: {},
      };
      expect(taskListToolRenderer.getTitle(props)).toBe("task_list: unknown");
    });
  });

  describe("render()", () => {
    test("create_tasks renders tasks with status icons", () => {
      const props: ToolRenderProps = {
        input: {
          action: "create_tasks",
          tasks: [
            { id: "1", description: "Completed task", status: "completed" },
            { id: "2", description: "In progress task", status: "in_progress" },
            { id: "3", description: "Pending task", status: "pending" },
            { id: "4", description: "Error task", status: "error" },
          ],
        },
      };
      const result = taskListToolRenderer.render(props);
      expect(result.title).toBe("Creating 4 tasks");
      expect(result.expandable).toBe(false);
      expect(result.content).toHaveLength(4);
      expect(result.content[0]).toBe(`${STATUS.success} Completed task`);
      expect(result.content[1]).toBe(`${STATUS.selected} In progress task`);
      expect(result.content[2]).toBe(`${STATUS.pending} Pending task`);
      expect(result.content[3]).toBe(`${STATUS.error} Error task`);
    });

    test("create_tasks falls back to summary when description is missing", () => {
      const props: ToolRenderProps = {
        input: {
          action: "create_tasks",
          tasks: [
            { id: "1", summary: "Summary text", status: "pending" },
          ],
        },
      };
      const result = taskListToolRenderer.render(props);
      expect(result.content[0]).toBe(`${STATUS.pending} Summary text`);
    });

    test("create_tasks with empty tasks array returns empty content", () => {
      const props: ToolRenderProps = {
        input: { action: "create_tasks", tasks: [] },
      };
      const result = taskListToolRenderer.render(props);
      expect(result.title).toBe("Creating 0 tasks");
      expect(result.content).toHaveLength(0);
    });

    test("create_tasks with missing tasks field returns empty content", () => {
      const props: ToolRenderProps = {
        input: { action: "create_tasks" },
      };
      const result = taskListToolRenderer.render(props);
      expect(result.title).toBe("Creating 0 tasks");
      expect(result.content).toHaveLength(0);
    });

    test("add_task renders single task with status icon", () => {
      const props: ToolRenderProps = {
        input: {
          action: "add_task",
          task: { id: "10", description: "New task", status: "pending", summary: "new" },
        },
      };
      const result = taskListToolRenderer.render(props);
      expect(result.title).toBe("Adding task: New task");
      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toBe(`${STATUS.pending} New task`);
      expect(result.expandable).toBe(false);
    });

    test("add_task with missing task returns empty content", () => {
      const props: ToolRenderProps = {
        input: { action: "add_task" },
      };
      const result = taskListToolRenderer.render(props);
      expect(result.content).toHaveLength(0);
    });

    test("update_task_status renders with correct status icon", () => {
      const completedProps: ToolRenderProps = {
        input: { action: "update_task_status", taskId: "1", status: "completed" },
      };
      const completedResult = taskListToolRenderer.render(completedProps);
      expect(completedResult.content).toHaveLength(1);
      expect(completedResult.content[0]).toBe(`${STATUS.success} Task 1 → completed`);
      expect(completedResult.expandable).toBe(false);

      const inProgressProps: ToolRenderProps = {
        input: { action: "update_task_status", taskId: "2", status: "in_progress" },
      };
      const inProgressResult = taskListToolRenderer.render(inProgressProps);
      expect(inProgressResult.content[0]).toBe(`${STATUS.selected} Task 2 → in_progress`);

      const errorProps: ToolRenderProps = {
        input: { action: "update_task_status", taskId: "3", status: "error" },
      };
      const errorResult = taskListToolRenderer.render(errorProps);
      expect(errorResult.content[0]).toBe(`${STATUS.error} Task 3 → error`);

      const pendingProps: ToolRenderProps = {
        input: { action: "update_task_status", taskId: "4", status: "pending" },
      };
      const pendingResult = taskListToolRenderer.render(pendingProps);
      expect(pendingResult.content[0]).toBe(`${STATUS.pending} Task 4 → pending`);
    });

    test("list_tasks returns empty content", () => {
      const props: ToolRenderProps = {
        input: { action: "list_tasks" },
      };
      const result = taskListToolRenderer.render(props);
      expect(result.title).toBe("Listing tasks");
      expect(result.content).toHaveLength(0);
      expect(result.expandable).toBe(false);
    });

    test("update_task_progress returns empty content", () => {
      const props: ToolRenderProps = {
        input: { action: "update_task_progress", taskId: "5", progress: "50% done" },
      };
      const result = taskListToolRenderer.render(props);
      expect(result.title).toBe("Progress update for task 5");
      expect(result.content).toHaveLength(0);
      expect(result.expandable).toBe(false);
    });

    test("get_task_progress returns empty content", () => {
      const props: ToolRenderProps = {
        input: { action: "get_task_progress", taskId: "5" },
      };
      const result = taskListToolRenderer.render(props);
      expect(result.title).toBe("Reading progress for task 5");
      expect(result.content).toHaveLength(0);
    });

    test("delete_task returns empty content", () => {
      const props: ToolRenderProps = {
        input: { action: "delete_task", taskId: "8" },
      };
      const result = taskListToolRenderer.render(props);
      expect(result.title).toBe("Deleting task 8");
      expect(result.content).toHaveLength(0);
    });

    test("unknown action returns empty content", () => {
      const props: ToolRenderProps = {
        input: { action: "something_else" },
      };
      const result = taskListToolRenderer.render(props);
      expect(result.title).toBe("task_list: something_else");
      expect(result.content).toHaveLength(0);
    });

    test("task with undefined status defaults to pending icon", () => {
      const props: ToolRenderProps = {
        input: {
          action: "create_tasks",
          tasks: [{ id: "1", description: "No status task" }],
        },
      };
      const result = taskListToolRenderer.render(props);
      expect(result.content[0]).toBe(`${STATUS.pending} No status task`);
    });
  });

  describe("alias registration", () => {
    test("task_list resolves to taskListToolRenderer", () => {
      expect(getToolRenderer("task_list")).toBe(taskListToolRenderer);
    });
  });
});
