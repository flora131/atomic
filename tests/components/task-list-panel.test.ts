/**
 * TaskListPanel Unit Tests
 *
 * Validates that TaskListPanel subscribes to workflow:tasks-updated bus events
 * as its sole data source, with no fs.watch / file-watcher dependency.
 */

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

const PANEL_SRC = fs.readFileSync(
  path.resolve(import.meta.dir, "../../src/components/task-list-panel.tsx"),
  "utf-8",
);

// ============================================================================
// Structural: imports
// ============================================================================

describe("TaskListPanel imports", () => {
  test("imports useBusSubscription hook from events/hooks", () => {
    expect(PANEL_SRC).toContain(
      'import { useBusSubscription } from "@/services/events/hooks.ts";',
    );
  });

  test("does NOT import watchTasksJson", () => {
    expect(PANEL_SRC).not.toContain("watchTasksJson");
  });

  test("does NOT import from workflow-commands (fs.watch watcher)", () => {
    expect(PANEL_SRC).not.toContain("workflow-commands");
  });

  test("does NOT import fs or node:fs", () => {
    expect(PANEL_SRC).not.toContain("from \"fs\"");
    expect(PANEL_SRC).not.toContain("from \"node:fs\"");
  });

  test("does NOT import useEffect (subscription is handled by useBusSubscription)", () => {
    // useBusSubscription handles the effect internally, so useEffect is no
    // longer needed in the component module.
    expect(PANEL_SRC).not.toContain("useEffect");
  });
});

// ============================================================================
// Structural: bus event subscription
// ============================================================================

describe("TaskListPanel bus subscription", () => {
  test("subscribes to workflow:tasks-updated event", () => {
    expect(PANEL_SRC).toContain('useBusSubscription("workflow:tasks-updated"');
  });

  test("maps event tasks to TaskItem shape (id, description, status, blockedBy)", () => {
    // The handler should extract the four TaskItem fields from event data
    expect(PANEL_SRC).toContain("t.id");
    expect(PANEL_SRC).toContain("t.description");
    expect(PANEL_SRC).toContain("t.status");
    expect(PANEL_SRC).toContain("t.blockedBy");
  });

  test("applies sortTasksTopologically to incoming tasks", () => {
    expect(PANEL_SRC).toContain("sortTasksTopologically");
  });
});

// ============================================================================
// Structural: props interface
// ============================================================================

describe("TaskListPanelProps interface", () => {
  test("includes sessionDir prop", () => {
    expect(PANEL_SRC).toContain("sessionDir: string");
  });

  test("includes expanded prop", () => {
    expect(PANEL_SRC).toContain("expanded?: boolean");
  });

  test("includes workflowActive prop", () => {
    expect(PANEL_SRC).toContain("workflowActive?: boolean");
  });

  test("does NOT include eventBus prop (uses context hook instead)", () => {
    // The eventBus is accessed via useBusSubscription / useEventBusContext,
    // not passed as a prop.
    expect(PANEL_SRC).not.toContain("eventBus?:");
    expect(PANEL_SRC).not.toContain("eventBus:");
  });

  test("does NOT include sessionId prop (no longer needed for filtering)", () => {
    // sessionId filtering was part of the hybrid approach; with sole bus
    // subscription this is unnecessary.
    expect(PANEL_SRC).not.toMatch(/sessionId\??\s*:/);
  });
});

// ============================================================================
// Structural: no normalizeTaskItem dependency
// ============================================================================

describe("TaskListPanel data normalization", () => {
  test("does NOT import normalizeTaskItem (bus events are already typed)", () => {
    // The workflow:tasks-updated bus event data is schema-validated by the
    // EventBus before dispatch, so normalizeTaskItem is unnecessary.
    expect(PANEL_SRC).not.toContain("normalizeTaskItem");
  });
});

// ============================================================================
// Exports
// ============================================================================

describe("TaskListPanel exports", () => {
  test("exports TaskListPanel as named export", () => {
    expect(PANEL_SRC).toContain("export function TaskListPanel");
  });

  test("exports TaskListBox as named export", () => {
    expect(PANEL_SRC).toContain("export const TaskListBox");
  });

  test("exports TaskListPanelProps type", () => {
    expect(PANEL_SRC).toContain("export interface TaskListPanelProps");
  });

  test("exports TaskListBoxProps type", () => {
    expect(PANEL_SRC).toContain("export interface TaskListBoxProps");
  });

  test("has default export of TaskListPanel", () => {
    expect(PANEL_SRC).toContain("export default TaskListPanel");
  });
});
