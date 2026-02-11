/**
 * Tests for Ralph Prompt Utilities
 */

import { describe, test, expect } from "bun:test";
import { buildSpecToTasksPrompt, buildImplementFeaturePrompt } from "../../../src/graph/nodes/ralph-nodes.ts";

describe("buildSpecToTasksPrompt", () => {
  test("includes the spec content in the prompt", () => {
    const spec = "Build a snake game in Rust";
    const prompt = buildSpecToTasksPrompt(spec);

    expect(prompt).toContain(spec);
    expect(prompt).toContain("<specification>");
    expect(prompt).toContain("</specification>");
  });

  test("includes output format instructions", () => {
    const prompt = buildSpecToTasksPrompt("test spec");

    expect(prompt).toContain('"id"');
    expect(prompt).toContain('"content"');
    expect(prompt).toContain('"status"');
    expect(prompt).toContain('"activeForm"');
    expect(prompt).toContain('"blockedBy"');
  });

  test("includes guidelines for task decomposition", () => {
    const prompt = buildSpecToTasksPrompt("test spec");

    expect(prompt).toContain("Order tasks by priority");
    expect(prompt).toContain("Output ONLY the JSON array");
  });
});

describe("buildImplementFeaturePrompt", () => {
  test("returns a non-empty prompt", () => {
    const prompt = buildImplementFeaturePrompt();
    expect(prompt.length).toBeGreaterThan(0);
  });

  test("includes getting up to speed instructions", () => {
    const prompt = buildImplementFeaturePrompt();
    expect(prompt).toContain("Getting up to speed");
    expect(prompt).toContain("highest-priority item");
  });

  test("includes test-driven development section", () => {
    const prompt = buildImplementFeaturePrompt();
    expect(prompt).toContain("Test-Driven Development");
  });

  test("includes design principles", () => {
    const prompt = buildImplementFeaturePrompt();
    expect(prompt).toContain("SOLID");
    expect(prompt).toContain("KISS");
    expect(prompt).toContain("YAGNI");
  });

  test("includes important notes about single feature focus", () => {
    const prompt = buildImplementFeaturePrompt();
    expect(prompt).toContain("ONLY work on the SINGLE highest priority feature");
  });
});
