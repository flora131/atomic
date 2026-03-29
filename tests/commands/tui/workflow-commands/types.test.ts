/**
 * Tests for parseWorkflowArgs in workflow-commands/types.ts
 */
import { describe, expect, test } from "bun:test";
import { parseWorkflowArgs } from "@/commands/tui/workflow-commands/types.ts";

describe("parseWorkflowArgs", () => {
  test("returns { prompt: trimmed } for valid args", () => {
    const result = parseWorkflowArgs("build a REST API");
    expect(result).toEqual({ prompt: "build a REST API" });
  });

  test("trims leading and trailing whitespace from prompt", () => {
    const result = parseWorkflowArgs("  hello world  ");
    expect(result).toEqual({ prompt: "hello world" });
  });

  test("throws for empty string", () => {
    expect(() => parseWorkflowArgs("")).toThrow(
      "A prompt argument is required.",
    );
  });

  test("throws for whitespace-only input", () => {
    expect(() => parseWorkflowArgs("   ")).toThrow(
      "A prompt argument is required.",
    );
  });

  test("includes default workflow name in error message", () => {
    expect(() => parseWorkflowArgs("")).toThrow("/workflow");
  });

  test("includes custom workflowName in error message", () => {
    expect(() => parseWorkflowArgs("", "ralph")).toThrow("/ralph");
  });

  test("does not throw for single non-whitespace character", () => {
    const result = parseWorkflowArgs("x");
    expect(result).toEqual({ prompt: "x" });
  });
});
