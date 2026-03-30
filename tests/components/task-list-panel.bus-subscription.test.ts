/**
 * Tests for TaskListPanel props-driven rendering.
 *
 * Verifies that:
 * - TaskListPanelProps includes items, expanded, and workflowActive props
 * - The component renders TaskListBox from the items prop
 * - The component preserves the last non-empty items snapshot during auto-clear
 * - The auto-clear lifecycle (5-second buffer) still works
 * - sortTasksTopologically is applied to incoming items
 *
 * Tests use source code structural verification.
 */

import { describe, test, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Source code reference
// ---------------------------------------------------------------------------

const SOURCE_PATH = path.resolve(
  import.meta.dir,
  "../../src/components/task-list-panel.tsx",
);
const source = fs.readFileSync(SOURCE_PATH, "utf-8");

// ===========================================================================
// TaskListPanelProps type verification
// ===========================================================================

describe("TaskListPanelProps interface", () => {
  test("includes items required prop", () => {
    expect(source).toContain("items: TaskItem[]");
  });

  test("does not include sessionId prop (removed)", () => {
    expect(source).not.toContain("sessionId?: string");
  });

  test("does not include eventBus prop (removed)", () => {
    expect(source).not.toContain('eventBus?: import("@/services/events/event-bus.ts").EventBus');
  });

  test("retains expanded optional prop", () => {
    expect(source).toContain("expanded?: boolean");
  });

  test("retains workflowActive optional prop", () => {
    expect(source).toContain("workflowActive?: boolean");
  });
});

// ===========================================================================
// Component destructuring
// ===========================================================================

describe("TaskListPanel component destructuring", () => {
  test("destructures items from props", () => {
    expect(source).toContain("items,");
  });

  test("does not destructure sessionId (removed)", () => {
    expect(source).not.toMatch(/\bsessionId,/);
  });

  test("does not destructure eventBus (removed)", () => {
    expect(source).not.toContain("eventBus: eventBusProp,");
  });
});

// ===========================================================================
// Items-driven display logic
// ===========================================================================

describe("items-driven display logic", () => {
  test("maintains displayItems state for snapshot preservation", () => {
    expect(source).toContain("const [displayItems, setDisplayItems] = useState<TaskItem[]>([])");
  });

  test("updates displayItems when non-empty items arrive", () => {
    expect(source).toContain("if (items.length > 0)");
    expect(source).toContain("setDisplayItems(sortTasksTopologically(items))");
  });

  test("applies sortTasksTopologically to incoming items", () => {
    expect(source).toContain("sortTasksTopologically(items)");
  });

  test("renders null when displayItems is empty", () => {
    expect(source).toContain("if (displayItems.length === 0) return null");
  });

  test("passes displayItems to TaskListBox", () => {
    expect(source).toContain("items={displayItems}");
  });
});

// ===========================================================================
// Auto-clear lifecycle
// ===========================================================================

describe("auto-clear lifecycle", () => {
  test("shouldClear depends on workflowActive and shouldAutoClearTaskPanel", () => {
    expect(source).toContain("const shouldClear = !workflowActive && shouldAutoClearTaskPanel(displayItems)");
  });

  test("resets hidden to false when shouldClear is false", () => {
    expect(source).toContain("setHidden(false)");
  });

  test("sets hidden and clears displayItems on auto-clear timeout", () => {
    expect(source).toContain("setHidden(true)");
    expect(source).toContain("setDisplayItems([])");
  });

  test("uses AUTO_CLEAR_DELAY_MS for timeout", () => {
    expect(source).toContain("AUTO_CLEAR_DELAY_MS");
  });
});

// ===========================================================================
// Import structure
// ===========================================================================

describe("import structure", () => {
  test("imports useEffect and useState from react", () => {
    expect(source).toContain("useEffect");
    expect(source).toContain("useState");
    expect(source).toMatch(/import.*useEffect.*from\s+"react"/);
    expect(source).toMatch(/import.*useState.*from\s+"react"/);
  });

  test("does not import useOptionalEventBusContext (bus subscription removed)", () => {
    expect(source).not.toContain("useOptionalEventBusContext");
  });

  test("does not reference resolvedEventBus (bus subscription removed)", () => {
    expect(source).not.toContain("resolvedEventBus");
  });

  test("exports TaskListPanelProps interface", () => {
    expect(source).toContain("export interface TaskListPanelProps");
  });

  test("exports TaskListPanel function", () => {
    expect(source).toContain("export function TaskListPanel");
  });
});
