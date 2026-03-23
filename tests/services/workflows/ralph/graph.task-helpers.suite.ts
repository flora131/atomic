import { describe, expect, test } from "bun:test";
import { getReadyTasks, hasActionableTasks } from "@/services/workflows/builtin/ralph/helpers/tasks.ts";
import type { TaskItem } from "@/services/workflows/builtin/ralph/helpers/prompts.ts";

function task(
  id: string | undefined,
  description: string,
  blockedBy: string[] = [],
  status = "pending",
): TaskItem {
  return { id, description, status, summary: `Working on ${description}`, blockedBy };
}

describe("getReadyTasks (graph layer)", () => {
  // --- Basic filtering ---

  test("returns pending tasks with no blockers", () => {
    const ready = getReadyTasks([task("#1", "first"), task("#2", "second")]);
    expect(ready.map((t) => t.id)).toEqual(["#1", "#2"]);
  });

  test("returns pending tasks whose blockers are all completed", () => {
    const ready = getReadyTasks([
      task("#1", "first", [], "completed"),
      task("#2", "second", ["#1"]),
      task("#3", "third", ["#1"]),
    ]);
    expect(ready.map((t) => t.id)).toEqual(["#2", "#3"]);
  });

  test("excludes pending tasks with incomplete blockers", () => {
    const ready = getReadyTasks([
      task("#1", "first"),
      task("#2", "second", ["#1"]),
    ]);
    expect(ready.map((t) => t.id)).toEqual(["#1"]);
  });

  test("excludes tasks with in_progress status", () => {
    const ready = getReadyTasks([
      task("#1", "first", [], "in_progress"),
      task("#2", "second", [], "completed"),
      task("#3", "third"),
    ]);
    expect(ready.map((t) => t.id)).toEqual(["#3"]);
  });

  test("excludes tasks with error status from ready set", () => {
    const ready = getReadyTasks([
      task("#1", "first", [], "error"),
      task("#2", "second"),
    ]);
    expect(ready.map((t) => t.id)).toEqual(["#2"]);
  });

  test("excludes tasks with completed status", () => {
    const ready = getReadyTasks([
      task("#1", "first", [], "completed"),
      task("#2", "second"),
    ]);
    expect(ready.map((t) => t.id)).toEqual(["#2"]);
  });

  // --- ID normalization ---

  test("normalizes blocker ids with or without leading #", () => {
    const ready = getReadyTasks([
      task("#1", "first", [], "completed"),
      task("#2", "second", ["1"]),
      task("3", "third", ["#1"]),
    ]);
    expect(ready.map((t) => t.id)).toEqual(["#2", "3"]);
  });

  test("normalizes multiple leading # characters", () => {
    const ready = getReadyTasks([
      task("##1", "first", [], "completed"),
      task("#2", "second", ["###1"]),
    ]);
    expect(ready.map((t) => t.id)).toEqual(["#2"]);
  });

  test("normalizes case-insensitively", () => {
    const ready = getReadyTasks([
      task("#Setup", "setup", [], "completed"),
      task("#build", "build", ["#SETUP"]),
    ]);
    expect(ready.map((t) => t.id)).toEqual(["#build"]);
  });

  // --- Dependency enforcement ---

  test("handles multiple blockers requiring all completed", () => {
    const ready = getReadyTasks([
      task("#1", "first", [], "completed"),
      task("#2", "second", [], "completed"),
      task("#3", "third", ["#1", "#2"]),
      task("#4", "fourth", ["#1", "#2"]),
    ]);
    expect(ready.map((t) => t.id)).toEqual(["#3", "#4"]);
  });

  test("excludes tasks if any blocker is not completed", () => {
    const ready = getReadyTasks([
      task("#1", "first", [], "completed"),
      task("#2", "second"),
      task("#3", "third", ["#1", "#2"]),
    ]);
    expect(ready.map((t) => t.id)).toEqual(["#2"]);
  });

  test("handles tasks with unknown blockers as blocking", () => {
    const ready = getReadyTasks([
      task("#1", "first", ["#99"]),
      task("#2", "second"),
    ]);
    expect(ready.map((t) => t.id)).toEqual(["#2"]);
  });

  test("handles empty blockedBy array", () => {
    const ready = getReadyTasks([task("#1", "first", [])]);
    expect(ready.map((t) => t.id)).toEqual(["#1"]);
  });

  test("handles missing blockedBy field", () => {
    const t: TaskItem = { id: "#1", description: "first", status: "pending", summary: "s" };
    expect(getReadyTasks([t]).map((item) => item.id)).toEqual(["#1"]);
  });

  // --- Error propagation ---

  test("excludes pending task directly blocked by errored task", () => {
    const ready = getReadyTasks([
      task("#1", "first", [], "error"),
      task("#2", "second", ["#1"]),
    ]);
    expect(ready).toEqual([]);
  });

  test("excludes task transitively blocked by errored task through pending intermediate", () => {
    const ready = getReadyTasks([
      task("#1", "first", [], "error"),
      task("#2", "second", ["#1"]),
      task("#3", "third", ["#2"]),
    ]);
    expect(ready).toEqual([]);
  });

  test("excludes task transitively blocked by error even when intermediate is completed", () => {
    // Data inconsistency: #2 is "completed" despite its blocker #1 having errored.
    // Error propagation should still exclude #3 because #1 errored.
    const ready = getReadyTasks([
      task("#1", "first", [], "error"),
      task("#2", "second", ["#1"], "completed"),
      task("#3", "third", ["#2"]),
    ]);
    expect(ready).toEqual([]);
  });

  test("propagates error through deep dependency chain", () => {
    const ready = getReadyTasks([
      task("#1", "root", [], "error"),
      task("#2", "level-1", ["#1"]),
      task("#3", "level-2", ["#2"]),
      task("#4", "level-3", ["#3"]),
      task("#5", "level-4", ["#4"]),
    ]);
    expect(ready).toEqual([]);
  });

  test("does not propagate error to unrelated tasks", () => {
    const ready = getReadyTasks([
      task("#1", "errored", [], "error"),
      task("#2", "blocked-by-error", ["#1"]),
      task("#3", "independent"),
    ]);
    expect(ready.map((t) => t.id)).toEqual(["#3"]);
  });

  test("handles diamond dependency with error at root", () => {
    // #1(error) → #2, #3 → #4
    const ready = getReadyTasks([
      task("#1", "root", [], "error"),
      task("#2", "left", ["#1"]),
      task("#3", "right", ["#1"]),
      task("#4", "join", ["#2", "#3"]),
    ]);
    expect(ready).toEqual([]);
  });

  test("handles partial error in diamond — non-errored branch still blocked", () => {
    // #1(completed), #2(error) → #3 depends on both
    const ready = getReadyTasks([
      task("#1", "ok-root", [], "completed"),
      task("#2", "bad-root", [], "error"),
      task("#3", "join", ["#1", "#2"]),
    ]);
    expect(ready).toEqual([]);
  });

  test("error propagation with multiple independent error sources", () => {
    const ready = getReadyTasks([
      task("#1", "error-a", [], "error"),
      task("#2", "error-b", [], "error"),
      task("#3", "blocked-by-a", ["#1"]),
      task("#4", "blocked-by-b", ["#2"]),
      task("#5", "independent"),
    ]);
    expect(ready.map((t) => t.id)).toEqual(["#5"]);
  });

  // --- Ordering and immutability ---

  test("preserves original task order", () => {
    const ready = getReadyTasks([
      task("#5", "fifth"),
      task("#1", "first"),
      task("#3", "third"),
    ]);
    expect(ready.map((t) => t.id)).toEqual(["#5", "#1", "#3"]);
  });

  test("returns empty array when no tasks are ready", () => {
    const ready = getReadyTasks([
      task("#1", "first", [], "completed"),
      task("#2", "second", [], "in_progress"),
      task("#3", "third", ["#99"]),
    ]);
    expect(ready).toEqual([]);
  });

  test("returns empty array for empty input", () => {
    expect(getReadyTasks([])).toEqual([]);
  });

  test("does not mutate input array", () => {
    const tasks = [
      task("#1", "first", [], "completed"),
      task("#2", "second", ["#1"]),
    ];
    const before = JSON.parse(JSON.stringify(tasks));
    const ready = getReadyTasks(tasks);
    expect(tasks).toEqual(before);
    expect(ready).not.toBe(tasks);
  });
});

describe("hasActionableTasks (graph layer)", () => {
  test("returns true when a task is in_progress", () => {
    expect(hasActionableTasks([task("#1", "a", [], "in_progress")])).toBe(true);
  });

  test("returns true when a pending task has no blockers", () => {
    expect(hasActionableTasks([task("#1", "a")])).toBe(true);
  });

  test("returns true when a pending task has all blockers completed", () => {
    expect(hasActionableTasks([
      task("#1", "a", [], "completed"),
      task("#2", "b", ["#1"]),
    ])).toBe(true);
  });

  test("returns false when all tasks are completed", () => {
    expect(hasActionableTasks([
      task("#1", "a", [], "completed"),
      task("#2", "b", [], "completed"),
    ])).toBe(false);
  });

  test("returns false when remaining pending tasks are blocked by errors", () => {
    expect(hasActionableTasks([
      task("#1", "a", [], "error"),
      task("#2", "b", ["#1"]),
    ])).toBe(false);
  });

  test("returns false when all pending tasks are transitively blocked by errors", () => {
    expect(hasActionableTasks([
      task("#1", "a", [], "error"),
      task("#2", "b", ["#1"]),
      task("#3", "c", ["#2"]),
    ])).toBe(false);
  });

  test("returns false for empty input", () => {
    expect(hasActionableTasks([])).toBe(false);
  });
});
