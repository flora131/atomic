import { describe, expect, test } from "bun:test";
import { headerBadgePresentation } from "./header.tsx";

describe("headerBadgePresentation", () => {
  test("keeps the orchestrator badge in info tone while active", () => {
    expect(headerBadgePresentation({ workflowName: "hello-world", tone: "info" })).toEqual({
      text: " Orchestrator ",
      tone: "info",
    });
  });

  test("turns the orchestrator badge into the green completed state", () => {
    expect(headerBadgePresentation({ workflowName: "hello-world", tone: "success" })).toEqual({
      text: " ✓ hello-world ",
      tone: "success",
    });
  });

  test("falls back to Orchestrator text when completed snapshot has no workflow name", () => {
    expect(headerBadgePresentation({ workflowName: "", tone: "success" })).toEqual({
      text: " ✓ Orchestrator ",
      tone: "success",
    });
  });

  test("turns the orchestrator badge into the red failed state", () => {
    expect(headerBadgePresentation({ workflowName: "hello-world", tone: "error" })).toEqual({
      text: " ✗ Failed ",
      tone: "error",
    });
  });
});
