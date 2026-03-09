import { describe, expect, test } from "bun:test";
import {
  buildFixSpecFromRawReview,
  buildFixSpecFromReview,
  type ReviewResult,
  type TaskItem,
} from "./ralph.test-support.ts";

describe("buildFixSpecFromReview", () => {
  test("returns empty string when no findings", () => {
    const review: ReviewResult = {
      findings: [],
      overall_correctness: "patch is correct",
      overall_explanation: "No issues found",
    };

    expect(buildFixSpecFromReview(review, [], "Original request")).toBe("");
  });

  test("returns empty string when patch is correct with no findings", () => {
    const review: ReviewResult = {
      findings: [],
      overall_correctness: "patch is correct",
      overall_explanation: "All good",
    };

    expect(buildFixSpecFromReview(review, [], "Test")).toBe("");
  });

  test("generates fix spec with single finding", () => {
    const review: ReviewResult = {
      findings: [
        {
          title: "[P0] Null pointer bug",
          body: "Code crashes on null input",
          priority: 0,
          confidence_score: 0.95,
          code_location: {
            absolute_file_path: "/path/to/file.ts",
            line_range: { start: 10, end: 15 },
          },
        },
      ],
      overall_correctness: "patch is incorrect",
      overall_explanation: "Critical bug found",
    };

    const spec = buildFixSpecFromReview(review, [], "Add feature X");

    expect(spec).toContain("# Review Fix Specification");
    expect(spec).toContain("Add feature X");
    expect(spec).toContain("patch is incorrect");
    expect(spec).toContain("Critical bug found");
    expect(spec).toContain("Finding 1");
    expect(spec).toContain("[P0] Null pointer bug");
    expect(spec).toContain("P0");
    expect(spec).toContain("/path/to/file.ts:10-15");
    expect(spec).toContain("Code crashes on null input");
  });

  test("sorts findings by priority", () => {
    const review: ReviewResult = {
      findings: [
        { title: "[P2] Moderate", body: "Issue 1", priority: 2 },
        { title: "[P0] Critical", body: "Issue 2", priority: 0 },
        { title: "[P1] Important", body: "Issue 3", priority: 1 },
      ],
      overall_correctness: "patch is incorrect",
      overall_explanation: "Multiple issues",
    };

    const spec = buildFixSpecFromReview(review, [], "Test");

    expect(spec.indexOf("[P0] Critical")).toBeLessThan(
      spec.indexOf("[P1] Important"),
    );
    expect(spec.indexOf("[P1] Important")).toBeLessThan(
      spec.indexOf("[P2] Moderate"),
    );
  });

  test("handles findings without code location", () => {
    const review: ReviewResult = {
      findings: [
        {
          title: "[P1] General issue",
          body: "No specific location",
          priority: 1,
        },
      ],
      overall_correctness: "patch is incorrect",
      overall_explanation: "Has issues",
    };

    expect(buildFixSpecFromReview(review, [], "Test")).toContain(
      "Location not specified",
    );
  });

  test("handles findings without explicit priority", () => {
    const review: ReviewResult = {
      findings: [{ title: "Issue without priority", body: "Details" }],
      overall_correctness: "patch is incorrect",
      overall_explanation: "Issue found",
    };

    expect(buildFixSpecFromReview(review, [], "Test")).toContain("P2");
  });

  test("includes fix guidelines", () => {
    const review: ReviewResult = {
      findings: [{ title: "[P0] Bug", body: "Fix this", priority: 0 }],
      overall_correctness: "patch is incorrect",
      overall_explanation: "Bug exists",
    };

    const spec = buildFixSpecFromReview(review, [], "Test");

    expect(spec).toContain("Fix Guidelines");
    expect(spec).toContain("priority order");
    expect(spec).toContain("existing tests");
    expect(spec).toContain("minimal changes");
  });

  test("includes rubric for each finding", () => {
    const review: ReviewResult = {
      findings: [{ title: "[P1] Issue", body: "Problem description", priority: 1 }],
      overall_correctness: "patch is incorrect",
      overall_explanation: "Issue found",
    };

    const spec = buildFixSpecFromReview(review, [], "Test");

    expect(spec).toContain("Rubric");
    expect(spec).toContain("fix is complete when");
  });
});

describe("buildFixSpecFromRawReview", () => {
  test("returns empty string for empty raw output", () => {
    expect(buildFixSpecFromRawReview("   ", "Test")).toBe("");
  });

  test("includes raw reviewer output in fallback spec", () => {
    const raw = "I found a bug in src/foo.ts around null handling.";
    const spec = buildFixSpecFromRawReview(raw, "Implement feature X");

    expect(spec).toContain("# Review Fix Specification");
    expect(spec).toContain("Implement feature X");
    expect(spec).toContain(raw);
    expect(spec).toContain("could not be parsed");
  });
});
