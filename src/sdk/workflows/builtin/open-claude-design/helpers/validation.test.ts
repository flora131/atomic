import { test, expect, describe } from "bun:test";
import {
  parseRefinementDecision,
  parseCritiqueFindings,
  parseScreenshotFindings,
  mergeValidationResults,
  isValidationClean,
  formatValidationForRefiner,
} from "./validation.ts";
import type {
  FindingSeverity,
  ValidationFinding,
  ValidationSummary,
  SessionMessageLike,
} from "./validation.ts";

// ============================================================================
// Helpers — build mock session messages for AskUserQuestion tests
// ============================================================================

let toolIdCounter = 0;

function makeAskUserMessages(
  userResponse: string,
  toolId?: string,
): SessionMessageLike[] {
  const id = toolId ?? `tool_${++toolIdCounter}`;
  return [
    {
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id,
            name: "AskUserQuestion",
            input: { question: "Choose one" },
          },
        ],
      },
    },
    {
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: id,
            content: userResponse,
          },
        ],
      },
    },
  ];
}

function makeAgentText(text: string): SessionMessageLike {
  return {
    type: "assistant",
    message: { content: [{ type: "text", text }] },
  };
}

// ============================================================================
// parseRefinementDecision — Strategy 1: tool_result extraction
// ============================================================================

describe("parseRefinementDecision — Strategy 1 (tool_result)", () => {
  test("user selects option 1 → done", () => {
    const msgs = makeAskUserMessages("1");
    const result = parseRefinementDecision(msgs);
    expect(result.done).toBe(true);
    expect(result.validate).toBe(false);
    expect(result.feedback).toBeNull();
  });

  test("user selects option 1 with text after number → done", () => {
    const msgs = makeAskUserMessages("1) Done, looks good.");
    const result = parseRefinementDecision(msgs);
    expect(result.done).toBe(true);
    expect(result.validate).toBe(false);
  });

  test("user selects option 2 → validate", () => {
    const msgs = makeAskUserMessages("2");
    const result = parseRefinementDecision(msgs);
    expect(result.done).toBe(false);
    expect(result.validate).toBe(true);
    expect(result.feedback).toBeNull();
  });

  test("user selects option 2 with text → validate", () => {
    const msgs = makeAskUserMessages("2) Run validation checks.");
    const result = parseRefinementDecision(msgs);
    expect(result.done).toBe(false);
    expect(result.validate).toBe(true);
  });

  test("user selects option 3 with follow-up feedback", () => {
    const msgs = [
      ...makeAskUserMessages("3", "tool_choice"),
      ...makeAskUserMessages("make the header bigger", "tool_feedback"),
    ];
    const result = parseRefinementDecision(msgs);
    expect(result.done).toBe(false);
    expect(result.validate).toBe(false);
    expect(result.feedback).toBe("make the header bigger");
  });

  test("user selects option 3 without follow-up → feedback is null", () => {
    const msgs = makeAskUserMessages("3");
    const result = parseRefinementDecision(msgs);
    expect(result.done).toBe(false);
    expect(result.validate).toBe(false);
    expect(result.feedback).toBeNull();
  });

  test("user types free-form feedback instead of a number → treated as feedback", () => {
    const msgs = makeAskUserMessages("change the colors to be warmer");
    const result = parseRefinementDecision(msgs);
    expect(result.done).toBe(false);
    expect(result.validate).toBe(false);
    expect(result.feedback).toBe("change the colors to be warmer");
  });

  test("handles tool_result with array content blocks", () => {
    const msgs: SessionMessageLike[] = [
      {
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", id: "t1", name: "AskUserQuestion" },
          ],
        },
      },
      {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "t1",
              content: [{ type: "text", text: "1" }],
            },
          ],
        },
      },
    ];
    expect(parseRefinementDecision(msgs).done).toBe(true);
  });
});

// ============================================================================
// parseRefinementDecision — Strategy 2: JSON from agent text
// ============================================================================

describe("parseRefinementDecision — Strategy 2 (JSON)", () => {
  test("parses decision from fenced JSON block — done", () => {
    const msgs: SessionMessageLike[] = [
      makeAgentText('Here is the result:\n```json\n{"decision": "done"}\n```'),
    ];
    const result = parseRefinementDecision(msgs);
    expect(result.done).toBe(true);
    expect(result.validate).toBe(false);
    expect(result.feedback).toBeNull();
  });

  test("parses decision from fenced JSON block — validate", () => {
    const msgs: SessionMessageLike[] = [
      makeAgentText('```json\n{"decision": "validate"}\n```'),
    ];
    const result = parseRefinementDecision(msgs);
    expect(result.done).toBe(false);
    expect(result.validate).toBe(true);
    expect(result.feedback).toBeNull();
  });

  test("parses decision from fenced JSON block — continue with feedback", () => {
    const msgs: SessionMessageLike[] = [
      makeAgentText(
        '```json\n{"decision": "continue", "feedback": "fix the spacing"}\n```',
      ),
    ];
    const result = parseRefinementDecision(msgs);
    expect(result.done).toBe(false);
    expect(result.validate).toBe(false);
    expect(result.feedback).toBe("fix the spacing");
  });

  test("parses decision from inline JSON object in prose", () => {
    const msgs: SessionMessageLike[] = [
      makeAgentText(
        'The user chose to continue. {"decision": "continue", "feedback": "bigger font"}',
      ),
    ];
    const result = parseRefinementDecision(msgs);
    expect(result.done).toBe(false);
    expect(result.validate).toBe(false);
    expect(result.feedback).toBe("bigger font");
  });
});

// ============================================================================
// parseRefinementDecision — Strategy 3: Regex from agent text
// ============================================================================

describe("parseRefinementDecision — Strategy 3 (regex)", () => {
  test("detects 'user chose option 1' → done", () => {
    const msgs: SessionMessageLike[] = [
      makeAgentText("The user chose option 1. Proceeding to export."),
    ];
    const result = parseRefinementDecision(msgs);
    expect(result.done).toBe(true);
    expect(result.validate).toBe(false);
  });

  test("detects 'user selected option 2' → validate", () => {
    const msgs: SessionMessageLike[] = [
      makeAgentText("The user selected option 2 to run validation checks."),
    ];
    const result = parseRefinementDecision(msgs);
    expect(result.done).toBe(false);
    expect(result.validate).toBe(true);
  });

  test("detects 'run validation' → validate", () => {
    const msgs: SessionMessageLike[] = [
      makeAgentText("The user wants to run validation on the design."),
    ];
    const result = parseRefinementDecision(msgs);
    expect(result.done).toBe(false);
    expect(result.validate).toBe(true);
  });

  test("detects 'user selected option 3' → continue", () => {
    const msgs: SessionMessageLike[] = [
      makeAgentText("The user selected option 3 and wants more changes."),
    ];
    const result = parseRefinementDecision(msgs);
    expect(result.done).toBe(false);
    expect(result.validate).toBe(false);
  });

  test("detects 'user has further feedback' → continue", () => {
    const msgs: SessionMessageLike[] = [
      makeAgentText("The user has further feedback about the layout."),
    ];
    const result = parseRefinementDecision(msgs);
    expect(result.done).toBe(false);
    expect(result.validate).toBe(false);
  });
});

// ============================================================================
// parseRefinementDecision — Default fallback
// ============================================================================

describe("parseRefinementDecision — Default", () => {
  test("returns done=false, validate=false for empty messages (conservative)", () => {
    const result = parseRefinementDecision([]);
    expect(result.done).toBe(false);
    expect(result.validate).toBe(false);
    expect(result.feedback).toBeNull();
  });

  test("returns done=false, validate=false when no signals found (conservative)", () => {
    const msgs: SessionMessageLike[] = [
      makeAgentText("I've made the requested changes to the design."),
    ];
    const result = parseRefinementDecision(msgs);
    expect(result.done).toBe(false);
    expect(result.validate).toBe(false);
  });
});

// ============================================================================
// parseCritiqueFindings
// ============================================================================

describe("parseCritiqueFindings", () => {
  test("returns empty array for empty input", () => {
    expect(parseCritiqueFindings("")).toEqual([]);
  });

  test("returns empty array when no structured findings present", () => {
    expect(parseCritiqueFindings("Great design overall.")).toEqual([]);
  });

  test("parses [Critical] severity marker", () => {
    const input = "[Critical] Usability: The button has no accessible label";
    const findings = parseCritiqueFindings(input);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]!.severity).toBe("critical");
  });

  test("parses [Moderate] severity marker", () => {
    const input = "[Moderate] Visual Hierarchy: Heading contrast is insufficient";
    const findings = parseCritiqueFindings(input);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]!.severity).toBe("moderate");
  });

  test("parses [Minor] severity marker", () => {
    const input = "[Minor] Consistency: Spacing inconsistency between elements";
    const findings = parseCritiqueFindings(input);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]!.severity).toBe("minor");
  });

  test("parses **Critical** bold severity marker", () => {
    const input = "**Critical** Accessibility: Low contrast ratio detected";
    const findings = parseCritiqueFindings(input);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]!.severity).toBe("critical");
  });

  test("parses **Moderate** bold severity marker", () => {
    const input = "**Moderate** Usability: Navigation is not clear";
    const findings = parseCritiqueFindings(input);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]!.severity).toBe("moderate");
  });

  test("parses **Minor** bold severity marker", () => {
    const input = "**Minor** Consistency: Icon style inconsistency";
    const findings = parseCritiqueFindings(input);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]!.severity).toBe("minor");
  });

  test("parses **[Critical]** bold-bracket severity marker", () => {
    const input = "**[Critical]** Accessibility: Low contrast ratio on primary CTA";
    const findings = parseCritiqueFindings(input);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]!.severity).toBe("critical");
    expect(findings[0]!.category).toBe("Accessibility");
    expect(findings[0]!.description).toContain("Low contrast ratio");
  });

  test("parses **[Moderate]** bold-bracket severity marker", () => {
    const input = "**[Moderate]** Usability: Navigation dropdown is hard to discover";
    const findings = parseCritiqueFindings(input);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]!.severity).toBe("moderate");
  });

  test("parses **[Minor]** bold-bracket severity marker", () => {
    const input = "**[Minor]** Consistency: Border radius varies between cards";
    const findings = parseCritiqueFindings(input);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]!.severity).toBe("minor");
  });

  test("parses mixed formats in multi-line output", () => {
    const input = `
**[Critical]** Accessibility: Missing alt text on hero image
[Moderate] Usability: CTA button is below the fold
**Minor** Consistency: Icon sizes vary slightly
    `.trim();
    const findings = parseCritiqueFindings(input);
    expect(findings.length).toBe(3);
    expect(findings[0]!.severity).toBe("critical");
    expect(findings[1]!.severity).toBe("moderate");
    expect(findings[2]!.severity).toBe("minor");
  });

  test("parses multiple findings from multi-line output", () => {
    const input = `
[Critical] Accessibility: Missing alt text on images
[Moderate] Usability: CTA button is hard to find
[Minor] Consistency: Font sizes vary inconsistently
    `.trim();
    const findings = parseCritiqueFindings(input);
    expect(findings.length).toBe(3);
    expect(findings[0]!.severity).toBe("critical");
    expect(findings[1]!.severity).toBe("moderate");
    expect(findings[2]!.severity).toBe("minor");
  });

  test("extracts category from finding", () => {
    const input = "[Critical] Accessibility: Missing alt text on images";
    const findings = parseCritiqueFindings(input);
    expect(findings[0]!.category).toBe("Accessibility");
  });

  test("extracts description text", () => {
    const input = "[Critical] Accessibility: Missing alt text on images";
    const findings = parseCritiqueFindings(input);
    expect(findings[0]!.description).toContain("Missing alt text");
  });

  test("case-insensitive severity marker matching", () => {
    const input = "[CRITICAL] Usability: Button too small";
    const findings = parseCritiqueFindings(input);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]!.severity).toBe("critical");
  });

  test("returns ValidationFinding objects with required fields", () => {
    const input = "[Moderate] Visual Hierarchy: Poor reading order";
    const findings = parseCritiqueFindings(input);
    expect(findings[0]).toHaveProperty("severity");
    expect(findings[0]).toHaveProperty("category");
    expect(findings[0]).toHaveProperty("description");
  });
});

// ============================================================================
// parseScreenshotFindings
// ============================================================================

describe("parseScreenshotFindings", () => {
  test("returns empty array for empty input", () => {
    expect(parseScreenshotFindings("")).toEqual([]);
  });

  test("returns empty array when no issues described", () => {
    expect(parseScreenshotFindings("All viewports look great. No issues found.")).toEqual([]);
  });

  test("detects mobile viewport issues", () => {
    const input = "Mobile (375px): Navigation overflows the screen and text is clipped";
    const findings = parseScreenshotFindings(input);
    expect(findings.length).toBeGreaterThan(0);
  });

  test("detects tablet viewport issues", () => {
    const input = "Tablet (768px): Layout breaks — columns collapse incorrectly";
    const findings = parseScreenshotFindings(input);
    expect(findings.length).toBeGreaterThan(0);
  });

  test("detects desktop viewport issues", () => {
    const input = "Desktop (1440px): Hero section has rendering artifacts";
    const findings = parseScreenshotFindings(input);
    expect(findings.length).toBeGreaterThan(0);
  });

  test("detects layout break indicators", () => {
    const input = "Layout break detected: the sidebar overlaps the main content area";
    const findings = parseScreenshotFindings(input);
    expect(findings.length).toBeGreaterThan(0);
  });

  test("detects rendering issue descriptions", () => {
    const input = "Rendering issue: fonts not loaded, fallback fonts appear";
    const findings = parseScreenshotFindings(input);
    expect(findings.length).toBeGreaterThan(0);
  });

  test("maps findings to ValidationFinding type", () => {
    const input = "Mobile (375px): Text overflow detected in header";
    const findings = parseScreenshotFindings(input);
    expect(findings[0]).toHaveProperty("severity");
    expect(findings[0]).toHaveProperty("category");
    expect(findings[0]).toHaveProperty("description");
  });
});

// ============================================================================
// mergeValidationResults
// ============================================================================

describe("mergeValidationResults", () => {
  test("stores raw critique output", () => {
    const critiqueRaw = "[Critical] Accessibility: Missing alt text";
    const screenshotRaw = "All viewports render correctly.";
    const summary = mergeValidationResults(critiqueRaw, screenshotRaw);
    expect(summary.critiqueRaw).toBe(critiqueRaw);
    expect(summary.screenshotRaw).toBe(screenshotRaw);
  });

  test("counts critical findings correctly", () => {
    const critiqueRaw = "[Critical] Accessibility: Missing alt text\n[Critical] Usability: Button not clickable";
    const summary = mergeValidationResults(critiqueRaw, "");
    expect(summary.criticalCount).toBe(2);
  });

  test("counts moderate findings correctly", () => {
    const critiqueRaw = "[Moderate] Visual Hierarchy: Poor contrast\n[Moderate] Consistency: Mixed fonts";
    const summary = mergeValidationResults(critiqueRaw, "");
    expect(summary.moderateCount).toBe(2);
  });

  test("counts minor findings correctly", () => {
    const critiqueRaw = "[Minor] Consistency: Spacing inconsistency";
    const summary = mergeValidationResults(critiqueRaw, "");
    expect(summary.minorCount).toBe(1);
  });

  test("merges critique and screenshot findings into single array", () => {
    const critiqueRaw = "[Critical] Accessibility: Missing alt text";
    const screenshotRaw = "Mobile (375px): Layout break detected in navigation";
    const summary = mergeValidationResults(critiqueRaw, screenshotRaw);
    expect(summary.findings.length).toBeGreaterThan(1);
  });

  test("returns zero counts when both inputs are empty", () => {
    const summary = mergeValidationResults("", "");
    expect(summary.criticalCount).toBe(0);
    expect(summary.moderateCount).toBe(0);
    expect(summary.minorCount).toBe(0);
    expect(summary.findings).toEqual([]);
  });

  test("returns ValidationSummary with all required fields", () => {
    const summary = mergeValidationResults("", "");
    expect(summary).toHaveProperty("criticalCount");
    expect(summary).toHaveProperty("moderateCount");
    expect(summary).toHaveProperty("minorCount");
    expect(summary).toHaveProperty("findings");
    expect(summary).toHaveProperty("critiqueRaw");
    expect(summary).toHaveProperty("screenshotRaw");
  });
});

// ============================================================================
// isValidationClean
// ============================================================================

describe("isValidationClean", () => {
  test("returns true when no critical findings", () => {
    const summary: ValidationSummary = {
      criticalCount: 0,
      moderateCount: 2,
      minorCount: 5,
      findings: [],
      critiqueRaw: "",
      screenshotRaw: "",
    };
    expect(isValidationClean(summary)).toBe(true);
  });

  test("returns false when there are critical findings", () => {
    const summary: ValidationSummary = {
      criticalCount: 1,
      moderateCount: 0,
      minorCount: 0,
      findings: [],
      critiqueRaw: "",
      screenshotRaw: "",
    };
    expect(isValidationClean(summary)).toBe(false);
  });

  test("returns true when all counts are zero", () => {
    const summary: ValidationSummary = {
      criticalCount: 0,
      moderateCount: 0,
      minorCount: 0,
      findings: [],
      critiqueRaw: "",
      screenshotRaw: "",
    };
    expect(isValidationClean(summary)).toBe(true);
  });

  test("moderate findings alone do not make validation unclean", () => {
    const summary: ValidationSummary = {
      criticalCount: 0,
      moderateCount: 10,
      minorCount: 0,
      findings: [],
      critiqueRaw: "",
      screenshotRaw: "",
    };
    expect(isValidationClean(summary)).toBe(true);
  });

  test("minor findings alone do not make validation unclean", () => {
    const summary: ValidationSummary = {
      criticalCount: 0,
      moderateCount: 0,
      minorCount: 10,
      findings: [],
      critiqueRaw: "",
      screenshotRaw: "",
    };
    expect(isValidationClean(summary)).toBe(true);
  });
});

// ============================================================================
// formatValidationForRefiner
// ============================================================================

describe("formatValidationForRefiner", () => {
  const makeSummary = (overrides: Partial<ValidationSummary> = {}): ValidationSummary => ({
    criticalCount: 0,
    moderateCount: 0,
    minorCount: 0,
    findings: [],
    critiqueRaw: "",
    screenshotRaw: "",
    ...overrides,
  });

  test("includes severity counts in output", () => {
    const summary = makeSummary({ criticalCount: 2, moderateCount: 3, minorCount: 1 });
    const formatted = formatValidationForRefiner(summary);
    expect(formatted).toContain("2 critical");
    expect(formatted).toContain("3 moderate");
    expect(formatted).toContain("1 minor");
  });

  test("returns a non-empty string", () => {
    const formatted = formatValidationForRefiner(makeSummary());
    expect(formatted.trim().length).toBeGreaterThan(0);
  });

  test("groups findings by severity with critical first", () => {
    const findings: ValidationFinding[] = [
      { severity: "minor", category: "Consistency", description: "Small spacing issue" },
      { severity: "critical", category: "Accessibility", description: "Missing alt text" },
      { severity: "moderate", category: "Usability", description: "CTA is unclear" },
    ];
    const summary = makeSummary({ findings, criticalCount: 1, moderateCount: 1, minorCount: 1 });
    const formatted = formatValidationForRefiner(summary);
    const criticalIndex = formatted.indexOf("critical");
    const moderateIndex = formatted.indexOf("moderate");
    const minorIndex = formatted.indexOf("minor");
    // critical should appear before moderate, moderate before minor
    expect(criticalIndex).toBeLessThan(moderateIndex);
    expect(moderateIndex).toBeLessThan(minorIndex);
  });

  test("includes raw critique excerpt when available", () => {
    const summary = makeSummary({ critiqueRaw: "Overall the design needs significant improvements." });
    const formatted = formatValidationForRefiner(summary);
    expect(formatted).toContain("Overall the design needs significant improvements.");
  });

  test("produces valid markdown output", () => {
    const summary = makeSummary({
      criticalCount: 1,
      findings: [{ severity: "critical", category: "Accessibility", description: "Missing alt text" }],
      critiqueRaw: "Some critique",
    });
    const formatted = formatValidationForRefiner(summary);
    // Should contain markdown headings
    expect(formatted).toMatch(/#/);
  });

  test("handles empty findings gracefully", () => {
    const summary = makeSummary({ findings: [] });
    expect(() => formatValidationForRefiner(summary)).not.toThrow();
  });
});
