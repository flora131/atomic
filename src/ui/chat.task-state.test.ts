import { describe, expect, test } from "bun:test";
import {
  normalizeInterruptedTasks,
  snapshotTaskItems,
  type RalphTaskStateItem,
} from "./utils/ralph-task-state.ts";

describe("ralph task state helpers", () => {
  test("normalizeInterruptedTasks only resets in_progress to pending", () => {
    const tasks: RalphTaskStateItem[] = [
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
    const tasks: RalphTaskStateItem[] = [
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
});
