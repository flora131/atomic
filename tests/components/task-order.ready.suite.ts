import { describe, expect, test } from "bun:test";
import { getReadyTasks } from "@/components/task-order.ts";
import { task } from "./task-order.test-support.ts";

describe("getReadyTasks", () => {
  test("returns pending tasks with no blockers", () => {
    const ready = getReadyTasks([task("#1", "first"), task("#2", "second")]);
    expect(ready.map((item) => item.id)).toEqual(["#1", "#2"]);
  });

  test("returns pending tasks whose blockers are all completed", () => {
    const ready = getReadyTasks([
      task("#1", "first", [], "completed"),
      task("#2", "second", ["#1"], "pending"),
      task("#3", "third", ["#1"], "pending"),
    ]);
    expect(ready.map((item) => item.id)).toEqual(["#2", "#3"]);
  });

  test("excludes pending tasks with incomplete blockers", () => {
    const ready = getReadyTasks([task("#1", "first", [], "pending"), task("#2", "second", ["#1"], "pending")]);
    expect(ready.map((item) => item.id)).toEqual(["#1"]);
  });

  test("excludes tasks with in_progress status", () => {
    const ready = getReadyTasks([
      task("#1", "first", [], "in_progress"),
      task("#2", "second", [], "completed"),
      task("#3", "third", [], "pending"),
    ]);
    expect(ready.map((item) => item.id)).toEqual(["#3"]);
  });

  test("excludes tasks with error status", () => {
    const ready = getReadyTasks([task("#1", "first", [], "error"), task("#2", "second", [], "pending")]);
    expect(ready.map((item) => item.id)).toEqual(["#2"]);
  });

  test("excludes tasks with completed status", () => {
    const ready = getReadyTasks([task("#1", "first", [], "completed"), task("#2", "second", [], "pending")]);
    expect(ready.map((item) => item.id)).toEqual(["#2"]);
  });

  test("normalizes blocker ids with or without leading #", () => {
    const ready = getReadyTasks([
      task("#1", "first", [], "completed"),
      task("#2", "second", ["1"], "pending"),
      task("3", "third", ["#1"], "pending"),
    ]);
    expect(ready.map((item) => item.id)).toEqual(["#2", "3"]);
  });

  test("handles multiple blockers requiring all completed", () => {
    const ready = getReadyTasks([
      task("#1", "first", [], "completed"),
      task("#2", "second", [], "completed"),
      task("#3", "third", ["#1", "#2"], "pending"),
      task("#4", "fourth", ["#1", "#2"], "pending"),
    ]);
    expect(ready.map((item) => item.id)).toEqual(["#3", "#4"]);
  });

  test("excludes tasks if any blocker is not completed", () => {
    const ready = getReadyTasks([
      task("#1", "first", [], "completed"),
      task("#2", "second", [], "pending"),
      task("#3", "third", ["#1", "#2"], "pending"),
    ]);
    expect(ready.map((item) => item.id)).toEqual(["#2"]);
  });

  test("handles tasks with unknown blockers", () => {
    const ready = getReadyTasks([task("#1", "first", ["#99"], "pending"), task("#2", "second", [], "pending")]);
    expect(ready.map((item) => item.id)).toEqual(["#2"]);
  });

  test("handles empty blockedBy array", () => {
    const ready = getReadyTasks([task("#1", "first", [], "pending")]);
    expect(ready.map((item) => item.id)).toEqual(["#1"]);
  });

  test("handles missing blockedBy field", () => {
    const ready = getReadyTasks([{ id: "#1", content: "first", status: "pending" }]);
    expect(ready.map((item) => item.id)).toEqual(["#1"]);
  });

  test("preserves original task order", () => {
    const ready = getReadyTasks([
      task("#5", "fifth", [], "pending"),
      task("#1", "first", [], "pending"),
      task("#3", "third", [], "pending"),
    ]);
    expect(ready.map((item) => item.id)).toEqual(["#5", "#1", "#3"]);
  });

  test("returns empty array when no tasks are ready", () => {
    const ready = getReadyTasks([
      task("#1", "first", [], "completed"),
      task("#2", "second", [], "in_progress"),
      task("#3", "third", ["#99"], "pending"),
    ]);
    expect(ready).toEqual([]);
  });

  test("does not mutate input array", () => {
    const tasks = [task("#1", "first", [], "completed"), task("#2", "second", ["#1"], "pending")];
    const before = JSON.parse(JSON.stringify(tasks));
    const ready = getReadyTasks(tasks);
    expect(tasks).toEqual(before);
    expect(ready).not.toBe(tasks);
  });
});
