import { describe, expect, test } from "bun:test";

import type { TaskItem } from "./task-list-indicator.tsx";
import { getReadyTasks, sortTasksTopologically } from "./task-order.ts";

function task(
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

describe("sortTasksTopologically", () => {
  test("places prerequisite tasks before dependents", () => {
    const tasks: TaskItem[] = [
      task("#2", "second", ["#1"]),
      task("#1", "first"),
    ];

    const sorted = sortTasksTopologically(tasks);

    expect(sorted.map((t) => t.id)).toEqual(["#1", "#2"]);
  });

  test("preserves stable order for same-rank tasks", () => {
    const tasks: TaskItem[] = [
      task("#2", "depends on first", ["#1"]),
      task("#1", "first"),
      task("#3", "independent"),
    ];

    const sorted = sortTasksTopologically(tasks);

    expect(sorted.map((t) => t.id)).toEqual(["#1", "#3", "#2"]);
  });

  test("normalizes blocker ids with or without leading #", () => {
    const tasks: TaskItem[] = [
      task("#2", "second", ["1"]),
      task("1", "first"),
    ];

    const sorted = sortTasksTopologically(tasks);

    expect(sorted.map((t) => t.id)).toEqual(["1", "#2"]);
  });

  test("appends tasks with unknown blockers at the end", () => {
    const tasks: TaskItem[] = [
      task("#1", "first"),
      task("#2", "unknown blocker", ["#99"]),
      task("#3", "third"),
    ];

    const sorted = sortTasksTopologically(tasks);

    expect(sorted.map((t) => t.id)).toEqual(["#1", "#3", "#2"]);
  });

  test("appends cyclic tasks at the end in original order", () => {
    const tasks: TaskItem[] = [
      task("#1", "cycle one", ["#2"]),
      task("#2", "cycle two", ["#1"]),
      task("#3", "independent"),
    ];

    const sorted = sortTasksTopologically(tasks);

    expect(sorted.map((t) => t.id)).toEqual(["#3", "#1", "#2"]);
  });

  test("appends tasks with missing or duplicate ids", () => {
    const tasks: TaskItem[] = [
      task("#1", "duplicate one"),
      task("#1", "duplicate two"),
      task(undefined, "missing id"),
      task("#2", "valid"),
    ];

    const sorted = sortTasksTopologically(tasks);

    expect(sorted.map((t) => t.content)).toEqual([
      "valid",
      "duplicate one",
      "duplicate two",
      "missing id",
    ]);
  });

  test("does not mutate the input array or task objects", () => {
    const tasks: TaskItem[] = [
      task("#2", "second", ["#1"]),
      task("#1", "first"),
    ];
    const before = JSON.parse(JSON.stringify(tasks)) as TaskItem[];

    const sorted = sortTasksTopologically(tasks);

    expect(tasks).toEqual(before);
    expect(sorted).not.toBe(tasks);
  });
});

describe("getReadyTasks", () => {
  test("returns pending tasks with no blockers", () => {
    const tasks: TaskItem[] = [
      task("#1", "first"),
      task("#2", "second"),
    ];

    const ready = getReadyTasks(tasks);

    expect(ready.map((t) => t.id)).toEqual(["#1", "#2"]);
  });

  test("returns pending tasks whose blockers are all completed", () => {
    const tasks: TaskItem[] = [
      task("#1", "first", [], "completed"),
      task("#2", "second", ["#1"], "pending"),
      task("#3", "third", ["#1"], "pending"),
    ];

    const ready = getReadyTasks(tasks);

    expect(ready.map((t) => t.id)).toEqual(["#2", "#3"]);
  });

  test("excludes pending tasks with incomplete blockers", () => {
    const tasks: TaskItem[] = [
      task("#1", "first", [], "pending"),
      task("#2", "second", ["#1"], "pending"),
    ];

    const ready = getReadyTasks(tasks);

    expect(ready.map((t) => t.id)).toEqual(["#1"]);
  });

  test("excludes tasks with in_progress status", () => {
    const tasks: TaskItem[] = [
      task("#1", "first", [], "in_progress"),
      task("#2", "second", [], "completed"),
      task("#3", "third", [], "pending"),
    ];

    const ready = getReadyTasks(tasks);

    expect(ready.map((t) => t.id)).toEqual(["#3"]);
  });

  test("excludes tasks with error status", () => {
    const tasks: TaskItem[] = [
      task("#1", "first", [], "error"),
      task("#2", "second", [], "pending"),
    ];

    const ready = getReadyTasks(tasks);

    expect(ready.map((t) => t.id)).toEqual(["#2"]);
  });

  test("excludes tasks with completed status", () => {
    const tasks: TaskItem[] = [
      task("#1", "first", [], "completed"),
      task("#2", "second", [], "pending"),
    ];

    const ready = getReadyTasks(tasks);

    expect(ready.map((t) => t.id)).toEqual(["#2"]);
  });

  test("normalizes blocker ids with or without leading #", () => {
    const tasks: TaskItem[] = [
      task("#1", "first", [], "completed"),
      task("#2", "second", ["1"], "pending"),
      task("3", "third", ["#1"], "pending"),
    ];

    const ready = getReadyTasks(tasks);

    expect(ready.map((t) => t.id)).toEqual(["#2", "3"]);
  });

  test("handles multiple blockers requiring all completed", () => {
    const tasks: TaskItem[] = [
      task("#1", "first", [], "completed"),
      task("#2", "second", [], "completed"),
      task("#3", "third", ["#1", "#2"], "pending"),
      task("#4", "fourth", ["#1", "#2"], "pending"),
    ];

    const ready = getReadyTasks(tasks);

    expect(ready.map((t) => t.id)).toEqual(["#3", "#4"]);
  });

  test("excludes tasks if any blocker is not completed", () => {
    const tasks: TaskItem[] = [
      task("#1", "first", [], "completed"),
      task("#2", "second", [], "pending"),
      task("#3", "third", ["#1", "#2"], "pending"),
    ];

    const ready = getReadyTasks(tasks);

    expect(ready.map((t) => t.id)).toEqual(["#2"]);
  });

  test("handles tasks with unknown blockers", () => {
    const tasks: TaskItem[] = [
      task("#1", "first", ["#99"], "pending"),
      task("#2", "second", [], "pending"),
    ];

    const ready = getReadyTasks(tasks);

    // Task #1 has an unknown blocker, so it's not ready
    // (the blocker is not "completed")
    expect(ready.map((t) => t.id)).toEqual(["#2"]);
  });

  test("handles empty blockedBy array", () => {
    const tasks: TaskItem[] = [
      task("#1", "first", [], "pending"),
    ];

    const ready = getReadyTasks(tasks);

    expect(ready.map((t) => t.id)).toEqual(["#1"]);
  });

  test("handles missing blockedBy field", () => {
    const tasks: TaskItem[] = [
      {
        id: "#1",
        content: "first",
        status: "pending",
        // no blockedBy field
      },
    ];

    const ready = getReadyTasks(tasks);

    expect(ready.map((t) => t.id)).toEqual(["#1"]);
  });

  test("preserves original task order", () => {
    const tasks: TaskItem[] = [
      task("#5", "fifth", [], "pending"),
      task("#1", "first", [], "pending"),
      task("#3", "third", [], "pending"),
    ];

    const ready = getReadyTasks(tasks);

    expect(ready.map((t) => t.id)).toEqual(["#5", "#1", "#3"]);
  });

  test("returns empty array when no tasks are ready", () => {
    const tasks: TaskItem[] = [
      task("#1", "first", [], "completed"),
      task("#2", "second", [], "in_progress"),
      task("#3", "third", ["#99"], "pending"),
    ];

    const ready = getReadyTasks(tasks);

    expect(ready).toEqual([]);
  });

  test("does not mutate input array", () => {
    const tasks: TaskItem[] = [
      task("#1", "first", [], "completed"),
      task("#2", "second", ["#1"], "pending"),
    ];
    const before = JSON.parse(JSON.stringify(tasks)) as TaskItem[];

    const ready = getReadyTasks(tasks);

    expect(tasks).toEqual(before);
    expect(ready).not.toBe(tasks);
  });
});

