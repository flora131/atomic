/**
 * Tests for parts truncation on stage completion.
 *
 * Validates that `truncateStageParts()` correctly identifies and replaces
 * verbose parts (tool, reasoning, text) belonging to a completed workflow
 * stage with a single TruncationPart summary, while preserving important
 * parts and respecting stage boundaries.
 */

import { describe, expect, test, beforeEach } from "bun:test";
import {
  truncateStageParts,
  createDefaultPartsTruncationConfig,
  DEFAULT_MIN_TRUNCATION_PARTS,
  type PartsTruncationConfig,
  type TruncationResult,
} from "@/state/parts/truncation.ts";
import { _resetPartCounter, createPartId } from "@/state/parts/id.ts";
import type {
  Part,
  TextPart,
  ToolPart,
  ReasoningPart,
  WorkflowStepPart,
  TruncationPart,
  TaskListPart,
  TaskResultPart,
} from "@/state/parts/types.ts";

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function textPart(content: string, isStreaming = false): TextPart {
  return {
    id: createPartId(),
    type: "text",
    content,
    isStreaming,
    createdAt: new Date().toISOString(),
  };
}

function reasoningPart(content: string): ReasoningPart {
  return {
    id: createPartId(),
    type: "reasoning",
    content,
    durationMs: 100,
    isStreaming: false,
    createdAt: new Date().toISOString(),
  };
}

function toolPart(
  name: string,
  status: "pending" | "running" | "completed" | "error" = "completed",
  output: unknown = "result",
): ToolPart {
  const state =
    status === "completed"
      ? { status: "completed" as const, output, durationMs: 50 }
      : status === "error"
        ? { status: "error" as const, error: "fail" }
        : status === "running"
          ? { status: "running" as const, startedAt: new Date().toISOString() }
          : { status: "pending" as const };

  return {
    id: createPartId(),
    type: "tool",
    toolCallId: `call-${name}`,
    toolName: name,
    input: { arg: "val" },
    state,
    createdAt: new Date().toISOString(),
  };
}

function workflowStepPart(
  nodeId: string,
  status: "running" | "completed" | "error" | "skipped" = "completed",
  workflowId = "wf-1",
): WorkflowStepPart {
  return {
    id: createPartId(),
    type: "workflow-step",
    workflowId,
    nodeId,
    status,
    startedAt: new Date().toISOString(),
    ...(status !== "running" ? { completedAt: new Date().toISOString(), durationMs: 1000 } : {}),
    createdAt: new Date().toISOString(),
  };
}

function taskListPart(): TaskListPart {
  return {
    id: createPartId(),
    type: "task-list",
    items: [{ id: "t1", description: "Task 1", status: "pending" }],
    expanded: false,
    createdAt: new Date().toISOString(),
  };
}

function taskResultPart(): TaskResultPart {
  return {
    id: createPartId(),
    type: "task-result",
    taskId: "t1",
    toolName: "worker",
    title: "Task 1 result",
    status: "completed",
    outputText: "Done",
    createdAt: new Date().toISOString(),
  };
}

const defaultConfig: PartsTruncationConfig = createDefaultPartsTruncationConfig();

/** Config with lower threshold for tests focused on behavior, not threshold. */
const testConfig: PartsTruncationConfig = createDefaultPartsTruncationConfig({ minTruncationParts: 3 });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("truncateStageParts", () => {
  beforeEach(() => {
    _resetPartCounter();
  });

  // -----------------------------------------------------------------------
  // Default Config
  // -----------------------------------------------------------------------

  describe("createDefaultPartsTruncationConfig", () => {
    test("returns sensible defaults", () => {
      const config = createDefaultPartsTruncationConfig();
      expect(config.minTruncationParts).toBe(DEFAULT_MIN_TRUNCATION_PARTS);
      expect(config.truncateText).toBe(true);
      expect(config.truncateReasoning).toBe(true);
      expect(config.truncateTools).toBe(true);
    });

    test("allows partial overrides", () => {
      const config = createDefaultPartsTruncationConfig({ truncateText: false, minTruncationParts: 1 });
      expect(config.truncateText).toBe(false);
      expect(config.minTruncationParts).toBe(1);
      expect(config.truncateReasoning).toBe(true);
      expect(config.truncateTools).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // No-Op Scenarios
  // -----------------------------------------------------------------------

  describe("no-op cases", () => {
    test("returns unchanged parts when completed step not found", () => {
      const parts: Part[] = [textPart("hello"), toolPart("read")];
      const result = truncateStageParts(parts, "planner", "wf-1", testConfig);

      expect(result.truncated).toBe(false);
      expect(result.parts).toHaveLength(2);
      expect(result.removedCount).toBe(0);
    });

    test("returns unchanged parts when below minimum threshold", () => {
      const step = workflowStepPart("planner");
      const parts: Part[] = [
        step,
        textPart("hello"),
        toolPart("read"),
      ];
      // Only 2 truncatable parts (text + tool), threshold is 3
      const result = truncateStageParts(parts, "planner", "wf-1", testConfig);

      expect(result.truncated).toBe(false);
    });

    test("returns unchanged parts when step belongs to different workflow", () => {
      const step = workflowStepPart("planner", "completed", "wf-other");
      const parts: Part[] = [
        step,
        textPart("a"), textPart("b"), toolPart("c"),
      ];
      const result = truncateStageParts(parts, "planner", "wf-1", testConfig);

      expect(result.truncated).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Basic Truncation
  // -----------------------------------------------------------------------

  describe("basic truncation", () => {
    test("compacts tool, text, and reasoning parts into a single TruncationPart", () => {
      const step = workflowStepPart("planner");
      const parts: Part[] = [
        step,
        textPart("Planning output"),
        reasoningPart("Thinking about the problem"),
        toolPart("file_read"),
      ];

      const result = truncateStageParts(parts, "planner", "wf-1", testConfig);

      expect(result.truncated).toBe(true);
      expect(result.removedCount).toBe(3);
      expect(result.reclaimedBytes).toBeGreaterThan(0);

      // Should have 2 parts: WorkflowStepPart + TruncationPart
      expect(result.parts).toHaveLength(2);
      expect(result.parts[0]!.type).toBe("workflow-step");
      expect(result.parts[1]!.type).toBe("truncation");

      const truncation = result.parts[1] as TruncationPart;
      expect(truncation.summary).toContain("planner");
      expect(truncation.summary).toContain("1 tool call");
      expect(truncation.summary).toContain("1 text block");
      expect(truncation.summary).toContain("1 reasoning block");
    });

    test("truncation summary includes correct plural forms", () => {
      const step = workflowStepPart("orch");
      const parts: Part[] = [
        step,
        textPart("a"),
        textPart("b"),
        toolPart("x"),
        toolPart("y"),
        toolPart("z"),
      ];

      const result = truncateStageParts(parts, "orch", "wf-1", testConfig);

      expect(result.truncated).toBe(true);
      const truncation = result.parts.find(p => p.type === "truncation") as TruncationPart;
      expect(truncation.summary).toContain("3 tool calls");
      expect(truncation.summary).toContain("2 text blocks");
    });
  });

  // -----------------------------------------------------------------------
  // Preserved Part Types
  // -----------------------------------------------------------------------

  describe("preserved parts", () => {
    test("preserves workflow-step parts", () => {
      const step = workflowStepPart("planner");
      const parts: Part[] = [
        step,
        textPart("a"), textPart("b"), toolPart("c"),
      ];

      const result = truncateStageParts(parts, "planner", "wf-1", testConfig);

      expect(result.truncated).toBe(true);
      const stepParts = result.parts.filter(p => p.type === "workflow-step");
      expect(stepParts).toHaveLength(1);
    });

    test("preserves task-list parts", () => {
      const step = workflowStepPart("planner");
      const tl = taskListPart();
      const parts: Part[] = [
        step,
        textPart("a"), textPart("b"), toolPart("c"),
        tl,
      ];

      const result = truncateStageParts(parts, "planner", "wf-1", testConfig);

      expect(result.truncated).toBe(true);
      const taskLists = result.parts.filter(p => p.type === "task-list");
      expect(taskLists).toHaveLength(1);
    });

    test("preserves task-result parts", () => {
      const step = workflowStepPart("planner");
      const tr = taskResultPart();
      const parts: Part[] = [
        step,
        textPart("a"), textPart("b"), toolPart("c"),
        tr,
      ];

      const result = truncateStageParts(parts, "planner", "wf-1", testConfig);

      expect(result.truncated).toBe(true);
      const taskResults = result.parts.filter(p => p.type === "task-result");
      expect(taskResults).toHaveLength(1);
    });

    test("preserves existing truncation parts", () => {
      const existingTruncation: TruncationPart = {
        id: createPartId(),
        type: "truncation",
        summary: "Previous stage truncated",
        createdAt: new Date().toISOString(),
      };
      const step = workflowStepPart("orch");
      const parts: Part[] = [
        existingTruncation,
        step,
        textPart("a"), textPart("b"), toolPart("c"),
      ];

      const result = truncateStageParts(parts, "orch", "wf-1", testConfig);

      expect(result.truncated).toBe(true);
      const truncationParts = result.parts.filter(p => p.type === "truncation");
      // Should have 2: the existing one + the new one
      expect(truncationParts).toHaveLength(2);
      expect((truncationParts[0] as TruncationPart).summary).toBe("Previous stage truncated");
    });
  });

  // -----------------------------------------------------------------------
  // Stage Boundary Detection
  // -----------------------------------------------------------------------

  describe("stage boundaries", () => {
    test("only compacts parts within the completed stage boundary", () => {
      const step1 = workflowStepPart("planner");
      const step2 = workflowStepPart("orchestrator");

      // Stage 1 parts
      const plannerText = textPart("Planner output");
      const plannerTool1 = toolPart("plan_tool1");
      const plannerTool2 = toolPart("plan_tool2");
      // Stage 2 parts
      const orchText = textPart("Orchestrator output");
      const orchTool = toolPart("orch_tool");

      const parts: Part[] = [
        step1,
        plannerText, plannerTool1, plannerTool2,
        step2,
        orchText, orchTool,
      ];

      // Complete orchestrator — only compact its parts (orchText, orchTool),
      // not planner's parts
      const result = truncateStageParts(
        parts, "orchestrator", "wf-1",
        createDefaultPartsTruncationConfig({ minTruncationParts: 2 }),
      );

      expect(result.truncated).toBe(true);
      expect(result.removedCount).toBe(2); // orchText + orchTool

      // Planner parts should still be present
      const textParts = result.parts.filter(p => p.type === "text");
      expect(textParts).toHaveLength(1);
      expect((textParts[0] as TextPart).content).toBe("Planner output");

      // Planner tool parts should still be present
      const toolParts = result.parts.filter(p => p.type === "tool");
      expect(toolParts).toHaveLength(2);
    });

    test("compacts first stage when no previous step exists", () => {
      const step = workflowStepPart("planner");
      const parts: Part[] = [
        step,
        textPart("a"), textPart("b"), toolPart("c"),
      ];

      const result = truncateStageParts(parts, "planner", "wf-1", testConfig);

      expect(result.truncated).toBe(true);
      expect(result.removedCount).toBe(3);
    });

    test("does not compact parts after the completed step's next stage", () => {
      const step = workflowStepPart("planner");
      const nextStep = workflowStepPart("orchestrator");
      const afterStepText = textPart("Next stage text");
      const afterStepTool = toolPart("next_tool");

      const parts: Part[] = [
        step,
        textPart("a"), textPart("b"), toolPart("c"),
        nextStep,
        afterStepText,
        afterStepTool,
      ];

      const result = truncateStageParts(parts, "planner", "wf-1", testConfig);

      expect(result.truncated).toBe(true);
      expect(result.removedCount).toBe(3);
      // After-step parts should remain
      const textParts = result.parts.filter(p => p.type === "text");
      expect(textParts).toHaveLength(1);
      expect((textParts[0] as TextPart).content).toBe("Next stage text");

      const toolParts = result.parts.filter(p => p.type === "tool");
      expect(toolParts).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // Config-Driven Behavior
  // -----------------------------------------------------------------------

  describe("config-driven behavior", () => {
    test("skips text truncation when truncateText is false", () => {
      const step = workflowStepPart("planner");
      const parts: Part[] = [
        step,
        textPart("a"), textPart("b"),
        toolPart("x"), toolPart("y"), toolPart("z"),
        toolPart("w"), toolPart("v"),
      ];

      const config = createDefaultPartsTruncationConfig({ truncateText: false });
      const result = truncateStageParts(parts, "planner", "wf-1", config);

      expect(result.truncated).toBe(true);
      // Text parts should remain, only tools truncated
      const textParts = result.parts.filter(p => p.type === "text");
      expect(textParts).toHaveLength(2);
      expect(result.removedCount).toBe(5); // only tools
    });

    test("skips reasoning truncation when truncateReasoning is false", () => {
      const step = workflowStepPart("planner");
      const parts: Part[] = [
        step,
        reasoningPart("thinking"),
        toolPart("x"), toolPart("y"), toolPart("z"),
        toolPart("w"), toolPart("v"),
      ];

      const config = createDefaultPartsTruncationConfig({ truncateReasoning: false });
      const result = truncateStageParts(parts, "planner", "wf-1", config);

      expect(result.truncated).toBe(true);
      const reasoningParts = result.parts.filter(p => p.type === "reasoning");
      expect(reasoningParts).toHaveLength(1);
      expect(result.removedCount).toBe(5); // only tools
    });

    test("skips tool truncation when truncateTools is false", () => {
      const step = workflowStepPart("planner");
      const parts: Part[] = [
        step,
        textPart("a"), textPart("b"), textPart("c"),
        textPart("d"), textPart("e"),
        toolPart("x"),
      ];

      const config = createDefaultPartsTruncationConfig({ truncateTools: false });
      const result = truncateStageParts(parts, "planner", "wf-1", config);

      expect(result.truncated).toBe(true);
      const toolParts = result.parts.filter(p => p.type === "tool");
      expect(toolParts).toHaveLength(1);
      expect(result.removedCount).toBe(5); // only text
    });

    test("respects minTruncationParts threshold", () => {
      const step = workflowStepPart("planner");
      const parts: Part[] = [
        textPart("a"), toolPart("b"),
        step,
      ];

      // 2 truncatable parts, threshold is 5
      const config = createDefaultPartsTruncationConfig({ minTruncationParts: 5 });
      const result = truncateStageParts(parts, "planner", "wf-1", config);

      expect(result.truncated).toBe(false);
    });

    test("compacts with low threshold", () => {
      const step = workflowStepPart("planner");
      const parts: Part[] = [
        step,
        toolPart("read"),
      ];

      const config = createDefaultPartsTruncationConfig({ minTruncationParts: 1 });
      const result = truncateStageParts(parts, "planner", "wf-1", config);

      expect(result.truncated).toBe(true);
      expect(result.removedCount).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // Edge Cases
  // -----------------------------------------------------------------------

  describe("edge cases", () => {
    test("does not compact streaming text parts", () => {
      const step = workflowStepPart("planner");
      const parts: Part[] = [
        step,
        textPart("streaming", true), // isStreaming = true
        toolPart("a"), toolPart("b"), toolPart("c"),
      ];

      const result = truncateStageParts(parts, "planner", "wf-1", testConfig);

      expect(result.truncated).toBe(true);
      // Streaming text should be preserved
      const textParts = result.parts.filter(p => p.type === "text");
      expect(textParts).toHaveLength(1);
      expect((textParts[0] as TextPart).isStreaming).toBe(true);
    });

    test("does not compact pending or running tool parts", () => {
      const step = workflowStepPart("planner");
      const parts: Part[] = [
        step,
        toolPart("running-tool", "running"),
        toolPart("pending-tool", "pending"),
        toolPart("done1", "completed"),
        toolPart("done2", "completed"),
        toolPart("done3", "completed"),
      ];

      const result = truncateStageParts(parts, "planner", "wf-1", testConfig);

      expect(result.truncated).toBe(true);
      // Running and pending tools preserved
      const toolParts = result.parts.filter(p => p.type === "tool");
      expect(toolParts).toHaveLength(2);
      expect((toolParts[0] as ToolPart).toolName).toBe("running-tool");
      expect((toolParts[1] as ToolPart).toolName).toBe("pending-tool");
    });

    test("compacts errored tool parts", () => {
      const step = workflowStepPart("planner");
      const parts: Part[] = [
        step,
        toolPart("err1", "error"),
        toolPart("err2", "error"),
        toolPart("ok", "completed"),
      ];

      const result = truncateStageParts(parts, "planner", "wf-1", testConfig);

      expect(result.truncated).toBe(true);
      expect(result.removedCount).toBe(3);
    });

    test("handles empty parts array", () => {
      const result = truncateStageParts([], "planner", "wf-1", testConfig);
      expect(result.truncated).toBe(false);
      expect(result.parts).toHaveLength(0);
    });

    test("handles parts array with only preserved types", () => {
      const step = workflowStepPart("planner");
      const parts: Part[] = [taskListPart(), step];

      const result = truncateStageParts(parts, "planner", "wf-1", testConfig);

      expect(result.truncated).toBe(false);
    });

    test("reclaimed bytes estimation includes tool output", () => {
      const step = workflowStepPart("planner");
      const bigOutput = "x".repeat(10000);
      const parts: Part[] = [
        step,
        toolPart("big", "completed", bigOutput),
        toolPart("small", "completed", "ok"),
        toolPart("medium", "completed", "y".repeat(500)),
      ];

      const result = truncateStageParts(parts, "planner", "wf-1", testConfig);

      expect(result.truncated).toBe(true);
      expect(result.reclaimedBytes).toBeGreaterThan(10000);
    });
  });

  // -----------------------------------------------------------------------
  // Multi-Stage Workflow
  // -----------------------------------------------------------------------

  describe("multi-stage workflow", () => {
    test("compacts stages independently without cross-contamination", () => {
      // Simulate: planner completed and truncated, then orchestrator completes
      const plannerStep = workflowStepPart("planner");
      const plannerTruncation: TruncationPart = {
        id: createPartId(),
        type: "truncation",
        summary: "planner: 5 tool calls truncated",
        createdAt: new Date().toISOString(),
      };

      const orchStep = workflowStepPart("orchestrator");
      const orchText = textPart("Orchestrator result");
      const orchTool1 = toolPart("dispatch");
      const orchTool2 = toolPart("collect");
      const orchTool3 = toolPart("aggregate");
      const orchReasoning = reasoningPart("Thinking about tasks");
      const orchReasoning2 = reasoningPart("Further analysis");

      const parts: Part[] = [
        plannerStep,
        plannerTruncation,
        orchStep,
        orchText,
        orchTool1,
        orchTool2,
        orchTool3,
        orchReasoning,
        orchReasoning2,
      ];

      const result = truncateStageParts(
        parts, "orchestrator", "wf-1",
        createDefaultPartsTruncationConfig(),
      );

      expect(result.truncated).toBe(true);
      expect(result.removedCount).toBe(6); // orchText + 3 tools + 2 reasoning

      // Planner's truncation should be untouched
      const truncationParts = result.parts.filter(p => p.type === "truncation");
      expect(truncationParts).toHaveLength(2);
      expect((truncationParts[0] as TruncationPart).summary).toBe("planner: 5 tool calls truncated");
      expect((truncationParts[1] as TruncationPart).summary).toContain("orchestrator");
    });
  });
});
