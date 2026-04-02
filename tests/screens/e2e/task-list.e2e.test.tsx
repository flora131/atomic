/**
 * TaskListIndicator & TaskListBox E2E Tests
 *
 * End-to-end rendering tests using OpenTUI's testRender. Validates visual
 * output for task list display, status icons, tree connectors, overflow,
 * truncation, progress bars, and header formatting.
 */

import { afterEach, describe, expect, test } from "bun:test";
import React from "react";
import { testRender } from "./test-support.ts";
import { ThemeProvider, darkTheme } from "@/theme/index.tsx";
import {
  TaskListIndicator,
  type TaskListIndicatorProps,
  type TaskItem,
  TASK_STATUS_ICONS,
} from "@/components/task-list-indicator.tsx";
import {
  TaskListBox,
  type TaskListBoxProps,
} from "@/components/task-list-panel.tsx";

// ============================================================================
// HELPERS
// ============================================================================

const DEFAULT_WIDTH = 80;
const DEFAULT_HEIGHT = 30;

let activeRenderer: { renderer: { destroy(): void } } | null = null;

/**
 * Factory for creating test TaskItems with sensible defaults.
 */
function createTask(
  overrides: Partial<TaskItem> & { description: string },
): TaskItem {
  return {
    status: "pending",
    ...overrides,
  };
}

/**
 * Render TaskListIndicator inside a ThemeProvider and capture the text frame.
 */
async function renderIndicator(
  props: TaskListIndicatorProps,
  options?: { width?: number; height?: number },
): Promise<string> {
  const width = options?.width ?? DEFAULT_WIDTH;
  const height = options?.height ?? DEFAULT_HEIGHT;

  const result = await testRender(
    <ThemeProvider initialTheme={darkTheme}>
      <TaskListIndicator {...props} />
    </ThemeProvider>,
    { width, height },
  );

  activeRenderer = result;
  await result.renderOnce();
  return result.captureCharFrame();
}

/**
 * Render TaskListBox inside a ThemeProvider and capture the text frame.
 */
async function renderBox(
  props: TaskListBoxProps,
  options?: { width?: number; height?: number },
): Promise<string> {
  const width = options?.width ?? DEFAULT_WIDTH;
  const height = options?.height ?? DEFAULT_HEIGHT;

  const result = await testRender(
    <ThemeProvider initialTheme={darkTheme}>
      <TaskListBox {...props} />
    </ThemeProvider>,
    { width, height },
  );

  activeRenderer = result;
  await result.renderOnce();
  return result.captureCharFrame();
}

// ============================================================================
// TEARDOWN
// ============================================================================

afterEach(() => {
  if (activeRenderer) {
    activeRenderer.renderer.destroy();
    activeRenderer = null;
  }
});

// ============================================================================
// TaskListIndicator TESTS
// ============================================================================

describe("TaskListIndicator E2E", () => {
  // --------------------------------------------------------------------------
  // 1. Empty items renders nothing
  // --------------------------------------------------------------------------
  test("renders nothing for empty items", async () => {
    const frame = await renderIndicator({ items: [] });

    // The entire captured frame should be blank (only whitespace)
    expect(frame.trim()).toBe("");
  });

  // --------------------------------------------------------------------------
  // 2. Single pending task
  // --------------------------------------------------------------------------
  test("renders single pending task", async () => {
    const items: TaskItem[] = [
      createTask({ description: "Install dependencies" }),
    ];

    const frame = await renderIndicator({ items });

    expect(frame).toContain("Install dependencies");
    // Pending icon: ○
    expect(frame).toContain(TASK_STATUS_ICONS.pending);
  });

  // --------------------------------------------------------------------------
  // 3. Single completed task
  // --------------------------------------------------------------------------
  test("renders single completed task", async () => {
    const items: TaskItem[] = [
      createTask({ description: "Run unit tests", status: "completed" }),
    ];

    const frame = await renderIndicator({ items });

    expect(frame).toContain("Run unit tests");
    // Completed icon: ✓
    expect(frame).toContain(TASK_STATUS_ICONS.completed);
  });

  // --------------------------------------------------------------------------
  // 4. Single in_progress task
  // --------------------------------------------------------------------------
  test("renders single in_progress task", async () => {
    const items: TaskItem[] = [
      createTask({
        description: "Building project",
        status: "in_progress",
      }),
    ];

    const frame = await renderIndicator({ items });

    expect(frame).toContain("Building project");
    // Active tasks use AnimatedBlinkIndicator which renders ● or ·
    // At initial render, visible=true so it shows ●
    expect(frame).toContain("●");
  });

  // --------------------------------------------------------------------------
  // 5. Single error task
  // --------------------------------------------------------------------------
  test("renders single error task", async () => {
    const items: TaskItem[] = [
      createTask({ description: "Deploy to production", status: "error" }),
    ];

    const frame = await renderIndicator({ items });

    expect(frame).toContain("Deploy to production");
    // Error icon: ✗
    expect(frame).toContain(TASK_STATUS_ICONS.error);
    // Error tasks show [FAILED] label
    expect(frame).toContain("[FAILED]");
  });

  // --------------------------------------------------------------------------
  // 6. Multiple tasks with different statuses
  // --------------------------------------------------------------------------
  test("renders multiple tasks with different statuses", async () => {
    const items: TaskItem[] = [
      createTask({ id: "1", description: "Lint codebase", status: "pending" }),
      createTask({
        id: "2",
        description: "Run integration tests",
        status: "in_progress",
      }),
      createTask({
        id: "3",
        description: "Update changelog",
        status: "completed",
      }),
    ];

    const frame = await renderIndicator({ items });

    // All descriptions should be visible
    expect(frame).toContain("Lint codebase");
    expect(frame).toContain("Run integration tests");
    expect(frame).toContain("Update changelog");
  });

  // --------------------------------------------------------------------------
  // 7. Tree connector └ for last item (trackEnd = ╰)
  // --------------------------------------------------------------------------
  test("shows tree connector ╰ for last item", async () => {
    const items: TaskItem[] = [
      createTask({ id: "1", description: "First task", status: "pending" }),
      createTask({ id: "2", description: "Second task", status: "pending" }),
    ];

    // maxVisible must equal items.length so overflowCount === 0,
    // which is the condition for the last item to use ╰ (trackEnd).
    // showConnector=false so the first item does NOT use the connector prefix
    // and we can clearly see the rail characters.
    const frame = await renderIndicator({
      items,
      showConnector: false,
      maxVisible: 2,
    });

    // Last item should use ╰ (trackEnd)
    expect(frame).toContain("╰");
    // First item should use ├ (trackDot) for intermediate items
    expect(frame).toContain("├");
  });

  // --------------------------------------------------------------------------
  // 8. Truncates tasks beyond maxVisible
  // --------------------------------------------------------------------------
  test("truncates tasks beyond maxVisible", async () => {
    const items: TaskItem[] = [
      createTask({ id: "1", description: "Task one", status: "pending" }),
      createTask({ id: "2", description: "Task two", status: "pending" }),
      createTask({
        id: "3",
        description: "Task three",
        status: "in_progress",
      }),
      createTask({
        id: "4",
        description: "Task four",
        status: "completed",
      }),
      createTask({ id: "5", description: "Task five", status: "pending" }),
    ];

    const frame = await renderIndicator({ items, maxVisible: 3 });

    // First 3 should be visible
    expect(frame).toContain("Task one");
    expect(frame).toContain("Task two");
    expect(frame).toContain("Task three");
    // Last 2 should NOT be visible
    expect(frame).not.toContain("Task four");
    expect(frame).not.toContain("Task five");
    // Overflow indicator: "… +2 more"
    expect(frame).toContain("+2 more");
  });

  // --------------------------------------------------------------------------
  // 9. Shows full description in expanded mode
  // --------------------------------------------------------------------------
  test("shows full description in expanded mode", async () => {
    const longDescription =
      "This is a very long task description that exceeds the default maximum content length of sixty characters and should be shown in full";
    const items: TaskItem[] = [
      createTask({ description: longDescription, status: "pending" }),
    ];

    const frame = await renderIndicator(
      { items, expanded: true },
      { width: 200, height: 30 },
    );

    // In expanded mode, the full description should appear
    expect(frame).toContain(longDescription);
  });

  // --------------------------------------------------------------------------
  // 10. Truncates long descriptions in collapsed mode
  // --------------------------------------------------------------------------
  test("truncates long descriptions in collapsed mode", async () => {
    const longDescription =
      "This is a very long task description that exceeds the default maximum content length of sixty characters";
    const items: TaskItem[] = [
      createTask({ description: longDescription, status: "pending" }),
    ];

    const frame = await renderIndicator({ items, expanded: false });

    // The full description should NOT appear
    expect(frame).not.toContain(longDescription);
    // Truncated text ends with "..." (truncateText uses three dots)
    expect(frame).toContain("...");
  });
});

// ============================================================================
// TaskListBox TESTS
// ============================================================================

describe("TaskListBox E2E", () => {
  // --------------------------------------------------------------------------
  // 11. Renders bordered container with header
  // --------------------------------------------------------------------------
  test("renders bordered container with header", async () => {
    const items: TaskItem[] = [
      createTask({ description: "Setup environment", status: "pending" }),
    ];

    const frame = await renderBox({ items });

    // Header should contain the default title
    expect(frame).toContain("Task Progress");
  });

  // --------------------------------------------------------------------------
  // 12. Shows completion count in header
  // --------------------------------------------------------------------------
  test("shows completion count in header", async () => {
    const items: TaskItem[] = [
      createTask({
        id: "1",
        description: "Write tests",
        status: "completed",
      }),
      createTask({
        id: "2",
        description: "Fix linting",
        status: "completed",
      }),
      createTask({
        id: "3",
        description: "Deploy staging",
        status: "pending",
      }),
    ];

    const frame = await renderBox({ items });

    // Header should show "2/3" (2 completed out of 3 total)
    expect(frame).toContain("2/3");
  });

  // --------------------------------------------------------------------------
  // 13. Shows percentage in header
  // --------------------------------------------------------------------------
  test("shows percentage in header", async () => {
    const items: TaskItem[] = [
      createTask({
        id: "1",
        description: "Write tests",
        status: "completed",
      }),
      createTask({
        id: "2",
        description: "Fix linting",
        status: "completed",
      }),
      createTask({
        id: "3",
        description: "Deploy staging",
        status: "pending",
      }),
    ];

    const frame = await renderBox({ items });

    // 2/3 = 66.67% rounds to 67%
    expect(frame).toContain("67%");
  });

  // --------------------------------------------------------------------------
  // 14. Shows progress bar
  // --------------------------------------------------------------------------
  test("shows progress bar", async () => {
    const items: TaskItem[] = [
      createTask({
        id: "1",
        description: "Task A",
        status: "completed",
      }),
      createTask({
        id: "2",
        description: "Task B",
        status: "pending",
      }),
    ];

    const frame = await renderBox({ items });

    // Progress bar uses ━ (filled) and ╌ (empty) characters
    expect(frame).toContain("━");
    expect(frame).toContain("╌");
  });

  // --------------------------------------------------------------------------
  // 15. Renders all task items
  // --------------------------------------------------------------------------
  test("renders all task items", async () => {
    const items: TaskItem[] = [
      createTask({
        id: "1",
        description: "Initialize project",
        status: "completed",
      }),
      createTask({
        id: "2",
        description: "Configure CI pipeline",
        status: "in_progress",
      }),
      createTask({
        id: "3",
        description: "Write documentation",
        status: "pending",
      }),
    ];

    const frame = await renderBox({ items });

    // All task descriptions should appear
    expect(frame).toContain("Initialize project");
    expect(frame).toContain("Configure CI pipeline");
    expect(frame).toContain("Write documentation");
  });

  // --------------------------------------------------------------------------
  // 16. Custom headerTitle
  // --------------------------------------------------------------------------
  test("custom headerTitle", async () => {
    const items: TaskItem[] = [
      createTask({ description: "Compile sources", status: "pending" }),
    ];

    const frame = await renderBox({
      items,
      headerTitle: "Build Tasks",
    });

    // Custom title should appear instead of default
    expect(frame).toContain("Build Tasks");
  });
});
