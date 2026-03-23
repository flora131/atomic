import { describe, expect, test } from "bun:test";
import {
  defaultWorkflowChatState,
  type WorkflowChatState,
} from "@/state/chat/shared/types/workflow.ts";

describe("WorkflowChatState — generic fields", () => {
  test("defaultWorkflowChatState has all required generic fields", () => {
    expect(defaultWorkflowChatState.workflowActive).toBe(false);
    expect(defaultWorkflowChatState.workflowType).toBeNull();
    expect(defaultWorkflowChatState.initialPrompt).toBeNull();
    expect(defaultWorkflowChatState.currentStage).toBeNull();
    expect(defaultWorkflowChatState.stageIndicator).toBeNull();
    expect(defaultWorkflowChatState.workflowConfig).toBeUndefined();
  });

  test("currentStage and stageIndicator are assignable as top-level fields", () => {
    const state: WorkflowChatState = {
      ...defaultWorkflowChatState,
      currentStage: "implement",
      stageIndicator: "Stage 3/4: implement",
    };
    expect(state.currentStage).toBe("implement");
    expect(state.stageIndicator).toBe("Stage 3/4: implement");
  });

  test("partial update resets stage fields to null", () => {
    const active: WorkflowChatState = {
      ...defaultWorkflowChatState,
      workflowActive: true,
      currentStage: "research",
      stageIndicator: "Stage 1/3: research",
    };

    // Simulate a workflow reset via partial update spread
    const reset: WorkflowChatState = {
      ...active,
      workflowActive: false,
      currentStage: null,
      stageIndicator: null,
    };

    expect(reset.workflowActive).toBe(false);
    expect(reset.currentStage).toBeNull();
    expect(reset.stageIndicator).toBeNull();
  });

  test("workflowCommandState also contains currentStage/stageIndicator (no conflict)", () => {
    const state: WorkflowChatState = {
      ...defaultWorkflowChatState,
      currentStage: "plan",
      stageIndicator: "Stage 2/3: plan",
      workflowCommandState: {
        ...defaultWorkflowChatState.workflowCommandState,
        currentStage: "plan",
        stageIndicator: "Stage 2/3: plan",
      },
    };
    // Both top-level and nested fields can be set independently
    expect(state.currentStage).toBe(state.workflowCommandState.currentStage);
    expect(state.stageIndicator).toBe(state.workflowCommandState.stageIndicator);
  });
});
