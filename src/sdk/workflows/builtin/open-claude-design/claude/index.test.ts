/**
 * Tests for the open-claude-design workflow orchestration index.
 *
 * Following TDD: tests written before the implementation.
 */

import { test, expect, describe } from "bun:test";

// We test that the module exports a valid WorkflowDefinition.
// We cannot run the full workflow in a unit test (requires tmux, Claude CLI),
// but we can verify:
//   1. The default export is a compiled WorkflowDefinition
//   2. It has the correct name and description
//   3. It declares the required inputs with correct shapes
//   4. It has a run function

describe("open-claude-design workflow", () => {
  // Dynamically import to avoid hoisting issues with types
  test("default export is a WorkflowDefinition with correct name", async () => {
    const mod = await import("./index.ts");
    const workflow = mod.default;
    expect(workflow).toBeDefined();
    expect(workflow.__brand).toBe("WorkflowDefinition");
    expect(workflow.name).toBe("open-claude-design");
  });

  test("has a non-empty description", async () => {
    const mod = await import("./index.ts");
    const workflow = mod.default;
    expect(typeof workflow.description).toBe("string");
    expect(workflow.description.length).toBeGreaterThan(0);
  });

  test("declares 4 inputs", async () => {
    const mod = await import("./index.ts");
    const workflow = mod.default;
    expect(workflow.inputs).toHaveLength(4);
  });

  test("prompt input is required text", async () => {
    const mod = await import("./index.ts");
    const workflow = mod.default;
    const promptInput = workflow.inputs.find((i) => i.name === "prompt");
    expect(promptInput).toBeDefined();
    expect(promptInput!.type).toBe("text");
    expect(promptInput!.required).toBe(true);
  });

  test("reference input is optional text", async () => {
    const mod = await import("./index.ts");
    const workflow = mod.default;
    const referenceInput = workflow.inputs.find((i) => i.name === "reference");
    expect(referenceInput).toBeDefined();
    expect(referenceInput!.type).toBe("text");
    expect(referenceInput!.required).toBeFalsy();
  });

  test("output-type input is an enum with 5 values", async () => {
    const mod = await import("./index.ts");
    const workflow = mod.default;
    const outputTypeInput = workflow.inputs.find((i) => i.name === "output-type");
    expect(outputTypeInput).toBeDefined();
    expect(outputTypeInput!.type).toBe("enum");
    expect(outputTypeInput!.values).toHaveLength(5);
    expect(outputTypeInput!.values).toContain("prototype");
    expect(outputTypeInput!.values).toContain("wireframe");
    expect(outputTypeInput!.values).toContain("mockup");
    expect(outputTypeInput!.values).toContain("landing-page");
    expect(outputTypeInput!.values).toContain("full-site");
    expect(outputTypeInput!.default).toBe("prototype");
  });

  test("design-system input is optional text", async () => {
    const mod = await import("./index.ts");
    const workflow = mod.default;
    const dsInput = workflow.inputs.find((i) => i.name === "design-system");
    expect(dsInput).toBeDefined();
    expect(dsInput!.type).toBe("text");
    expect(dsInput!.required).toBeFalsy();
  });

  test("has a run function", async () => {
    const mod = await import("./index.ts");
    const workflow = mod.default;
    expect(typeof workflow.run).toBe("function");
  });
});
