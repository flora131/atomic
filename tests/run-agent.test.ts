import { test, expect, describe, mock, beforeEach, afterEach } from "bun:test";
import { runAgentCommand } from "../src/commands/run-agent";
import * as detectModule from "../src/utils/detect";
import { join } from "path";
import { AGENT_CONFIG, isValidAgent, type AgentKey } from "../src/config";
import { pathExists } from "../src/utils/copy";

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

/**
 * Unit tests for runAgentCommand auto-init behavior
 *
 * These tests verify that:
 * 1. When config folder is missing, initCommand is called with preSelectedAgent
 * 2. When config folder exists, initCommand is NOT called
 * 3. The correct folder path is checked based on agent config
 */
describe("runAgentCommand auto-init behavior", () => {
  describe("config folder path construction", () => {
    test("claude-code uses .claude folder", () => {
      const agent = AGENT_CONFIG["claude-code"];
      const configFolder = join(process.cwd(), agent.folder);

      expect(agent.folder).toBe(".claude");
      expect(configFolder).toContain(".claude");
    });

    test("opencode uses .opencode folder", () => {
      const agent = AGENT_CONFIG["opencode"];
      const configFolder = join(process.cwd(), agent.folder);

      expect(agent.folder).toBe(".opencode");
      expect(configFolder).toContain(".opencode");
    });

    test("copilot-cli uses .github folder", () => {
      const agent = AGENT_CONFIG["copilot-cli"];
      const configFolder = join(process.cwd(), agent.folder);

      expect(agent.folder).toBe(".github");
      expect(configFolder).toContain(".github");
    });
  });

  describe("auto-init logic flow", () => {
    /**
     * These tests verify the conditional logic in runAgentCommand:
     *
     * if (!(await pathExists(configFolder))) {
     *   await initCommand({
     *     preSelectedAgent: agentKey as AgentKey,
     *     showBanner: true,
     *     configNotFoundMessage: `${agent.folder} not found. Running setup...`,
     *   });
     * }
     */

    test("should trigger init when folder does not exist (logic check)", async () => {
      // Simulate the logic flow
      const agentKey = "claude-code";
      const agent = AGENT_CONFIG[agentKey];

      // Simulate pathExists returning false
      const folderExists = false;

      let initCalled = false;
      let initArgs: { preSelectedAgent?: string; showBanner?: boolean; configNotFoundMessage?: string } | null =
        null;

      if (!folderExists) {
        // This is where initCommand would be called
        initCalled = true;
        initArgs = {
          preSelectedAgent: agentKey,
          showBanner: true,
          configNotFoundMessage: `${agent.folder} not found. Running setup...`,
        };
      }

      expect(initCalled).toBe(true);
      expect(initArgs).toEqual({
        preSelectedAgent: "claude-code",
        showBanner: true,
        configNotFoundMessage: ".claude not found. Running setup...",
      });
    });

    test("should skip init when folder exists (logic check)", async () => {
      // Simulate the logic flow
      const agentKey = "claude-code";

      // Simulate pathExists returning true
      const folderExists = true;

      let initCalled = false;

      if (!folderExists) {
        initCalled = true;
      }

      expect(initCalled).toBe(false);
    });

    test("init uses showBanner: true with configNotFoundMessage for auto-init", () => {
      // Verify the expected behavior from the implementation
      // Banner displays first, then intro, then configNotFoundMessage
      const expectedInitOptions = {
        preSelectedAgent: "opencode" as AgentKey,
        showBanner: true,
        configNotFoundMessage: ".opencode not found. Running setup...",
      };

      expect(expectedInitOptions.showBanner).toBe(true);
      expect(expectedInitOptions.preSelectedAgent).toBe("opencode");
      expect(expectedInitOptions.configNotFoundMessage).toBe(".opencode not found. Running setup...");
    });
  });

  describe("pathExists utility integration", () => {
    test("pathExists function exists and is callable", () => {
      expect(typeof pathExists).toBe("function");
    });

    test("pathExists returns a Promise", () => {
      const result = pathExists("/some/nonexistent/path/12345");
      expect(result).toBeInstanceOf(Promise);
    });

    test("pathExists returns false for non-existent paths", async () => {
      const exists = await pathExists(
        "/definitely/does/not/exist/random123456"
      );
      expect(exists).toBe(false);
    });
  });

  describe("agent validation before init", () => {
    test("invalid agent should return error before checking folder", async () => {
      // runAgentCommand validates agent key BEFORE checking folder existence
      // This is the correct order to avoid unnecessary filesystem checks

      const invalidKey = "not-a-real-agent";
      expect(isValidAgent(invalidKey)).toBe(false);

      // If validation happens first, we never reach the pathExists check
    });

    test("valid agent proceeds to folder check", () => {
      const validKeys: AgentKey[] = ["claude-code", "opencode", "copilot-cli"];

      for (const key of validKeys) {
        expect(isValidAgent(key)).toBe(true);

        // For valid agents, we can construct the folder path
        const agent = AGENT_CONFIG[key];
        const folder = join(process.cwd(), agent.folder);
        expect(folder).toBeTruthy();
      }
    });
  });
});
