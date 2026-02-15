import { describe, expect, test } from "bun:test";
import {
  isTaskStatus,
  normalizeTaskItem,
  normalizeTaskStatus,
  normalizeTodoItem,
  normalizeTodoItems,
} from "./task-status.ts";

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

describe("task item normalization", () => {
  test("normalizes malformed task item fields", () => {
    const normalized = normalizeTaskItem({
      id: 42,
      content: "Run tests",
      status: "in-progress",
      blockedBy: ["#1", 7, "", null],
    });

    expect(normalized).toEqual({
      id: "42",
      content: "Run tests",
      status: "in_progress",
      blockedBy: ["#1", "7"],
    });
  });

  test("normalizes todo item with defaults", () => {
    const normalized = normalizeTodoItem({
      content: "Ship fix",
      status: "unknown",
    });

    expect(normalized).toEqual({
      content: "Ship fix",
      status: "pending",
      activeForm: "",
    });
  });

  test("normalizes todo item arrays", () => {
    const normalized = normalizeTodoItems([
      { content: "A", status: "done", activeForm: "Doing A" },
      { content: "B", status: "in progress", activeForm: "Doing B" },
      { content: "C", status: "bogus" },
    ]);

    expect(normalized.map((item) => item.status)).toEqual([
      "completed",
      "in_progress",
      "pending",
    ]);
  });
});
