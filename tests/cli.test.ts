import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { AGENT_CONFIG } from "../src/config";
import { VERSION } from "../src/version";

describe("CLI argument parsing", () => {
  let originalArgv: string[];
  let originalConsoleLog: typeof console.log;
  let consoleLogCalls: string[][];

  beforeEach(() => {
    originalArgv = [...Bun.argv];
    originalConsoleLog = console.log;
    consoleLogCalls = [];
    console.log = (...args: any[]) => {
      consoleLogCalls.push(args.map(String));
    };
  });

  afterEach(() => {
    // Restore Bun.argv is not possible as it's read-only
    // But tests are isolated by design
    console.log = originalConsoleLog;
  });

  test("VERSION is defined and follows semver pattern", () => {
    expect(VERSION).toBeDefined();
    expect(typeof VERSION).toBe("string");
    // Should be semver format: x.y.z
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("AGENT_CONFIG has all expected agent keys", () => {
    const keys = Object.keys(AGENT_CONFIG);
    expect(keys).toContain("claude-code");
    expect(keys).toContain("opencode");
    expect(keys).toContain("copilot-cli");
  });
});

describe("CLI help content", () => {
  test("each agent has a command defined", () => {
    for (const [key, config] of Object.entries(AGENT_CONFIG)) {
      expect(config.cmd).toBeDefined();
      expect(config.cmd.length).toBeGreaterThan(0);
    }
  });

  test("each agent has a valid install URL", () => {
    for (const [key, config] of Object.entries(AGENT_CONFIG)) {
      expect(config.install_url).toMatch(/^https:\/\//);
    }
  });

  test("each agent has additional_flags as array", () => {
    for (const [key, config] of Object.entries(AGENT_CONFIG)) {
      expect(Array.isArray(config.additional_flags)).toBe(true);
    }
  });
});
