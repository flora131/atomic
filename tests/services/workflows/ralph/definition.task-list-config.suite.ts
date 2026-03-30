/**
 * Tests for Ralph Workflow task_list configuration changes.
 *
 * Verifies:
 * - RALPH_DISALLOWED_TOOLS includes TodoWrite for all providers
 * - All 4 stages have TodoWrite in their disallowedTools
 * - AskUserQuestion tools remain disallowed alongside TodoWrite
 * - Planner outputMapper continues to extract tasks from text responses
 * - Planner outputMapper gracefully handles empty/non-JSON responses
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
// Planner outputMapper: task extraction from text
// ---------------------------------------------------------------------------

describe("Planner outputMapper handles varied response formats", () => {
  const planner = stages.find((s) => s.id === "planner")!;

  test("extracts tasks from a valid JSON array response", () => {
    const response = JSON.stringify([
      { id: "1", description: "Setup project", status: "pending", summary: "Setting up" },
      { id: "2", description: "Implement feature", status: "pending", summary: "Implementing", blockedBy: ["1"] },
    ]);
    const result = planner.parseOutput!(response);
    const tasks = (result as Record<string, unknown>).tasks as Array<Record<string, unknown>>;
    expect(tasks).toHaveLength(2);
    expect(tasks[0]!.id).toBe("1");
    expect(tasks[0]!.description).toBe("Setup project");
    expect(tasks[1]!.blockedBy).toEqual(["1"]);
  });

  test("returns empty tasks array for non-JSON response", () => {
    const response = "I'll create a task list for you. Here are the tasks...";
    const result = planner.parseOutput!(response);
    const tasks = (result as Record<string, unknown>).tasks as Array<unknown>;
    expect(tasks).toEqual([]);
  });

  test("returns empty tasks array for empty response", () => {
    const result = planner.parseOutput!("");
    const tasks = (result as Record<string, unknown>).tasks as Array<unknown>;
    expect(tasks).toEqual([]);
  });

  test("extracts tasks embedded in surrounding text", () => {
    const response = `Here are the tasks I've identified:
    [
      {"id": "1", "description": "Task A", "status": "pending", "summary": "Doing A"}
    ]
    Let me know if you need changes.`;
    const result = planner.parseOutput!(response);
    const tasks = (result as Record<string, unknown>).tasks as Array<Record<string, unknown>>;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.description).toBe("Task A");
  });

  test("normalizes legacy content/activeForm fields to description/summary", () => {
    const response = JSON.stringify([
      { id: "#1", content: "Legacy task", status: "pending", activeForm: "Working on legacy task" },
    ]);
    const result = planner.parseOutput!(response);
    const tasks = (result as Record<string, unknown>).tasks as Array<Record<string, unknown>>;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.description).toBe("Legacy task");
    expect(tasks[0]!.summary).toBe("Working on legacy task");
  });

  test("handles numeric IDs by converting to string", () => {
    const response = JSON.stringify([
      { id: 1, description: "Task", status: "pending", summary: "Working" },
    ]);
    const result = planner.parseOutput!(response);
    const tasks = (result as Record<string, unknown>).tasks as Array<Record<string, unknown>>;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.id).toBe("1");
  });

  test("always returns object with tasks key for graph output inference", () => {
    // The outputMapper must always return { tasks: ... } so that
    // inferStageOutputs correctly identifies "tasks" as a planner output key.
    const result = planner.parseOutput!("");
    expect(result).toHaveProperty("tasks");
  });
});
