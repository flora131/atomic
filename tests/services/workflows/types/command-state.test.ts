import { describe, expect, test } from "bun:test";
import {
  defaultWorkflowCommandState,
  type WorkflowCommandState,
  type WorkflowProgressState,
  type WorkflowCommandArgs,
} from "@/services/workflows/types/command-state.ts";

// ---------------------------------------------------------------------------
// defaultWorkflowCommandState
// ---------------------------------------------------------------------------

describe("defaultWorkflowCommandState", () => {
  test("has all required WorkflowCommandState fields", () => {
    const keys = Object.keys(defaultWorkflowCommandState).sort();
    const expected = [
      "approved",
      "currentNode",
      "currentStage",
      "extensions",
      "feedback",
      "iteration",
      "pendingApproval",
      "progress",
      "stageIndicator",
    ];
    expect(keys).toEqual(expected);
  });

  test("initializes currentNode to null", () => {
    expect(defaultWorkflowCommandState.currentNode).toBeNull();
  });

  test("initializes iteration to 0", () => {
    expect(defaultWorkflowCommandState.iteration).toBe(0);
  });

  test("initializes currentStage to null", () => {
    expect(defaultWorkflowCommandState.currentStage).toBeNull();
  });

  test("initializes stageIndicator to null", () => {
    expect(defaultWorkflowCommandState.stageIndicator).toBeNull();
  });

  test("initializes progress to null", () => {
    expect(defaultWorkflowCommandState.progress).toBeNull();
  });

  test("initializes pendingApproval to false", () => {
    expect(defaultWorkflowCommandState.pendingApproval).toBe(false);
  });

  test("initializes approved to false", () => {
    expect(defaultWorkflowCommandState.approved).toBe(false);
  });

  test("initializes feedback to null", () => {
    expect(defaultWorkflowCommandState.feedback).toBeNull();
  });

  test("initializes extensions to an empty object", () => {
    expect(defaultWorkflowCommandState.extensions).toEqual({});
  });

  test("is assignable to WorkflowCommandState type", () => {
    // TypeScript compile-time check; at runtime we verify the shape
    const state: WorkflowCommandState = { ...defaultWorkflowCommandState };
    expect(state.currentNode).toBeNull();
    expect(state.iteration).toBe(0);
    expect(state.pendingApproval).toBe(false);
  });

  test("does not share extensions reference across spreads", () => {
    const state1 = { ...defaultWorkflowCommandState };
    const state2 = { ...defaultWorkflowCommandState };

    // Extensions object from spread should be shallow copied from the same source
    // but each spread creates a new top-level object
    state1.extensions = { foo: "bar" };
    expect(state2.extensions).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// WorkflowProgressState shape checks
// ---------------------------------------------------------------------------

describe("WorkflowProgressState", () => {
  test("accepts minimal progress state with completed and total", () => {
    const progress: WorkflowProgressState = {
      completed: 3,
      total: 10,
    };
    expect(progress.completed).toBe(3);
    expect(progress.total).toBe(10);
    expect(progress.currentItem).toBeUndefined();
  });

  test("accepts progress state with currentItem", () => {
    const progress: WorkflowProgressState = {
      completed: 5,
      total: 10,
      currentItem: "Implement login form",
    };
    expect(progress.currentItem).toBe("Implement login form");
  });

  test("supports zero values for completed and total", () => {
    const progress: WorkflowProgressState = {
      completed: 0,
      total: 0,
    };
    expect(progress.completed).toBe(0);
    expect(progress.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// WorkflowCommandArgs shape checks
// ---------------------------------------------------------------------------

describe("WorkflowCommandArgs", () => {
  test("requires a prompt field", () => {
    const args: WorkflowCommandArgs = { prompt: "Build a login page" };
    expect(args.prompt).toBe("Build a login page");
  });

  test("accepts empty string prompt", () => {
    const args: WorkflowCommandArgs = { prompt: "" };
    expect(args.prompt).toBe("");
  });
});
