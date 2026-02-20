import { describe, expect, test } from "bun:test";

import {
  resolveCopilotUserInputSessionId,
  parseCopilotChoice,
  deriveCopilotHeader,
} from "./copilot.ts";

describe("resolveCopilotUserInputSessionId", () => {
  test("keeps preferred session when it is active", () => {
    const resolved = resolveCopilotUserInputSessionId("copilot_123", [
      "copilot_001",
      "copilot_123",
    ]);

    expect(resolved).toBe("copilot_123");
  });

  test("falls back to latest active session when preferred is unknown", () => {
    const resolved = resolveCopilotUserInputSessionId("tentative_session", [
      "copilot_001",
      "copilot_002",
    ]);

    expect(resolved).toBe("copilot_002");
  });

  test("returns preferred session when no active sessions exist", () => {
    const resolved = resolveCopilotUserInputSessionId("tentative_session", []);

    expect(resolved).toBe("tentative_session");
  });
});

describe("parseCopilotChoice", () => {
  test("extracts label and description from dash-separated choice", () => {
    const result = parseCopilotChoice("Blue - A cool, calming color");
    expect(result).toEqual({
      label: "Blue",
      value: "Blue - A cool, calming color",
      description: "A cool, calming color",
    });
  });

  test("extracts label and description from colon-separated choice", () => {
    const result = parseCopilotChoice("TypeScript: Strongly typed JavaScript");
    expect(result).toEqual({
      label: "TypeScript",
      value: "TypeScript: Strongly typed JavaScript",
      description: "Strongly typed JavaScript",
    });
  });

  test("returns plain label when no separator is found", () => {
    const result = parseCopilotChoice("Yes");
    expect(result).toEqual({ label: "Yes", value: "Yes" });
  });

  test("returns plain label for short strings with a dash", () => {
    // Dash at position 0 should not split
    const result = parseCopilotChoice("- something");
    expect(result).toEqual({ label: "- something", value: "- something" });
  });

  test("handles whitespace-only descriptions gracefully", () => {
    // "A - " has an empty description after trimming
    const result = parseCopilotChoice("A -  ");
    expect(result).toEqual({ label: "A -", value: "A -  " });
  });

  test("preserves original choice string as value", () => {
    const original = "Option A - The first option";
    const result = parseCopilotChoice(original);
    expect(result.value).toBe(original);
  });

  test("prefers dash separator over colon when both are present", () => {
    const result = parseCopilotChoice("Mode: Fast - Uses parallel execution");
    expect(result).toEqual({
      label: "Mode: Fast",
      value: "Mode: Fast - Uses parallel execution",
      description: "Uses parallel execution",
    });
  });
});

describe("deriveCopilotHeader", () => {
  test("returns short questions as-is", () => {
    expect(deriveCopilotHeader("Pick a color")).toBe("Pick a color");
  });

  test("extracts topic from 'favorite' pattern", () => {
    expect(deriveCopilotHeader("What is your favorite color?")).toBe("Color");
  });

  test("extracts topic from 'which...should' pattern", () => {
    expect(deriveCopilotHeader("Which framework should we use for this project?")).toBe("Framework");
  });

  test("extracts topic from 'preferred' pattern", () => {
    expect(deriveCopilotHeader("What is your preferred language?")).toBe("Language");
  });

  test("falls back to first few words for long unrecognized questions", () => {
    const result = deriveCopilotHeader("Please tell me about the deployment strategy you would recommend for production");
    expect(result.length).toBeLessThanOrEqual(25);
    expect(result.length).toBeGreaterThan(0);
  });

  test("returns 'Question' for empty input", () => {
    expect(deriveCopilotHeader("")).toBe("Question");
    expect(deriveCopilotHeader("   ")).toBe("Question");
  });

  test("strips trailing question marks", () => {
    expect(deriveCopilotHeader("Pick a color???")).toBe("Pick a color");
  });
});
