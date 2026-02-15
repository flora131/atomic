import { describe, expect, test } from "bun:test";

import type { TaskItem } from "./task-list-indicator.tsx";
import { sortTasksTopologically } from "./task-order.ts";

function task(
  id: string | undefined,
  content: string,
  blockedBy: string[] = [],
): TaskItem {
  return {
    id,
    content,
    status: "pending",
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

