import { describe, expect, test } from "bun:test";
import {
  plannerStage,
  orchestratorStage,
  reviewerStage,
  debuggerStage,
  RALPH_STAGES,
} from "@/services/workflows/ralph/stages.ts";
import type { StageContext, StageOutput } from "@/services/workflows/conductor/types.ts";
import { isStageDefinition } from "@/services/workflows/conductor/guards.ts";

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides?: Partial<StageContext>): StageContext {
  return {
    userPrompt: "Build a user authentication module with JWT tokens",
    stageOutputs: new Map(),
    tasks: [],
    abortSignal: new AbortController().signal,
    ...overrides,
  };
}

function makeStageOutput(overrides?: Partial<StageOutput>): StageOutput {
  return {
    stageId: "test",
    rawResponse: "",
    status: "completed",
    ...overrides,
  };
}

const SAMPLE_TASKS_JSON = JSON.stringify([
  { id: 1, description: "Set up project scaffolding", status: "pending", summary: "Setting up scaffolding", blockedBy: [] },
  { id: 2, description: "Implement JWT auth endpoint", status: "pending", summary: "Implementing auth", blockedBy: [1] },
  { id: 3, description: "Add unit tests for auth", status: "completed", summary: "Adding auth tests", blockedBy: [2] },
]);

const SAMPLE_REVIEW_JSON = JSON.stringify({
  findings: [
    {
      title: "[P1] Missing input validation on login endpoint",
      body: "The login endpoint does not validate email format",
      priority: 1,
      confidence_score: 0.9,
    },
  ],
  overall_correctness: "patch is incorrect",
  overall_explanation: "Critical validation issue found",
  overall_confidence_score: 0.85,
});

// ---------------------------------------------------------------------------
// RALPH_STAGES registry
// ---------------------------------------------------------------------------

describe("RALPH_STAGES", () => {
  test("contains exactly 4 stages in correct order", () => {
    expect(RALPH_STAGES).toHaveLength(4);
    expect(RALPH_STAGES[0]!.id).toBe("planner");
    expect(RALPH_STAGES[1]!.id).toBe("orchestrator");
    expect(RALPH_STAGES[2]!.id).toBe("reviewer");
    expect(RALPH_STAGES[3]!.id).toBe("debugger");
  });

  test("all stages satisfy the StageDefinition type guard", () => {
    for (const stage of RALPH_STAGES) {
      expect(isStageDefinition(stage)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Planner Stage
// ---------------------------------------------------------------------------

describe("plannerStage", () => {
  test("has correct identity fields", () => {
    expect(plannerStage.id).toBe("planner");
    expect(plannerStage.name).toBe("Planner");
    expect(plannerStage.indicator).toBe("⌕ PLANNER");
  });

  test("buildPrompt includes the user prompt as specification content", () => {
    const ctx = makeContext({ userPrompt: "Build a REST API for blog posts" });
    const prompt = plannerStage.buildPrompt(ctx);

    expect(prompt).toContain("Build a REST API for blog posts");
    expect(prompt).toContain("task decomposition");
  });

  test("buildPrompt produces valid task decomposition instructions", () => {
    const prompt = plannerStage.buildPrompt(makeContext());

    // Should contain schema instructions for the task list format
    expect(prompt).toContain("JSON");
    expect(prompt).toContain("description");
    expect(prompt).toContain("status");
    expect(prompt).toContain("blockedBy");
  });

  test("parseOutput extracts structured tasks from valid JSON", () => {
    const result = plannerStage.parseOutput!(SAMPLE_TASKS_JSON);
    expect(Array.isArray(result)).toBe(true);

    const tasks = result as Array<{ id: string; description: string; status: string }>;
    expect(tasks).toHaveLength(3);
    expect(tasks[0]!.description).toBe("Set up project scaffolding");
    expect(tasks[1]!.description).toBe("Implement JWT auth endpoint");
  });

  test("parseOutput returns empty array for invalid input", () => {
    const result = plannerStage.parseOutput!("not valid json at all");
    expect(Array.isArray(result)).toBe(true);
    expect(result as unknown[]).toHaveLength(0);
  });

  test("parseOutput handles markdown-wrapped JSON", () => {
    const wrapped = "```json\n" + SAMPLE_TASKS_JSON + "\n```";
    const result = plannerStage.parseOutput!(wrapped);
    expect(Array.isArray(result)).toBe(true);
    expect((result as unknown[]).length).toBeGreaterThan(0);
  });

  test("shouldRun is undefined (always runs)", () => {
    expect(plannerStage.shouldRun).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Orchestrator Stage
// ---------------------------------------------------------------------------

describe("orchestratorStage", () => {
  test("has correct identity fields", () => {
    expect(orchestratorStage.id).toBe("orchestrator");
    expect(orchestratorStage.name).toBe("Orchestrator");
    expect(orchestratorStage.indicator).toBe("⚡ ORCHESTRATOR");
  });

  test("buildPrompt uses tasks from context when available", () => {
    const ctx = makeContext({
      tasks: [
        { description: "Create user model", status: "pending", summary: "Creating model", blockedBy: [] },
        { description: "Add validation", status: "pending", summary: "Adding validation", blockedBy: ["1"] },
      ],
    });

    const prompt = orchestratorStage.buildPrompt(ctx);
    expect(prompt).toContain("Create user model");
    expect(prompt).toContain("Add validation");
    expect(prompt).toContain("orchestrator");
  });

  test("buildPrompt falls back to planner parsed output when context.tasks is empty", () => {
    const plannerOutput = makeStageOutput({
      stageId: "planner",
      rawResponse: SAMPLE_TASKS_JSON,
      parsedOutput: [
        { id: "1", description: "Scaffolding task", status: "pending", summary: "Scaffolding", blockedBy: [] },
      ],
    });

    const ctx = makeContext({
      tasks: [],
      stageOutputs: new Map([["planner", plannerOutput]]),
    });

    const prompt = orchestratorStage.buildPrompt(ctx);
    expect(prompt).toContain("Scaffolding task");
  });

  test("buildPrompt falls back to re-parsing raw planner response", () => {
    const plannerOutput = makeStageOutput({
      stageId: "planner",
      rawResponse: SAMPLE_TASKS_JSON,
      // No parsedOutput
    });

    const ctx = makeContext({
      tasks: [],
      stageOutputs: new Map([["planner", plannerOutput]]),
    });

    const prompt = orchestratorStage.buildPrompt(ctx);
    expect(prompt).toContain("Set up project scaffolding");
  });

  test("buildPrompt handles completely empty context gracefully", () => {
    const ctx = makeContext({ tasks: [] });
    const prompt = orchestratorStage.buildPrompt(ctx);

    // Should still produce a valid prompt (empty task list)
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
  });

  test("buildPrompt includes dependency and concurrency instructions", () => {
    const ctx = makeContext({
      tasks: [
        { description: "Task A", status: "pending", summary: "Doing A", blockedBy: [] },
      ],
    });

    const prompt = orchestratorStage.buildPrompt(ctx);
    expect(prompt).toContain("blockedBy");
    expect(prompt).toContain("parallel");
  });

  test("shouldRun is undefined (always runs)", () => {
    expect(orchestratorStage.shouldRun).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Reviewer Stage
// ---------------------------------------------------------------------------

describe("reviewerStage", () => {
  test("has correct identity fields", () => {
    expect(reviewerStage.id).toBe("reviewer");
    expect(reviewerStage.name).toBe("Reviewer");
    expect(reviewerStage.indicator).toBe("🔍 REVIEWER");
  });

  test("buildPrompt includes user prompt and task context", () => {
    const ctx = makeContext({
      userPrompt: "Implement OAuth2 flow",
      tasks: [
        { id: "1", description: "Create OAuth client", status: "completed", summary: "OAuth client" },
        { id: "2", description: "Add token refresh", status: "completed", summary: "Token refresh" },
      ],
    });

    const prompt = reviewerStage.buildPrompt(ctx);
    expect(prompt).toContain("Implement OAuth2 flow");
    expect(prompt).toContain("Create OAuth client");
    expect(prompt).toContain("Add token refresh");
  });

  test("buildPrompt includes orchestrator output as progress context", () => {
    const orchestratorOutput = makeStageOutput({
      stageId: "orchestrator",
      rawResponse: "All 5 tasks completed successfully. Summary: ...",
    });

    const ctx = makeContext({
      stageOutputs: new Map([["orchestrator", orchestratorOutput]]),
      tasks: [{ description: "Task 1", status: "completed", summary: "First" }],
    });

    const prompt = reviewerStage.buildPrompt(ctx);
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
  });

  test("parseOutput extracts structured ReviewResult from valid JSON", () => {
    const result = reviewerStage.parseOutput!(SAMPLE_REVIEW_JSON);
    expect(result).not.toBeNull();

    const review = result as { findings: unknown[]; overall_correctness: string };
    expect(review.overall_correctness).toBe("patch is incorrect");
    expect(review.findings.length).toBeGreaterThan(0);
  });

  test("parseOutput returns null for unparseable response", () => {
    const result = reviewerStage.parseOutput!("The code looks good overall with some minor issues.");
    expect(result).toBeNull();
  });

  test("parseOutput handles markdown-fenced JSON", () => {
    const fenced = "Here are my findings:\n\n```json\n" + SAMPLE_REVIEW_JSON + "\n```\n\nPlease review.";
    const result = reviewerStage.parseOutput!(fenced);
    expect(result).not.toBeNull();
  });

  test("shouldRun is undefined (always runs)", () => {
    expect(reviewerStage.shouldRun).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Debugger Stage
// ---------------------------------------------------------------------------

describe("debuggerStage", () => {
  test("has correct identity fields", () => {
    expect(debuggerStage.id).toBe("debugger");
    expect(debuggerStage.name).toBe("Debugger");
    expect(debuggerStage.indicator).toBe("🔧 DEBUGGER");
  });

  test("shouldRun returns false when no reviewer output exists", () => {
    const ctx = makeContext();
    expect(debuggerStage.shouldRun!(ctx)).toBe(false);
  });

  test("shouldRun returns false when reviewer errored", () => {
    const ctx = makeContext({
      stageOutputs: new Map([
        ["reviewer", makeStageOutput({ stageId: "reviewer", status: "error", rawResponse: "" })],
      ]),
    });
    expect(debuggerStage.shouldRun!(ctx)).toBe(false);
  });

  test("shouldRun returns false when reviewer found no issues", () => {
    const noIssuesReview = JSON.stringify({
      findings: [],
      overall_correctness: "patch is correct",
      overall_explanation: "Everything looks good",
    });

    const ctx = makeContext({
      stageOutputs: new Map([
        ["reviewer", makeStageOutput({
          stageId: "reviewer",
          rawResponse: noIssuesReview,
          parsedOutput: { findings: [], overall_correctness: "patch is correct", overall_explanation: "Good" },
        })],
      ]),
    });
    expect(debuggerStage.shouldRun!(ctx)).toBe(false);
  });

  test("shouldRun returns true when reviewer has structured findings", () => {
    const ctx = makeContext({
      stageOutputs: new Map([
        ["reviewer", makeStageOutput({
          stageId: "reviewer",
          rawResponse: SAMPLE_REVIEW_JSON,
          parsedOutput: JSON.parse(SAMPLE_REVIEW_JSON),
        })],
      ]),
    });
    expect(debuggerStage.shouldRun!(ctx)).toBe(true);
  });

  test("shouldRun returns true when reviewer has raw response but no parsed output", () => {
    const ctx = makeContext({
      stageOutputs: new Map([
        ["reviewer", makeStageOutput({
          stageId: "reviewer",
          rawResponse: "There are several issues with the implementation that need fixing.",
          // No parsedOutput — parsing failed
        })],
      ]),
    });
    expect(debuggerStage.shouldRun!(ctx)).toBe(true);
  });

  test("shouldRun returns false when reviewer completed with empty response", () => {
    const ctx = makeContext({
      stageOutputs: new Map([
        ["reviewer", makeStageOutput({
          stageId: "reviewer",
          rawResponse: "",
        })],
      ]),
    });
    expect(debuggerStage.shouldRun!(ctx)).toBe(false);
  });

  test("buildPrompt produces fix spec from structured review findings", () => {
    const reviewResult = JSON.parse(SAMPLE_REVIEW_JSON);
    const ctx = makeContext({
      userPrompt: "Build auth module",
      tasks: [{ description: "Implement login", status: "completed", summary: "Login" }],
      stageOutputs: new Map([
        ["reviewer", makeStageOutput({
          stageId: "reviewer",
          rawResponse: SAMPLE_REVIEW_JSON,
          parsedOutput: reviewResult,
        })],
      ]),
    });

    const prompt = debuggerStage.buildPrompt(ctx);
    expect(prompt).toContain("Missing input validation");
    expect(prompt).toContain("Build auth module");
    expect(prompt).toContain("Fix");
  });

  test("buildPrompt falls back to raw review when parsing failed", () => {
    const rawReview = "The login endpoint has a SQL injection vulnerability in the email parameter.";
    const ctx = makeContext({
      userPrompt: "Build auth module",
      stageOutputs: new Map([
        ["reviewer", makeStageOutput({
          stageId: "reviewer",
          rawResponse: rawReview,
          // No parsedOutput
        })],
      ]),
    });

    const prompt = debuggerStage.buildPrompt(ctx);
    expect(prompt).toContain("SQL injection vulnerability");
    expect(prompt).toContain("Build auth module");
  });

  test("buildPrompt provides defensive fallback when no review data", () => {
    const ctx = makeContext({ userPrompt: "Build auth module" });
    const prompt = debuggerStage.buildPrompt(ctx);

    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
    expect(prompt).toContain("Build auth module");
  });
});
