import { describe, expect, test } from "bun:test";
import { detectDeadlock } from "@/components/task-order.ts";
import { task } from "./task-order.test-support.ts";

describe("detectDeadlock", () => {
  test("returns none for empty task list", () => {
    expect(detectDeadlock([])).toEqual({ type: "none" });
  });

  test("returns none for tasks with no dependencies", () => {
    expect(detectDeadlock([task("#1", "first"), task("#2", "second"), task("#3", "third")])).toEqual({ type: "none" });
  });

  test("returns none for valid dependency chain", () => {
    expect(detectDeadlock([
      task("#1", "first", [], "completed"),
      task("#2", "second", ["#1"], "pending"),
      task("#3", "third", ["#2"], "pending"),
    ])).toEqual({ type: "none" });
  });

  test("detects simple two-task cycle", () => {
    const result = detectDeadlock([task("#1", "first", ["#2"]), task("#2", "second", ["#1"])]);
    expect(result.type).toBe("cycle");
    if (result.type === "cycle") {
      expect(result.cycle).toContain("#1");
      expect(result.cycle).toContain("#2");
    }
  });

  test("detects three-task cycle", () => {
    const result = detectDeadlock([
      task("#1", "first", ["#3"]),
      task("#2", "second", ["#1"]),
      task("#3", "third", ["#2"]),
    ]);
    expect(result.type).toBe("cycle");
    if (result.type === "cycle") {
      expect(result.cycle).toContain("#1");
      expect(result.cycle).toContain("#2");
      expect(result.cycle).toContain("#3");
    }
  });

  test("detects self-referential cycle", () => {
    const result = detectDeadlock([task("#1", "self-ref", ["#1"]), task("#2", "independent")]);
    expect(result.type).toBe("cycle");
    if (result.type === "cycle") {
      expect(result.cycle).toContain("#1");
    }
  });

  test("detects error dependency for pending task", () => {
    expect(detectDeadlock([
      task("#1", "failed", [], "error"),
      task("#2", "waiting", ["#1"], "pending"),
    ])).toEqual({ type: "error_dependency", taskId: "#2", errorDependencies: ["#1"] });
  });

  test("detects multiple error dependencies", () => {
    const result = detectDeadlock([
      task("#1", "failed one", [], "error"),
      task("#2", "failed two", [], "error"),
      task("#3", "waiting", ["#1", "#2"], "pending"),
    ]);
    expect(result.type).toBe("error_dependency");
    if (result.type === "error_dependency") {
      expect(result.taskId).toBe("#3");
      expect(result.errorDependencies).toContain("#1");
      expect(result.errorDependencies).toContain("#2");
    }
  });

  test("prioritizes cycle detection over error dependencies", () => {
    const result = detectDeadlock([
      task("#1", "cycle one", ["#2"]),
      task("#2", "cycle two", ["#1"]),
      task("#3", "failed", [], "error"),
      task("#4", "waiting", ["#3"], "pending"),
    ]);
    expect(result.type).toBe("cycle");
  });

  test("ignores error dependencies for non-pending tasks", () => {
    expect(detectDeadlock([
      task("#1", "failed", [], "error"),
      task("#2", "completed with error dep", ["#1"], "completed"),
      task("#3", "in progress with error dep", ["#1"], "in_progress"),
      task("#4", "independent", [], "pending"),
    ])).toEqual({ type: "none" });
  });

  test("handles mixed valid and error dependencies", () => {
    expect(detectDeadlock([
      task("#1", "completed", [], "completed"),
      task("#2", "failed", [], "error"),
      task("#3", "waiting", ["#1", "#2"], "pending"),
    ])).toEqual({ type: "error_dependency", taskId: "#3", errorDependencies: ["#2"] });
  });

  test("normalizes task IDs with or without leading #", () => {
    expect(detectDeadlock([task("1", "first", ["2"]), task("#2", "second", ["1"])])).toMatchObject({ type: "cycle" });
  });

  test("ignores tasks with missing or duplicate IDs", () => {
    expect(detectDeadlock([
      task("#1", "duplicate one"),
      task("#1", "duplicate two"),
      task(undefined, "missing id", ["#1"]),
      task("#2", "valid", [], "pending"),
    ])).toEqual({ type: "none" });
  });

  test("ignores unknown blocker references in cycle detection", () => {
    expect(detectDeadlock([task("#1", "first", ["#99"]), task("#2", "second", [], "pending")])).toEqual({ type: "none" });
  });

  test("handles empty blockedBy array", () => {
    expect(detectDeadlock([task("#1", "first", []), task("#2", "second", [])])).toEqual({ type: "none" });
  });

  test("detects first pending task with error dependency when multiple exist", () => {
    expect(detectDeadlock([
      task("#1", "failed", [], "error"),
      task("#2", "waiting one", ["#1"], "pending"),
      task("#3", "waiting two", ["#1"], "pending"),
    ])).toEqual({ type: "error_dependency", taskId: "#2", errorDependencies: ["#1"] });
  });

  test("handles complex dependency graph without deadlock", () => {
    expect(detectDeadlock([
      task("#1", "first", [], "completed"),
      task("#2", "second", ["#1"], "completed"),
      task("#3", "third", ["#1"], "pending"),
      task("#4", "fourth", ["#2", "#3"], "pending"),
      task("#5", "fifth", [], "pending"),
    ])).toEqual({ type: "none" });
  });

  test("detects cycle in complex graph with multiple components", () => {
    const result = detectDeadlock([
      task("#1", "independent", [], "pending"),
      task("#2", "cycle start", ["#4"]),
      task("#3", "cycle mid", ["#2"]),
      task("#4", "cycle end", ["#3"]),
      task("#5", "another independent", [], "completed"),
    ]);
    expect(result.type).toBe("cycle");
    if (result.type === "cycle") {
      expect(result.cycle).toContain("#2");
      expect(result.cycle).toContain("#3");
      expect(result.cycle).toContain("#4");
    }
  });
});
