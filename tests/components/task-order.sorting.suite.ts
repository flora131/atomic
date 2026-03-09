import { describe, expect, test } from "bun:test";
import { sortTasksTopologically } from "@/components/task-order.ts";
import { task } from "./task-order.test-support.ts";

describe("sortTasksTopologically", () => {
  test("places prerequisite tasks before dependents", () => {
    const sorted = sortTasksTopologically([task("#2", "second", ["#1"]), task("#1", "first")]);
    expect(sorted.map((item) => item.id)).toEqual(["#1", "#2"]);
  });

  test("preserves stable order for same-rank tasks", () => {
    const sorted = sortTasksTopologically([
      task("#2", "depends on first", ["#1"]),
      task("#1", "first"),
      task("#3", "independent"),
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["#1", "#3", "#2"]);
  });

  test("normalizes blocker ids with or without leading #", () => {
    const sorted = sortTasksTopologically([task("#2", "second", ["1"]), task("1", "first")]);
    expect(sorted.map((item) => item.id)).toEqual(["1", "#2"]);
  });

  test("appends tasks with unknown blockers at the end", () => {
    const sorted = sortTasksTopologically([
      task("#1", "first"),
      task("#2", "unknown blocker", ["#99"]),
      task("#3", "third"),
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["#1", "#3", "#2"]);
  });

  test("appends cyclic tasks at the end in original order", () => {
    const sorted = sortTasksTopologically([
      task("#1", "cycle one", ["#2"]),
      task("#2", "cycle two", ["#1"]),
      task("#3", "independent"),
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["#3", "#1", "#2"]);
  });

  test("keeps dependency chains contiguous around in_progress items", () => {
    const sorted = sortTasksTopologically([
      task("#3", "verify", ["#2"], "pending"),
      task("#1", "plan", [], "completed"),
      task("#2", "implement", ["#1"], "in_progress"),
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["#1", "#2", "#3"]);
    expect(sorted[1]!.status).toBe("in_progress");
  });

  test("appends tasks with missing or duplicate ids", () => {
    const sorted = sortTasksTopologically([
      task("#1", "duplicate one"),
      task("#1", "duplicate two"),
      task(undefined, "missing id"),
      task("#2", "valid"),
    ]);
    expect(sorted.map((item) => item.content)).toEqual([
      "valid",
      "duplicate one",
      "duplicate two",
      "missing id",
    ]);
  });

  test("does not mutate the input array or task objects", () => {
    const tasks = [task("#2", "second", ["#1"]), task("#1", "first")];
    const before = JSON.parse(JSON.stringify(tasks));
    const sorted = sortTasksTopologically(tasks);
    expect(tasks).toEqual(before);
    expect(sorted).not.toBe(tasks);
  });
});
