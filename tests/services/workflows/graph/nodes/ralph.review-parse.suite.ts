import { describe, expect, test } from "bun:test";
import {
  buildReviewPrompt,
  parseReviewResult,
} from "./ralph.test-support.ts";

describe("buildReviewPrompt", () => {
  test("includes user prompt in review request", () => {
    const prompt = buildReviewPrompt(
      "Implement user authentication",
    );

    expect(prompt).toContain("Implement user authentication");
    expect(prompt).toContain("<user_request>");
    expect(prompt).toContain("</user_request>");
  });

  test("instructs to retrieve tasks via task_list tool", () => {
    const prompt = buildReviewPrompt("Test");

    expect(prompt).toContain("task_list tool");
    expect(prompt).toContain("list_tasks");
    expect(prompt).toContain("get_task_progress");
  });

  test("includes task completion and gap analysis focus area", () => {
    const prompt = buildReviewPrompt("Test");

    expect(prompt).toContain("Task Completion & Specification Gap Analysis");
    expect(prompt).toContain("MOST IMPORTANT review step");
    expect(prompt).toContain("Do NOT approve an incomplete implementation");
  });

  test("includes review focus areas", () => {
    const prompt = buildReviewPrompt("Test");

    expect(prompt).toContain("Correctness of Logic");
    expect(prompt).toContain("Error Handling");
    expect(prompt).toContain("Edge Cases");
    expect(prompt).toContain("Security Concerns");
    expect(prompt).toContain("Performance Implications");
    expect(prompt).toContain("Test Coverage");
  });

  test("specifies JSON output format", () => {
    const prompt = buildReviewPrompt("Test");

    expect(prompt).toContain("findings");
    expect(prompt).toContain("overall_correctness");
    expect(prompt).toContain("overall_explanation");
    expect(prompt).toContain("confidence_score");
  });

  test("defines priority levels", () => {
    const prompt = buildReviewPrompt("Test");

    expect(prompt).toContain("P0");
    expect(prompt).toContain("P1");
    expect(prompt).toContain("P2");
    expect(prompt).toContain("P3");
    expect(prompt).toContain("Critical");
    expect(prompt).toContain("Important");
  });

  test("includes prior debugger output section when provided", () => {
    const debuggerOutput = "Fixed null pointer in auth module by adding guard clause";
    const prompt = buildReviewPrompt("Test", debuggerOutput);

    expect(prompt).toContain("## Prior Debugging Context");
    expect(prompt).toContain("<prior_debugger_output>");
    expect(prompt).toContain(debuggerOutput);
    expect(prompt).toContain("</prior_debugger_output>");
    expect(prompt).toContain("whether these fixes actually resolved the issues");
    expect(prompt).toContain("whether they introduced any regressions");
  });

  test("omits prior debugger output section when undefined", () => {
    const prompt = buildReviewPrompt("Test", undefined);

    expect(prompt).not.toContain("Prior Debugging Context");
    expect(prompt).not.toContain("<prior_debugger_output>");
    expect(prompt).toContain("Begin your review now.");
  });

  test("omits prior debugger output section when empty string", () => {
    const prompt = buildReviewPrompt("Test", "");

    expect(prompt).not.toContain("Prior Debugging Context");
    expect(prompt).not.toContain("<prior_debugger_output>");
    expect(prompt).toContain("Begin your review now.");
  });

  test("omits prior debugger output section when not provided (1 arg)", () => {
    const prompt = buildReviewPrompt("Test");

    expect(prompt).not.toContain("Prior Debugging Context");
    expect(prompt).not.toContain("<prior_debugger_output>");
    expect(prompt).toContain("Begin your review now.");
  });

  test("prompt with prior debugger output still contains all standard sections", () => {
    const prompt = buildReviewPrompt("Test", "Some debug fixes");

    expect(prompt).toContain("# Code Review Request");
    expect(prompt).toContain("## Original Specification");
    expect(prompt).toContain("## Review Instructions");
    expect(prompt).toContain("Correctness of Logic");
    expect(prompt).toContain("Begin your review now.");
    expect(prompt).toContain("## Prior Debugging Context");
  });

  test("does not reference progress file path", () => {
    const prompt = buildReviewPrompt("Test");

    expect(prompt).not.toContain("progress file");
    expect(prompt).not.toContain("progressFilePath");
  });

  test("does not embed inline task data", () => {
    const prompt = buildReviewPrompt("Test");

    expect(prompt).not.toContain("<task_plan>");
    expect(prompt).not.toContain("## Completed Tasks");
    expect(prompt).not.toContain("## Task Completion Summary");
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
