import { describe, expect, test } from "bun:test";

import type { TaskItem } from "./task-list-indicator.tsx";
import {
  detectDeadlock,
  getReadyTasks,
  sortTasksTopologically,
} from "./task-order.ts";

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

describe("detectDeadlock", () => {
  test("returns none for empty task list", () => {
    const result = detectDeadlock([]);
    expect(result).toEqual({ type: "none" });
  });

  test("returns none for tasks with no dependencies", () => {
    const tasks: TaskItem[] = [
      task("#1", "first"),
      task("#2", "second"),
      task("#3", "third"),
    ];

    const result = detectDeadlock(tasks);
    expect(result).toEqual({ type: "none" });
  });

  test("returns none for valid dependency chain", () => {
    const tasks: TaskItem[] = [
      task("#1", "first", [], "completed"),
      task("#2", "second", ["#1"], "pending"),
      task("#3", "third", ["#2"], "pending"),
    ];

    const result = detectDeadlock(tasks);
    expect(result).toEqual({ type: "none" });
  });

  test("detects simple two-task cycle", () => {
    const tasks: TaskItem[] = [
      task("#1", "first", ["#2"]),
      task("#2", "second", ["#1"]),
    ];

    const result = detectDeadlock(tasks);
    expect(result.type).toBe("cycle");
    if (result.type === "cycle") {
      expect(result.cycle).toHaveLength(2);
      expect(result.cycle).toContain("#1");
      expect(result.cycle).toContain("#2");
    }
  });

  test("detects three-task cycle", () => {
    const tasks: TaskItem[] = [
      task("#1", "first", ["#3"]),
      task("#2", "second", ["#1"]),
      task("#3", "third", ["#2"]),
    ];

    const result = detectDeadlock(tasks);
    expect(result.type).toBe("cycle");
    if (result.type === "cycle") {
      expect(result.cycle).toHaveLength(3);
      expect(result.cycle).toContain("#1");
      expect(result.cycle).toContain("#2");
      expect(result.cycle).toContain("#3");
    }
  });

  test("detects self-referential cycle", () => {
    const tasks: TaskItem[] = [
      task("#1", "self-ref", ["#1"]),
      task("#2", "independent"),
    ];

    const result = detectDeadlock(tasks);
    expect(result.type).toBe("cycle");
    if (result.type === "cycle") {
      expect(result.cycle).toContain("#1");
    }
  });

  test("detects error dependency for pending task", () => {
    const tasks: TaskItem[] = [
      task("#1", "failed", [], "error"),
      task("#2", "waiting", ["#1"], "pending"),
    ];

    const result = detectDeadlock(tasks);
    expect(result).toEqual({
      type: "error_dependency",
      taskId: "#2",
      errorDependencies: ["#1"],
    });
  });

  test("detects multiple error dependencies", () => {
    const tasks: TaskItem[] = [
      task("#1", "failed one", [], "error"),
      task("#2", "failed two", [], "error"),
      task("#3", "waiting", ["#1", "#2"], "pending"),
    ];

    const result = detectDeadlock(tasks);
    expect(result.type).toBe("error_dependency");
    if (result.type === "error_dependency") {
      expect(result.taskId).toBe("#3");
      expect(result.errorDependencies).toHaveLength(2);
      expect(result.errorDependencies).toContain("#1");
      expect(result.errorDependencies).toContain("#2");
    }
  });

  test("prioritizes cycle detection over error dependencies", () => {
    const tasks: TaskItem[] = [
      task("#1", "cycle one", ["#2"]),
      task("#2", "cycle two", ["#1"]),
      task("#3", "failed", [], "error"),
      task("#4", "waiting", ["#3"], "pending"),
    ];

    const result = detectDeadlock(tasks);
    // Should detect cycle first
    expect(result.type).toBe("cycle");
  });

  test("ignores error dependencies for non-pending tasks", () => {
    const tasks: TaskItem[] = [
      task("#1", "failed", [], "error"),
      task("#2", "completed with error dep", ["#1"], "completed"),
      task("#3", "in progress with error dep", ["#1"], "in_progress"),
      task("#4", "independent", [], "pending"),
    ];

    const result = detectDeadlock(tasks);
    expect(result).toEqual({ type: "none" });
  });

  test("handles mixed valid and error dependencies", () => {
    const tasks: TaskItem[] = [
      task("#1", "completed", [], "completed"),
      task("#2", "failed", [], "error"),
      task("#3", "waiting", ["#1", "#2"], "pending"),
    ];

    const result = detectDeadlock(tasks);
    expect(result).toEqual({
      type: "error_dependency",
      taskId: "#3",
      errorDependencies: ["#2"],
    });
  });

  test("normalizes task IDs with or without leading #", () => {
    const tasks: TaskItem[] = [
      task("1", "first", ["2"]),
      task("#2", "second", ["1"]),
    ];

    const result = detectDeadlock(tasks);
    expect(result.type).toBe("cycle");
  });

  test("ignores tasks with missing or duplicate IDs", () => {
    const tasks: TaskItem[] = [
      task("#1", "duplicate one"),
      task("#1", "duplicate two"),
      task(undefined, "missing id", ["#1"]),
      task("#2", "valid", [], "pending"),
    ];

    const result = detectDeadlock(tasks);
    expect(result).toEqual({ type: "none" });
  });

  test("ignores unknown blocker references in cycle detection", () => {
    const tasks: TaskItem[] = [
      task("#1", "first", ["#99"]),
      task("#2", "second", [], "pending"),
    ];

    const result = detectDeadlock(tasks);
    // #99 doesn't exist, so no cycle, no error dependency
    expect(result).toEqual({ type: "none" });
  });

  test("handles empty blockedBy array", () => {
    const tasks: TaskItem[] = [
      task("#1", "first", []),
      task("#2", "second", []),
    ];

    const result = detectDeadlock(tasks);
    expect(result).toEqual({ type: "none" });
  });

  test("detects first pending task with error dependency when multiple exist", () => {
    const tasks: TaskItem[] = [
      task("#1", "failed", [], "error"),
      task("#2", "waiting one", ["#1"], "pending"),
      task("#3", "waiting two", ["#1"], "pending"),
    ];

    const result = detectDeadlock(tasks);
    expect(result).toEqual({
      type: "error_dependency",
      taskId: "#2",
      errorDependencies: ["#1"],
    });
  });

  test("handles complex dependency graph without deadlock", () => {
    const tasks: TaskItem[] = [
      task("#1", "first", [], "completed"),
      task("#2", "second", ["#1"], "completed"),
      task("#3", "third", ["#1"], "pending"),
      task("#4", "fourth", ["#2", "#3"], "pending"),
      task("#5", "fifth", [], "pending"),
    ];

    const result = detectDeadlock(tasks);
    expect(result).toEqual({ type: "none" });
  });

  test("detects cycle in complex graph with multiple components", () => {
    const tasks: TaskItem[] = [
      task("#1", "independent", [], "pending"),
      task("#2", "cycle start", ["#4"]),
      task("#3", "cycle mid", ["#2"]),
      task("#4", "cycle end", ["#3"]),
      task("#5", "another independent", [], "completed"),
    ];

    const result = detectDeadlock(tasks);
    expect(result.type).toBe("cycle");
    if (result.type === "cycle") {
      expect(result.cycle).toHaveLength(3);
      expect(result.cycle).toContain("#2");
      expect(result.cycle).toContain("#3");
      expect(result.cycle).toContain("#4");
    }
  });
});

