/**
 * Tests for Ralph Workflow task_list configuration changes.
 *
 * Verifies:
 * - RALPH_DISALLOWED_TOOLS includes TodoWrite for all providers
 * - All 4 stages have TodoWrite in their disallowedTools
 * - AskUserQuestion tools remain disallowed alongside TodoWrite
 * - Planner outputMapper returns empty object (tasks persisted via tool)
 */

import { describe, test, expect } from "bun:test";
import { getRalphWorkflowDefinition } from "@/services/workflows/builtin/ralph/ralph-workflow.ts";

const definition = getRalphWorkflowDefinition();
const stages = definition.conductorStages!;

// ---------------------------------------------------------------------------
// RALPH_DISALLOWED_TOOLS: TodoWrite is blocked in all stages
// ---------------------------------------------------------------------------

describe("RALPH_DISALLOWED_TOOLS includes TodoWrite", () => {
  const stageNames = ["planner", "orchestrator", "reviewer", "debugger"] as const;

  for (const stageName of stageNames) {
    test(`${stageName} stage disallows TodoWrite for claude`, () => {
      const stage = stages.find((s) => s.id === stageName)!;
      expect(stage.disallowedTools).toBeDefined();
      expect(stage.disallowedTools!["claude"]).toContain("TodoWrite");
    });

    test(`${stageName} stage disallows TodoWrite for opencode`, () => {
      const stage = stages.find((s) => s.id === stageName)!;
      expect(stage.disallowedTools).toBeDefined();
      expect(stage.disallowedTools!["opencode"]).toContain("TodoWrite");
    });

    test(`${stageName} stage disallows TodoWrite for copilot`, () => {
      const stage = stages.find((s) => s.id === stageName)!;
      expect(stage.disallowedTools).toBeDefined();
      expect(stage.disallowedTools!["copilot"]).toContain("TodoWrite");
    });
  }

  // Ensure the original ask-user-question tools remain disallowed
  test("planner stage still disallows AskUserQuestion for claude", () => {
    const planner = stages.find((s) => s.id === "planner")!;
    expect(planner.disallowedTools!["claude"]).toContain("AskUserQuestion");
  });

  test("planner stage still disallows question for opencode", () => {
    const planner = stages.find((s) => s.id === "planner")!;
    expect(planner.disallowedTools!["opencode"]).toContain("question");
  });

  test("planner stage still disallows ask_user for copilot", () => {
    const planner = stages.find((s) => s.id === "planner")!;
    expect(planner.disallowedTools!["copilot"]).toContain("ask_user");
  });
});

// ---------------------------------------------------------------------------
// Planner outputMapper: returns empty object (tasks persisted via tool)
// ---------------------------------------------------------------------------

describe("Planner outputMapper returns empty object (tool-first flow)", () => {
  const planner = stages.find((s) => s.id === "planner")!;

  test("returns empty object for any response text", () => {
    const response = "I have created the tasks using the task_list tool.";
    const result = planner.parseOutput!(response);
    expect(result).toEqual({});
  });

  test("returns empty object for JSON array response", () => {
    const response = JSON.stringify([
      { id: "1", description: "Setup project", status: "pending", summary: "Setting up" },
    ]);
    const result = planner.parseOutput!(response);
    expect(result).toEqual({});
  });

  test("returns empty object for empty response", () => {
    const result = planner.parseOutput!("");
    expect(result).toEqual({});
  });

  test("does not have tasks key (tasks are in SQLite, not outputMapper)", () => {
    const result = planner.parseOutput!("");
    expect(result).not.toHaveProperty("tasks");
  });
});
