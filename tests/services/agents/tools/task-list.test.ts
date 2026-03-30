/**
 * Tests for src/services/agents/tools/task-list.ts
 *
 * TaskList tool definition:
 * - createTaskListTool() factory
 * - CRUD operations: create_tasks, list_tasks, update_task_status, add_task,
 *   update_task_progress, get_task_progress, delete_task
 * - SQLite persistence (real database in temp directory)
 * - Event emission via emitTaskUpdate callback
 * - Error handling for unknown actions, missing tasks
 * - Input schema structure
 */

import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  createTaskListTool,
  type TaskItem,
  type TaskListToolConfig,
} from "@/services/agents/tools/task-list.ts";
import type { ToolDefinition } from "@/services/agents/types.ts";

const mockContext = {
  sessionID: "test",
  messageID: "msg-1",
  agent: "test-agent",
  directory: "/tmp",
  abort: new AbortController().signal,
};

/** Helper to create a tool with a fresh temp directory and optional emitTaskUpdate */
function createTestTool(
  emitTaskUpdate?: (tasks: TaskItem[]) => void
): { tool: ToolDefinition; sessionDir: string } {
  const sessionDir = mkdtempSync(join(tmpdir(), "task-list-test-"));
  const config: TaskListToolConfig = {
    workflowName: "test-workflow",
    sessionId: "test-session",
    sessionDir,
    emitTaskUpdate,
  };
  return { tool: createTaskListTool(config), sessionDir };
}

/** Invoke the tool handler with a given input */
function invoke(
  tool: ToolDefinition,
  input: Record<string, unknown>
): Record<string, unknown> {
  return tool.handler(input, mockContext) as Record<string, unknown>;
}

// --- Factory structure ---

describe("createTaskListTool - structure", () => {
  let sessionDir: string;

  afterEach(() => {
    if (sessionDir) {
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  test("returns a tool with name 'task_list'", () => {
    const result = createTestTool();
    sessionDir = result.sessionDir;
    expect(result.tool.name).toBe("task_list");
  });

  test("has a non-empty description string", () => {
    const result = createTestTool();
    sessionDir = result.sessionDir;
    expect(typeof result.tool.description).toBe("string");
    expect(result.tool.description.length).toBeGreaterThan(0);
  });

  test("inputSchema requires 'action' field", () => {
    const result = createTestTool();
    sessionDir = result.sessionDir;
    const schema = result.tool.inputSchema as Record<string, unknown>;
    expect(schema.type).toBe("object");
    expect(schema.required).toEqual(["action"]);
  });

  test("inputSchema defines action enum with all 9 operations", () => {
    const result = createTestTool();
    sessionDir = result.sessionDir;
    const schema = result.tool.inputSchema as Record<string, unknown>;
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    const actionSchema = properties.action!;

    expect(actionSchema.type).toBe("string");
    expect(actionSchema.enum).toEqual([
      "create_tasks",
      "list_tasks",
      "update_task_status",
      "add_task",
      "update_task_blockedBy",
      "update_task_progress",
      "get_task_progress",
      "delete_task",
      "clear_progress",
    ]);
  });

  test("inputSchema defines tasks array with required fields", () => {
    const result = createTestTool();
    sessionDir = result.sessionDir;
    const schema = result.tool.inputSchema as Record<string, unknown>;
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    const tasksSchema = properties.tasks as Record<string, unknown>;

    expect(tasksSchema.type).toBe("array");
    const items = tasksSchema.items as Record<string, unknown>;
    expect(items.type).toBe("object");
    expect(items.required).toEqual(["id", "description", "status", "summary"]);
  });

  test("each createTaskListTool() call creates independent state", () => {
    const result1 = createTestTool();
    const result2 = createTestTool();
    sessionDir = result1.sessionDir;
    const sessionDir2 = result2.sessionDir;

    // Create task in tool1
    invoke(result1.tool, {
      action: "add_task",
      task: { id: "1", description: "Task 1", status: "pending", summary: "First" },
    });

    // tool2 should have empty state
    const listResult = invoke(result2.tool, { action: "list_tasks" });
    const tasks = listResult.tasks as TaskItem[];
    expect(tasks).toHaveLength(0);

    rmSync(sessionDir2, { recursive: true, force: true });
  });
});

// --- create_tasks ---

describe("createTaskListTool - create_tasks", () => {
  let sessionDir: string;

  afterEach(() => {
    if (sessionDir) {
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  test("creates multiple tasks and returns them", () => {
    const result = createTestTool();
    sessionDir = result.sessionDir;

    const tasks: TaskItem[] = [
      { id: "1", description: "Setup project", status: "pending", summary: "Setting up" },
      { id: "2", description: "Implement feature", status: "pending", summary: "Implementing" },
    ];

    const response = invoke(result.tool, { action: "create_tasks", tasks });

    expect(response.created).toBe(2);
    const returnedTasks = response.tasks as TaskItem[];
    expect(returnedTasks).toHaveLength(2);
    expect(returnedTasks[0]!.id).toBe("1");
    expect(returnedTasks[1]!.id).toBe("2");
  });

  test("persists tasks to database (survives list_tasks call)", () => {
    const result = createTestTool();
    sessionDir = result.sessionDir;

    const tasks: TaskItem[] = [
      { id: "t1", description: "Task A", status: "in_progress", summary: "Working on A" },
    ];

    invoke(result.tool, { action: "create_tasks", tasks });

    const listResult = invoke(result.tool, { action: "list_tasks" });
    const listed = listResult.tasks as TaskItem[];
    expect(listed).toHaveLength(1);
    expect(listed[0]!.description).toBe("Task A");
    expect(listed[0]!.status).toBe("in_progress");
  });

  test("preserves blockedBy when provided", () => {
    const result = createTestTool();
    sessionDir = result.sessionDir;

    const tasks: TaskItem[] = [
      { id: "1", description: "First", status: "pending", summary: "First task" },
      {
        id: "2",
        description: "Second",
        status: "pending",
        summary: "Second task",
        blockedBy: ["1"],
      },
    ];

    invoke(result.tool, { action: "create_tasks", tasks });

    const listResult = invoke(result.tool, { action: "list_tasks" });
    const listed = listResult.tasks as TaskItem[];
    expect(listed[1]!.blockedBy).toEqual(["1"]);
  });

  test("handles idempotent re-creation via INSERT OR REPLACE", () => {
    const result = createTestTool();
    sessionDir = result.sessionDir;

    const tasks: TaskItem[] = [
      { id: "1", description: "Original", status: "pending", summary: "First" },
    ];
    invoke(result.tool, { action: "create_tasks", tasks });

    // Re-create with updated description
    const updatedTasks: TaskItem[] = [
      { id: "1", description: "Updated", status: "in_progress", summary: "Updated" },
    ];
    invoke(result.tool, { action: "create_tasks", tasks: updatedTasks });

    const listResult = invoke(result.tool, { action: "list_tasks" });
    const listed = listResult.tasks as TaskItem[];
    expect(listed).toHaveLength(1);
    expect(listed[0]!.description).toBe("Updated");
    expect(listed[0]!.status).toBe("in_progress");
  });

  test("emits task update event on create", () => {
    const emitted: TaskItem[][] = [];
    const result = createTestTool((tasks) => emitted.push(tasks));
    sessionDir = result.sessionDir;

    const tasks: TaskItem[] = [
      { id: "1", description: "Task", status: "pending", summary: "Doing" },
    ];
    invoke(result.tool, { action: "create_tasks", tasks });

    expect(emitted).toHaveLength(1);
    expect(emitted[0]!).toHaveLength(1);
    expect(emitted[0]![0]!.id).toBe("1");
  });
});

// --- list_tasks ---

describe("createTaskListTool - list_tasks", () => {
  let sessionDir: string;

  afterEach(() => {
    if (sessionDir) {
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  test("returns empty list when no tasks exist", () => {
    const result = createTestTool();
    sessionDir = result.sessionDir;

    const response = invoke(result.tool, { action: "list_tasks" });
    expect(response.tasks).toEqual([]);
    expect(response.statusSummary).toBe("0 tasks: 0 done, 0 in progress, 0 pending, 0 error");
  });

  test("returns correct status summary for mixed statuses", () => {
    const result = createTestTool();
    sessionDir = result.sessionDir;

    const tasks: TaskItem[] = [
      { id: "1", description: "A", status: "completed", summary: "Done" },
      { id: "2", description: "B", status: "in_progress", summary: "Working" },
      { id: "3", description: "C", status: "pending", summary: "Waiting" },
      { id: "4", description: "D", status: "error", summary: "Failed" },
      { id: "5", description: "E", status: "pending", summary: "Waiting" },
    ];
    invoke(result.tool, { action: "create_tasks", tasks });

    const response = invoke(result.tool, { action: "list_tasks" });
    expect(response.statusSummary).toBe(
      "5 tasks: 1 done, 1 in progress, 2 pending, 1 error"
    );
  });

  test("does not emit task update event (read-only)", () => {
    const emitted: TaskItem[][] = [];
    const result = createTestTool((tasks) => emitted.push(tasks));
    sessionDir = result.sessionDir;

    invoke(result.tool, { action: "list_tasks" });
    // list_tasks should not emit (it's read-only)
    expect(emitted).toHaveLength(0);
  });
});

// --- update_task_status ---

describe("createTaskListTool - update_task_status", () => {
  let sessionDir: string;

  afterEach(() => {
    if (sessionDir) {
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  test("updates status and returns old and new status", () => {
    const result = createTestTool();
    sessionDir = result.sessionDir;

    invoke(result.tool, {
      action: "create_tasks",
      tasks: [{ id: "1", description: "Task", status: "pending", summary: "Doing" }],
    });

    const response = invoke(result.tool, {
      action: "update_task_status",
      taskId: "1",
      status: "in_progress",
    });

    expect(response.taskId).toBe("1");
    expect(response.oldStatus).toBe("pending");
    expect(response.newStatus).toBe("in_progress");
  });

  test("returns error for non-existent task", () => {
    const result = createTestTool();
    sessionDir = result.sessionDir;

    const response = invoke(result.tool, {
      action: "update_task_status",
      taskId: "nonexistent",
      status: "completed",
    });

    expect(response.error).toBe("Task not found: nonexistent");
  });

  test("persists status change", () => {
    const result = createTestTool();
    sessionDir = result.sessionDir;

    invoke(result.tool, {
      action: "create_tasks",
      tasks: [{ id: "1", description: "Task", status: "pending", summary: "Doing" }],
    });

    invoke(result.tool, {
      action: "update_task_status",
      taskId: "1",
      status: "completed",
    });

    const listResult = invoke(result.tool, { action: "list_tasks" });
    const tasks = listResult.tasks as TaskItem[];
    expect(tasks[0]!.status).toBe("completed");
  });

  test("emits task update event on status change", () => {
    const emitted: TaskItem[][] = [];
    const result = createTestTool((tasks) => emitted.push(tasks));
    sessionDir = result.sessionDir;

    invoke(result.tool, {
      action: "create_tasks",
      tasks: [{ id: "1", description: "Task", status: "pending", summary: "Doing" }],
    });
    emitted.length = 0; // Reset from create_tasks emission

    invoke(result.tool, {
      action: "update_task_status",
      taskId: "1",
      status: "in_progress",
    });

    expect(emitted).toHaveLength(1);
    expect(emitted[0]![0]!.status).toBe("in_progress");
  });

  test("includes statusSummary in response", () => {
    const result = createTestTool();
    sessionDir = result.sessionDir;

    invoke(result.tool, {
      action: "create_tasks",
      tasks: [
        { id: "1", description: "A", status: "pending", summary: "Doing A" },
        { id: "2", description: "B", status: "pending", summary: "Doing B" },
      ],
    });

    const response = invoke(result.tool, {
      action: "update_task_status",
      taskId: "1",
      status: "completed",
    });

    expect(response.statusSummary).toBe("2 tasks: 1 done, 0 in progress, 1 pending, 0 error");
  });
});

// --- add_task ---

describe("createTaskListTool - add_task", () => {
  let sessionDir: string;

  afterEach(() => {
    if (sessionDir) {
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  test("adds a single task and returns it with total count", () => {
    const result = createTestTool();
    sessionDir = result.sessionDir;

    const task: TaskItem = {
      id: "new-1",
      description: "New task",
      status: "pending",
      summary: "Adding new task",
    };

    const response = invoke(result.tool, { action: "add_task", task });
    expect(response.added).toEqual(task);
    expect(response.total).toBe(1);
  });

  test("adds task with blockedBy", () => {
    const result = createTestTool();
    sessionDir = result.sessionDir;

    invoke(result.tool, {
      action: "create_tasks",
      tasks: [{ id: "1", description: "First", status: "pending", summary: "First" }],
    });

    const task: TaskItem = {
      id: "2",
      description: "Second",
      status: "pending",
      summary: "Second",
      blockedBy: ["1"],
    };

    const response = invoke(result.tool, { action: "add_task", task });
    expect(response.total).toBe(2);

    const listResult = invoke(result.tool, { action: "list_tasks" });
    const tasks = listResult.tasks as TaskItem[];
    const addedTask = tasks.find((t) => t.id === "2");
    expect(addedTask!.blockedBy).toEqual(["1"]);
  });

  test("emits task update event on add", () => {
    const emitted: TaskItem[][] = [];
    const result = createTestTool((tasks) => emitted.push(tasks));
    sessionDir = result.sessionDir;

    invoke(result.tool, {
      action: "add_task",
      task: { id: "1", description: "Task", status: "pending", summary: "Doing" },
    });

    expect(emitted).toHaveLength(1);
    expect(emitted[0]!).toHaveLength(1);
  });
});

// --- update_task_progress ---

describe("createTaskListTool - update_task_progress", () => {
  let sessionDir: string;

  afterEach(() => {
    if (sessionDir) {
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  test("appends progress entry and returns confirmation", () => {
    const result = createTestTool();
    sessionDir = result.sessionDir;

    invoke(result.tool, {
      action: "create_tasks",
      tasks: [{ id: "1", description: "Task", status: "in_progress", summary: "Working" }],
    });

    const response = invoke(result.tool, {
      action: "update_task_progress",
      taskId: "1",
      progress: "Completed step 1 of 3",
    });

    expect(response.taskId).toBe("1");
    expect(response.appended).toBe(true);
  });

  test("emits task update events on progress mutation", () => {
    const emitted: TaskItem[][] = [];
    const result = createTestTool((tasks) => emitted.push(tasks));
    sessionDir = result.sessionDir;

    invoke(result.tool, {
      action: "create_tasks",
      tasks: [{ id: "1", description: "Task", status: "in_progress", summary: "Working" }],
    });
    const emitCountAfterCreate = emitted.length;

    invoke(result.tool, {
      action: "update_task_progress",
      taskId: "1",
      progress: "Made progress",
    });

    expect(emitted.length).toBe(emitCountAfterCreate + 1);
    expect(emitted[emitted.length - 1]![0]!.id).toBe("1");
  });

  test("returns tasks in response after progress update", () => {
    const result = createTestTool();
    sessionDir = result.sessionDir;

    invoke(result.tool, {
      action: "create_tasks",
      tasks: [{ id: "1", description: "Task", status: "in_progress", summary: "Working" }],
    });

    const response = invoke(result.tool, {
      action: "update_task_progress",
      taskId: "1",
      progress: "Step done",
    });

    expect(response.tasks).toBeDefined();
    const tasks = response.tasks as TaskItem[];
    expect(tasks.length).toBe(1);
    expect(tasks[0]!.id).toBe("1");
  });

  test("progress entries are retrievable via get_task_progress", () => {
    const result = createTestTool();
    sessionDir = result.sessionDir;

    invoke(result.tool, {
      action: "create_tasks",
      tasks: [{ id: "1", description: "Task", status: "in_progress", summary: "Working" }],
    });

    invoke(result.tool, {
      action: "update_task_progress",
      taskId: "1",
      progress: "Step 1 done",
    });
    invoke(result.tool, {
      action: "update_task_progress",
      taskId: "1",
      progress: "Step 2 done",
    });

    const response = invoke(result.tool, {
      action: "get_task_progress",
      taskId: "1",
    });

    const progress = response.progress as string;
    expect(progress).toContain("Step 1 done");
    expect(progress).toContain("Step 2 done");
  });
});

// --- get_task_progress ---

describe("createTaskListTool - get_task_progress", () => {
  let sessionDir: string;

  afterEach(() => {
    if (sessionDir) {
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  test("returns empty string when no progress exists for a task", () => {
    const result = createTestTool();
    sessionDir = result.sessionDir;

    invoke(result.tool, {
      action: "create_tasks",
      tasks: [{ id: "1", description: "Task", status: "pending", summary: "Doing" }],
    });

    const response = invoke(result.tool, {
      action: "get_task_progress",
      taskId: "1",
    });

    expect(response.progress).toBe("");
  });

  test("returns error for non-existent task", () => {
    const result = createTestTool();
    sessionDir = result.sessionDir;

    const response = invoke(result.tool, {
      action: "get_task_progress",
      taskId: "ghost",
    });

    expect(response.error).toBe("Task not found: ghost");
  });

  test("returns all progress when no taskId provided", () => {
    const result = createTestTool();
    sessionDir = result.sessionDir;

    invoke(result.tool, {
      action: "create_tasks",
      tasks: [
        { id: "1", description: "Task A", status: "in_progress", summary: "A" },
        { id: "2", description: "Task B", status: "in_progress", summary: "B" },
      ],
    });

    invoke(result.tool, {
      action: "update_task_progress",
      taskId: "1",
      progress: "Progress on A",
    });
    invoke(result.tool, {
      action: "update_task_progress",
      taskId: "2",
      progress: "Progress on B",
    });

    const response = invoke(result.tool, { action: "get_task_progress" });

    const progress = response.progress as string;
    expect(progress).toContain("Progress on A");
    expect(progress).toContain("Progress on B");
    expect(progress).toContain("[1]");
    expect(progress).toContain("[2]");
  });

  test("progress entries include timestamps", () => {
    const result = createTestTool();
    sessionDir = result.sessionDir;

    invoke(result.tool, {
      action: "create_tasks",
      tasks: [{ id: "1", description: "Task", status: "in_progress", summary: "Working" }],
    });

    invoke(result.tool, {
      action: "update_task_progress",
      taskId: "1",
      progress: "Did something",
    });

    const response = invoke(result.tool, {
      action: "get_task_progress",
      taskId: "1",
    });

    const progress = response.progress as string;
    // Timestamps are in the format [YYYY-MM-DD HH:MM:SS]
    expect(progress).toMatch(/\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]/);
    expect(progress).toContain("Did something");
  });
});

// --- delete_task ---

describe("createTaskListTool - delete_task", () => {
  let sessionDir: string;

  afterEach(() => {
    if (sessionDir) {
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  test("deletes a task and returns remaining count", () => {
    const result = createTestTool();
    sessionDir = result.sessionDir;

    invoke(result.tool, {
      action: "create_tasks",
      tasks: [
        { id: "1", description: "A", status: "pending", summary: "A" },
        { id: "2", description: "B", status: "pending", summary: "B" },
      ],
    });

    const response = invoke(result.tool, {
      action: "delete_task",
      taskId: "1",
    });

    expect(response.deleted).toBe("1");
    expect(response.remaining).toBe(1);
  });

  test("returns error for non-existent task", () => {
    const result = createTestTool();
    sessionDir = result.sessionDir;

    const response = invoke(result.tool, {
      action: "delete_task",
      taskId: "nonexistent",
    });

    expect(response.error).toBe("Task not found: nonexistent");
  });

  test("task is actually removed from database", () => {
    const result = createTestTool();
    sessionDir = result.sessionDir;

    invoke(result.tool, {
      action: "create_tasks",
      tasks: [{ id: "1", description: "Task", status: "pending", summary: "Doing" }],
    });

    invoke(result.tool, { action: "delete_task", taskId: "1" });

    const listResult = invoke(result.tool, { action: "list_tasks" });
    const tasks = listResult.tasks as TaskItem[];
    expect(tasks).toHaveLength(0);
  });

  test("emits task update event on delete", () => {
    const emitted: TaskItem[][] = [];
    const result = createTestTool((tasks) => emitted.push(tasks));
    sessionDir = result.sessionDir;

    invoke(result.tool, {
      action: "create_tasks",
      tasks: [{ id: "1", description: "Task", status: "pending", summary: "Doing" }],
    });
    emitted.length = 0;

    invoke(result.tool, { action: "delete_task", taskId: "1" });

    expect(emitted).toHaveLength(1);
    expect(emitted[0]!).toHaveLength(0);
  });
});

// --- Error handling ---

describe("createTaskListTool - error handling", () => {
  let sessionDir: string;

  afterEach(() => {
    if (sessionDir) {
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  test("returns error for unknown action", () => {
    const result = createTestTool();
    sessionDir = result.sessionDir;

    const response = invoke(result.tool, { action: "invalid_action" });
    expect(response.error).toBe("Unknown action: invalid_action");
  });

  test("emitTaskUpdate errors do not fail the tool call", () => {
    const result = createTestTool(() => {
      throw new Error("UI explosion");
    });
    sessionDir = result.sessionDir;

    // Should not throw despite emitTaskUpdate throwing
    const response = invoke(result.tool, {
      action: "create_tasks",
      tasks: [{ id: "1", description: "Task", status: "pending", summary: "Doing" }],
    });

    expect(response.created).toBe(1);
  });

  test("update_task_status returns error for missing task", () => {
    const result = createTestTool();
    sessionDir = result.sessionDir;

    const response = invoke(result.tool, {
      action: "update_task_status",
      taskId: "ghost",
      status: "completed",
    });

    expect(response.error).toBe("Task not found: ghost");
  });

  test("delete_task returns error for missing task", () => {
    const result = createTestTool();
    sessionDir = result.sessionDir;

    const response = invoke(result.tool, {
      action: "delete_task",
      taskId: "ghost",
    });

    expect(response.error).toBe("Task not found: ghost");
  });
});

// --- blockedBy serialization ---

describe("createTaskListTool - blockedBy serialization", () => {
  let sessionDir: string;

  afterEach(() => {
    if (sessionDir) {
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  test("defaults to empty array when blockedBy is not provided", () => {
    const result = createTestTool();
    sessionDir = result.sessionDir;

    invoke(result.tool, {
      action: "add_task",
      task: { id: "1", description: "Task", status: "pending", summary: "Doing" },
    });

    const listResult = invoke(result.tool, { action: "list_tasks" });
    const tasks = listResult.tasks as TaskItem[];
    expect(tasks[0]!.blockedBy).toEqual([]);
  });

  test("round-trips multiple blockedBy IDs", () => {
    const result = createTestTool();
    sessionDir = result.sessionDir;

    invoke(result.tool, {
      action: "create_tasks",
      tasks: [
        { id: "1", description: "A", status: "pending", summary: "A" },
        { id: "2", description: "B", status: "pending", summary: "B" },
        {
          id: "3",
          description: "C",
          status: "pending",
          summary: "C",
          blockedBy: ["1", "2"],
        },
      ],
    });

    const listResult = invoke(result.tool, { action: "list_tasks" });
    const tasks = listResult.tasks as TaskItem[];
    const task3 = tasks.find((t) => t.id === "3");
    expect(task3!.blockedBy).toEqual(["1", "2"]);
  });
});

// --- Database file creation ---

describe("createTaskListTool - database file", () => {
  let sessionDir: string;

  afterEach(() => {
    if (sessionDir) {
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  test("creates workflow.db file in sessionDir", () => {
    const result = createTestTool();
    sessionDir = result.sessionDir;

    const dbPath = join(sessionDir, "workflow.db");
    const file = Bun.file(dbPath);
    expect(file.size).toBeGreaterThan(0);
  });
});

// --- double-close safety ---

describe("createTaskListTool - double close", () => {
  let sessionDir: string;

  afterEach(() => {
    if (sessionDir) {
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  test("calling close() twice does not throw", () => {
    const result = createTestTool();
    sessionDir = result.sessionDir;
    const tool = result.tool as ReturnType<typeof createTaskListTool>;

    expect(() => {
      tool.close();
      tool.close();
    }).not.toThrow();
  });

  test("operations after close() return an error", () => {
    const result = createTestTool();
    sessionDir = result.sessionDir;
    const tool = result.tool as ReturnType<typeof createTaskListTool>;

    tool.close();
    const response = invoke(tool, { action: "list_tasks" });
    expect(response.error).toBe("task_list tool has been closed");
  });
});

// --- update_task_blockedBy ---

describe("createTaskListTool - update_task_blockedBy", () => {
  let sessionDir: string;

  afterEach(() => {
    if (sessionDir) {
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  test("updates blockedBy for an existing task", () => {
    const result = createTestTool();
    sessionDir = result.sessionDir;

    invoke(result.tool, {
      action: "create_tasks",
      tasks: [
        { id: "a", description: "A", status: "pending", summary: "A" },
        { id: "b", description: "B", status: "pending", summary: "B" },
        { id: "c", description: "C", status: "pending", summary: "C" },
      ],
    });

    const response = invoke(result.tool, {
      action: "update_task_blockedBy",
      taskId: "c",
      blockedBy: ["a", "b"],
    });

    expect(response.error).toBeUndefined();
    expect(response.taskId).toBe("c");
    expect(response.blockedBy).toEqual(["a", "b"]);
    const tasks = response.tasks as TaskItem[];
    const taskC = tasks.find((t) => t.id === "c");
    expect(taskC!.blockedBy).toEqual(["a", "b"]);
  });

  test("clears blockedBy with an empty array", () => {
    const result = createTestTool();
    sessionDir = result.sessionDir;

    // Create both tasks so blockedBy validation passes
    invoke(result.tool, {
      action: "create_tasks",
      tasks: [
        { id: "y", description: "Y", status: "pending", summary: "Y" },
        { id: "x", description: "X", status: "pending", summary: "X", blockedBy: ["y"] },
      ],
    });

    const response = invoke(result.tool, {
      action: "update_task_blockedBy",
      taskId: "x",
      blockedBy: [],
    });

    const tasks = response.tasks as TaskItem[];
    const taskX = tasks.find((t) => t.id === "x");
    expect(taskX!.blockedBy).toEqual([]);
  });

  test("returns error for missing taskId", () => {
    const result = createTestTool();
    sessionDir = result.sessionDir;

    const response = invoke(result.tool, {
      action: "update_task_blockedBy",
      blockedBy: ["a"],
    });

    expect(response.error).toBe("update_task_blockedBy requires a 'taskId' string");
  });

  test("returns error for missing blockedBy array", () => {
    const result = createTestTool();
    sessionDir = result.sessionDir;

    invoke(result.tool, {
      action: "add_task",
      task: { id: "t1", description: "T", status: "pending", summary: "T" },
    });

    const response = invoke(result.tool, {
      action: "update_task_blockedBy",
      taskId: "t1",
    });

    expect(response.error).toBe("update_task_blockedBy requires a 'blockedBy' array");
  });

  test("returns error for non-existent task", () => {
    const result = createTestTool();
    sessionDir = result.sessionDir;

    const response = invoke(result.tool, {
      action: "update_task_blockedBy",
      taskId: "ghost",
      blockedBy: [],
    });

    expect(response.error).toBe("Task not found: ghost");
  });

  test("returns error when blockedBy references non-existent task IDs", () => {
    const result = createTestTool();
    sessionDir = result.sessionDir;

    invoke(result.tool, {
      action: "create_tasks",
      tasks: [
        { id: "a", description: "A", status: "pending", summary: "A" },
      ],
    });

    const response = invoke(result.tool, {
      action: "update_task_blockedBy",
      taskId: "a",
      blockedBy: ["nonexistent1", "nonexistent2"],
    });

    expect(response.error).toBe(
      "blockedBy references non-existent task(s): nonexistent1, nonexistent2"
    );
  });

  test("returns error when blockedBy partially references non-existent task IDs", () => {
    const result = createTestTool();
    sessionDir = result.sessionDir;

    invoke(result.tool, {
      action: "create_tasks",
      tasks: [
        { id: "a", description: "A", status: "pending", summary: "A" },
        { id: "b", description: "B", status: "pending", summary: "B" },
      ],
    });

    const response = invoke(result.tool, {
      action: "update_task_blockedBy",
      taskId: "a",
      blockedBy: ["b", "ghost"],
    });

    expect(response.error).toBe(
      "blockedBy references non-existent task(s): ghost"
    );
  });
});

// --- create_tasks input validation ---

describe("createTaskListTool - create_tasks validation", () => {
  let sessionDir: string;

  afterEach(() => {
    if (sessionDir) rmSync(sessionDir, { recursive: true, force: true });
  });

  test("returns error when tasks param is missing", () => {
    const result = createTestTool();
    sessionDir = result.sessionDir;

    const response = invoke(result.tool, { action: "create_tasks" });
    expect(response.error).toBe("create_tasks requires a 'tasks' array");
  });

  test("returns error when tasks param is not an array", () => {
    const result = createTestTool();
    sessionDir = result.sessionDir;

    const response = invoke(result.tool, {
      action: "create_tasks",
      tasks: "not-an-array",
    });
    expect(response.error).toBe("create_tasks requires a 'tasks' array");
  });

  test("returns error when blockedBy references non-existent external task", () => {
    const result = createTestTool();
    sessionDir = result.sessionDir;

    const response = invoke(result.tool, {
      action: "create_tasks",
      tasks: [
        {
          id: "a",
          description: "A",
          status: "pending",
          summary: "A",
          blockedBy: ["nonexistent"],
        },
      ],
    });
    expect(response.error).toBe(
      'Task "a" blockedBy references non-existent task(s): nonexistent'
    );
  });
});

// --- update_task_status input validation ---

describe("createTaskListTool - update_task_status validation", () => {
  let sessionDir: string;

  afterEach(() => {
    if (sessionDir) rmSync(sessionDir, { recursive: true, force: true });
  });

  test("returns error when taskId is missing", () => {
    const result = createTestTool();
    sessionDir = result.sessionDir;

    const response = invoke(result.tool, {
      action: "update_task_status",
      status: "completed",
    });
    expect(response.error).toBe(
      "update_task_status requires a 'taskId' string"
    );
  });

  test("returns error when status is missing", () => {
    const result = createTestTool();
    sessionDir = result.sessionDir;

    const response = invoke(result.tool, {
      action: "update_task_status",
      taskId: "some-task",
    });
    expect(response.error).toBe(
      "update_task_status requires a 'status' string"
    );
  });
});

// --- add_task input validation ---

describe("createTaskListTool - add_task validation", () => {
  let sessionDir: string;

  afterEach(() => {
    if (sessionDir) rmSync(sessionDir, { recursive: true, force: true });
  });

  test("returns error when task param is missing", () => {
    const result = createTestTool();
    sessionDir = result.sessionDir;

    const response = invoke(result.tool, { action: "add_task" });
    expect(response.error).toBe("add_task requires a 'task' object");
  });

  test("returns error when blockedBy references non-existent task", () => {
    const result = createTestTool();
    sessionDir = result.sessionDir;

    const response = invoke(result.tool, {
      action: "add_task",
      task: {
        id: "t1",
        description: "Task 1",
        status: "pending",
        summary: "Doing",
        blockedBy: ["ghost"],
      },
    });
    expect(response.error).toBe(
      "blockedBy references non-existent task(s): ghost"
    );
  });
});

// --- update_task_progress input validation ---

describe("createTaskListTool - update_task_progress validation", () => {
  let sessionDir: string;

  afterEach(() => {
    if (sessionDir) rmSync(sessionDir, { recursive: true, force: true });
  });

  test("returns error when taskId is missing", () => {
    const result = createTestTool();
    sessionDir = result.sessionDir;

    const response = invoke(result.tool, {
      action: "update_task_progress",
      progress: "some progress",
    });
    expect(response.error).toBe(
      "update_task_progress requires a 'taskId' string"
    );
  });

  test("returns error when progress is missing", () => {
    const result = createTestTool();
    sessionDir = result.sessionDir;

    const response = invoke(result.tool, {
      action: "update_task_progress",
      taskId: "some-task",
    });
    expect(response.error).toBe(
      "update_task_progress requires a 'progress' string"
    );
  });

  test("returns error for non-existent task", () => {
    const result = createTestTool();
    sessionDir = result.sessionDir;

    const response = invoke(result.tool, {
      action: "update_task_progress",
      taskId: "ghost",
      progress: "did stuff",
    });
    expect(response.error).toBe("Task not found: ghost");
  });
});

// --- clear_progress ---

describe("createTaskListTool - clear_progress", () => {
  let sessionDir: string;

  afterEach(() => {
    if (sessionDir) rmSync(sessionDir, { recursive: true, force: true });
  });

  test("clears progress for a specific task", () => {
    const result = createTestTool();
    sessionDir = result.sessionDir;

    invoke(result.tool, {
      action: "create_tasks",
      tasks: [
        { id: "t1", description: "Task", status: "pending", summary: "S" },
      ],
    });
    invoke(result.tool, {
      action: "update_task_progress",
      taskId: "t1",
      progress: "step 1",
    });

    const response = invoke(result.tool, {
      action: "clear_progress",
      taskId: "t1",
    });
    expect(response.cleared).toBe(true);
    expect(response.taskId).toBe("t1");

    const progress = invoke(result.tool, {
      action: "get_task_progress",
      taskId: "t1",
    });
    expect(progress.progress).toBe("");
  });

  test("returns error for non-existent task", () => {
    const result = createTestTool();
    sessionDir = result.sessionDir;

    const response = invoke(result.tool, {
      action: "clear_progress",
      taskId: "ghost",
    });
    expect(response.error).toBe("Task not found: ghost");
  });

  test("clears all progress when no taskId provided", () => {
    const result = createTestTool();
    sessionDir = result.sessionDir;

    invoke(result.tool, {
      action: "create_tasks",
      tasks: [
        { id: "t1", description: "A", status: "pending", summary: "A" },
        { id: "t2", description: "B", status: "pending", summary: "B" },
      ],
    });
    invoke(result.tool, {
      action: "update_task_progress",
      taskId: "t1",
      progress: "p1",
    });
    invoke(result.tool, {
      action: "update_task_progress",
      taskId: "t2",
      progress: "p2",
    });

    const response = invoke(result.tool, { action: "clear_progress" });
    expect(response.cleared).toBe(true);
    expect(response.all).toBe(true);

    const progress = invoke(result.tool, { action: "get_task_progress" });
    expect(progress.progress).toBe("");
  });
});

// --- delete_task blockedBy cascade ---

describe("createTaskListTool - delete_task blockedBy cleanup", () => {
  let sessionDir: string;

  afterEach(() => {
    if (sessionDir) rmSync(sessionDir, { recursive: true, force: true });
  });

  test("returns error when taskId is missing", () => {
    const result = createTestTool();
    sessionDir = result.sessionDir;

    const response = invoke(result.tool, { action: "delete_task" });
    expect(response.error).toBe("delete_task requires a 'taskId' string");
  });

  test("removes deleted task from other tasks blockedBy arrays", () => {
    const result = createTestTool();
    sessionDir = result.sessionDir;

    invoke(result.tool, {
      action: "create_tasks",
      tasks: [
        { id: "a", description: "A", status: "pending", summary: "A" },
        {
          id: "b",
          description: "B",
          status: "pending",
          summary: "B",
          blockedBy: ["a"],
        },
      ],
    });

    // Verify blockedBy is set
    const before = invoke(result.tool, { action: "list_tasks" });
    const taskB = (before.tasks as TaskItem[]).find((t) => t.id === "b");
    expect(taskB?.blockedBy).toEqual(["a"]);

    // Delete task "a"
    invoke(result.tool, { action: "delete_task", taskId: "a" });

    // Task "b" should no longer have "a" in blockedBy
    const after = invoke(result.tool, { action: "list_tasks" });
    const taskBAfter = (after.tasks as TaskItem[]).find((t) => t.id === "b");
    expect(taskBAfter?.blockedBy).toEqual([]);
  });
});
