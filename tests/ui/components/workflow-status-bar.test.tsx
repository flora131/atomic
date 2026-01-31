/**
 * Tests for WorkflowStatusBar Component
 *
 * Tests cover:
 * - Visibility (only when workflowActive)
 * - Workflow type display with icons
 * - Current node display
 * - Iteration display
 * - Feature progress display
 * - Utility functions
 */

import { describe, test, expect } from "bun:test";
import {
  getWorkflowIcon,
  formatWorkflowType,
  formatIteration,
  formatFeatureProgress,
  type WorkflowStatusBarProps,
  type FeatureProgress,
} from "../../../src/ui/components/workflow-status-bar.tsx";

// ============================================================================
// GET WORKFLOW ICON TESTS
// ============================================================================

describe("getWorkflowIcon", () => {
  test("returns atom icon for atomic workflow", () => {
    expect(getWorkflowIcon("atomic")).toBe("⚛");
    expect(getWorkflowIcon("Atomic")).toBe("⚛");
    expect(getWorkflowIcon("ATOMIC")).toBe("⚛");
  });

  test("returns cycle icon for ralph workflow", () => {
    expect(getWorkflowIcon("ralph")).toBe("🔄");
    expect(getWorkflowIcon("Ralph")).toBe("🔄");
    expect(getWorkflowIcon("ralph-loop")).toBe("🔄");
  });

  test("returns lightning icon for unknown workflow", () => {
    expect(getWorkflowIcon("custom")).toBe("⚡");
    expect(getWorkflowIcon("other")).toBe("⚡");
  });

  test("returns lightning icon for null/undefined", () => {
    expect(getWorkflowIcon(null)).toBe("⚡");
    expect(getWorkflowIcon(undefined)).toBe("⚡");
  });
});

// ============================================================================
// FORMAT WORKFLOW TYPE TESTS
// ============================================================================

describe("formatWorkflowType", () => {
  test("capitalizes first letter", () => {
    expect(formatWorkflowType("atomic")).toBe("Atomic");
    expect(formatWorkflowType("ralph")).toBe("Ralph");
  });

  test("handles already capitalized", () => {
    expect(formatWorkflowType("Atomic")).toBe("Atomic");
  });

  test("handles all uppercase", () => {
    expect(formatWorkflowType("ATOMIC")).toBe("ATOMIC");
  });

  test("returns Unknown for null/undefined", () => {
    expect(formatWorkflowType(null)).toBe("Unknown");
    expect(formatWorkflowType(undefined)).toBe("Unknown");
  });

  test("handles empty string", () => {
    expect(formatWorkflowType("")).toBe("Unknown");
  });
});

// ============================================================================
// FORMAT ITERATION TESTS
// ============================================================================

describe("formatIteration", () => {
  test("formats iteration without max", () => {
    expect(formatIteration(1, undefined)).toBe("Iteration 1");
    expect(formatIteration(5, undefined)).toBe("Iteration 5");
  });

  test("formats iteration with max", () => {
    expect(formatIteration(1, 5)).toBe("Iteration 1/5");
    expect(formatIteration(3, 10)).toBe("Iteration 3/10");
  });

  test("returns null for undefined iteration", () => {
    expect(formatIteration(undefined, 5)).toBeNull();
  });

  test("returns null for zero iteration", () => {
    expect(formatIteration(0, 5)).toBeNull();
  });

  test("returns null for negative iteration", () => {
    expect(formatIteration(-1, 5)).toBeNull();
  });

  test("ignores max when zero", () => {
    expect(formatIteration(1, 0)).toBe("Iteration 1");
  });
});

// ============================================================================
// FORMAT FEATURE PROGRESS TESTS
// ============================================================================

describe("formatFeatureProgress", () => {
  test("formats basic progress", () => {
    const progress: FeatureProgress = { completed: 3, total: 10 };
    expect(formatFeatureProgress(progress)).toBe("Features: 3/10");
  });

  test("formats progress with current feature", () => {
    const progress: FeatureProgress = {
      completed: 2,
      total: 5,
      currentFeature: "Add login",
    };
    expect(formatFeatureProgress(progress)).toBe("Features: 2/5 - Add login");
  });

  test("truncates long feature names", () => {
    const longFeature = "This is a very long feature name that should be truncated";
    const progress: FeatureProgress = {
      completed: 1,
      total: 3,
      currentFeature: longFeature,
    };
    const result = formatFeatureProgress(progress);
    expect(result).toContain("Features: 1/3 - ");
    expect(result!.length).toBeLessThan(50);
    expect(result).toContain("...");
  });

  test("returns null for null progress", () => {
    expect(formatFeatureProgress(null)).toBeNull();
  });

  test("returns null for undefined progress", () => {
    expect(formatFeatureProgress(undefined)).toBeNull();
  });

  test("handles zero completed", () => {
    const progress: FeatureProgress = { completed: 0, total: 5 };
    expect(formatFeatureProgress(progress)).toBe("Features: 0/5");
  });

  test("handles all completed", () => {
    const progress: FeatureProgress = { completed: 5, total: 5 };
    expect(formatFeatureProgress(progress)).toBe("Features: 5/5");
  });
});

// ============================================================================
// WORKFLOW STATUS BAR PROPS TESTS
// ============================================================================

describe("WorkflowStatusBarProps structure", () => {
  test("minimal active props", () => {
    const props: WorkflowStatusBarProps = {
      workflowActive: true,
    };

    expect(props.workflowActive).toBe(true);
    expect(props.workflowType).toBeUndefined();
    expect(props.currentNode).toBeUndefined();
  });

  test("full props", () => {
    const props: WorkflowStatusBarProps = {
      workflowActive: true,
      workflowType: "atomic",
      currentNode: "create_spec",
      iteration: 2,
      maxIterations: 5,
      featureProgress: {
        completed: 3,
        total: 10,
        currentFeature: "Add login",
      },
    };

    expect(props.workflowActive).toBe(true);
    expect(props.workflowType).toBe("atomic");
    expect(props.currentNode).toBe("create_spec");
    expect(props.iteration).toBe(2);
    expect(props.maxIterations).toBe(5);
    expect(props.featureProgress?.completed).toBe(3);
  });

  test("inactive props", () => {
    const props: WorkflowStatusBarProps = {
      workflowActive: false,
    };

    expect(props.workflowActive).toBe(false);
  });
});

// ============================================================================
// FEATURE PROGRESS STRUCTURE TESTS
// ============================================================================

describe("FeatureProgress structure", () => {
  test("minimal progress", () => {
    const progress: FeatureProgress = {
      completed: 0,
      total: 5,
    };

    expect(progress.completed).toBe(0);
    expect(progress.total).toBe(5);
    expect(progress.currentFeature).toBeUndefined();
  });

  test("progress with current feature", () => {
    const progress: FeatureProgress = {
      completed: 2,
      total: 5,
      currentFeature: "Current task",
    };

    expect(progress.currentFeature).toBe("Current task");
  });
});

// ============================================================================
// DISPLAY LOGIC TESTS
// ============================================================================

describe("Display logic", () => {
  test("shows workflow type with icon", () => {
    const icon = getWorkflowIcon("atomic");
    const type = formatWorkflowType("atomic");

    expect(`${icon} ${type}`).toBe("⚛ Atomic");
  });

  test("shows iteration with max", () => {
    const iteration = formatIteration(2, 5);
    expect(iteration).toBe("Iteration 2/5");
  });

  test("shows progress with feature", () => {
    const progress = formatFeatureProgress({
      completed: 3,
      total: 10,
      currentFeature: "Login",
    });
    expect(progress).toBe("Features: 3/10 - Login");
  });

  test("full status bar content", () => {
    const icon = getWorkflowIcon("atomic");
    const type = formatWorkflowType("atomic");
    const currentNode = "create_spec";
    const iteration = formatIteration(2, 5);
    const progress = formatFeatureProgress({ completed: 3, total: 10 });

    // Build expected content parts
    const parts = [
      `${icon} ${type}`,
      currentNode,
      iteration,
      progress,
    ].filter(Boolean);

    expect(parts).toEqual([
      "⚛ Atomic",
      "create_spec",
      "Iteration 2/5",
      "Features: 3/10",
    ]);
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe("Edge cases", () => {
  test("handles very large iteration numbers", () => {
    expect(formatIteration(999, 1000)).toBe("Iteration 999/1000");
  });

  test("handles very large feature counts", () => {
    const progress: FeatureProgress = { completed: 50, total: 100 };
    expect(formatFeatureProgress(progress)).toBe("Features: 50/100");
  });

  test("handles empty current feature", () => {
    const progress: FeatureProgress = {
      completed: 1,
      total: 5,
      currentFeature: "",
    };
    // Empty string is falsy, so no feature shown
    expect(formatFeatureProgress(progress)).toBe("Features: 1/5");
  });

  test("handles special characters in feature name", () => {
    const progress: FeatureProgress = {
      completed: 1,
      total: 5,
      currentFeature: "Add <tag> & 'quotes'",
    };
    expect(formatFeatureProgress(progress)).toContain("Add <tag>");
  });

  test("handles workflow type with special chars", () => {
    expect(formatWorkflowType("my-workflow")).toBe("My-workflow");
    expect(formatWorkflowType("workflow_name")).toBe("Workflow_name");
  });
});
