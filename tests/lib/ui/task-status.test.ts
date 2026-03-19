import { describe, expect, test } from "bun:test";
import {
  isTodoWriteToolName,
  isTaskStatus,
  mergeBlockedBy,
  normalizeTaskItem,
  normalizeTaskStatus,
  normalizeTodoItem,
  normalizeTodoItems,
  reconcileTodoWriteItems,
  type NormalizedTaskItem,
} from "@/state/parts/helpers/task-status.ts";

describe("normalizeTaskStatus", () => {
  test("keeps canonical statuses unchanged", () => {
    expect(normalizeTaskStatus("pending")).toBe("pending");
    expect(normalizeTaskStatus("in_progress")).toBe("in_progress");
    expect(normalizeTaskStatus("completed")).toBe("completed");
    expect(normalizeTaskStatus("error")).toBe("error");
  });

  test("normalizes common aliases", () => {
    expect(normalizeTaskStatus("in-progress")).toBe("in_progress");
    expect(normalizeTaskStatus("In Progress")).toBe("in_progress");
    expect(normalizeTaskStatus("DONE")).toBe("completed");
    expect(normalizeTaskStatus("failed")).toBe("error");
  });

  test("falls back to pending for missing or invalid statuses", () => {
    expect(normalizeTaskStatus(undefined)).toBe("pending");
    expect(normalizeTaskStatus(null)).toBe("pending");
    expect(normalizeTaskStatus("blocked")).toBe("pending");
    expect(normalizeTaskStatus(123)).toBe("pending");
  });
});

describe("isTaskStatus", () => {
  test("returns true for supported status strings and aliases", () => {
    expect(isTaskStatus("pending")).toBe(true);
    expect(isTaskStatus("in-progress")).toBe(true);
    expect(isTaskStatus("DONE")).toBe(true);
    expect(isTaskStatus("failed")).toBe(true);
  });

  test("returns false for unsupported values", () => {
    expect(isTaskStatus("queued")).toBe(false);
    expect(isTaskStatus(null)).toBe(false);
    expect(isTaskStatus(undefined)).toBe(false);
    expect(isTaskStatus({})).toBe(false);
  });
});

describe("isTodoWriteToolName", () => {
  test("accepts TodoWrite variants across SDK providers", () => {
    expect(isTodoWriteToolName("TodoWrite")).toBe(true);
    expect(isTodoWriteToolName("todowrite")).toBe(true);
    expect(isTodoWriteToolName("todo_write")).toBe(true);
    expect(isTodoWriteToolName("todo-write")).toBe(true);
    expect(isTodoWriteToolName("todo write")).toBe(true);
  });

  test("rejects non-TodoWrite tool names", () => {
    expect(isTodoWriteToolName("Read")).toBe(false);
    expect(isTodoWriteToolName("Write")).toBe(false);
    expect(isTodoWriteToolName("")).toBe(false);
    expect(isTodoWriteToolName(null)).toBe(false);
    expect(isTodoWriteToolName(undefined)).toBe(false);
  });
});

describe("task item normalization", () => {
  test("normalizes malformed task item fields", () => {
    const normalized = normalizeTaskItem({
      id: 42,
      description: "Run tests",
      status: "in-progress",
      blockedBy: ["#1", 7, "", null],
    });

    expect(normalized).toEqual({
      id: "42",
      description: "Run tests",
      status: "in_progress",
      blockedBy: ["#1", "7"],
    });
  });

  test("normalizes todo item with defaults", () => {
    const normalized = normalizeTodoItem({
      description: "Ship fix",
      status: "unknown",
    });

    expect(normalized).toEqual({
      description: "Ship fix",
      status: "pending",
      summary: "",
    });
  });

  test("normalizes todo item arrays", () => {
    const normalized = normalizeTodoItems([
      { description: "A", status: "done", summary: "Doing A" },
      { description: "B", status: "in progress", summary: "Doing B" },
      { description: "C", status: "bogus" },
    ]);

    expect(normalized.map((item) => item.status)).toEqual([
      "completed",
      "in_progress",
      "pending",
    ]);
  });

  test("preserves task result envelopes for persistence round-trip", () => {
    const normalized = normalizeTodoItems([
      {
        id: "#3",
        description: "Persist worker output",
        status: "completed",
        summary: "Persisting worker output",
        taskResult: {
          task_id: "#3",
          tool_name: "task",
          title: "Persist worker output",
          metadata: {
            sessionId: "session-3",
            providerBindings: {
              subagent_id: "worker-3",
            },
          },
          status: "completed",
          output_text: "done",
          envelope_text: "task_id: #3",
        },
      },
    ]);

    expect(normalized[0]?.taskResult).toEqual({
      task_id: "#3",
      tool_name: "task",
      title: "Persist worker output",
      metadata: {
        sessionId: "session-3",
        providerBindings: {
          subagent_id: "worker-3",
        },
      },
      status: "completed",
      output_text: "done",
      envelope_text: "task_id: #3",
    });
  });
});

describe("mergeBlockedBy", () => {
  test("restores blockedBy from previous state when omitted in update", () => {
    const previous = [
      { id: "#1", description: "Setup", status: "completed" as const },
      { id: "#2", description: "Implement", status: "pending" as const, blockedBy: ["#1"] },
      { id: "#3", description: "Test", status: "pending" as const, blockedBy: ["#1", "#2"] },
    ];

    const updated: NormalizedTaskItem[] = [
      { id: "#1", description: "Setup", status: "completed" },
      { id: "#2", description: "Implement", status: "in_progress" },
      { id: "#3", description: "Test", status: "pending" },
    ];

    const merged = mergeBlockedBy(updated, previous);
    expect(merged[0]!.blockedBy).toBeUndefined();
    expect(merged[1]!.blockedBy).toEqual(["#1"]);
    expect(merged[2]!.blockedBy).toEqual(["#1", "#2"]);
  });

  test("preserves explicitly provided blockedBy in update", () => {
    const previous = [
      { id: "#1", description: "A", status: "pending" as const, blockedBy: ["#2"] },
    ];

    const updated = [
      { id: "#1", description: "A", status: "pending" as const, blockedBy: ["#3"] },
    ];

    const merged = mergeBlockedBy(updated, previous);
    expect(merged[0]!.blockedBy).toEqual(["#3"]);
  });

  test("returns updated as-is when previous is empty", () => {
    const updated = [
      { id: "#1", description: "A", status: "pending" as const },
    ];

    const merged = mergeBlockedBy(updated, []);
    expect(merged).toEqual(updated);
  });

  test("handles tasks without IDs gracefully", () => {
    const previous: NormalizedTaskItem[] = [
      { description: "No ID", status: "pending", blockedBy: ["#1"] },
    ];

    const updated: NormalizedTaskItem[] = [
      { description: "No ID", status: "pending" },
    ];

    const merged = mergeBlockedBy(updated, previous);
    expect(merged[0]!.id).toBeUndefined();
    expect(merged[0]!.blockedBy).toEqual(["#1"]);
  });

  test("matches IDs case-insensitively", () => {
    const previous: NormalizedTaskItem[] = [
      { id: "#1", description: "A", status: "pending", blockedBy: ["#2"] },
    ];

    const updated: NormalizedTaskItem[] = [
      { id: "#1", description: "A", status: "pending" },
    ];

    const merged = mergeBlockedBy(updated, previous);
    expect(merged[0]!.blockedBy).toEqual(["#2"]);
  });

  test("matches IDs with and without leading #", () => {
    const previous: NormalizedTaskItem[] = [
      { id: "#1", description: "A", status: "pending", blockedBy: ["#0"] },
    ];

    const updated: NormalizedTaskItem[] = [
      { id: "1", description: "A", status: "in_progress" },
    ];

    const merged = mergeBlockedBy(updated, previous);
    expect(merged[0]!.blockedBy).toEqual(["#0"]);
  });

  test("restores missing IDs by matching task content", () => {
    const previous: NormalizedTaskItem[] = [
      { id: "#1", description: "Implement login flow", status: "pending", blockedBy: ["#0"] },
    ];

    const updated: NormalizedTaskItem[] = [
      { description: "  implement   login flow ", status: "completed" },
    ];

    const merged = mergeBlockedBy(updated, previous);
    expect(merged[0]!.id).toBe("#1");
    expect(merged[0]!.blockedBy).toEqual(["#0"]);
  });

  test("does not assign IDs when content does not match previous task", () => {
    const previous: NormalizedTaskItem[] = [
      { id: "#1", description: "Implement login flow", status: "pending" },
    ];

    const updated: NormalizedTaskItem[] = [
      { description: "Write release notes", status: "completed" },
    ];

    const merged = mergeBlockedBy(updated, previous);
    expect(merged[0]!.id).toBeUndefined();
  });

  test("does not use content fallback for blockedBy when updated task already has explicit ID", () => {
    const previous: NormalizedTaskItem[] = [
      { id: "#a", description: "Duplicate", status: "pending", blockedBy: ["#x"] },
      { id: "#b", description: "Duplicate", status: "pending", blockedBy: ["#y"] },
    ];

    const updated: NormalizedTaskItem[] = [
      { id: "#z", description: "Duplicate", status: "in_progress" },
    ];

    const merged = mergeBlockedBy(updated, previous);
    expect(merged[0]!.id).toBe("#z");
    expect(merged[0]!.blockedBy).toBeUndefined();
  });
});

describe("reconcileTodoWriteItems", () => {
  test("keeps todo updates topologically sorted by blockedBy", () => {
    const previous = [
      { id: "#1", description: "Plan", status: "completed" as const, summary: "Planning" },
      {
        id: "#2",
        description: "Implement",
        status: "pending" as const,
        blockedBy: ["#1"],
        summary: "Implementing",
      },
      {
        id: "#3",
        description: "Test",
        status: "pending" as const,
        blockedBy: ["#2"],
        summary: "Testing",
      },
    ];

    const incoming = [
      { id: "#3", description: "Test", status: "pending", summary: "Testing" },
      { id: "#1", description: "Plan", status: "completed", summary: "Planning" },
      { id: "#2", description: "Implement", status: "in_progress", summary: "Implementing" },
    ];

    const reconciled = reconcileTodoWriteItems(incoming, previous);

    expect(reconciled.map((item) => item.id)).toEqual(["#1", "#2", "#3"]);
    expect(reconciled[1]!.status).toBe("in_progress");
    expect(reconciled[1]!.blockedBy).toEqual(["#1"]);
    expect(reconciled[2]!.blockedBy).toEqual(["#2"]);
  });

  test("restores missing ids/blockedBy before sorting follow-up updates", () => {
    const previous = [
      { id: "#1", description: "Plan", status: "completed" as const, summary: "Planning" },
      {
        id: "#2",
        description: "Implement",
        status: "in_progress" as const,
        blockedBy: ["#1"],
        summary: "Implementing",
      },
      {
        id: "#3",
        description: "Test",
        status: "pending" as const,
        blockedBy: ["#2"],
        summary: "Testing",
      },
    ];

    const incomingWithoutIds = [
      { description: "Test", status: "pending", summary: "Testing" },
      { description: "Implement", status: "completed", summary: "Implementing" },
      { description: "Plan", status: "completed", summary: "Planning" },
    ];

    const reconciled = reconcileTodoWriteItems(incomingWithoutIds, previous);

    expect(reconciled.map((item) => item.id)).toEqual(["#1", "#2", "#3"]);
    expect(reconciled[1]!.blockedBy).toEqual(["#1"]);
    expect(reconciled[2]!.blockedBy).toEqual(["#2"]);
  });

  test("keeps previous sibling order when blockedBy rank is equal", () => {
    const previous = [
      { id: "#1", description: "Setup", status: "completed" as const, summary: "Setting up" },
      { id: "#2", description: "Lint", status: "pending" as const, summary: "Linting" },
      { id: "#3", description: "Test", status: "pending" as const, summary: "Testing" },
    ];

    const incomingShuffled = [
      { id: "#3", description: "Test", status: "in_progress", summary: "Testing" },
      { id: "#1", description: "Setup", status: "completed", summary: "Setting up" },
      { id: "#2", description: "Lint", status: "pending", summary: "Linting" },
    ];

    const reconciled = reconcileTodoWriteItems(incomingShuffled, previous);

    expect(reconciled.map((item) => item.id)).toEqual(["#1", "#2", "#3"]);
    expect(reconciled[2]!.status).toBe("in_progress");
  });
});
