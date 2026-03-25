/**
 * Tests for the task-status normalization helpers.
 *
 * Covers:
 * - isTaskStatus — validates strings against the known status set
 * - normalizeTaskStatus — canonicalizes status aliases
 * - isTodoWriteToolName — recognises TodoWrite tool variants
 * - normalizeTaskItem / normalizeTodoItem — robust input normalization
 * - normalizeTaskItems / normalizeTodoItems — array wrappers
 * - mergeBlockedBy — restores dependency metadata from previous state
 * - reconcileTodoWriteItems — full pipeline: normalize → merge → stabilize → sort
 */

import { describe, test, expect } from "bun:test";
import {
  TASK_STATUS_VALUES,
  isTaskStatus,
  normalizeTaskStatus,
  isTodoWriteToolName,
  normalizeTaskItem,
  normalizeTodoItem,
  normalizeTaskItems,
  normalizeTodoItems,
  mergeBlockedBy,
  reconcileTodoWriteItems,
  type TaskStatus,
  type NormalizedTaskItem,
  type NormalizedTodoItem,
} from "@/state/parts/helpers/task-status.ts";

// ---------------------------------------------------------------------------
// TASK_STATUS_VALUES constant
// ---------------------------------------------------------------------------

describe("TASK_STATUS_VALUES", () => {
  test("contains exactly the four canonical statuses", () => {
    expect(TASK_STATUS_VALUES).toEqual(["pending", "in_progress", "completed", "error"]);
  });

  test("is a readonly tuple (length is 4)", () => {
    expect(TASK_STATUS_VALUES.length).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// isTaskStatus
// ---------------------------------------------------------------------------

describe("isTaskStatus", () => {
  test("returns true for all canonical status values", () => {
    for (const status of TASK_STATUS_VALUES) {
      expect(isTaskStatus(status)).toBe(true);
    }
  });

  test("returns true for known aliases", () => {
    const aliases = [
      "todo", "open", "not_started",
      "inprogress", "doing", "running", "active",
      "complete", "done", "success", "succeeded",
      "failed", "failure",
    ];
    for (const alias of aliases) {
      expect(isTaskStatus(alias)).toBe(true);
    }
  });

  test("returns false for unknown strings", () => {
    expect(isTaskStatus("unknown")).toBe(false);
    expect(isTaskStatus("cancelled")).toBe(false);
    expect(isTaskStatus("skipped")).toBe(false);
    expect(isTaskStatus("")).toBe(false);
  });

  test("returns false for non-string types", () => {
    expect(isTaskStatus(42)).toBe(false);
    expect(isTaskStatus(null)).toBe(false);
    expect(isTaskStatus(undefined)).toBe(false);
    expect(isTaskStatus(true)).toBe(false);
    expect(isTaskStatus({})).toBe(false);
  });

  test("handles whitespace and case normalization", () => {
    expect(isTaskStatus("  Pending  ")).toBe(true);
    expect(isTaskStatus("COMPLETED")).toBe(true);
    expect(isTaskStatus("In Progress")).toBe(true);
    expect(isTaskStatus("IN-PROGRESS")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// normalizeTaskStatus
// ---------------------------------------------------------------------------

describe("normalizeTaskStatus", () => {
  test("returns canonical form for canonical inputs", () => {
    expect(normalizeTaskStatus("pending")).toBe("pending");
    expect(normalizeTaskStatus("in_progress")).toBe("in_progress");
    expect(normalizeTaskStatus("completed")).toBe("completed");
    expect(normalizeTaskStatus("error")).toBe("error");
  });

  test("normalizes 'pending' aliases", () => {
    expect(normalizeTaskStatus("todo")).toBe("pending");
    expect(normalizeTaskStatus("open")).toBe("pending");
    expect(normalizeTaskStatus("not_started")).toBe("pending");
  });

  test("normalizes 'in_progress' aliases", () => {
    expect(normalizeTaskStatus("inprogress")).toBe("in_progress");
    expect(normalizeTaskStatus("doing")).toBe("in_progress");
    expect(normalizeTaskStatus("running")).toBe("in_progress");
    expect(normalizeTaskStatus("active")).toBe("in_progress");
  });

  test("normalizes 'completed' aliases", () => {
    expect(normalizeTaskStatus("complete")).toBe("completed");
    expect(normalizeTaskStatus("done")).toBe("completed");
    expect(normalizeTaskStatus("success")).toBe("completed");
    expect(normalizeTaskStatus("succeeded")).toBe("completed");
  });

  test("normalizes 'error' aliases", () => {
    expect(normalizeTaskStatus("failed")).toBe("error");
    expect(normalizeTaskStatus("failure")).toBe("error");
  });

  test("handles case insensitivity", () => {
    expect(normalizeTaskStatus("PENDING")).toBe("pending");
    expect(normalizeTaskStatus("Completed")).toBe("completed");
    expect(normalizeTaskStatus("IN_PROGRESS")).toBe("in_progress");
    expect(normalizeTaskStatus("ERROR")).toBe("error");
  });

  test("handles whitespace and hyphens in input", () => {
    expect(normalizeTaskStatus("  in progress  ")).toBe("in_progress");
    expect(normalizeTaskStatus("in-progress")).toBe("in_progress");
    expect(normalizeTaskStatus("not started")).toBe("pending");
    expect(normalizeTaskStatus("not-started")).toBe("pending");
  });

  test("defaults to 'pending' for unknown strings", () => {
    expect(normalizeTaskStatus("unknown")).toBe("pending");
    expect(normalizeTaskStatus("")).toBe("pending");
    expect(normalizeTaskStatus("cancelled")).toBe("pending");
  });

  test("defaults to 'pending' for non-string types", () => {
    expect(normalizeTaskStatus(42)).toBe("pending");
    expect(normalizeTaskStatus(null)).toBe("pending");
    expect(normalizeTaskStatus(undefined)).toBe("pending");
    expect(normalizeTaskStatus(true)).toBe("pending");
    expect(normalizeTaskStatus({})).toBe("pending");
  });
});

// ---------------------------------------------------------------------------
// isTodoWriteToolName
// ---------------------------------------------------------------------------

describe("isTodoWriteToolName", () => {
  test("returns true for exact 'TodoWrite'", () => {
    expect(isTodoWriteToolName("TodoWrite")).toBe(true);
  });

  test("returns true for case variants", () => {
    expect(isTodoWriteToolName("todowrite")).toBe(true);
    expect(isTodoWriteToolName("TODOWRITE")).toBe(true);
    expect(isTodoWriteToolName("todoWrite")).toBe(true);
  });

  test("returns true for variants with separators", () => {
    expect(isTodoWriteToolName("todo_write")).toBe(true);
    expect(isTodoWriteToolName("todo-write")).toBe(true);
    expect(isTodoWriteToolName("Todo_Write")).toBe(true);
    expect(isTodoWriteToolName("todo write")).toBe(true);
  });

  test("returns false for other tool names", () => {
    expect(isTodoWriteToolName("Read")).toBe(false);
    expect(isTodoWriteToolName("Bash")).toBe(false);
    expect(isTodoWriteToolName("TodoRead")).toBe(false);
    expect(isTodoWriteToolName("")).toBe(false);
  });

  test("returns false for non-string types", () => {
    expect(isTodoWriteToolName(42)).toBe(false);
    expect(isTodoWriteToolName(null)).toBe(false);
    expect(isTodoWriteToolName(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// normalizeTaskItem
// ---------------------------------------------------------------------------

describe("normalizeTaskItem", () => {
  test("normalizes a well-formed input object", () => {
    const input = {
      id: "1",
      description: "Implement feature",
      status: "completed",
      blockedBy: ["2"],
    };
    const result = normalizeTaskItem(input);
    expect(result.id).toBe("1");
    expect(result.description).toBe("Implement feature");
    expect(result.status).toBe("completed");
    expect(result.blockedBy).toEqual(["2"]);
  });

  test("uses 'content' as fallback for missing 'description'", () => {
    const input = { content: "fallback content", status: "pending" };
    const result = normalizeTaskItem(input);
    expect(result.description).toBe("fallback content");
  });

  test("returns empty string for missing description and content", () => {
    const result = normalizeTaskItem({ status: "pending" });
    expect(result.description).toBe("");
  });

  test("normalizes status aliases", () => {
    const result = normalizeTaskItem({ description: "task", status: "done" });
    expect(result.status).toBe("completed");
  });

  test("defaults status to 'pending' when missing", () => {
    const result = normalizeTaskItem({ description: "task" });
    expect(result.status).toBe("pending");
  });

  test("returns undefined id when id is null or undefined", () => {
    expect(normalizeTaskItem({ id: null, description: "t" }).id).toBeUndefined();
    expect(normalizeTaskItem({ id: undefined, description: "t" }).id).toBeUndefined();
  });

  test("returns undefined id for empty string id", () => {
    expect(normalizeTaskItem({ id: "", description: "t" }).id).toBeUndefined();
  });

  test("coerces numeric id to string", () => {
    const result = normalizeTaskItem({ id: 42, description: "t" });
    expect(result.id).toBe("42");
  });

  test("returns undefined blockedBy when not an array", () => {
    expect(normalizeTaskItem({ description: "t", blockedBy: "not-array" }).blockedBy).toBeUndefined();
    expect(normalizeTaskItem({ description: "t", blockedBy: 42 }).blockedBy).toBeUndefined();
    expect(normalizeTaskItem({ description: "t" }).blockedBy).toBeUndefined();
  });

  test("filters null and undefined from blockedBy array", () => {
    const result = normalizeTaskItem({
      description: "t",
      blockedBy: ["1", null, undefined, "2", ""],
    });
    expect(result.blockedBy).toEqual(["1", "2"]);
  });

  test("returns undefined blockedBy for empty filtered array", () => {
    const result = normalizeTaskItem({
      description: "t",
      blockedBy: [null, undefined, ""],
    });
    expect(result.blockedBy).toBeUndefined();
  });

  test("handles completely invalid input gracefully", () => {
    expect(normalizeTaskItem(null)).toEqual({
      description: "",
      status: "pending",
    });
    expect(normalizeTaskItem(undefined)).toEqual({
      description: "",
      status: "pending",
    });
    expect(normalizeTaskItem(42)).toEqual({
      description: "",
      status: "pending",
    });
    expect(normalizeTaskItem("string")).toEqual({
      description: "",
      status: "pending",
    });
  });

  test("includes identity when present and valid", () => {
    const input = {
      description: "t",
      identity: {
        canonicalId: "canon-1",
        providerBindings: { claude: ["id-1"] },
      },
    };
    const result = normalizeTaskItem(input);
    expect(result.identity).toBeDefined();
    expect(result.identity!.canonicalId).toBe("canon-1");
  });

  test("excludes identity when invalid", () => {
    const result = normalizeTaskItem({
      description: "t",
      identity: "not-object",
    });
    expect(result.identity).toBeUndefined();
  });

  test("excludes identity when canonicalId and providerBindings are both empty", () => {
    const result = normalizeTaskItem({
      description: "t",
      identity: { canonicalId: "", providerBindings: {} },
    });
    expect(result.identity).toBeUndefined();
  });

  test("includes taskResult from 'taskResult' key", () => {
    const input = {
      description: "t",
      taskResult: {
        task_id: "t1",
        tool_name: "worker",
        title: "Result",
        status: "completed",
        output_text: "done",
      },
    };
    const result = normalizeTaskItem(input);
    expect(result.taskResult).toBeDefined();
    expect(result.taskResult!.task_id).toBe("t1");
  });

  test("includes taskResult from snake_case 'task_result' key", () => {
    const input = {
      description: "t",
      task_result: {
        task_id: "t1",
        tool_name: "worker",
        title: "Result",
        status: "completed",
        output_text: "done",
      },
    };
    const result = normalizeTaskItem(input);
    expect(result.taskResult).toBeDefined();
    expect(result.taskResult!.task_id).toBe("t1");
  });

  test("excludes taskResult when task_id is missing", () => {
    const result = normalizeTaskItem({
      description: "t",
      taskResult: { tool_name: "w", title: "r", status: "completed", output_text: "" },
    });
    expect(result.taskResult).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// normalizeTodoItem
// ---------------------------------------------------------------------------

describe("normalizeTodoItem", () => {
  test("includes summary field from input", () => {
    const result = normalizeTodoItem({
      description: "task",
      summary: "Doing the task",
      status: "in_progress",
    });
    expect(result.summary).toBe("Doing the task");
    expect(result.description).toBe("task");
    expect(result.status).toBe("in_progress");
  });

  test("uses activeForm as fallback for missing summary", () => {
    const result = normalizeTodoItem({
      description: "task",
      activeForm: "Working on it",
      status: "pending",
    });
    expect(result.summary).toBe("Working on it");
  });

  test("defaults summary to empty string when neither summary nor activeForm present", () => {
    const result = normalizeTodoItem({ description: "task" });
    expect(result.summary).toBe("");
  });

  test("inherits all fields from normalizeTaskItem", () => {
    const input = {
      id: "5",
      description: "my task",
      status: "done",
      blockedBy: ["3"],
      summary: "Working",
    };
    const result = normalizeTodoItem(input);
    expect(result.id).toBe("5");
    expect(result.description).toBe("my task");
    expect(result.status).toBe("completed");
    expect(result.blockedBy).toEqual(["3"]);
    expect(result.summary).toBe("Working");
  });
});

// ---------------------------------------------------------------------------
// normalizeTaskItems
// ---------------------------------------------------------------------------

describe("normalizeTaskItems", () => {
  test("normalizes an array of task inputs", () => {
    const input = [
      { description: "Task A", status: "done" },
      { description: "Task B", status: "running" },
    ];
    const result = normalizeTaskItems(input);
    expect(result).toHaveLength(2);
    expect(result[0]!.status).toBe("completed");
    expect(result[1]!.status).toBe("in_progress");
  });

  test("returns empty array for non-array input", () => {
    expect(normalizeTaskItems(null)).toEqual([]);
    expect(normalizeTaskItems(undefined)).toEqual([]);
    expect(normalizeTaskItems("string")).toEqual([]);
    expect(normalizeTaskItems(42)).toEqual([]);
    expect(normalizeTaskItems({})).toEqual([]);
  });

  test("returns empty array for empty array input", () => {
    expect(normalizeTaskItems([])).toEqual([]);
  });

  test("handles mixed valid and invalid items", () => {
    const input = [
      { description: "Valid", status: "pending" },
      null,
      42,
      { description: "Also valid", status: "completed" },
    ];
    const result = normalizeTaskItems(input);
    expect(result).toHaveLength(4);
    expect(result[0]!.description).toBe("Valid");
    expect(result[1]!.description).toBe(""); // null normalized
    expect(result[2]!.description).toBe(""); // number normalized
    expect(result[3]!.description).toBe("Also valid");
  });
});

// ---------------------------------------------------------------------------
// normalizeTodoItems
// ---------------------------------------------------------------------------

describe("normalizeTodoItems", () => {
  test("normalizes an array of todo inputs with summaries", () => {
    const input = [
      { description: "A", summary: "Doing A", status: "pending" },
      { description: "B", activeForm: "Doing B", status: "done" },
    ];
    const result = normalizeTodoItems(input);
    expect(result).toHaveLength(2);
    expect(result[0]!.summary).toBe("Doing A");
    expect(result[1]!.summary).toBe("Doing B");
    expect(result[1]!.status).toBe("completed");
  });

  test("returns empty array for non-array input", () => {
    expect(normalizeTodoItems(null)).toEqual([]);
    expect(normalizeTodoItems(undefined)).toEqual([]);
    expect(normalizeTodoItems(42)).toEqual([]);
  });

  test("returns empty array for empty array", () => {
    expect(normalizeTodoItems([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// mergeBlockedBy
// ---------------------------------------------------------------------------

describe("mergeBlockedBy", () => {
  test("restores blockedBy from previous state when update omits it", () => {
    const previous: NormalizedTaskItem[] = [
      { id: "1", description: "A", status: "pending", blockedBy: ["2"] },
      { id: "2", description: "B", status: "pending" },
    ];
    const updated: NormalizedTaskItem[] = [
      { id: "1", description: "A", status: "in_progress" },
      { id: "2", description: "B", status: "completed" },
    ];

    const result = mergeBlockedBy(updated, previous);
    expect(result[0]!.blockedBy).toEqual(["2"]);
    expect(result[1]!.blockedBy).toBeUndefined();
  });

  test("does not overwrite explicitly provided blockedBy", () => {
    const previous: NormalizedTaskItem[] = [
      { id: "1", description: "A", status: "pending", blockedBy: ["2"] },
    ];
    const updated: NormalizedTaskItem[] = [
      { id: "1", description: "A", status: "pending", blockedBy: ["3"] },
    ];

    const result = mergeBlockedBy(updated, previous);
    expect(result[0]!.blockedBy).toEqual(["3"]);
  });

  test("returns updated unchanged when previous is empty", () => {
    const updated: NormalizedTaskItem[] = [
      { id: "1", description: "A", status: "pending" },
    ];
    const result = mergeBlockedBy(updated, []);
    expect(result).toBe(updated); // same reference
  });

  test("matches by description when id is missing", () => {
    const previous: NormalizedTaskItem[] = [
      { id: "1", description: "A task", status: "pending", blockedBy: ["2"] },
    ];
    const updated: NormalizedTaskItem[] = [
      { description: "A task", status: "in_progress" },
    ];

    const result = mergeBlockedBy(updated, previous);
    // Should restore both id and blockedBy
    expect(result[0]!.id).toBe("1");
    expect(result[0]!.blockedBy).toEqual(["2"]);
  });

  test("case-insensitive description matching", () => {
    const previous: NormalizedTaskItem[] = [
      { id: "x", description: "Implement Feature", status: "pending", blockedBy: ["y"] },
    ];
    const updated: NormalizedTaskItem[] = [
      { description: "implement feature", status: "pending" },
    ];

    const result = mergeBlockedBy(updated, previous);
    expect(result[0]!.id).toBe("x");
    expect(result[0]!.blockedBy).toEqual(["y"]);
  });

  test("normalizes whitespace in description matching", () => {
    const previous: NormalizedTaskItem[] = [
      { id: "a", description: "  Two  words  ", status: "pending", blockedBy: ["b"] },
    ];
    const updated: NormalizedTaskItem[] = [
      { description: "two words", status: "pending" },
    ];

    const result = mergeBlockedBy(updated, previous);
    expect(result[0]!.blockedBy).toEqual(["b"]);
  });

  test("does not match if both id and description differ", () => {
    const previous: NormalizedTaskItem[] = [
      { id: "1", description: "Old task", status: "pending", blockedBy: ["2"] },
    ];
    const updated: NormalizedTaskItem[] = [
      { id: "99", description: "New task", status: "pending" },
    ];

    const result = mergeBlockedBy(updated, previous);
    expect(result[0]!.blockedBy).toBeUndefined();
  });

  test("returns original items when no restoration needed", () => {
    const previous: NormalizedTaskItem[] = [
      { id: "1", description: "A", status: "completed" },
    ];
    const updated: NormalizedTaskItem[] = [
      { id: "1", description: "A", status: "completed" },
    ];

    const result = mergeBlockedBy(updated, previous);
    // No blockedBy to restore, so items should be unchanged
    expect(result[0]).toBe(updated[0]);
  });

  test("handles empty updated array", () => {
    const previous: NormalizedTaskItem[] = [
      { id: "1", description: "A", status: "pending", blockedBy: ["2"] },
    ];
    const result = mergeBlockedBy([], previous);
    expect(result).toEqual([]);
  });

  test("returns updated when previous has no blockedBy or descriptions", () => {
    const previous: NormalizedTaskItem[] = [
      { description: "", status: "pending" },
    ];
    const updated: NormalizedTaskItem[] = [
      { id: "1", description: "A", status: "pending" },
    ];

    const result = mergeBlockedBy(updated, previous);
    expect(result).toBe(updated);
  });
});

// ---------------------------------------------------------------------------
// reconcileTodoWriteItems
// ---------------------------------------------------------------------------

describe("reconcileTodoWriteItems", () => {
  test("normalizes raw input into NormalizedTodoItem array", () => {
    const incoming = [
      { description: "Task 1", status: "done", summary: "Working" },
      { description: "Task 2", status: "running", activeForm: "Building" },
    ];
    const result = reconcileTodoWriteItems(incoming);
    expect(result).toHaveLength(2);
    expect(result[0]!.status).toBe("completed");
    expect(result[0]!.summary).toBe("Working");
    expect(result[1]!.status).toBe("in_progress");
    expect(result[1]!.summary).toBe("Building");
  });

  test("restores blockedBy from previous state", () => {
    const previous: NormalizedTodoItem[] = [
      { id: "1", description: "A", status: "pending", blockedBy: ["2"], summary: "" },
      { id: "2", description: "B", status: "pending", summary: "" },
    ];
    const incoming = [
      { id: "1", description: "A", status: "in_progress" },
      { id: "2", description: "B", status: "pending" },
    ];

    const result = reconcileTodoWriteItems(incoming, previous);
    const taskA = result.find(t => t.id === "1");
    expect(taskA).toBeDefined();
    expect(taskA!.blockedBy).toEqual(["2"]);
  });

  test("returns empty array for non-array input", () => {
    expect(reconcileTodoWriteItems(null)).toEqual([]);
    expect(reconcileTodoWriteItems(undefined)).toEqual([]);
    expect(reconcileTodoWriteItems(42)).toEqual([]);
  });

  test("returns empty array for empty array input", () => {
    expect(reconcileTodoWriteItems([])).toEqual([]);
  });

  test("stabilizes order based on previous state", () => {
    const previous: NormalizedTodoItem[] = [
      { id: "1", description: "First", status: "pending", summary: "" },
      { id: "2", description: "Second", status: "pending", summary: "" },
      { id: "3", description: "Third", status: "pending", summary: "" },
    ];
    // Incoming has different order but same tasks
    const incoming = [
      { id: "3", description: "Third", status: "pending" },
      { id: "1", description: "First", status: "pending" },
      { id: "2", description: "Second", status: "pending" },
    ];

    const result = reconcileTodoWriteItems(incoming, previous);
    // Should stabilize to previous order since there are no dependencies
    expect(result[0]!.id).toBe("1");
    expect(result[1]!.id).toBe("2");
    expect(result[2]!.id).toBe("3");
  });

  test("applies topological sort when dependencies exist", () => {
    const incoming = [
      { id: "2", description: "Depends on 1", status: "pending", blockedBy: ["1"] },
      { id: "1", description: "No deps", status: "pending" },
    ];

    const result = reconcileTodoWriteItems(incoming);
    // Task 1 should appear before task 2 due to dependency
    const idx1 = result.findIndex(t => t.id === "1");
    const idx2 = result.findIndex(t => t.id === "2");
    expect(idx1).toBeLessThan(idx2);
  });

  test("handles pipeline with no previous state", () => {
    const incoming = [
      { id: "1", description: "A", status: "pending", summary: "Doing A" },
    ];
    const result = reconcileTodoWriteItems(incoming);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("1");
    expect(result[0]!.summary).toBe("Doing A");
  });
});

// ---------------------------------------------------------------------------
// Identity normalization edge cases
// ---------------------------------------------------------------------------

describe("normalizeTaskItem identity normalization", () => {
  test("normalizes providerBindings — deduplicates array values", () => {
    const input = {
      description: "t",
      identity: {
        canonicalId: "c1",
        providerBindings: {
          claude: ["id-1", "id-1", "id-2"],
        },
      },
    };
    const result = normalizeTaskItem(input);
    expect(result.identity!.providerBindings!.claude).toEqual(["id-1", "id-2"]);
  });

  test("strips empty provider binding entries", () => {
    const input = {
      description: "t",
      identity: {
        canonicalId: "c1",
        providerBindings: {
          "": ["id-1"],        // empty provider key
          valid: [],            // empty array
          good: ["id-1"],
        },
      },
    };
    const result = normalizeTaskItem(input);
    // Empty provider key and empty arrays should be stripped
    expect(result.identity!.providerBindings!.good).toEqual(["id-1"]);
    expect(result.identity!.providerBindings![""]).toBeUndefined();
    expect(result.identity!.providerBindings!.valid).toBeUndefined();
  });

  test("filters null/undefined from providerBindings arrays", () => {
    const input = {
      description: "t",
      identity: {
        canonicalId: "c1",
        providerBindings: {
          claude: [null, "id-1", undefined, ""],
        },
      },
    };
    const result = normalizeTaskItem(input);
    expect(result.identity!.providerBindings!.claude).toEqual(["id-1"]);
  });

  test("returns undefined identity when canonicalId is empty and no bindings", () => {
    const result = normalizeTaskItem({
      description: "t",
      identity: { canonicalId: "" },
    });
    expect(result.identity).toBeUndefined();
  });

  test("preserves identity with only canonicalId (no bindings)", () => {
    const result = normalizeTaskItem({
      description: "t",
      identity: { canonicalId: "abc" },
    });
    expect(result.identity).toBeDefined();
    expect(result.identity!.canonicalId).toBe("abc");
  });

  test("preserves identity with only providerBindings (no canonicalId)", () => {
    const result = normalizeTaskItem({
      description: "t",
      identity: {
        providerBindings: { claude: ["id-1"] },
      },
    });
    expect(result.identity).toBeDefined();
    expect(result.identity!.providerBindings!.claude).toEqual(["id-1"]);
  });
});

// ---------------------------------------------------------------------------
// Task result normalization edge cases
// ---------------------------------------------------------------------------

describe("normalizeTaskItem taskResult normalization", () => {
  test("normalizes a complete task result envelope", () => {
    const input = {
      description: "t",
      taskResult: {
        task_id: "t1",
        tool_name: "agent",
        title: "My Result",
        status: "completed",
        output_text: "Success",
        metadata: {
          sessionId: "sess-1",
          providerBindings: { claude: "prov-1" },
        },
      },
    };
    const result = normalizeTaskItem(input);
    expect(result.taskResult).toBeDefined();
    expect(result.taskResult!.task_id).toBe("t1");
    expect(result.taskResult!.tool_name).toBe("agent");
    expect(result.taskResult!.title).toBe("My Result");
    expect(result.taskResult!.status).toBe("completed");
    expect(result.taskResult!.output_text).toBe("Success");
    expect(result.taskResult!.metadata).toBeDefined();
    expect(result.taskResult!.metadata!.sessionId).toBe("sess-1");
    expect(result.taskResult!.metadata!.providerBindings!.claude).toBe("prov-1");
  });

  test("defaults tool_name to 'task' when missing", () => {
    const result = normalizeTaskItem({
      description: "t",
      taskResult: {
        task_id: "t1",
        title: "",
        status: "completed",
        output_text: "",
      },
    });
    expect(result.taskResult!.tool_name).toBe("task");
  });

  test("normalizes error status", () => {
    const result = normalizeTaskItem({
      description: "t",
      taskResult: {
        task_id: "t1",
        tool_name: "w",
        title: "",
        status: "error",
        output_text: "",
        error: "something failed",
      },
    });
    expect(result.taskResult!.status).toBe("error");
    expect(result.taskResult!.error).toBe("something failed");
  });

  test("treats non-error status as 'completed'", () => {
    const result = normalizeTaskItem({
      description: "t",
      taskResult: {
        task_id: "t1",
        tool_name: "w",
        title: "",
        status: "success",
        output_text: "",
      },
    });
    expect(result.taskResult!.status).toBe("completed");
  });

  test("includes envelope_text when present", () => {
    const result = normalizeTaskItem({
      description: "t",
      taskResult: {
        task_id: "t1",
        tool_name: "w",
        title: "",
        status: "completed",
        output_text: "",
        envelope_text: "full envelope",
      },
    });
    expect(result.taskResult!.envelope_text).toBe("full envelope");
  });

  test("excludes empty envelope_text", () => {
    const result = normalizeTaskItem({
      description: "t",
      taskResult: {
        task_id: "t1",
        tool_name: "w",
        title: "",
        status: "completed",
        output_text: "",
        envelope_text: "",
      },
    });
    expect(result.taskResult!.envelope_text).toBeUndefined();
  });

  test("includes output_structured when it is a plain object", () => {
    const result = normalizeTaskItem({
      description: "t",
      taskResult: {
        task_id: "t1",
        tool_name: "w",
        title: "",
        status: "completed",
        output_text: "",
        output_structured: { data: 42 },
      },
    });
    expect(result.taskResult!.output_structured).toEqual({ data: 42 });
  });

  test("excludes output_structured when it is an array", () => {
    const result = normalizeTaskItem({
      description: "t",
      taskResult: {
        task_id: "t1",
        tool_name: "w",
        title: "",
        status: "completed",
        output_text: "",
        output_structured: [1, 2, 3],
      },
    });
    expect(result.taskResult!.output_structured).toBeUndefined();
  });

  test("excludes metadata when sessionId and providerBindings are both absent", () => {
    const result = normalizeTaskItem({
      description: "t",
      taskResult: {
        task_id: "t1",
        tool_name: "w",
        title: "",
        status: "completed",
        output_text: "",
        metadata: {},
      },
    });
    expect(result.taskResult!.metadata).toBeUndefined();
  });

  test("strips empty providerBindings from metadata", () => {
    const result = normalizeTaskItem({
      description: "t",
      taskResult: {
        task_id: "t1",
        tool_name: "w",
        title: "",
        status: "completed",
        output_text: "",
        metadata: {
          providerBindings: { "": "val", "  ": "  " },
        },
      },
    });
    // Both keys are empty after trimming, so providerBindings should be stripped
    expect(result.taskResult!.metadata).toBeUndefined();
  });
});
