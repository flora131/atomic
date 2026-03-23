import { describe, expect, test } from "bun:test";
import { isWorkflowTaskUpdate } from "@/state/chat/shared/helpers/workflow-task-guard.ts";

describe("isWorkflowTaskUpdate", () => {
  test("returns true when all todo IDs belong to the active workflow", () => {
    const activeIds = new Set(["#1", "#2", "#3"]);
    const todos = [
      { id: "1", description: "First task" },
      { id: "2", description: "Second task" },
    ];

    expect(isWorkflowTaskUpdate(todos, activeIds)).toBe(true);
  });

  test("returns false when any todo ID is foreign to the workflow", () => {
    const activeIds = new Set(["#1", "#2"]);
    const todos = [
      { id: "#1", description: "Known task" },
      { id: "#99", description: "Foreign task" },
    ];

    expect(isWorkflowTaskUpdate(todos, activeIds)).toBe(false);
  });

  test("returns false for empty todo list", () => {
    const activeIds = new Set(["#1"]);
    expect(isWorkflowTaskUpdate([], activeIds)).toBe(false);
  });

  test("normalizes # prefix so '#1' and '1' are equivalent", () => {
    const activeIds = new Set(["1"]);
    const todos = [{ id: "#1", description: "Task one" }];

    expect(isWorkflowTaskUpdate(todos, activeIds)).toBe(true);
  });

  test("falls back to description matching when IDs are absent and previousTasks provided", () => {
    const activeIds = new Set(["#1", "#2"]);
    const previousTasks = [
      { description: "Wire auth route" },
      { description: "Add tests" },
    ];
    const todos = [
      { description: "wire auth route" },
      { description: "add tests" },
    ];

    expect(isWorkflowTaskUpdate(todos, activeIds, previousTasks)).toBe(true);
  });

  test("rejects no-id todos when descriptions don't match previous tasks", () => {
    const activeIds = new Set(["#1"]);
    const previousTasks = [{ description: "Wire auth route" }];
    const todos = [{ description: "Completely unrelated task" }];

    expect(isWorkflowTaskUpdate(todos, activeIds, previousTasks)).toBe(false);
  });

  test("rejects no-id todos with no previous tasks and no anchored match", () => {
    const activeIds = new Set(["#1"]);
    const todos = [{ description: "Some task without an ID" }];

    expect(isWorkflowTaskUpdate(todos, activeIds)).toBe(false);
  });

  test("handles empty activeWorkflowTaskIds with description-based matching", () => {
    const activeIds = new Set<string>();
    const previousTasks = [
      { description: "Wire auth route" },
      { description: "Add tests" },
    ];
    const todos = [
      { description: "wire auth route" },
      { description: "add tests" },
    ];

    expect(isWorkflowTaskUpdate(todos, activeIds, previousTasks)).toBe(true);
  });

  test("detects workflow updates when descriptions carry embedded task IDs", () => {
    const activeIds = new Set(["#1", "#2"]);
    const previousTasks = [
      { description: "Wire auth route" },
      { description: "Add tests" },
    ];
    const todos = [
      { description: "[x] #1 Wire auth route" },
      { description: "[ ] #2 Add tests" },
    ];

    expect(isWorkflowTaskUpdate(todos, activeIds, previousTasks)).toBe(true);
  });

  test("rejects when embedded task IDs in descriptions are foreign", () => {
    const activeIds = new Set(["#1", "#2"]);
    const previousTasks = [
      { description: "Wire auth route" },
      { description: "Add tests" },
    ];
    const todos = [
      { description: "[x] #1 Wire auth route" },
      { description: "[ ] #99 Unexpected task" },
    ];

    expect(isWorkflowTaskUpdate(todos, activeIds, previousTasks)).toBe(false);
  });
});
