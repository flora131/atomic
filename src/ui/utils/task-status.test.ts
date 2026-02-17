import { describe, expect, test } from "bun:test";
import {
  isTaskStatus,
  mergeBlockedBy,
  normalizeTaskItem,
  normalizeTaskStatus,
  normalizeTodoItem,
  normalizeTodoItems,
  type NormalizedTaskItem,
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

describe("mergeBlockedBy", () => {
  test("restores blockedBy from previous state when omitted in update", () => {
    const previous = [
      { id: "#1", content: "Setup", status: "completed" as const },
      { id: "#2", content: "Implement", status: "pending" as const, blockedBy: ["#1"] },
      { id: "#3", content: "Test", status: "pending" as const, blockedBy: ["#1", "#2"] },
    ];

    const updated: NormalizedTaskItem[] = [
      { id: "#1", content: "Setup", status: "completed" },
      { id: "#2", content: "Implement", status: "in_progress" },
      { id: "#3", content: "Test", status: "pending" },
    ];

    const merged = mergeBlockedBy(updated, previous);
    expect(merged[0]!.blockedBy).toBeUndefined();
    expect(merged[1]!.blockedBy).toEqual(["#1"]);
    expect(merged[2]!.blockedBy).toEqual(["#1", "#2"]);
  });

  test("preserves explicitly provided blockedBy in update", () => {
    const previous = [
      { id: "#1", content: "A", status: "pending" as const, blockedBy: ["#2"] },
    ];

    const updated = [
      { id: "#1", content: "A", status: "pending" as const, blockedBy: ["#3"] },
    ];

    const merged = mergeBlockedBy(updated, previous);
    expect(merged[0]!.blockedBy).toEqual(["#3"]);
  });

  test("returns updated as-is when previous is empty", () => {
    const updated = [
      { id: "#1", content: "A", status: "pending" as const },
    ];

    const merged = mergeBlockedBy(updated, []);
    expect(merged).toEqual(updated);
  });

  test("handles tasks without IDs gracefully", () => {
    const previous: NormalizedTaskItem[] = [
      { content: "No ID", status: "pending", blockedBy: ["#1"] },
    ];

    const updated: NormalizedTaskItem[] = [
      { content: "No ID", status: "pending" },
    ];

    const merged = mergeBlockedBy(updated, previous);
    expect(merged[0]!.blockedBy).toBeUndefined();
  });

  test("matches IDs case-insensitively", () => {
    const previous: NormalizedTaskItem[] = [
      { id: "#1", content: "A", status: "pending", blockedBy: ["#2"] },
    ];

    const updated: NormalizedTaskItem[] = [
      { id: "#1", content: "A", status: "pending" },
    ];

    const merged = mergeBlockedBy(updated, previous);
    expect(merged[0]!.blockedBy).toEqual(["#2"]);
  });
});
