/**
 * Tests for Workflow SDK Zod Schemas
 *
 * Validates that the exported schemas correctly accept valid inputs and
 * reject invalid ones.  These are real Zod validations — no mocking.
 *
 * Source: packages/workflow-sdk/src/schemas.ts
 */

import { describe, test, expect } from "bun:test";
import {
  JsonValueSchema,
  TaskItemSchema,
  StageOutputStatusSchema,
  StageOutputSchema,
  SignalTypeSchema,
  SignalDataSchema,
  AgentTypeSchema,
  SessionConfigSchema,
  AskUserQuestionConfigSchema,
} from "../../../packages/workflow-sdk/src/schemas.ts";

// ---------------------------------------------------------------------------
// JsonValueSchema
// ---------------------------------------------------------------------------

describe("JsonValueSchema", () => {
  test("accepts string primitives", () => {
    expect(JsonValueSchema.safeParse("hello").success).toBe(true);
    expect(JsonValueSchema.safeParse("").success).toBe(true);
  });

  test("accepts number primitives", () => {
    expect(JsonValueSchema.safeParse(42).success).toBe(true);
    expect(JsonValueSchema.safeParse(0).success).toBe(true);
    expect(JsonValueSchema.safeParse(-3.14).success).toBe(true);
  });

  test("accepts boolean primitives", () => {
    expect(JsonValueSchema.safeParse(true).success).toBe(true);
    expect(JsonValueSchema.safeParse(false).success).toBe(true);
  });

  test("accepts null", () => {
    expect(JsonValueSchema.safeParse(null).success).toBe(true);
  });

  test("accepts arrays of JSON values", () => {
    expect(JsonValueSchema.safeParse([1, "two", true, null]).success).toBe(true);
    expect(JsonValueSchema.safeParse([]).success).toBe(true);
  });

  test("accepts nested objects", () => {
    const nested = {
      a: 1,
      b: "two",
      c: { d: [true, null, { e: "deep" }] },
    };
    expect(JsonValueSchema.safeParse(nested).success).toBe(true);
  });

  test("accepts deeply nested recursive structures", () => {
    const deep = { l1: { l2: { l3: { l4: [[[{ val: 42 }]]] } } } };
    expect(JsonValueSchema.safeParse(deep).success).toBe(true);
  });

  test("rejects undefined", () => {
    expect(JsonValueSchema.safeParse(undefined).success).toBe(false);
  });

  test("rejects functions", () => {
    expect(JsonValueSchema.safeParse(() => {}).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TaskItemSchema
// ---------------------------------------------------------------------------

describe("TaskItemSchema", () => {
  test("validates a complete task item", () => {
    const result = TaskItemSchema.safeParse({
      id: "task-1",
      description: "Implement feature X",
      status: "pending",
      summary: "Implementing feature X",
      blockedBy: ["task-0"],
    });
    expect(result.success).toBe(true);
  });

  test("validates a minimal task item (only required fields)", () => {
    const result = TaskItemSchema.safeParse({
      description: "Do something",
      status: "pending",
      summary: "Doing something",
    });
    expect(result.success).toBe(true);
  });

  test("rejects missing required field: description", () => {
    const result = TaskItemSchema.safeParse({
      status: "pending",
      summary: "Summary",
    });
    expect(result.success).toBe(false);
  });

  test("rejects missing required field: status", () => {
    const result = TaskItemSchema.safeParse({
      description: "Desc",
      summary: "Summary",
    });
    expect(result.success).toBe(false);
  });

  test("rejects missing required field: summary", () => {
    const result = TaskItemSchema.safeParse({
      description: "Desc",
      status: "pending",
    });
    expect(result.success).toBe(false);
  });

  test("validates array of task items", () => {
    const result = TaskItemSchema.array().safeParse([
      { description: "A", status: "pending", summary: "A" },
      { description: "B", status: "done", summary: "B", blockedBy: ["A"] },
    ]);
    expect(result.success).toBe(true);
  });

  test("rejects non-object input", () => {
    expect(TaskItemSchema.safeParse("not an object").success).toBe(false);
    expect(TaskItemSchema.safeParse(42).success).toBe(false);
    expect(TaskItemSchema.safeParse(null).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// StageOutputSchema
// ---------------------------------------------------------------------------

describe("StageOutputSchema", () => {
  test("validates a minimal stage output", () => {
    const result = StageOutputSchema.safeParse({
      stageId: "planner",
      rawResponse: "Here is the plan...",
      status: "completed",
    });
    expect(result.success).toBe(true);
  });

  test("validates stage output with parsedOutput (JsonValue values)", () => {
    const result = StageOutputSchema.safeParse({
      stageId: "planner",
      rawResponse: "output",
      parsedOutput: {
        tasks: [{ id: "1", name: "task" }],
        count: 42,
        nested: { deep: true },
      },
      status: "completed",
    });
    expect(result.success).toBe(true);
  });

  test("validates stage output with error status", () => {
    const result = StageOutputSchema.safeParse({
      stageId: "planner",
      rawResponse: "",
      status: "error",
      error: "Agent timed out",
    });
    expect(result.success).toBe(true);
  });

  test("rejects invalid status", () => {
    const result = StageOutputSchema.safeParse({
      stageId: "planner",
      rawResponse: "",
      status: "running",
    });
    expect(result.success).toBe(false);
  });

  test("rejects missing required fields", () => {
    expect(StageOutputSchema.safeParse({ stageId: "x" }).success).toBe(false);
    expect(StageOutputSchema.safeParse({ rawResponse: "y" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// StageOutputStatusSchema
// ---------------------------------------------------------------------------

describe("StageOutputStatusSchema", () => {
  test("accepts valid statuses", () => {
    expect(StageOutputStatusSchema.safeParse("completed").success).toBe(true);
    expect(StageOutputStatusSchema.safeParse("interrupted").success).toBe(true);
    expect(StageOutputStatusSchema.safeParse("error").success).toBe(true);
  });

  test("rejects invalid statuses", () => {
    expect(StageOutputStatusSchema.safeParse("running").success).toBe(false);
    expect(StageOutputStatusSchema.safeParse("").success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SignalTypeSchema / SignalDataSchema
// ---------------------------------------------------------------------------

describe("SignalTypeSchema", () => {
  test("accepts valid signal types", () => {
    expect(SignalTypeSchema.safeParse("checkpoint").success).toBe(true);
    expect(SignalTypeSchema.safeParse("human_input_required").success).toBe(true);
    expect(SignalTypeSchema.safeParse("debug_report_generated").success).toBe(true);
  });

  test("rejects invalid types", () => {
    expect(SignalTypeSchema.safeParse("unknown_signal").success).toBe(false);
  });
});

describe("SignalDataSchema", () => {
  test("validates minimal signal data", () => {
    const result = SignalDataSchema.safeParse({
      type: "checkpoint",
    });
    expect(result.success).toBe(true);
  });

  test("validates full signal data with nested JSON values", () => {
    const result = SignalDataSchema.safeParse({
      type: "checkpoint",
      message: "Checkpoint reached",
      data: { usagePercent: 85, tokens: { input: 3500, output: 400 } },
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AgentTypeSchema
// ---------------------------------------------------------------------------

describe("AgentTypeSchema", () => {
  test("accepts valid agent types", () => {
    expect(AgentTypeSchema.safeParse("claude").success).toBe(true);
    expect(AgentTypeSchema.safeParse("opencode").success).toBe(true);
    expect(AgentTypeSchema.safeParse("copilot").success).toBe(true);
  });

  test("rejects unknown agent types", () => {
    expect(AgentTypeSchema.safeParse("gpt").success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SessionConfigSchema
// ---------------------------------------------------------------------------

describe("SessionConfigSchema", () => {
  test("validates empty config (all optional)", () => {
    expect(SessionConfigSchema.safeParse({}).success).toBe(true);
  });

  test("validates full config", () => {
    const result = SessionConfigSchema.safeParse({
      model: { claude: "sonnet-4", opencode: "gpt-4o" },
      sessionId: "sess-123",
      systemPrompt: "You are a helpful assistant",
      additionalInstructions: "Focus on TypeScript",
      tools: ["read_file", "write_file"],
      permissionMode: "auto",
      maxBudgetUsd: 5.0,
      maxTurns: 10,
      reasoningEffort: { claude: "high" },
      maxThinkingTokens: 8192,
    });
    expect(result.success).toBe(true);
  });

  test("rejects invalid permissionMode", () => {
    const result = SessionConfigSchema.safeParse({
      permissionMode: "yolo",
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AskUserQuestionConfigSchema
// ---------------------------------------------------------------------------

describe("AskUserQuestionConfigSchema", () => {
  test("validates minimal question (only required 'question' field)", () => {
    const result = AskUserQuestionConfigSchema.safeParse({
      question: "Continue?",
    });
    expect(result.success).toBe(true);
  });

  test("validates full config with options", () => {
    const result = AskUserQuestionConfigSchema.safeParse({
      question: "Choose a strategy",
      header: "Strategy Selection",
      options: [
        { label: "Fast", description: "Quick but less thorough" },
        { label: "Thorough" },
      ],
      multiSelect: true,
    });
    expect(result.success).toBe(true);
  });

  test("rejects missing question", () => {
    const result = AskUserQuestionConfigSchema.safeParse({
      header: "Some header",
    });
    expect(result.success).toBe(false);
  });
});
