import { describe, expect, test } from "bun:test";
import { buildHiddenPhaseSummary } from "./utils/hidden-phase-summary.ts";

describe("buildHiddenPhaseSummary", () => {
  test("returns null for task decomposition payloads", () => {
    const summary = buildHiddenPhaseSummary(
      JSON.stringify([
        {
          id: "#1",
          content: "Implement orchestration",
          status: "pending",
          activeForm: "Implementing orchestration",
          blockedBy: [],
        },
        {
          id: "#2",
          content: "Add tests",
          status: "pending",
          activeForm: "Adding tests",
          blockedBy: ["#1"],
        },
      ]),
    );

    expect(summary).toBeNull();
  });

  test("summarizes review phase output", () => {
    const summary = buildHiddenPhaseSummary(
      "overall_correctness: patch is correct\nfindings: []",
    );

    expect(summary).toBe("[Code Review] Review completed.");
  });

  test("returns generic phase summary for unknown content", () => {
    expect(buildHiddenPhaseSummary("random internal output")).toBe(
      "[Workflow Phase] Completed.",
    );
  });
});
