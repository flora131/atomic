import { describe, expect, test } from "bun:test";
import {
  buildReviewPrompt,
  parseReviewResult,
  type TaskItem,
} from "./ralph.test-support.ts";

describe("buildReviewPrompt", () => {
  test("includes user prompt in review request", () => {
    const tasks: TaskItem[] = [
      { id: "#1", content: "Add login", status: "completed", activeForm: "Adding login" },
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

  test("lists all completed tasks", () => {
    const tasks: TaskItem[] = [
      { id: "#1", content: "Setup DB", status: "completed", activeForm: "Setting up" },
      { id: "#2", content: "Add API", status: "completed", activeForm: "Adding API" },
      { id: "#3", content: "Not done yet", status: "pending", activeForm: "Working" },
    ];

    const prompt = buildReviewPrompt(tasks, "Build backend", "/tmp/progress.txt");

    expect(prompt).toContain("#1");
    expect(prompt).toContain("Setup DB");
    expect(prompt).toContain("#2");
    expect(prompt).toContain("Add API");
    expect(prompt).not.toContain("Not done yet");
  });

  test("includes progress file path", () => {
    const tasks: TaskItem[] = [
      { id: "#1", content: "Task", status: "completed", activeForm: "Working" },
    ];

    expect(buildReviewPrompt(tasks, "Test", "/session/progress.txt")).toContain(
      "/session/progress.txt",
    );
  });

  test("includes review focus areas", () => {
    const tasks: TaskItem[] = [
      { id: "#1", content: "Task", status: "completed", activeForm: "Working" },
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
      { id: "#1", content: "Task", status: "completed", activeForm: "Working" },
    ];

    const prompt = buildReviewPrompt(tasks, "Test", "/tmp/progress.txt");

    expect(prompt).toContain("findings");
    expect(prompt).toContain("overall_correctness");
    expect(prompt).toContain("overall_explanation");
    expect(prompt).toContain("confidence_score");
  });

  test("defines priority levels", () => {
    const tasks: TaskItem[] = [
      { id: "#1", content: "Task", status: "completed", activeForm: "Working" },
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
      { content: "Unnamed task", status: "completed", activeForm: "Working" },
    ];

    const prompt = buildReviewPrompt(tasks, "Test", "/tmp/progress.txt");

    expect(prompt).toContain("?");
    expect(prompt).toContain("Unnamed task");
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
