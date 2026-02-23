import { describe, expect, test } from "bun:test";

import type { TaskItem } from "../components/task-list-indicator.tsx";
import { preferTerminalTaskItems } from "./ralph-task-state.ts";
import { shouldAutoClearTaskPanel } from "./task-list-lifecycle.ts";

function task(status: TaskItem["status"]): TaskItem {
  return {
    id: "#1",
    content: "task",
    status,
  };
}

describe("shouldAutoClearTaskPanel", () => {
  test("returns true when all tasks are completed", () => {
    const tasks: TaskItem[] = [task("completed"), task("completed")];

    expect(shouldAutoClearTaskPanel(tasks)).toBe(true);
  });

  test("returns false when any task is in progress", () => {
    const tasks: TaskItem[] = [task("completed"), task("in_progress")];

    expect(shouldAutoClearTaskPanel(tasks)).toBe(false);
  });

  test("returns false when any task is pending", () => {
    const tasks: TaskItem[] = [task("completed"), task("pending")];

    expect(shouldAutoClearTaskPanel(tasks)).toBe(false);
  });

  test("returns false when any task is errored", () => {
    const tasks: TaskItem[] = [task("completed"), task("error")];

    expect(shouldAutoClearTaskPanel(tasks)).toBe(false);
  });

  test("returns false for an empty task list", () => {
    expect(shouldAutoClearTaskPanel([])).toBe(false);
  });

  test("auto-clears after stale in_progress snapshot is reconciled", () => {
    const inMemory: TaskItem[] = [task("completed"), task("in_progress")];
    const fromDisk: TaskItem[] = [task("completed"), task("completed")];

    const reconciled = preferTerminalTaskItems(inMemory, fromDisk);

    expect(reconciled).toEqual(fromDisk);
    expect(shouldAutoClearTaskPanel(reconciled)).toBe(true);
  });

  test("does not auto-clear when reconciled tasks are still active", () => {
    const inMemory: TaskItem[] = [task("completed"), task("in_progress")];
    const fromDisk: TaskItem[] = [task("completed"), task("in_progress")];

    const reconciled = preferTerminalTaskItems(inMemory, fromDisk);

    expect(reconciled).toEqual(inMemory);
    expect(shouldAutoClearTaskPanel(reconciled)).toBe(false);
  });
});
