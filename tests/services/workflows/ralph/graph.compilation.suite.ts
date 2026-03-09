import { describe, expect, test } from "bun:test";
import { createRalphWorkflow } from "@/services/workflows/ralph/graph.ts";

describe("createRalphWorkflow - Basic Compilation", () => {
  test("compiles without error", () => {
    const workflow = createRalphWorkflow();

    expect(workflow).toBeDefined();
    expect(workflow.nodes.size).toBeGreaterThan(0);
    expect(workflow.startNode).toBe("planner");
    expect(workflow.nodes.has("planner")).toBe(true);
    expect(workflow.nodes.has("parse-tasks")).toBe(true);
    expect(workflow.nodes.has("select-ready-tasks")).toBe(true);
    expect(workflow.nodes.has("worker")).toBe(true);
    expect(workflow.nodes.has("reviewer")).toBe(true);
    expect(workflow.nodes.has("prepare-fix-tasks")).toBe(true);
    expect(workflow.nodes.has("fixer")).toBe(true);
  });
});
