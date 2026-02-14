/**
 * Tests for Ralph Prompt Utilities
 */

import { describe, test, expect } from "bun:test";
import { buildSpecToTasksPrompt, buildTaskListPreamble } from "../../../src/graph/nodes/ralph.ts";

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

describe("buildTaskListPreamble", () => {
  test("includes the task list JSON", () => {
    const tasks = [
      { id: "#1", content: "Setup project", status: "completed", activeForm: "Setting up project", blockedBy: [] as string[] },
      { id: "#2", content: "Add auth", status: "pending", activeForm: "Adding auth", blockedBy: ["#1"] },
    ];
    const preamble = buildTaskListPreamble(tasks);

    expect(preamble).toContain('"#1"');
    expect(preamble).toContain('"#2"');
    expect(preamble).toContain("Setup project");
    expect(preamble).toContain("Add auth");
    expect(preamble).toContain('"blockedBy"');
  });

  test("instructs agent to call TodoWrite first", () => {
    const tasks = [{ id: "#1", content: "Task", status: "pending", activeForm: "Tasking" }];
    const preamble = buildTaskListPreamble(tasks);

    expect(preamble).toContain("TodoWrite");
    expect(preamble).toContain("FIRST action");
  });
});
