import { describe, expect, test } from "bun:test";
import {
  applyRuntimeTask,
  buildReviewFixTasks,
  getReadyTasks,
  hasActionableTasks,
  stripPriorityPrefix,
  toRuntimeTask,
} from "@/services/workflows/builtin/ralph/helpers/tasks.ts";
import type { TaskItem } from "@/services/workflows/builtin/ralph/helpers/prompts.ts";
import type { WorkflowRuntimeTask } from "@/services/workflows/runtime-contracts.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function task(
  id: string | undefined,
  description: string,
  blockedBy: string[] = [],
  status = "pending",
): TaskItem {
  return { id, description, status, summary: `Working on ${description}`, blockedBy };
}

// ---------------------------------------------------------------------------
// getReadyTasks
// ---------------------------------------------------------------------------

describe("getReadyTasks", () => {
  test("returns pending tasks with no dependencies", () => {
    const tasks = [task("#1", "first"), task("#2", "second")];
    const ready = getReadyTasks(tasks);
    expect(ready.map((t) => t.id)).toEqual(["#1", "#2"]);
  });

  test("returns pending tasks whose blockers are all completed", () => {
    const tasks = [
      task("#1", "first", [], "completed"),
      task("#2", "second", ["#1"]),
    ];
    const ready = getReadyTasks(tasks);
    expect(ready.map((t) => t.id)).toEqual(["#2"]);
  });

  test("excludes pending tasks with incomplete blockers", () => {
    const tasks = [
      task("#1", "first"),
      task("#2", "second", ["#1"]),
    ];
    const ready = getReadyTasks(tasks);
    expect(ready.map((t) => t.id)).toEqual(["#1"]);
  });

  test("excludes non-pending tasks", () => {
    const tasks = [
      task("#1", "first", [], "in_progress"),
      task("#2", "second", [], "completed"),
      task("#3", "third", [], "error"),
      task("#4", "fourth"),
    ];
    const ready = getReadyTasks(tasks);
    expect(ready.map((t) => t.id)).toEqual(["#4"]);
  });

  test("propagates error status to direct dependents", () => {
    const tasks = [
      task("#1", "first", [], "error"),
      task("#2", "second", ["#1"]),
    ];
    const ready = getReadyTasks(tasks);
    expect(ready).toEqual([]);
  });

  test("propagates error status transitively via BFS", () => {
    const tasks = [
      task("#1", "root task", [], "error"),
      task("#2", "intermediate", ["#1"], "completed"),
      task("#3", "leaf", ["#2"]),
    ];
    const ready = getReadyTasks(tasks);
    // #3 depends on #2, which depends on #1 (error).
    // Even though #2 is "completed", it's transitively error-propagated,
    // so #3 should be excluded.
    expect(ready).toEqual([]);
  });

  test("normalizes IDs with # prefix for matching", () => {
    const tasks = [
      task("#1", "first", [], "completed"),
      task("#2", "second", ["1"]),  // blocker id without #
    ];
    const ready = getReadyTasks(tasks);
    expect(ready.map((t) => t.id)).toEqual(["#2"]);
  });

  test("normalizes multiple leading # characters", () => {
    const tasks = [
      task("##1", "first", [], "completed"),
      task("#2", "second", ["###1"]),
    ];
    const ready = getReadyTasks(tasks);
    expect(ready.map((t) => t.id)).toEqual(["#2"]);
  });

  test("handles tasks with undefined id gracefully", () => {
    const tasks = [
      task(undefined, "no id task"),
    ];
    const ready = getReadyTasks(tasks);
    // Task has no id, but is pending with no deps, so it should be ready
    expect(ready).toHaveLength(1);
    expect(ready[0]!.description).toBe("no id task");
  });

  test("returns empty array when all tasks are completed", () => {
    const tasks = [
      task("#1", "first", [], "completed"),
      task("#2", "second", ["#1"], "completed"),
    ];
    const ready = getReadyTasks(tasks);
    expect(ready).toEqual([]);
  });

  test("handles complex dependency graph with mixed statuses", () => {
    const tasks = [
      task("#1", "foundation", [], "completed"),
      task("#2", "feature-a", ["#1"], "completed"),
      task("#3", "feature-b", ["#1"]),
      task("#4", "integration", ["#2", "#3"]),
      task("#5", "independent"),
    ];
    const ready = getReadyTasks(tasks);
    // #3 is pending with completed blocker #1 → ready
    // #4 is pending with #2 completed but #3 still pending → not ready
    // #5 is pending with no blockers → ready
    expect(ready.map((t) => t.id)).toEqual(["#3", "#5"]);
  });

  test("handles case-insensitive id comparison", () => {
    const tasks: TaskItem[] = [
      { id: "#A", description: "first", status: "completed", summary: "s", blockedBy: [] },
      { id: "#b", description: "second", status: "pending", summary: "s", blockedBy: ["#A"] },
    ];
    const ready = getReadyTasks(tasks);
    expect(ready.map((t) => t.id)).toEqual(["#b"]);
  });

  test("handles empty blockedBy with undefined", () => {
    const t: TaskItem = {
      id: "#1",
      description: "task",
      status: "pending",
      summary: "s",
      blockedBy: undefined,
    };
    const ready = getReadyTasks([t]);
    expect(ready).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// hasActionableTasks
// ---------------------------------------------------------------------------

describe("hasActionableTasks", () => {
  test("returns true when a task is in_progress", () => {
    const tasks = [
      task("#1", "first", [], "in_progress"),
      task("#2", "second", ["#1"]),
    ];
    expect(hasActionableTasks(tasks)).toBe(true);
  });

  test("returns true when pending tasks are ready", () => {
    const tasks = [task("#1", "first")];
    expect(hasActionableTasks(tasks)).toBe(true);
  });

  test("returns false when all tasks are completed", () => {
    const tasks = [
      task("#1", "first", [], "completed"),
      task("#2", "second", ["#1"], "completed"),
    ];
    expect(hasActionableTasks(tasks)).toBe(false);
  });

  test("returns false when all pending tasks are blocked", () => {
    const tasks = [
      task("#1", "first", [], "error"),
      task("#2", "second", ["#1"]),
    ];
    // #2 is pending but blocked by errored #1, so not ready
    expect(hasActionableTasks(tasks)).toBe(false);
  });

  test("returns false for empty task list", () => {
    expect(hasActionableTasks([])).toBe(false);
  });

  test("returns true when mix of completed and ready pending", () => {
    const tasks = [
      task("#1", "first", [], "completed"),
      task("#2", "second"),
    ];
    expect(hasActionableTasks(tasks)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// stripPriorityPrefix
// ---------------------------------------------------------------------------

describe("stripPriorityPrefix", () => {
  test("strips [P1] prefix", () => {
    expect(stripPriorityPrefix("[P1] Fix critical bug")).toBe("Fix critical bug");
  });

  test("strips [p2] prefix (lowercase)", () => {
    expect(stripPriorityPrefix("[p2] Add feature")).toBe("Add feature");
  });

  test("strips [P0] prefix", () => {
    expect(stripPriorityPrefix("[P0] Emergency fix")).toBe("Emergency fix");
  });

  test("strips [P9] prefix", () => {
    expect(stripPriorityPrefix("[P9] Low priority task")).toBe("Low priority task");
  });

  test("returns original string when no prefix present", () => {
    expect(stripPriorityPrefix("No priority here")).toBe("No priority here");
  });

  test("handles leading whitespace before prefix", () => {
    expect(stripPriorityPrefix("  [P1] Indented task")).toBe("Indented task");
  });

  test("handles multiple spaces after prefix", () => {
    expect(stripPriorityPrefix("[P1]   Extra spaces")).toBe("Extra spaces");
  });

  test("does not strip non-priority brackets", () => {
    expect(stripPriorityPrefix("[Bug] Fix issue")).toBe("[Bug] Fix issue");
  });

  test("returns empty string for prefix-only input", () => {
    expect(stripPriorityPrefix("[P1]")).toBe("");
  });

  test("trims result", () => {
    expect(stripPriorityPrefix("[P1]   ")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// toRuntimeTask
// ---------------------------------------------------------------------------

describe("toRuntimeTask", () => {
  test("maps TaskItem fields to WorkflowRuntimeTask", () => {
    const item = task("#1", "Implement feature", ["#0"], "pending");
    const result = toRuntimeTask(item, "fallback-id");
    expect(result.id).toBe("#1");
    expect(result.title).toBe("Implement feature");
    expect(result.status).toBe("pending");
    expect(result.blockedBy).toEqual(["#0"]);
  });

  test("uses fallbackId when task id is undefined", () => {
    const item = task(undefined, "No id task");
    const result = toRuntimeTask(item, "fallback-42");
    expect(result.id).toBe("fallback-42");
  });

  test("normalizes status string to valid WorkflowRuntimeTaskStatus", () => {
    const item = task("#1", "Task", [], "IN_PROGRESS");
    const result = toRuntimeTask(item, "fb");
    expect(result.status).toBe("in_progress");
  });

  test("falls back to pending for unknown status", () => {
    const item = task("#1", "Task", [], "banana");
    const result = toRuntimeTask(item, "fb");
    expect(result.status).toBe("pending");
  });

  test("preserves identity field", () => {
    const item: TaskItem = {
      ...task("#1", "Task"),
      identity: { canonicalId: "canon-1" },
    };
    const result = toRuntimeTask(item, "fb");
    expect(result.identity).toEqual({ canonicalId: "canon-1" });
  });

  test("preserves taskResult field", () => {
    const envelope = {
      task_id: "#1",
      tool_name: "test",
      title: "Task",
      status: "completed" as const,
      output_text: "done",
    };
    const item: TaskItem = {
      ...task("#1", "Task", [], "completed"),
      taskResult: envelope,
    };
    const result = toRuntimeTask(item, "fb");
    expect(result.taskResult).toEqual(envelope);
  });

  test("handles undefined blockedBy", () => {
    const item: TaskItem = {
      id: "#1",
      description: "Task",
      status: "pending",
      summary: "Working",
      blockedBy: undefined,
    };
    const result = toRuntimeTask(item, "fb");
    expect(result.blockedBy).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// applyRuntimeTask
// ---------------------------------------------------------------------------

describe("applyRuntimeTask", () => {
  test("merges runtime task fields into TaskItem", () => {
    const original = task("#1", "Original desc", [], "pending");
    const runtime: WorkflowRuntimeTask = {
      id: "#1",
      title: "Updated title",
      status: "completed",
      blockedBy: [],
      identity: { canonicalId: "canon-1" },
    };
    const result = applyRuntimeTask(original, runtime);
    expect(result.id).toBe("#1");
    expect(result.status).toBe("completed");
    expect(result.identity).toEqual({ canonicalId: "canon-1" });
    // description and summary are preserved from original
    expect(result.description).toBe("Original desc");
    expect(result.summary).toBe("Working on Original desc");
  });

  test("preserves taskResult from original when runtime has none", () => {
    const envelope = {
      task_id: "#1",
      tool_name: "test",
      title: "Task",
      status: "completed" as const,
      output_text: "done",
    };
    const original: TaskItem = {
      ...task("#1", "Task", [], "completed"),
      taskResult: envelope,
    };
    const runtime: WorkflowRuntimeTask = {
      id: "#1",
      title: "Task",
      status: "completed",
    };
    const result = applyRuntimeTask(original, runtime);
    expect(result.taskResult).toEqual(envelope);
  });

  test("overwrites taskResult when runtime provides one", () => {
    const originalEnvelope = {
      task_id: "#1",
      tool_name: "test",
      title: "Task",
      status: "completed" as const,
      output_text: "old output",
    };
    const runtimeEnvelope = {
      task_id: "#1",
      tool_name: "test",
      title: "Task",
      status: "error" as const,
      output_text: "new output",
      error: "something failed",
    };
    const original: TaskItem = {
      ...task("#1", "Task"),
      taskResult: originalEnvelope,
    };
    const runtime: WorkflowRuntimeTask = {
      id: "#1",
      title: "Task",
      status: "error",
      taskResult: runtimeEnvelope,
    };
    const result = applyRuntimeTask(original, runtime);
    expect(result.taskResult).toEqual(runtimeEnvelope);
  });

  test("updates blockedBy from runtime", () => {
    const original = task("#2", "Task", ["#1"], "pending");
    const runtime: WorkflowRuntimeTask = {
      id: "#2",
      title: "Task",
      status: "pending",
      blockedBy: ["#1", "#3"],
    };
    const result = applyRuntimeTask(original, runtime);
    expect(result.blockedBy).toEqual(["#1", "#3"]);
  });

  test("updates id from runtime", () => {
    const original = task("#old", "Task");
    const runtime: WorkflowRuntimeTask = {
      id: "#new",
      title: "Task",
      status: "pending",
    };
    const result = applyRuntimeTask(original, runtime);
    expect(result.id).toBe("#new");
  });

  test("does not include taskResult key when both original and runtime lack it", () => {
    const original = task("#1", "Task");
    const runtime: WorkflowRuntimeTask = {
      id: "#1",
      title: "Task",
      status: "in_progress",
    };
    const result = applyRuntimeTask(original, runtime);
    expect("taskResult" in result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildReviewFixTasks
// ---------------------------------------------------------------------------

describe("buildReviewFixTasks", () => {
  test("returns default task when findings are empty", () => {
    const result = buildReviewFixTasks([]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: "#review-fix-1",
      description: "Address review feedback",
      status: "pending",
      summary: "Addressing review feedback",
      blockedBy: [],
    });
  });

  test("creates one task per finding with titles", () => {
    const findings = [
      { title: "Fix typo in readme", body: "There's a typo" },
      { title: "Add error handling", body: "Missing try/catch" },
    ];
    const result = buildReviewFixTasks(findings);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      id: "#review-fix-1",
      description: "Fix typo in readme",
      status: "pending",
      summary: "Addressing Fix typo in readme",
      blockedBy: [],
    });
    expect(result[1]).toEqual({
      id: "#review-fix-2",
      description: "Add error handling",
      status: "pending",
      summary: "Addressing Add error handling",
      blockedBy: [],
    });
  });

  test("strips priority prefix from finding titles", () => {
    const findings = [
      { title: "[P1] Critical bug fix", body: "Fix it" },
      { title: "[p2] Minor improvement", body: "Improve it" },
    ];
    const result = buildReviewFixTasks(findings);
    expect(result[0]!.description).toBe("Critical bug fix");
    expect(result[1]!.description).toBe("Minor improvement");
  });

  test("uses fallback description when title is missing", () => {
    const findings = [
      { body: "No title here" },
      { title: undefined, body: "Also no title" },
    ];
    const result = buildReviewFixTasks(findings);
    expect(result[0]!.description).toBe("Address review finding 1");
    expect(result[1]!.description).toBe("Address review finding 2");
    expect(result[0]!.summary).toBe("Addressing Address review finding 1");
  });

  test("uses fallback description when title is empty string", () => {
    const findings = [{ title: "", body: "Empty title" }];
    const result = buildReviewFixTasks(findings);
    expect(result[0]!.description).toBe("Address review finding 1");
  });

  test("uses fallback when title becomes empty after stripping prefix", () => {
    const findings = [{ title: "[P1]", body: "Only priority prefix" }];
    const result = buildReviewFixTasks(findings);
    expect(result[0]!.description).toBe("Address review finding 1");
  });

  test("generates sequential review-fix IDs", () => {
    const findings = [
      { title: "A" },
      { title: "B" },
      { title: "C" },
    ];
    const result = buildReviewFixTasks(findings);
    expect(result.map((t) => t.id)).toEqual([
      "#review-fix-1",
      "#review-fix-2",
      "#review-fix-3",
    ]);
  });

  test("all generated tasks have pending status and empty blockedBy", () => {
    const findings = [{ title: "A" }, { title: "B" }];
    const result = buildReviewFixTasks(findings);
    for (const t of result) {
      expect(t.status).toBe("pending");
      expect(t.blockedBy).toEqual([]);
    }
  });
});
