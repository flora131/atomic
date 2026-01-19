import { test, expect, describe, mock, beforeEach, afterEach } from "bun:test";
import { runAgentCommand } from "../src/commands/run-agent";
import * as detectModule from "../src/utils/detect";

describe("runAgentCommand", () => {
  let originalConsoleError: typeof console.error;
  let consoleErrorCalls: string[][];

  beforeEach(() => {
    // Capture console.error calls
    originalConsoleError = console.error;
    consoleErrorCalls = [];
    console.error = (...args: any[]) => {
      consoleErrorCalls.push(args.map(String));
    };
  });

  afterEach(() => {
    console.error = originalConsoleError;
  });

  test("returns error for invalid agent key", async () => {
    const exitCode = await runAgentCommand("invalid-agent");
    expect(exitCode).toBe(1);
    expect(consoleErrorCalls.length).toBeGreaterThan(0);
    expect(consoleErrorCalls[0]?.[0]).toContain("Unknown agent");
  });

  test("returns error for empty agent key", async () => {
    const exitCode = await runAgentCommand("");
    expect(exitCode).toBe(1);
    expect(consoleErrorCalls[0]?.[0]).toContain("Unknown agent");
  });

  test("validates agent key is case-sensitive", async () => {
    const exitCode = await runAgentCommand("Claude-Code");
    expect(exitCode).toBe(1);
    expect(consoleErrorCalls[0]?.[0]).toContain("Unknown agent");
  });

  test("lists valid agents in error message", async () => {
    await runAgentCommand("invalid");
    const allOutput = consoleErrorCalls.flat().join(" ");
    expect(allOutput).toContain("claude-code");
    expect(allOutput).toContain("opencode");
    expect(allOutput).toContain("copilot-cli");
  });
});
