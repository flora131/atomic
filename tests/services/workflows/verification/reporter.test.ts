/**
 * Tests for the Verification Reporter.
 *
 * Pure string formatting — no solver or mock dependencies required.
 */

import { describe, test, expect } from "bun:test";
import {
  formatVerificationReport,
  formatStartupWarning,
} from "@/services/workflows/verification/reporter";
import type {
  VerificationResult,
  PropertyResult,
} from "@/services/workflows/verification/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PASS: PropertyResult = { verified: true };

function makeAllPassResult(): VerificationResult {
  return {
    valid: true,
    properties: {
      reachability: PASS,
      termination: PASS,
      deadlockFreedom: PASS,
      loopBounds: PASS,
      stateDataFlow: PASS,
    },
  };
}

function makeFailedResult(
  overrides: Partial<VerificationResult["properties"]>,
): VerificationResult {
  const properties = {
    reachability: PASS,
    termination: PASS,
    deadlockFreedom: PASS,
    loopBounds: PASS,
    stateDataFlow: PASS,
    ...overrides,
  };
  const valid = Object.values(properties).every((p) => p.verified);
  return { valid, properties };
}

// ---------------------------------------------------------------------------
// formatVerificationReport
// ---------------------------------------------------------------------------

describe("formatVerificationReport", () => {
  test("reports all-pass result with success header", () => {
    const result = makeAllPassResult();
    const report = formatVerificationReport("my-workflow", result);

    expect(report).toContain('Workflow "my-workflow" passed all verification checks');
  });

  test("contains PASS for each property when all pass", () => {
    const result = makeAllPassResult();
    const report = formatVerificationReport("test", result);

    expect(report).toContain("PASS  Reachability");
    expect(report).toContain("PASS  Termination");
    expect(report).toContain("PASS  Deadlock-Freedom");
    expect(report).toContain("PASS  Loop Bounds");
    expect(report).toContain("PASS  State Data-Flow");
  });

  test("reports failure header when any property fails", () => {
    const result = makeFailedResult({
      reachability: {
        verified: false,
        counterexample: 'Node "X" unreachable',
      },
    });
    const report = formatVerificationReport("broken", result);

    expect(report).toContain('Workflow "broken" failed verification');
    expect(report).not.toContain("passed all verification checks");
  });

  test("shows FAIL with counterexample for failed properties", () => {
    const result = makeFailedResult({
      reachability: {
        verified: false,
        counterexample: 'Node(s) "X" unreachable from start node "start"',
      },
    });
    const report = formatVerificationReport("w", result);

    expect(report).toContain(
      'FAIL  Reachability: Node(s) "X" unreachable from start node "start"',
    );
  });

  test("shows FAIL without counterexample when none provided", () => {
    const result = makeFailedResult({
      termination: { verified: false },
    });
    const report = formatVerificationReport("w", result);

    expect(report).toContain("FAIL  Termination");
    // Should not have a trailing colon when no counterexample
    const terminationLine = report
      .split("\n")
      .find((l) => l.includes("Termination"));
    expect(terminationLine).toBe("  FAIL  Termination");
  });

  test("shows mixed PASS and FAIL for partial failures", () => {
    const result = makeFailedResult({
      deadlockFreedom: {
        verified: false,
        counterexample: 'Node "stuck" may deadlock',
      },
      loopBounds: {
        verified: false,
        counterexample: "Unbounded loops detected",
      },
    });
    const report = formatVerificationReport("mixed", result);

    expect(report).toContain("PASS  Reachability");
    expect(report).toContain("PASS  Termination");
    expect(report).toContain("FAIL  Deadlock-Freedom");
    expect(report).toContain("FAIL  Loop Bounds");
    expect(report).toContain("PASS  State Data-Flow");
  });

  test("shows all 5 properties as FAIL when everything fails", () => {
    const result: VerificationResult = {
      valid: false,
      properties: {
        reachability: { verified: false, counterexample: "fail1" },
        termination: { verified: false, counterexample: "fail2" },
        deadlockFreedom: { verified: false, counterexample: "fail3" },
        loopBounds: { verified: false, counterexample: "fail4" },
        stateDataFlow: { verified: false, counterexample: "fail5" },
      },
    };
    const report = formatVerificationReport("all-bad", result);

    expect(report).toContain("FAIL  Reachability: fail1");
    expect(report).toContain("FAIL  Termination: fail2");
    expect(report).toContain("FAIL  Deadlock-Freedom: fail3");
    expect(report).toContain("FAIL  Loop Bounds: fail4");
    expect(report).toContain("FAIL  State Data-Flow: fail5");
  });

  test("includes workflow ID in header", () => {
    const result = makeAllPassResult();
    const report = formatVerificationReport("deploy-pipeline", result);

    expect(report).toContain("deploy-pipeline");
  });

  test("produces multi-line output with blank separator", () => {
    const result = makeAllPassResult();
    const report = formatVerificationReport("w", result);
    const lines = report.split("\n");

    // Header, blank line, then 5 property lines
    expect(lines.length).toBe(7);
    expect(lines[1]).toBe("");
  });

  test("preserves property order: reachability, termination, deadlockFreedom, loopBounds, stateDataFlow", () => {
    const result = makeAllPassResult();
    const report = formatVerificationReport("w", result);
    const lines = report.split("\n").filter((l) => l.includes("PASS"));

    expect(lines[0]).toContain("Reachability");
    expect(lines[1]).toContain("Termination");
    expect(lines[2]).toContain("Deadlock-Freedom");
    expect(lines[3]).toContain("Loop Bounds");
    expect(lines[4]).toContain("State Data-Flow");
  });

  test("uses display names (not camelCase keys) for properties", () => {
    const result = makeAllPassResult();
    const report = formatVerificationReport("w", result);

    // Should not contain camelCase property keys
    expect(report).not.toContain("  PASS  deadlockFreedom");
    expect(report).not.toContain("  PASS  loopBounds");
    expect(report).not.toContain("  PASS  stateDataFlow");
    // Should contain display names
    expect(report).toContain("Deadlock-Freedom");
    expect(report).toContain("Loop Bounds");
    expect(report).toContain("State Data-Flow");
  });

  test("handles special characters in workflow ID", () => {
    const result = makeAllPassResult();
    const report = formatVerificationReport("my-workflow/v2", result);
    expect(report).toContain('"my-workflow/v2"');
  });

  test("handles empty string workflow ID", () => {
    const result = makeAllPassResult();
    const report = formatVerificationReport("", result);
    expect(report).toContain('Workflow ""');
  });
});

// ---------------------------------------------------------------------------
// formatStartupWarning
// ---------------------------------------------------------------------------

describe("formatStartupWarning", () => {
  test("includes workflow ID in warning message", () => {
    const warning = formatStartupWarning("broken-wf");
    expect(warning).toContain("broken-wf");
  });

  test("includes warning prefix", () => {
    const warning = formatStartupWarning("x");
    expect(warning).toContain("Warning:");
  });

  test("includes ANSI yellow color code", () => {
    const warning = formatStartupWarning("x");
    // \x1b[33m = yellow, \x1b[0m = reset
    expect(warning).toContain("\x1b[33m");
    expect(warning).toContain("\x1b[0m");
  });

  test("starts with yellow ANSI and ends with reset", () => {
    const warning = formatStartupWarning("test");
    expect(warning.startsWith("\x1b[33m")).toBe(true);
    expect(warning.endsWith("\x1b[0m")).toBe(true);
  });

  test("contains 'Failed to load workflow' message", () => {
    const warning = formatStartupWarning("my-wf");
    expect(warning).toContain("Failed to load workflow: my-wf");
  });

  test("handles special characters in workflow ID", () => {
    const warning = formatStartupWarning("wf/v2@latest");
    expect(warning).toContain("wf/v2@latest");
  });
});
