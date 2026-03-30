/**
 * Tests for task_list tool event handling in use-tool-events.ts.
 *
 * Since useChatStreamToolEvents is a React hook that requires renderHook,
 * these tests verify:
 *
 * 1. Structural: The source contains the expected task_list handling blocks
 *    in both handleToolStart and handleToolComplete callbacks.
 * 2. Data transformation: The normalization pipeline used by the task_list
 *    handling produces correct NormalizedTodoItem[] results for each action.
 * 3. isTaskListToolName: The helper function correctly detects the tool.
 * 4. Persistence: persistWorkflowTasksToDisk is called for task_list mutations
 *    (tasks.json is still needed for the TaskListPanel file watcher during
 *    the transition period).
 */

import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  normalizeTodoItem,
  normalizeTaskStatus,
  type NormalizedTodoItem,
} from "@/state/parts/helpers/task-status.ts";

// ---------------------------------------------------------------------------
// Source code for structural assertions
// ---------------------------------------------------------------------------

const SOURCE_PATH = resolve(
  import.meta.dir,
  "../../../../src/state/chat/stream/use-tool-events.ts",
);
const source = readFileSync(SOURCE_PATH, "utf-8");

// ---------------------------------------------------------------------------
// Helpers — simulate the data transformations the hook performs
// ---------------------------------------------------------------------------

function applyCreateTasks(
  rawTasks: Array<Record<string, unknown>>,
): NormalizedTodoItem[] {
  return rawTasks.map((t) => normalizeTodoItem(t));
}

function applyUpdateTaskStatus(
  current: NormalizedTodoItem[],
  taskId: string,
  status: unknown,
): NormalizedTodoItem[] {
  const newStatus = normalizeTaskStatus(status);
  return current.map((t) =>
    t.id === taskId ? { ...t, status: newStatus } : t,
  );
}

function applyAddTask(
  current: NormalizedTodoItem[],
  rawTask: Record<string, unknown>,
): NormalizedTodoItem[] {
  return [...current, normalizeTodoItem(rawTask)];
}

function applyAddTaskWithDedup(
  current: NormalizedTodoItem[],
  rawTask: Record<string, unknown>,
): NormalizedTodoItem[] {
  const newTodo = normalizeTodoItem(rawTask);
  if (current.some((t) => t.id === newTodo.id)) return current;
  return [...current, newTodo];
}

function applyDeleteTask(
  current: NormalizedTodoItem[],
  taskId: string,
): NormalizedTodoItem[] {
  return current.filter((t) => t.id !== taskId);
}

// ---------------------------------------------------------------------------
// 1. Structural tests
// ---------------------------------------------------------------------------

describe("use-tool-events.ts — task_list structural verification", () => {
  test("imports normalizeTodoItem from task-status", () => {
    expect(source).toMatch(/import\s*\{[^}]*normalizeTodoItem[^}]*\}\s*from\s*["']@\/state\/parts\/helpers\/task-status/);
  });

  test("imports normalizeTaskStatus from task-status", () => {
    expect(source).toMatch(/import\s*\{[^}]*normalizeTaskStatus[^}]*\}\s*from\s*["']@\/state\/parts\/helpers\/task-status/);
  });

  test("defines isTaskListToolName helper function", () => {
    expect(source).toContain("function isTaskListToolName");
    expect(source).toContain('name === "task_list"');
  });

  test("handleToolStart uses isTaskListToolName to detect the tool", () => {
    expect(source).toContain("isTaskListToolName(toolName)");
  });

  test("handleToolComplete uses isTaskListToolName to detect the tool", () => {
    expect(source).toContain("isTaskListToolName(completedToolName)");
  });

  test("handles all four mutating actions", () => {
    for (const action of ["create_tasks", "update_task_status", "add_task", "delete_task"]) {
      expect(source).toContain(`"${action}"`);
    }
  });

  test("task_list block is placed AFTER TodoWrite block in handleToolStart", () => {
    const todoWriteStart = source.indexOf("isTodoWriteToolName(toolName)");
    const taskListStart = source.indexOf("isTaskListToolName(toolName)");
    expect(todoWriteStart).toBeGreaterThan(-1);
    expect(taskListStart).toBeGreaterThan(-1);
    expect(taskListStart).toBeGreaterThan(todoWriteStart);
  });

  test("task_list block is placed AFTER TodoWrite block in handleToolComplete", () => {
    const todoWriteComplete = source.indexOf("isTodoWriteToolName(completedToolName)");
    const taskListComplete = source.indexOf("isTaskListToolName(completedToolName)");
    expect(todoWriteComplete).toBeGreaterThan(-1);
    expect(taskListComplete).toBeGreaterThan(-1);
    expect(taskListComplete).toBeGreaterThan(todoWriteComplete);
  });

  test("handleToolComplete prefers output tasks array as authoritative state", () => {
    expect(source).toContain("outputRecord.tasks");
    expect(source).toContain("authoritative state");
  });

  test("handleToolComplete has dedup logic for add_task", () => {
    expect(source).toContain("alreadyExists");
  });

  test("TodoWrite handling is preserved alongside task_list", () => {
    expect(source).toContain("isTodoWriteToolName(toolName)");
    expect(source).toContain("reconcileTodoWriteItems");
  });

  test("non-mutating actions are not in the guard condition", () => {
    for (const action of ["list_tasks", "update_task_progress", "get_task_progress"]) {
      expect(source).not.toContain(`action === "${action}"`);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Persistence tests — tasks.json is persisted for TaskListPanel file watcher
// ---------------------------------------------------------------------------

describe("task_list persists to tasks.json (transition period)", () => {
  test("handleToolStart task_list block calls persistWorkflowTasksToDisk", () => {
    const startBlockStart = source.indexOf("// Handle task_list tool mutations");
    const startBlockEnd = source.indexOf("  }, [", startBlockStart);
    const startBlock = source.slice(startBlockStart, startBlockEnd);
    expect(startBlock).toContain("persistWorkflowTasksToDisk");
  });

  test("handleToolComplete task_list block calls persistWorkflowTasksToDisk", () => {
    const completeBlockStart = source.indexOf("// Handle task_list tool completion");
    // Find the closing of the handleToolComplete useCallback
    const completeBlockEnd = source.indexOf("  }, [", completeBlockStart);
    const completeBlock = source.slice(completeBlockStart, completeBlockEnd);
    expect(completeBlock).toContain("persistWorkflowTasksToDisk");
  });

  test("persistWorkflowTasksToDisk is still invoked for TodoWrite too", () => {
    const todoWriteStartBlock = source.slice(
      source.indexOf("isTodoWriteToolName(toolName)"),
      source.indexOf("// Handle task_list tool mutations"),
    );
    expect(todoWriteStartBlock).toContain("persistWorkflowTasksToDisk(");
  });
});

// ---------------------------------------------------------------------------
// 3. Data transformation tests
// ---------------------------------------------------------------------------

describe("task_list create_tasks — normalization", () => {
  test("normalizes a batch of raw tasks", () => {
    const result = applyCreateTasks([
      { id: "1", description: "Task one", status: "pending", summary: "Planning" },
      { id: "2", description: "Task two", status: "in_progress", summary: "Working" },
      { id: "3", description: "Task three", status: "completed", summary: "Done" },
    ]);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ id: "1", description: "Task one", status: "pending", summary: "Planning" });
    expect(result[1]).toEqual({ id: "2", description: "Task two", status: "in_progress", summary: "Working" });
    expect(result[2]).toEqual({ id: "3", description: "Task three", status: "completed", summary: "Done" });
  });

  test("normalizes status aliases", () => {
    const result = applyCreateTasks([{ id: "1", description: "T", status: "done", summary: "S" }]);
    expect(result[0]!.status).toBe("completed");
  });

  test("defaults missing status to pending", () => {
    const result = applyCreateTasks([{ id: "1", description: "T", summary: "S" }]);
    expect(result[0]!.status).toBe("pending");
  });

  test("preserves blockedBy", () => {
    const result = applyCreateTasks([{ id: "3", description: "T", status: "pending", summary: "S", blockedBy: ["1", "2"] }]);
    expect(result[0]!.blockedBy).toEqual(["1", "2"]);
  });

  test("handles empty array", () => {
    expect(applyCreateTasks([])).toEqual([]);
  });

  test("normalizes summary from activeForm fallback", () => {
    const result = applyCreateTasks([{ id: "1", description: "T", status: "pending", activeForm: "Legacy" }]);
    expect(result[0]!.summary).toBe("Legacy");
  });
});

describe("task_list update_task_status — status update", () => {
  const base: NormalizedTodoItem[] = [
    { id: "1", description: "First", status: "pending", summary: "T1" },
    { id: "2", description: "Second", status: "pending", summary: "T2" },
    { id: "3", description: "Third", status: "in_progress", summary: "T3" },
  ];

  test("updates the targeted task", () => {
    expect(applyUpdateTaskStatus(base, "2", "completed")[1]!.status).toBe("completed");
  });

  test("does not modify other tasks", () => {
    const result = applyUpdateTaskStatus(base, "2", "completed");
    expect(result[0]!.status).toBe("pending");
    expect(result[2]!.status).toBe("in_progress");
  });

  test("normalizes status aliases", () => {
    expect(applyUpdateTaskStatus(base, "1", "failed")[0]!.status).toBe("error");
  });

  test("returns unchanged for missing taskId", () => {
    expect(applyUpdateTaskStatus(base, "nope", "completed")).toEqual(base);
  });

  test("preserves array length", () => {
    expect(applyUpdateTaskStatus(base, "1", "completed")).toHaveLength(3);
  });
});

describe("task_list add_task — appending", () => {
  const base: NormalizedTodoItem[] = [
    { id: "1", description: "First", status: "pending", summary: "T1" },
  ];

  test("appends a new task", () => {
    const result = applyAddTask(base, { id: "2", description: "New", status: "pending", summary: "New" });
    expect(result).toHaveLength(2);
    expect(result[1]!.id).toBe("2");
  });

  test("does not modify existing tasks", () => {
    const result = applyAddTask(base, { id: "2", description: "New", status: "pending", summary: "New" });
    expect(result[0]).toEqual(base[0]);
  });

  test("normalizes the new task", () => {
    const result = applyAddTask(base, { id: "2", description: "N", status: "running", activeForm: "Work" });
    expect(result[1]!.status).toBe("in_progress");
    expect(result[1]!.summary).toBe("Work");
  });

  test("preserves blockedBy on new task", () => {
    const result = applyAddTask(base, { id: "2", description: "N", status: "pending", summary: "B", blockedBy: ["1"] });
    expect(result[1]!.blockedBy).toEqual(["1"]);
  });
});

describe("task_list add_task (completion dedup)", () => {
  const base: NormalizedTodoItem[] = [
    { id: "1", description: "First", status: "pending", summary: "T1" },
    { id: "2", description: "Second", status: "pending", summary: "T2" },
  ];

  test("skips if task ID already exists", () => {
    const result = applyAddTaskWithDedup(base, { id: "2", description: "Dup", status: "pending", summary: "D" });
    expect(result).toHaveLength(2);
    expect(result).toBe(base);
  });

  test("appends if task ID is new", () => {
    const result = applyAddTaskWithDedup(base, { id: "3", description: "New", status: "pending", summary: "N" });
    expect(result).toHaveLength(3);
    expect(result[2]!.id).toBe("3");
  });
});

describe("task_list delete_task — removing", () => {
  const base: NormalizedTodoItem[] = [
    { id: "1", description: "First", status: "pending", summary: "T1" },
    { id: "2", description: "Second", status: "in_progress", summary: "T2" },
    { id: "3", description: "Third", status: "completed", summary: "T3" },
  ];

  test("removes the targeted task", () => {
    const result = applyDeleteTask(base, "2");
    expect(result).toHaveLength(2);
    expect(result.find((t) => t.id === "2")).toBeUndefined();
  });

  test("preserves order of remaining tasks", () => {
    const result = applyDeleteTask(base, "2");
    expect(result[0]!.id).toBe("1");
    expect(result[1]!.id).toBe("3");
  });

  test("returns same length for missing taskId", () => {
    expect(applyDeleteTask(base, "nope")).toHaveLength(3);
  });

  test("handles deleting the only task", () => {
    expect(applyDeleteTask([{ id: "1", description: "Only", status: "pending", summary: "S" }], "1")).toEqual([]);
  });

  test("handles deleting from empty list", () => {
    expect(applyDeleteTask([], "1")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. Output-based authoritative update (handleToolComplete)
// ---------------------------------------------------------------------------

describe("task_list handleToolComplete — output tasks as authoritative state", () => {
  test("normalizes output tasks array", () => {
    const outputTasks = [
      { id: "1", description: "A", status: "completed", summary: "Done" },
      { id: "2", description: "B", status: "in_progress", summary: "Working" },
    ];
    const todos = outputTasks.map((t) => normalizeTodoItem(t));
    expect(todos).toHaveLength(2);
    expect(todos[0]!.status).toBe("completed");
    expect(todos[1]!.status).toBe("in_progress");
  });

  test("normalizes status aliases in output", () => {
    const todos = [{ id: "1", description: "T", status: "succeeded", summary: "Y" }].map((t) => normalizeTodoItem(t));
    expect(todos[0]!.status).toBe("completed");
  });

  test("handles output tasks with blockedBy", () => {
    const todos = [{ id: "2", description: "T", status: "pending", summary: "W", blockedBy: ["1"] }].map((t) => normalizeTodoItem(t));
    expect(todos[0]!.blockedBy).toEqual(["1"]);
  });
});
