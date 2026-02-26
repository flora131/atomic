import { describe, expect, test } from "bun:test";
import {
  applyTaskSnapshotToLatestAssistantMessage,
  hasWorkflowTaskIdOverlap,
  normalizeInterruptedTasks,
  preferTerminalTaskItems,
  snapshotTaskItems,
  type WorkflowTaskStateItem,
} from "./utils/workflow-task-state.ts";
import { mergeBlockedBy, type NormalizedTodoItem } from "./utils/task-status.ts";

describe("workflow task state helpers", () => {
  test("normalizeInterruptedTasks only resets in_progress to pending", () => {
    const tasks: WorkflowTaskStateItem[] = [
      { id: "#1", content: "a", status: "pending" },
      { id: "#2", content: "b", status: "in_progress" },
      { id: "#3", content: "c", status: "completed" },
      { id: "#4", content: "d", status: "error" },
    ];

    const normalized = normalizeInterruptedTasks(tasks);
    expect(normalized.map((task) => task.status)).toEqual([
      "pending",
      "pending",
      "completed",
      "error",
    ]);
  });

  test("snapshotTaskItems preserves status values without coercion", () => {
    const tasks: WorkflowTaskStateItem[] = [
      { id: "#1", content: "a", status: "pending" },
      { id: "#2", content: "b", status: "in_progress" },
      { id: "#3", content: "c", status: "completed" },
      { id: "#4", content: "d", status: "error", blockedBy: ["#1"] },
    ];

    const snapshot = snapshotTaskItems(tasks);
    expect(snapshot?.map((task) => task.status)).toEqual([
      "pending",
      "in_progress",
      "completed",
      "error",
    ]);
    expect(snapshot?.[3]?.blockedBy).toEqual(["#1"]);
  });

  test("snapshotTaskItems returns undefined for empty input", () => {
    expect(snapshotTaskItems([])).toBeUndefined();
  });

  test("hasWorkflowTaskIdOverlap matches ids with and without # prefix", () => {
    const knownIds = new Set(["#1", "#2"]);
    const todos: WorkflowTaskStateItem[] = [
      { id: "1", content: "first", status: "completed" },
      { id: "2", content: "second", status: "pending" },
    ];

    expect(hasWorkflowTaskIdOverlap(todos, knownIds)).toBe(true);
  });

  test("hasWorkflowTaskIdOverlap rejects unrelated todo ids", () => {
    const knownIds = new Set(["#1", "#2"]);
    const todos: WorkflowTaskStateItem[] = [
      { id: "#9", content: "other", status: "completed" },
    ];

    expect(hasWorkflowTaskIdOverlap(todos, knownIds)).toBe(false);
  });

  test("hasWorkflowTaskIdOverlap rejects mixed payloads with foreign IDs", () => {
    const knownIds = new Set(["#1", "#2"]);
    const todos: WorkflowTaskStateItem[] = [
      { id: "#1", content: "first", status: "completed" },
      { id: "#99", content: "foreign", status: "pending" },
    ];

    expect(hasWorkflowTaskIdOverlap(todos, knownIds)).toBe(false);
  });

  test("supports restart resume by preserving ids and blockedBy", () => {
    const interrupted: WorkflowTaskStateItem[] = [
      { id: "#1", content: "bootstrap", status: "completed" },
      {
        id: "#2",
        content: "route runtime",
        status: "in_progress",
        blockedBy: ["#1"],
      },
      {
        id: "#3",
        content: "render parity",
        status: "pending",
        blockedBy: ["#2"],
      },
    ];

    const normalized = normalizeInterruptedTasks(interrupted);
    const snapshot = snapshotTaskItems(normalized);

    expect(snapshot?.[1]).toEqual({
      id: "#2",
      content: "route runtime",
      status: "pending",
      blockedBy: ["#1"],
    });
    expect(
      hasWorkflowTaskIdOverlap(snapshot ?? [], new Set(["1", "2", "3"])),
    ).toBe(true);
  });

  test("recognizes ralph TodoWrite updates that omit id fields", () => {
    const knownIds = new Set(["#1", "#2"]);
    const previous: NormalizedTodoItem[] = [
      { id: "#1", content: "Wire auth route", status: "pending", activeForm: "Wiring auth route" },
      { id: "#2", content: "Add tests", status: "pending", activeForm: "Adding tests" },
    ];
    const incomingWithoutIds: NormalizedTodoItem[] = [
      { content: "wire   auth route", status: "completed", activeForm: "Wiring auth route" },
      { content: "Add tests", status: "in_progress", activeForm: "Adding tests" },
    ];

    const merged = mergeBlockedBy(incomingWithoutIds, previous);
    expect(hasWorkflowTaskIdOverlap(merged, knownIds)).toBe(true);
  });

  test("accepts no-id updates when known IDs are empty but content matches", () => {
    const knownIds = new Set<string>();
    const previous: NormalizedTodoItem[] = [
      { content: "Wire auth route", status: "pending", activeForm: "Wiring auth route" },
      { content: "Add tests", status: "pending", activeForm: "Adding tests" },
    ];
    const incomingWithoutIds: NormalizedTodoItem[] = [
      { content: "wire auth route", status: "completed", activeForm: "Wiring auth route" },
      { content: "add tests", status: "in_progress", activeForm: "Adding tests" },
    ];

    expect(hasWorkflowTaskIdOverlap(incomingWithoutIds, knownIds, previous)).toBe(true);
  });

  test("recognizes no-id updates when content prefixes include task IDs/checkboxes", () => {
    const knownIds = new Set(["#1", "#2"]);
    const previous: NormalizedTodoItem[] = [
      { id: "#1", content: "Wire auth route", status: "pending", activeForm: "Wiring auth route" },
      { id: "#2", content: "Add tests", status: "pending", activeForm: "Adding tests" },
    ];
    const incomingWithoutIds: NormalizedTodoItem[] = [
      { content: "[x] #1 Wire auth route", status: "completed", activeForm: "Wiring auth route" },
      { content: "[ ] #2 Add tests", status: "in_progress", activeForm: "Adding tests" },
    ];

    const merged = mergeBlockedBy(incomingWithoutIds, previous);
    expect(hasWorkflowTaskIdOverlap(merged, knownIds, previous)).toBe(true);
  });

  test("rejects no-id updates when prefixed content carries foreign task IDs", () => {
    const knownIds = new Set(["#1", "#2"]);
    const previous: NormalizedTodoItem[] = [
      { id: "#1", content: "Wire auth route", status: "pending", activeForm: "Wiring auth route" },
      { id: "#2", content: "Add tests", status: "pending", activeForm: "Adding tests" },
    ];
    const incomingWithoutIds: NormalizedTodoItem[] = [
      { content: "[x] #1 Wire auth route", status: "completed", activeForm: "Wiring auth route" },
      { content: "[ ] #99 Unexpected task", status: "in_progress", activeForm: "Unexpected tasking" },
    ];

    const merged = mergeBlockedBy(incomingWithoutIds, previous);
    expect(hasWorkflowTaskIdOverlap(merged, knownIds, previous)).toBe(false);
  });

  test("rejects unrelated no-id TodoWrite payloads during /ralph", () => {
    const knownIds = new Set(["#1", "#2"]);
    const previous: NormalizedTodoItem[] = [
      { id: "#1", content: "Wire auth route", status: "pending", activeForm: "Wiring auth route" },
      { id: "#2", content: "Add tests", status: "pending", activeForm: "Adding tests" },
    ];
    const unrelated: NormalizedTodoItem[] = [
      { content: "Refactor parser", status: "completed", activeForm: "Refactoring parser" },
    ];

    const merged = mergeBlockedBy(unrelated, previous);
    expect(hasWorkflowTaskIdOverlap(merged, knownIds)).toBe(false);
  });

  test("rejects no-id rows that do not match existing ralph tasks", () => {
    const knownIds = new Set(["#1", "#2"]);
    const previous: NormalizedTodoItem[] = [
      { id: "#1", content: "Wire auth route", status: "pending", activeForm: "Wiring auth route" },
      { id: "#2", content: "Add tests", status: "pending", activeForm: "Adding tests" },
    ];
    const mixed: NormalizedTodoItem[] = [
      { id: "#1", content: "Wire auth route", status: "completed", activeForm: "Wiring auth route" },
      { content: "Completely new task", status: "pending", activeForm: "Adding a new task" },
    ];

    expect(hasWorkflowTaskIdOverlap(mixed, knownIds, previous)).toBe(false);
  });

  test("preferTerminalTaskItems drops stale in_progress last-item snapshots", () => {
    const inMemory: WorkflowTaskStateItem[] = [
      { id: "#1", content: "prep", status: "completed" },
      { id: "#2", content: "finalize", status: "in_progress" },
    ];
    const fromDisk: WorkflowTaskStateItem[] = [
      { id: "#1", content: "prep", status: "completed" },
      { id: "#2", content: "finalize", status: "completed" },
    ];

    expect(preferTerminalTaskItems(inMemory, fromDisk)).toEqual(fromDisk);
  });

  test("applyTaskSnapshotToLatestAssistantMessage refreshes final assistant task state", () => {
    const messages: Array<{ id: string; role: string; taskItems?: WorkflowTaskStateItem[] }> = [
      {
        id: "m-user",
        role: "user",
      },
      {
        id: "m-assistant",
        role: "assistant",
        taskItems: [
          { id: "#1", content: "prep", status: "completed" },
          { id: "#2", content: "finalize", status: "in_progress" },
        ],
      },
    ];

    const nextTasks: WorkflowTaskStateItem[] = [
      { id: "#1", content: "prep", status: "completed" },
      { id: "#2", content: "finalize", status: "completed" },
    ];

    const updated = applyTaskSnapshotToLatestAssistantMessage(messages, nextTasks);
    expect(updated[1]).toMatchObject({
      role: "assistant",
      taskItems: [
        { id: "#1", content: "prep", status: "completed" },
        { id: "#2", content: "finalize", status: "completed" },
      ],
    });
  });
});
