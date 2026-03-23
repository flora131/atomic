import { describe, expect, test } from "bun:test";
import {
  buildReviewPrompt,
  parseReviewResult,
  type TaskItem,
} from "./ralph.test-support.ts";

describe("buildReviewPrompt", () => {
  test("includes user prompt in review request", () => {
    const tasks: TaskItem[] = [
      { id: "#1", description: "Add login", status: "completed", summary: "Adding login" },
    ];

    const prompt = buildReviewPrompt(
      tasks,
      "Implement user authentication",
      "/tmp/progress.txt",
    );

    expect(prompt).toContain("Implement user authentication");
    expect(prompt).toContain("<user_request>");
    expect(prompt).toContain("</user_request>");
  });

  test("lists all completed tasks in Completed Tasks section", () => {
    const tasks: TaskItem[] = [
      { id: "#1", description: "Setup DB", status: "completed", summary: "Setting up" },
      { id: "#2", description: "Add API", status: "completed", summary: "Adding API" },
      { id: "#3", description: "Not done yet", status: "pending", summary: "Working" },
    ];

    const prompt = buildReviewPrompt(tasks, "Build backend", "/tmp/progress.txt");

    // Completed Tasks section only contains completed tasks
    const completedSection = prompt.split("## Completed Tasks")[1]?.split("## Review Instructions")[0] ?? "";
    expect(completedSection).toContain("Setup DB");
    expect(completedSection).toContain("Add API");
    expect(completedSection).not.toContain("Not done yet");
  });

  test("includes progress file path", () => {
    const tasks: TaskItem[] = [
      { id: "#1", description: "Task", status: "completed", summary: "Working" },
    ];

    expect(buildReviewPrompt(tasks, "Test", "/session/progress.txt")).toContain(
      "/session/progress.txt",
    );
  });

  test("includes full task plan with statuses", () => {
    const tasks: TaskItem[] = [
      { id: "#1", description: "Setup DB", status: "completed", summary: "Setting up" },
      { id: "#2", description: "Add API", status: "completed", summary: "Adding API" },
      { id: "#3", description: "Write tests", status: "pending", summary: "Writing tests" },
      { id: "#4", description: "Deploy", status: "error", summary: "Deploying" },
    ];

    const prompt = buildReviewPrompt(tasks, "Build backend", "/tmp/progress.txt");

    expect(prompt).toContain("<task_plan>");
    expect(prompt).toContain("</task_plan>");
    expect(prompt).toContain("[COMPLETED] Setup DB");
    expect(prompt).toContain("[COMPLETED] Add API");
    expect(prompt).toContain("[PENDING] Write tests");
    expect(prompt).toContain("[ERROR] Deploy");
  });

  test("includes task completion summary with counts", () => {
    const tasks: TaskItem[] = [
      { id: "#1", description: "Setup DB", status: "completed", summary: "Setting up" },
      { id: "#2", description: "Add API", status: "completed", summary: "Adding API" },
      { id: "#3", description: "Write tests", status: "pending", summary: "Writing tests" },
      { id: "#4", description: "Deploy", status: "error", summary: "Deploying" },
    ];

    const prompt = buildReviewPrompt(tasks, "Build backend", "/tmp/progress.txt");

    expect(prompt).toContain("## Task Completion Summary");
    expect(prompt).toContain("**Total tasks:** 4");
    expect(prompt).toContain("**Completed:** 2");
    expect(prompt).toContain("**Errored:** 1");
    expect(prompt).toContain("**Pending:** 1");
    expect(prompt).toContain("**Completion rate:** 50%");
  });

  test("includes warning when tasks are incomplete", () => {
    const tasks: TaskItem[] = [
      { id: "#1", description: "Done task", status: "completed", summary: "Done" },
      { id: "#2", description: "Failed task", status: "error", summary: "Failed" },
    ];

    const prompt = buildReviewPrompt(tasks, "Test", "/tmp/progress.txt");

    expect(prompt).toContain("WARNING: Only 1 of 2 tasks completed");
    expect(prompt).toContain("MUST be reported as P0 findings");
  });

  test("omits warning when all tasks are completed", () => {
    const tasks: TaskItem[] = [
      { id: "#1", description: "Task", status: "completed", summary: "Working" },
    ];

    const prompt = buildReviewPrompt(tasks, "Test", "/tmp/progress.txt");

    expect(prompt).toContain("**Completion rate:** 100%");
    expect(prompt).not.toContain("WARNING");
  });

  test("includes task completion and gap analysis focus area", () => {
    const tasks: TaskItem[] = [
      { id: "#1", description: "Task", status: "completed", summary: "Working" },
    ];

    const prompt = buildReviewPrompt(tasks, "Test", "/tmp/progress.txt");

    expect(prompt).toContain("Task Completion & Specification Gap Analysis");
    expect(prompt).toContain("MOST IMPORTANT review step");
    expect(prompt).toContain("completion rate is below 100%");
    expect(prompt).toContain("Do NOT approve an incomplete implementation");
  });

  test("includes review focus areas", () => {
    const tasks: TaskItem[] = [
      { id: "#1", description: "Task", status: "completed", summary: "Working" },
    ];

    const prompt = buildReviewPrompt(tasks, "Test", "/tmp/progress.txt");

    expect(prompt).toContain("Correctness of Logic");
    expect(prompt).toContain("Error Handling");
    expect(prompt).toContain("Edge Cases");
    expect(prompt).toContain("Security Concerns");
    expect(prompt).toContain("Performance Implications");
    expect(prompt).toContain("Test Coverage");
  });

  test("specifies JSON output format", () => {
    const tasks: TaskItem[] = [
      { id: "#1", description: "Task", status: "completed", summary: "Working" },
    ];

    const prompt = buildReviewPrompt(tasks, "Test", "/tmp/progress.txt");

    expect(prompt).toContain("findings");
    expect(prompt).toContain("overall_correctness");
    expect(prompt).toContain("overall_explanation");
    expect(prompt).toContain("confidence_score");
  });

  test("defines priority levels", () => {
    const tasks: TaskItem[] = [
      { id: "#1", description: "Task", status: "completed", summary: "Working" },
    ];

    const prompt = buildReviewPrompt(tasks, "Test", "/tmp/progress.txt");

    expect(prompt).toContain("P0");
    expect(prompt).toContain("P1");
    expect(prompt).toContain("P2");
    expect(prompt).toContain("P3");
    expect(prompt).toContain("Critical");
    expect(prompt).toContain("Important");
  });

  test("handles tasks without IDs", () => {
    const tasks: TaskItem[] = [
      { description: "Unnamed task", status: "completed", summary: "Working" },
    ];

    const prompt = buildReviewPrompt(tasks, "Test", "/tmp/progress.txt");

    expect(prompt).toContain("?");
    expect(prompt).toContain("Unnamed task");
  });

  test("includes prior debugger output section when provided", () => {
    const tasks: TaskItem[] = [
      { id: "#1", description: "Task", status: "completed", summary: "Working" },
    ];

    const debuggerOutput = "Fixed null pointer in auth module by adding guard clause";
    const prompt = buildReviewPrompt(tasks, "Test", "/tmp/progress.txt", debuggerOutput);

    expect(prompt).toContain("## Prior Debugging Context");
    expect(prompt).toContain("<prior_debugger_output>");
    expect(prompt).toContain(debuggerOutput);
    expect(prompt).toContain("</prior_debugger_output>");
    expect(prompt).toContain("whether these fixes actually resolved the issues");
    expect(prompt).toContain("whether they introduced any regressions");
  });

  test("omits prior debugger output section when undefined", () => {
    const tasks: TaskItem[] = [
      { id: "#1", description: "Task", status: "completed", summary: "Working" },
    ];

    const prompt = buildReviewPrompt(tasks, "Test", "/tmp/progress.txt", undefined);

    expect(prompt).not.toContain("Prior Debugging Context");
    expect(prompt).not.toContain("<prior_debugger_output>");
    expect(prompt).toContain("Begin your review now.");
  });

  test("omits prior debugger output section when empty string", () => {
    const tasks: TaskItem[] = [
      { id: "#1", description: "Task", status: "completed", summary: "Working" },
    ];

    const prompt = buildReviewPrompt(tasks, "Test", "/tmp/progress.txt", "");

    expect(prompt).not.toContain("Prior Debugging Context");
    expect(prompt).not.toContain("<prior_debugger_output>");
    expect(prompt).toContain("Begin your review now.");
  });

  test("omits prior debugger output section when not provided (3 args)", () => {
    const tasks: TaskItem[] = [
      { id: "#1", description: "Task", status: "completed", summary: "Working" },
    ];

    const prompt = buildReviewPrompt(tasks, "Test", "/tmp/progress.txt");

    expect(prompt).not.toContain("Prior Debugging Context");
    expect(prompt).not.toContain("<prior_debugger_output>");
    expect(prompt).toContain("Begin your review now.");
  });

  test("prompt with prior debugger output still contains all standard sections", () => {
    const tasks: TaskItem[] = [
      { id: "#1", description: "Task", status: "completed", summary: "Working" },
    ];

    const prompt = buildReviewPrompt(tasks, "Test", "/tmp/progress.txt", "Some debug fixes");

    expect(prompt).toContain("# Code Review Request");
    expect(prompt).toContain("## Original Specification");
    expect(prompt).toContain("## Review Instructions");
    expect(prompt).toContain("Correctness of Logic");
    expect(prompt).toContain("Begin your review now.");
    expect(prompt).toContain("## Prior Debugging Context");
  });
});

describe("parseReviewResult", () => {
  test("parses direct JSON", () => {
    const json = JSON.stringify({
      findings: [
        {
          title: "[P0] Critical bug",
          body: "Description",
          priority: 0,
          confidence_score: 0.95,
        },
      ],
      overall_correctness: "patch is incorrect",
      overall_explanation: "Has bugs",
      overall_confidence_score: 0.9,
    });

    const result = parseReviewResult(json);

    expect(result).not.toBeNull();
    expect(result?.findings).toHaveLength(1);
    expect(result?.findings[0]?.title).toBe("[P0] Critical bug");
    expect(result?.overall_correctness).toBe("patch is incorrect");
  });

  test("parses JSON from markdown code fence", () => {
    const markdown = `Here's the review:

\`\`\`json
{
  "findings": [{"title": "[P1] Issue", "body": "Details", "priority": 1}],
  "overall_correctness": "patch is correct",
  "overall_explanation": "Looks good"
}
\`\`\`

End of review.`;

    const result = parseReviewResult(markdown);

    expect(result).not.toBeNull();
    expect(result?.findings).toHaveLength(1);
    expect(result?.findings[0]?.title).toBe("[P1] Issue");
  });

  test("parses JSON from surrounding prose", () => {
    const prose =
      'After careful review, here are my findings: {"findings": [{"title": "[P2] Minor issue", "body": "Detail", "priority": 2}], "overall_correctness": "patch is correct", "overall_explanation": "Good work"} That completes the review.';

    const result = parseReviewResult(prose);

    expect(result).not.toBeNull();
    expect(result?.findings).toHaveLength(1);
  });

  test("filters out P3 findings", () => {
    const json = JSON.stringify({
      findings: [
        { title: "[P0] Critical", body: "Must fix", priority: 0 },
        { title: "[P1] Important", body: "Should fix", priority: 1 },
        { title: "[P2] Moderate", body: "Could fix", priority: 2 },
        { title: "[P3] Minor", body: "Style nit", priority: 3 },
      ],
      overall_correctness: "patch is correct",
      overall_explanation: "Mostly good",
    });

    const result = parseReviewResult(json);

    expect(result).not.toBeNull();
    expect(result?.findings).toHaveLength(3);
    expect(result?.findings.some((finding) => finding.priority === 3)).toBe(false);
  });

  test("handles findings without priority field", () => {
    const json = JSON.stringify({
      findings: [{ title: "Issue", body: "Details" }],
      overall_correctness: "patch is correct",
      overall_explanation: "OK",
    });

    const result = parseReviewResult(json);

    expect(result).not.toBeNull();
    expect(result?.findings).toHaveLength(1);
  });

  test("returns null for invalid JSON", () => {
    expect(parseReviewResult("This is not JSON at all")).toBeNull();
  });

  test("returns null for JSON without required fields", () => {
    expect(parseReviewResult(JSON.stringify({ some_field: "value" }))).toBeNull();
  });
});
