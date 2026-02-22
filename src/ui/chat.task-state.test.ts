import { describe, expect, test } from "bun:test";
import {

  normalizeInterruptedTasks,
  preferTerminalTaskItems,
  snapshotTaskItems,
  validateRalphTaskIds,
  type RalphTaskStateItem,
} from "./utils/ralph-task-state.ts";

describe("ralph task state helpers", () => {
  test("normalizeInterruptedTasks resets only in_progress tasks", () => {
    const tasks: RalphTaskStateItem[] = [
      { id: "#1", content: "a", status: "pending" },
      { id: "#2", content: "b", status: "in_progress" },
      { id: "#3", content: "c", status: "completed" },
      { id: "#4", content: "d", status: "error" },
    ];

    expect(normalizeInterruptedTasks(tasks).map((task) => task.status)).toEqual([
      "pending",
      "pending",
      "completed",
      "error",
    ]);
  });

  test("snapshotTaskItems returns undefined for empty input", () => {
    expect(snapshotTaskItems([])).toBeUndefined();
  });

  test("snapshotTaskItems preserves task properties", () => {
    const tasks: RalphTaskStateItem[] = [
      { id: "#1", content: "a", status: "pending" },
      { id: "#2", content: "b", status: "error", blockedBy: ["#1"] },
    ];

    expect(snapshotTaskItems(tasks)).toEqual(tasks);
  });
});

describe("validateRalphTaskIds", () => {
  test("returns valid when all IDs match", () => {
    const result = validateRalphTaskIds(
      [
        { id: "#1", content: "Task one", status: "pending" },
        { id: "2", content: "Task two", status: "completed" },
      ],
      new Set(["#1", "#2"]),
    );

    expect(result.valid).toBe(true);
    expect(result.unknownIds).toEqual([]);
  });

  test("returns invalid for unknown IDs", () => {
    const result = validateRalphTaskIds(
      [
        { id: "#1", content: "Task one", status: "pending" },
        { id: "#99", content: "Unknown", status: "pending" },
      ],
      new Set(["#1", "#2"]),
    );

    expect(result.valid).toBe(false);
    expect(result.unknownIds).toEqual(["#99"]);
    expect(result.errorMessage).toContain("#99");
    expect(result.errorMessage).toContain("#1");
    expect(result.errorMessage).toContain("#2");
  });

  test("returns invalid for empty payload", () => {
    const result = validateRalphTaskIds([], new Set(["#1"]));
    expect(result.valid).toBe(false);
    expect(result.errorMessage).toContain("empty");
  });

  test("accepts extracted leading IDs from content", () => {
    const result = validateRalphTaskIds(
      [{ content: "[x] #1 Implement feature" }],
      new Set(["#1"]),
    );
    expect(result.valid).toBe(true);
    expect(result.matchedIds).toEqual(["#1"]);
  });

  test("rejects missing IDs when content does not include a leading task ID", () => {
    const result = validateRalphTaskIds(
      [{ content: "Implement feature" }],
      new Set(["#1"]),
    );
    expect(result.valid).toBe(false);
    expect(result.unknownIds).toEqual(["(no id)"]);
  });

  test("preferTerminalTaskItems drops stale in_progress last-item snapshots", () => {
    const inMemory: RalphTaskStateItem[] = [
      { id: "#1", content: "prep", status: "completed" },
      { id: "#2", content: "finalize", status: "in_progress" },
    ];
    const fromDisk: RalphTaskStateItem[] = [
      { id: "#1", content: "prep", status: "completed" },
      { id: "#2", content: "finalize", status: "completed" },
    ];

    expect(preferTerminalTaskItems(inMemory, fromDisk)).toEqual(fromDisk);
  });

  test("applyTaskSnapshotToLatestAssistantMessage refreshes final assistant task state", () => {
    const messages: Array<{ id: string; role: string; taskItems?: RalphTaskStateItem[] }> = [
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

    const nextTasks: RalphTaskStateItem[] = [
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
