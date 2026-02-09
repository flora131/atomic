/**
 * Tests for TaskListIndicator component
 *
 * Covers:
 * - Returns null for empty items
 * - Renders correct status icons (◻ pending, ◉ in_progress, ◼ completed)
 * - First item gets tree connector ⎿, subsequent items get space indent
 * - Respects maxVisible limit with overflow text
 * - Mixed statuses render correctly
 * - Types are exported
 *
 * Reference: Issue #168
 */

import { describe, test, expect } from "bun:test";
import {
  TaskListIndicator,
  type TaskItem,
  type TaskListIndicatorProps,
} from "../components/task-list-indicator.tsx";

// ============================================================================
// HELPERS
// ============================================================================

function makeItem(
  content: string,
  status: TaskItem["status"] = "pending"
): TaskItem {
  return { content, status };
}

/**
 * Recursively collect all string values from a React element tree
 * so we can assert on rendered text content.
 */
function collectText(node: unknown): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);

  if (Array.isArray(node)) {
    return node.map(collectText).join("");
  }

  const el = node as { props?: { children?: unknown } };
  if (el.props?.children != null) {
    return collectText(el.props.children);
  }

  return "";
}

/**
 * Get the top-level children array from the rendered box element.
 */
function getRenderedChildren(
  result: ReturnType<typeof TaskListIndicator>
): unknown[] {
  const el = result as { props?: { children?: unknown } };
  const children = el?.props?.children;
  if (Array.isArray(children)) return children;
  if (children != null) return [children];
  return [];
}

// ============================================================================
// NULL / EMPTY TESTS
// ============================================================================

describe("TaskListIndicator - empty state", () => {
  test("returns null for empty items", () => {
    const result = TaskListIndicator({ items: [] });
    expect(result).toBeNull();
  });
});

// ============================================================================
// STATUS ICON TESTS
// ============================================================================

describe("TaskListIndicator - status icons", () => {
  test("renders pending item with ◻ icon", () => {
    const result = TaskListIndicator({ items: [makeItem("Task A", "pending")] });
    const text = collectText(result);
    expect(text).toContain("◻");
    expect(text).toContain("Task A");
  });

  test("renders in_progress item with ◉ icon", () => {
    const result = TaskListIndicator({
      items: [makeItem("Task B", "in_progress")],
    });
    const text = collectText(result);
    expect(text).toContain("◉");
    expect(text).toContain("Task B");
  });

  test("renders completed item with ◼ icon", () => {
    const result = TaskListIndicator({
      items: [makeItem("Task C", "completed")],
    });
    const text = collectText(result);
    expect(text).toContain("◼");
    expect(text).toContain("Task C");
  });
});

// ============================================================================
// TREE CONNECTOR TESTS
// ============================================================================

describe("TaskListIndicator - tree connectors", () => {
  test("first item gets tree connector ⎿", () => {
    const result = TaskListIndicator({ items: [makeItem("First")] });
    const text = collectText(result);
    expect(text).toContain("⎿");
  });

  test("subsequent items get space indent", () => {
    const result = TaskListIndicator({
      items: [makeItem("First"), makeItem("Second"), makeItem("Third")],
    });
    const children = getRenderedChildren(result);

    // The items are in the children array; first child is the mapped array
    const itemElements = children.flat();

    // Collect text from each item element individually
    const firstText = collectText(itemElements[0]);
    const secondText = collectText(itemElements[1]);
    const thirdText = collectText(itemElements[2]);

    expect(firstText).toContain("⎿");
    // Subsequent items should NOT have ⎿
    expect(secondText).not.toContain("⎿");
    expect(thirdText).not.toContain("⎿");
    // They should have space indent instead
    expect(secondText).toContain("   ");
    expect(thirdText).toContain("   ");
  });
});

// ============================================================================
// OVERFLOW / maxVisible TESTS
// ============================================================================

describe("TaskListIndicator - maxVisible and overflow", () => {
  test("respects maxVisible limit", () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      makeItem(`Task ${i + 1}`)
    );
    const result = TaskListIndicator({ items, maxVisible: 2 });
    const text = collectText(result);

    // Should show first 2 items
    expect(text).toContain("Task 1");
    expect(text).toContain("Task 2");
    // Should NOT show items beyond maxVisible
    expect(text).not.toContain("Task 3");
    expect(text).not.toContain("Task 4");
    expect(text).not.toContain("Task 5");
  });

  test("overflow text shows correct count", () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      makeItem(`Task ${i + 1}`)
    );
    const result = TaskListIndicator({ items, maxVisible: 2 });
    const text = collectText(result);

    expect(text).toContain("+3");
    expect(text).toContain("more tasks");
  });

  test("no overflow text when items fit within maxVisible", () => {
    const items = [makeItem("A"), makeItem("B")];
    const result = TaskListIndicator({ items, maxVisible: 5 });
    const text = collectText(result);

    expect(text).not.toContain("more tasks");
  });
});

// ============================================================================
// MIXED STATUS TESTS
// ============================================================================

describe("TaskListIndicator - mixed statuses", () => {
  test("mixed statuses render correctly", () => {
    const items: TaskItem[] = [
      makeItem("Pending task", "pending"),
      makeItem("Active task", "in_progress"),
      makeItem("Done task", "completed"),
    ];
    const result = TaskListIndicator({ items });
    const text = collectText(result);

    expect(text).toContain("◻");
    expect(text).toContain("◉");
    expect(text).toContain("◼");
    expect(text).toContain("Pending task");
    expect(text).toContain("Active task");
    expect(text).toContain("Done task");
  });
});

// ============================================================================
// BLOCKED BY TESTS
// ============================================================================

describe("TaskListIndicator - blocked by", () => {
  test("renders blocked by suffix with dependency IDs", () => {
    const items: TaskItem[] = [
      { content: "Verify results", status: "pending", blockedBy: ["13", "14", "15"] },
    ];
    const result = TaskListIndicator({ items });
    const text = collectText(result);

    expect(text).toContain("› blocked by #13, #14, #15");
  });

  test("does not render blocked by when blockedBy is empty", () => {
    const items: TaskItem[] = [
      { content: "No deps", status: "pending", blockedBy: [] },
    ];
    const result = TaskListIndicator({ items });
    const text = collectText(result);

    expect(text).not.toContain("blocked by");
  });

  test("does not render blocked by when blockedBy is undefined", () => {
    const items: TaskItem[] = [
      { content: "No deps", status: "pending" },
    ];
    const result = TaskListIndicator({ items });
    const text = collectText(result);

    expect(text).not.toContain("blocked by");
  });

  test("preserves # prefix if already present in IDs", () => {
    const items: TaskItem[] = [
      { content: "Task X", status: "pending", blockedBy: ["#1", "#2"] },
    ];
    const result = TaskListIndicator({ items });
    const text = collectText(result);

    expect(text).toContain("› blocked by #1, #2");
    // Should not double the # prefix
    expect(text).not.toContain("##");
  });

  test("id field is optional on TaskItem", () => {
    const item: TaskItem = { id: "42", content: "With ID", status: "pending" };
    expect(item.id).toBe("42");

    const itemNoId: TaskItem = { content: "No ID", status: "pending" };
    expect(itemNoId.id).toBeUndefined();
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
});
