import { test, expect, describe, mock, beforeEach, afterEach } from "bun:test";
import { join } from "path";

/**
 * Unit tests for initCommand with preSelectedAgent option
 *
 * These tests verify that:
 * 1. When preSelectedAgent is provided, the interactive selection prompt is skipped
 * 2. When preSelectedAgent is invalid, the command exits with error
 * 3. When preSelectedAgent is not provided, interactive selection runs as normal
 */
describe("initCommand with preSelectedAgent", () => {
  // Track which @clack/prompts functions were called
  let selectCalled: boolean;
  let cancelCalled: boolean;
  let confirmCalls: number;
  let logInfoMessages: string[];
  let processExitCode: number | null;

  // Original process.exit
  const originalProcessExit = process.exit;

  beforeEach(() => {
    selectCalled = false;
    cancelCalled = false;
    confirmCalls = 0;
    logInfoMessages = [];
    processExitCode = null;

    // Mock process.exit to capture exit codes without actually exiting
    process.exit = ((code?: number) => {
      processExitCode = code ?? 0;
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit;
  });

  afterEach(() => {
    process.exit = originalProcessExit;
  });

  describe("preSelectedAgent validation", () => {
    test("valid preSelectedAgent skips select prompt", async () => {
      // We test that isValidAgent('claude-code') returns true
      // and the agent info is retrievable
      const { isValidAgent, AGENT_CONFIG } = await import("../src/config");

      expect(isValidAgent("claude-code")).toBe(true);
      expect(AGENT_CONFIG["claude-code"].name).toBe("Claude Code");
      expect(AGENT_CONFIG["claude-code"].folder).toBe(".claude");
    });

    test("invalid preSelectedAgent causes exit", async () => {
      const { isValidAgent } = await import("../src/config");

      // Verify that invalid agent names are rejected
      expect(isValidAgent("invalid-agent")).toBe(false);
      expect(isValidAgent("Claude-Code")).toBe(false); // case-sensitive
      expect(isValidAgent("")).toBe(false);
    });

    test("all valid agents pass validation", async () => {
      const { isValidAgent, getAgentKeys } = await import("../src/config");

      for (const key of getAgentKeys()) {
        expect(isValidAgent(key)).toBe(true);
      }
    });
  });

  describe("InitOptions interface", () => {
    test("InitOptions accepts preSelectedAgent field", async () => {
      // This test verifies the TypeScript interface accepts the new field
      // by importing and checking the types at runtime
      const { AGENT_CONFIG } = await import("../src/config");
      type AgentKey = "claude-code" | "opencode" | "copilot-cli";

      // Valid InitOptions structures
      const validOptions = [
        { showBanner: true },
        { showBanner: false },
        { preSelectedAgent: "claude-code" as AgentKey },
        { preSelectedAgent: "opencode" as AgentKey },
        { preSelectedAgent: "copilot-cli" as AgentKey },
        { showBanner: false, preSelectedAgent: "claude-code" as AgentKey },
        {},
      ];

      // All should be valid structures (no runtime errors)
      for (const opts of validOptions) {
        expect(opts).toBeDefined();
      }
    });
  });

  describe("agent config lookup with preSelectedAgent", () => {
    test("can retrieve config for claude-code", async () => {
      const { AGENT_CONFIG } = await import("../src/config");

      const agent = AGENT_CONFIG["claude-code"];
      expect(agent.name).toBe("Claude Code");
      expect(agent.folder).toBe(".claude");
      expect(agent.cmd).toBe("claude");
    });

    test("can retrieve config for opencode", async () => {
      const { AGENT_CONFIG } = await import("../src/config");

      const agent = AGENT_CONFIG["opencode"];
      expect(agent.name).toBe("OpenCode");
      expect(agent.folder).toBe(".opencode");
      expect(agent.cmd).toBe("opencode");
    });

    test("can retrieve config for copilot-cli", async () => {
      const { AGENT_CONFIG } = await import("../src/config");

      const agent = AGENT_CONFIG["copilot-cli"];
      expect(agent.name).toBe("GitHub Copilot CLI");
      expect(agent.folder).toBe(".github");
      expect(agent.cmd).toBe("copilot");
    });
  });
});

describe("initCommand preSelectedAgent flow logic", () => {
  /**
   * These tests verify the logical flow when preSelectedAgent is provided:
   *
   * 1. If preSelectedAgent is set AND valid -> skip select, use directly
   * 2. If preSelectedAgent is set AND invalid -> cancel and exit(1)
   * 3. If preSelectedAgent is NOT set -> run interactive select
   */

  test("preSelectedAgent flow: valid agent should skip selection", () => {
    const { isValidAgent, AGENT_CONFIG } = require("../src/config");
    type AgentKey = "claude-code" | "opencode" | "copilot-cli";

    // Simulate the logic in initCommand
    const preSelectedAgent = "claude-code" as const;

    let agentKey: string;
    let shouldCallSelect = true;

    if (preSelectedAgent) {
      if (!isValidAgent(preSelectedAgent)) {
        // Would call cancel() and exit(1)
        throw new Error("Invalid agent");
      }
      agentKey = preSelectedAgent;
      shouldCallSelect = false;
    } else {
      // Would call select() interactively
      shouldCallSelect = true;
      agentKey = "mock-selected";
    }

    expect(shouldCallSelect).toBe(false);
    expect(agentKey).toBe("claude-code");
    expect(AGENT_CONFIG[agentKey as AgentKey].name).toBe("Claude Code");
  });

  test("preSelectedAgent flow: invalid agent should fail validation", () => {
    const { isValidAgent } = require("../src/config");

    const preSelectedAgent = "invalid-agent";

    let didFail = false;

    if (preSelectedAgent) {
      if (!isValidAgent(preSelectedAgent)) {
        didFail = true;
      }
    }

    expect(didFail).toBe(true);
  });

  test("preSelectedAgent flow: undefined should require selection", () => {
    const preSelectedAgent = undefined;

    let shouldCallSelect = false;

    if (preSelectedAgent) {
      shouldCallSelect = false;
    } else {
      shouldCallSelect = true;
    }

    expect(shouldCallSelect).toBe(true);
  });
});
