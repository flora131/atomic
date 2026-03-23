/**
 * Tests for workflow DSL agent resolution.
 *
 * Validates that stage IDs are matched against discovered agent
 * definitions, and that agent file bodies are resolved as system prompts.
 */

import { describe, expect, test } from "bun:test";
import {
  readAgentBody,
  validateStageAgents,
  resolveStageSystemPrompt,
  buildAgentLookup,
} from "@/services/workflows/dsl/agent-resolution.ts";
import type { AgentInfo } from "@/services/agent-discovery/index.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLookup(agents: Array<{ name: string; filePath: string }>): Map<string, AgentInfo> {
  const lookup = new Map<string, AgentInfo>();
  for (const agent of agents) {
    lookup.set(agent.name.toLowerCase(), {
      name: agent.name,
      description: `Agent: ${agent.name}`,
      source: "project",
      filePath: agent.filePath,
    });
  }
  return lookup;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("validateStageAgents", () => {
  test("returns no errors when all stages match discovered agents", () => {
    const lookup = makeLookup([
      { name: "planner", filePath: "/fake/planner.md" },
      { name: "orchestrator", filePath: "/fake/orchestrator.md" },
    ]);
    const errors = validateStageAgents(["planner", "orchestrator"], lookup);
    expect(errors).toHaveLength(0);
  });

  test("returns errors for unmatched stage IDs", () => {
    const lookup = makeLookup([
      { name: "planner", filePath: "/fake/planner.md" },
    ]);
    const errors = validateStageAgents(["planner", "executor"], lookup);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("executor");
    expect(errors[0]).toContain("no matching agent definition");
  });

  test("matches case-insensitively", () => {
    const lookup = makeLookup([
      { name: "Planner", filePath: "/fake/planner.md" },
    ]);
    const errors = validateStageAgents(["planner"], lookup);
    expect(errors).toHaveLength(0);
  });

  test("returns errors for all unmatched stages", () => {
    const lookup = makeLookup([]);
    const errors = validateStageAgents(["s1", "s2", "s3"], lookup);
    expect(errors).toHaveLength(3);
  });
});

describe("readAgentBody", () => {
  test("reads body from a real agent definition file", () => {
    // Use an actual agent file from the project
    const body = readAgentBody(`${process.cwd()}/.claude/agents/planner.md`);
    expect(body).not.toBeNull();
    expect(body!.length).toBeGreaterThan(0);
    expect(body).toContain("planner");
  });

  test("returns null for nonexistent file", () => {
    const body = readAgentBody("/nonexistent/agent.md");
    expect(body).toBeNull();
  });
});

describe("resolveStageSystemPrompt", () => {
  test("resolves system prompt from matching agent file", () => {
    const lookup = makeLookup([
      { name: "planner", filePath: `${process.cwd()}/.claude/agents/planner.md` },
    ]);
    const prompt = resolveStageSystemPrompt("planner", lookup);
    expect(prompt).not.toBeNull();
    expect(prompt!.length).toBeGreaterThan(0);
  });

  test("returns null when no matching agent exists", () => {
    const lookup = makeLookup([]);
    const prompt = resolveStageSystemPrompt("nonexistent", lookup);
    expect(prompt).toBeNull();
  });
});

describe("buildAgentLookup", () => {
  test("discovers agents from project directories", () => {
    const lookup = buildAgentLookup();
    // The project has agent files in .claude/agents/, .opencode/agents/, .github/agents/
    expect(lookup.size).toBeGreaterThan(0);
    expect(lookup.has("planner")).toBe(true);
    expect(lookup.has("worker")).toBe(true);
  });
});
