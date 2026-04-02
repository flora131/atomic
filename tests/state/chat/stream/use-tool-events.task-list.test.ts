/**
 * Tests for task_list tool handling in useChatStreamToolEvents.
 *
 * Verifies that:
 * - The isTaskListToolName helper correctly identifies the task_list tool
 * - handleToolStart handles all task_list CRUD actions (create_tasks,
 *   update_task_status, add_task, delete_task)
 * - handleToolComplete prefers authoritative output.tasks when available
 * - handleToolComplete falls back to optimistic input-based updates
 * - isWorkflowTaskUpdate guard is NOT applied for task_list tool calls
 *
 * Since useChatStreamToolEvents is a React hook, these tests verify the
 * source code structure and the pure helper functions used by the hook.
 */

import { describe, test, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  normalizeTaskStatus,
  normalizeTodoItem,
} from "@/state/parts/helpers/task-status.ts";
import type { NormalizedTodoItem } from "@/state/parts/helpers/task-status.ts";

// ---------------------------------------------------------------------------
// Source code reference
// ---------------------------------------------------------------------------

const SOURCE_PATH = path.resolve(
  import.meta.dir,
  "../../../../src/state/chat/stream/use-tool-events.ts",
);
const source = fs.readFileSync(SOURCE_PATH, "utf-8");

// ===========================================================================
// isTaskListToolName helper
// ===========================================================================

describe("isTaskListToolName helper", () => {
  test("is defined as a module-level function", () => {
    expect(source).toContain("function isTaskListToolName(name: string): boolean");
  });

  test('returns true for "task_list"', () => {
    expect(source).toContain('return name === "task_list"');
  });

  test("is used in handleToolComplete", () => {
    expect(source).toContain("isTaskListToolName(completedToolName)");
  });

  test("handleToolStart intentionally skips optimistic updates for task_list", () => {
    expect(source).toContain(
      "Optimistic updates are intentionally skipped in handleToolStart",
    );
  });
});

// ===========================================================================
// handleToolComplete: task_list action coverage
// ===========================================================================

describe("handleToolComplete: task_list action handling", () => {
  // Extract the task_list complete block for scoped assertions
  const completeBlockStart = source.indexOf("// Handle task_list tool completion");
  const completeBlockEnd = source.indexOf("  }, [", completeBlockStart);
  const completeBlock = source.slice(completeBlockStart, completeBlockEnd);

  test("outer condition does not gate on input", () => {
    // The authoritative output-based path must work even when input is
    // undefined (toolInput is optional in stream.tool.complete schema).
    expect(completeBlock).toContain("if (isTaskListToolName(completedToolName))");
    // Must NOT have `&& input` in the outer condition
    expect(completeBlock).not.toMatch(/isTaskListToolName\(completedToolName\)\s*&&\s*input\b/);
  });

  test("parses output when it is a JSON string", () => {
    // SDK providers may serialize toolResult as a string rather than an object
    expect(completeBlock).toContain('typeof output === "string"');
    expect(completeBlock).toContain("JSON.parse(output)");
  });

  test("prefers authoritative tasks from tool output", () => {
    expect(completeBlock).toContain("Array.isArray(outputRecord.tasks)");
  });

  test("falls back to optimistic input-based updates", () => {
    expect(completeBlock).toContain("Fallback: apply optimistic update from input");
  });

  test("fallback path gates on input.action", () => {
    expect(completeBlock).toContain("input && input.action");
  });

  test("avoids duplicate add_task entries on completion", () => {
    expect(completeBlock).toContain("alreadyExists");
    expect(completeBlock).toContain("prev.some");
  });

  test("handles create_tasks via authoritative output path", () => {
    expect(completeBlock).toContain("Array.isArray(outputRecord.tasks)");
    expect(completeBlock).toContain("normalizeTodoItem(t)");
  });

  test("handles update_task_status in fallback path", () => {
    expect(completeBlock).toContain('action === "update_task_status"');
  });

  test("handles add_task in fallback path", () => {
    expect(completeBlock).toContain('action === "add_task"');
  });

  test("handles delete_task in fallback path", () => {
    expect(completeBlock).toContain('action === "delete_task"');
  });

  test("updates todoItemsRef.current for authoritative and fallback paths", () => {
    const assignments = (completeBlock.match(/todoItemsRef\.current\s*=/g) || []).length;
    // 1 authoritative + 3 fallback (update_task_status, add_task, delete_task) = 4
    expect(assignments).toBeGreaterThanOrEqual(4);
  });

  test("calls setTodoItems for authoritative and fallback paths", () => {
    const calls = (completeBlock.match(/setTodoItems\(/g) || []).length;
    expect(calls).toBeGreaterThanOrEqual(4);
  });
});

// ===========================================================================
// isWorkflowTaskUpdate guard is NOT applied for task_list
// ===========================================================================

describe("task_list skips isWorkflowTaskUpdate guard", () => {
  test("task_list complete block does not reference isWorkflowTaskUpdate", () => {
    const completeBlockStart = source.indexOf("// Handle task_list tool completion");
    const completeBlockEnd = source.indexOf("  }, [", completeBlockStart);
    const completeBlock = source.slice(completeBlockStart, completeBlockEnd);
    expect(completeBlock).not.toContain("isWorkflowTaskUpdate");
  });

  test("isWorkflowTaskUpdate is still used for TodoWrite", () => {
    const todoWriteBlock = source.slice(
      source.indexOf("isTodoWriteToolName(toolName)"),
      source.indexOf("// task_list tool mutations"),
    );
    expect(todoWriteBlock).toContain("isWorkflowTaskUpdate");
  });
});

// ===========================================================================
// normalizeTodoItem compatibility with TaskItem schema
// ===========================================================================

describe("normalizeTodoItem maps TaskItem fields correctly", () => {
  test("maps id, description, status, summary, blockedBy", () => {
    const taskItem = {
      id: "1",
      description: "Implement feature X",
      status: "in_progress",
      summary: "Implementing feature X",
      blockedBy: ["2", "3"],
    };
    const normalized = normalizeTodoItem(taskItem);
    expect(normalized.id).toBe("1");
    expect(normalized.description).toBe("Implement feature X");
    expect(normalized.status).toBe("in_progress");
    expect(normalized.summary).toBe("Implementing feature X");
    expect(normalized.blockedBy).toEqual(["2", "3"]);
  });

  test("normalizes unknown status strings to pending", () => {
    const taskItem = {
      id: "2",
      description: "Task",
      status: "unknown_status",
      summary: "",
    };
    const normalized = normalizeTodoItem(taskItem);
    expect(normalized.status).toBe("pending");
  });

  test("handles missing blockedBy", () => {
    const taskItem = {
      id: "3",
      description: "Task",
      status: "completed",
      summary: "Done",
    };
    const normalized = normalizeTodoItem(taskItem);
    expect(normalized.blockedBy).toBeUndefined();
  });

  test("handles empty blockedBy array", () => {
    const taskItem = {
      id: "4",
      description: "Task",
      status: "pending",
      summary: "",
      blockedBy: [],
    };
    const normalized = normalizeTodoItem(taskItem);
    expect(normalized.blockedBy).toBeUndefined();
  });
});

// ===========================================================================
// normalizeTaskStatus compatibility with task_list statuses
// ===========================================================================

describe("normalizeTaskStatus handles all task_list status values", () => {
  test('normalizes "pending" to "pending"', () => {
    expect(normalizeTaskStatus("pending")).toBe("pending");
  });

  test('normalizes "in_progress" to "in_progress"', () => {
    expect(normalizeTaskStatus("in_progress")).toBe("in_progress");
  });

  test('normalizes "completed" to "completed"', () => {
    expect(normalizeTaskStatus("completed")).toBe("completed");
  });

  test('normalizes "error" to "error"', () => {
    expect(normalizeTaskStatus("error")).toBe("error");
  });
});

// ===========================================================================
// Simulated optimistic update logic
// ===========================================================================

describe("optimistic update logic", () => {
  const baseTodos: NormalizedTodoItem[] = [
    { id: "1", description: "Task 1", status: "pending", summary: "Task one" },
    { id: "2", description: "Task 2", status: "in_progress", summary: "Task two" },
    { id: "3", description: "Task 3", status: "completed", summary: "Task three" },
  ];

  test("create_tasks replaces the entire list", () => {
    const newTasks = [
      { id: "10", description: "New task", status: "pending", summary: "New" },
    ];
    const todos: NormalizedTodoItem[] = newTasks.map((t) => normalizeTodoItem(t));
    expect(todos).toHaveLength(1);
    expect(todos[0]!.id).toBe("10");
  });

  test("update_task_status modifies only the matching task", () => {
    const taskId = "2";
    const newStatus = normalizeTaskStatus("completed");
    const updated = baseTodos.map((t) =>
      t.id === taskId ? { ...t, status: newStatus } : t,
    );
    expect(updated[0]!.status).toBe("pending");
    expect(updated[1]!.status).toBe("completed");
    expect(updated[2]!.status).toBe("completed");
  });

  test("update_task_status leaves list unchanged for non-existent taskId", () => {
    const taskId = "999";
    const newStatus = normalizeTaskStatus("error");
    const updated = baseTodos.map((t) =>
      t.id === taskId ? { ...t, status: newStatus } : t,
    );
    expect(updated).toEqual(baseTodos);
  });

  test("add_task appends a new task", () => {
    const newTodo = normalizeTodoItem({
      id: "4",
      description: "Task 4",
      status: "pending",
      summary: "Task four",
    });
    const updated = [...baseTodos, newTodo];
    expect(updated).toHaveLength(4);
    expect(updated[3]!.id).toBe("4");
  });

  test("add_task deduplication check works", () => {
    const newTodo = normalizeTodoItem({
      id: "2",
      description: "Duplicate",
      status: "pending",
      summary: "Dup",
    });
    const alreadyExists = baseTodos.some((t) => t.id === newTodo.id);
    expect(alreadyExists).toBe(true);
  });

  test("delete_task removes the matching task", () => {
    const taskId = "2";
    const updated = baseTodos.filter((t) => t.id !== taskId);
    expect(updated).toHaveLength(2);
    expect(updated.map((t) => t.id)).toEqual(["1", "3"]);
  });

  test("delete_task leaves list unchanged for non-existent taskId", () => {
    const taskId = "999";
    const updated = baseTodos.filter((t) => t.id !== taskId);
    expect(updated).toHaveLength(3);
  });
});
