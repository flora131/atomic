/**
 * Tests for TaskListIndicator utility functions
 *
 * Covers:
 * - TASK_STATUS_ICONS mapping (○ pending, ● in_progress/completed, ✕ error)
 * - getStatusColorKey returns correct semantic color key
 * - truncate function behavior
 * - MAX_CONTENT_LENGTH constant
 * - Type exports compile correctly
 *
 * Note: The component itself uses React hooks (useThemeColors, useState, useEffect)
 * and cannot be tested as a plain function call. Only pure utility functions are tested.
 *
 * Reference: Issue #168
 */

import { describe, test, expect } from "bun:test";
import {
  TASK_STATUS_ICONS,
  MAX_CONTENT_LENGTH,
  truncate,
  getStatusColorKey,
  type TaskItem,
  type TaskListIndicatorProps,
} from "../components/task-list-indicator.tsx";

// ============================================================================
// STATUS ICONS TESTS
// ============================================================================

describe("TaskListIndicator - TASK_STATUS_ICONS", () => {
  test("pending uses ○ (open circle)", () => {
    expect(TASK_STATUS_ICONS.pending).toBe("○");
  });

  test("in_progress uses ● (filled circle)", () => {
    expect(TASK_STATUS_ICONS.in_progress).toBe("●");
  });

  test("completed uses ● (filled circle)", () => {
    expect(TASK_STATUS_ICONS.completed).toBe("●");
  });

  test("error uses ✕ (cross)", () => {
    expect(TASK_STATUS_ICONS.error).toBe("✕");
  });

  test("covers all TaskItem statuses", () => {
    const statuses: TaskItem["status"][] = ["pending", "in_progress", "completed", "error"];
    for (const status of statuses) {
      expect(TASK_STATUS_ICONS[status]).toBeDefined();
      expect(typeof TASK_STATUS_ICONS[status]).toBe("string");
    }
  });
});

// ============================================================================
// getStatusColorKey TESTS
// ============================================================================

describe("TaskListIndicator - getStatusColorKey", () => {
  test("pending maps to muted", () => {
    expect(getStatusColorKey("pending")).toBe("muted");
  });

  test("in_progress maps to accent", () => {
    expect(getStatusColorKey("in_progress")).toBe("accent");
  });

  test("completed maps to success", () => {
    expect(getStatusColorKey("completed")).toBe("success");
  });

  test("error maps to error", () => {
    expect(getStatusColorKey("error")).toBe("error");
  });
});

// ============================================================================
// TRUNCATE TESTS
// ============================================================================

describe("TaskListIndicator - truncate", () => {
  test("returns text unchanged when within limit", () => {
    expect(truncate("short", 10)).toBe("short");
  });

  test("returns text unchanged at exact limit", () => {
    expect(truncate("12345", 5)).toBe("12345");
  });

  test("truncates and adds ellipsis when exceeding limit", () => {
    expect(truncate("this is a long string", 10)).toBe("this is a…");
  });

  test("handles empty string", () => {
    expect(truncate("", 10)).toBe("");
  });

  test("handles single character limit", () => {
    expect(truncate("ab", 1)).toBe("…");
  });
});

// ============================================================================
// MAX_CONTENT_LENGTH TESTS
// ============================================================================

describe("TaskListIndicator - MAX_CONTENT_LENGTH", () => {
  test("is a reasonable length for TUI display", () => {
    expect(MAX_CONTENT_LENGTH).toBe(60);
    expect(typeof MAX_CONTENT_LENGTH).toBe("number");
  });
});

// ============================================================================
// BLOCKED BY ID FORMAT TESTS
// ============================================================================

describe("TaskListIndicator - blockedBy format", () => {
  test("id field is optional on TaskItem", () => {
    const item: TaskItem = { id: "42", content: "With ID", status: "pending" };
    expect(item.id).toBe("42");

    const itemNoId: TaskItem = { content: "No ID", status: "pending" };
    expect(itemNoId.id).toBeUndefined();
  });

  test("blockedBy field is optional", () => {
    const item: TaskItem = { content: "Task", status: "pending" };
    expect(item.blockedBy).toBeUndefined();

    const itemWithBlocked: TaskItem = { content: "Task", status: "pending", blockedBy: ["1", "2"] };
    expect(itemWithBlocked.blockedBy).toEqual(["1", "2"]);
  });

  test("error status is valid on TaskItem", () => {
    const item: TaskItem = { content: "Failed task", status: "error" };
    expect(item.status).toBe("error");
  });
});

// ============================================================================
// TYPE EXPORT TESTS
// ============================================================================

describe("TaskListIndicator - type exports", () => {
  test("exports TaskItem and TaskListIndicatorProps types", () => {
    // Type-level check: these compile without errors
    const item: TaskItem = { content: "test", status: "pending" };
    const props: TaskListIndicatorProps = { items: [item], maxVisible: 5 };

    expect(item.content).toBe("test");
    expect(props.items).toHaveLength(1);
    expect(props.maxVisible).toBe(5);
  });

  test("TaskItem supports all four statuses", () => {
    const statuses: TaskItem["status"][] = ["pending", "in_progress", "completed", "error"];
    const items: TaskItem[] = statuses.map(s => ({ content: `Task ${s}`, status: s }));

    expect(items).toHaveLength(4);
    expect(items.map(i => i.status)).toEqual(statuses);
  });
});
