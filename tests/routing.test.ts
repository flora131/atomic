import { test, expect, describe } from "bun:test";
import { parseArgs } from "util";

/**
 * Integration tests for CLI argument parsing with init subcommand
 * Tests that the parseArgs configuration properly handles various command forms
 */
describe("CLI routing argument parsing", () => {
  // Test helper that mimics the parsing in src/index.ts
  function parseCliArgs(args: string[]) {
    return parseArgs({
      args,
      options: {
        agent: { type: "string", short: "a" },
        version: { type: "boolean", short: "v" },
        help: { type: "boolean", short: "h" },
        "no-banner": { type: "boolean" },
      },
      strict: false,
      allowPositionals: true,
    });
  }

  describe("init subcommand with --agent flag", () => {
    test("parses 'init --agent claude-code' correctly", () => {
      const { values, positionals } = parseCliArgs([
        "init",
        "--agent",
        "claude-code",
      ]);

      expect(positionals[0]).toBe("init");
      expect(values.agent).toBe("claude-code");
    });

    test("parses 'init -a claude-code' correctly (short form)", () => {
      const { values, positionals } = parseCliArgs([
        "init",
        "-a",
        "claude-code",
      ]);

      expect(positionals[0]).toBe("init");
      expect(values.agent).toBe("claude-code");
    });

    test("parses 'init --agent opencode' correctly", () => {
      const { values, positionals } = parseCliArgs([
        "init",
        "--agent",
        "opencode",
      ]);

      expect(positionals[0]).toBe("init");
      expect(values.agent).toBe("opencode");
    });

    test("parses 'init -a copilot-cli' correctly (short form)", () => {
      const { values, positionals } = parseCliArgs([
        "init",
        "-a",
        "copilot-cli",
      ]);

      expect(positionals[0]).toBe("init");
      expect(values.agent).toBe("copilot-cli");
    });

    test("parses 'init --no-banner --agent claude-code' with multiple flags", () => {
      const { values, positionals } = parseCliArgs([
        "init",
        "--no-banner",
        "--agent",
        "claude-code",
      ]);

      expect(positionals[0]).toBe("init");
      expect(values.agent).toBe("claude-code");
      expect(values["no-banner"]).toBe(true);
    });
  });

  describe("standalone --agent flag (without init)", () => {
    test("parses '--agent claude-code' without init", () => {
      const { values, positionals } = parseCliArgs(["--agent", "claude-code"]);

      expect(positionals[0]).toBeUndefined();
      expect(values.agent).toBe("claude-code");
    });

    test("parses '-a claude-code' without init (short form)", () => {
      const { values, positionals } = parseCliArgs(["-a", "claude-code"]);

      expect(positionals[0]).toBeUndefined();
      expect(values.agent).toBe("claude-code");
    });

    test("parses '-a opencode' without init (short form)", () => {
      const { values, positionals } = parseCliArgs(["-a", "opencode"]);

      expect(positionals[0]).toBeUndefined();
      expect(values.agent).toBe("opencode");
    });
  });

  describe("no positional command (default init)", () => {
    test("parses empty args as no command", () => {
      const { values, positionals } = parseCliArgs([]);

      expect(positionals[0]).toBeUndefined();
      expect(values.agent).toBeUndefined();
    });

    test("parses '--no-banner' alone", () => {
      const { values, positionals } = parseCliArgs(["--no-banner"]);

      expect(positionals[0]).toBeUndefined();
      expect(values["no-banner"]).toBe(true);
    });
  });

  describe("help and version flags", () => {
    test("parses '--help' flag", () => {
      const { values } = parseCliArgs(["--help"]);
      expect(values.help).toBe(true);
    });

    test("parses '-h' flag (short form)", () => {
      const { values } = parseCliArgs(["-h"]);
      expect(values.help).toBe(true);
    });

    test("parses '--version' flag", () => {
      const { values } = parseCliArgs(["--version"]);
      expect(values.version).toBe(true);
    });

    test("parses '-v' flag (short form)", () => {
      const { values } = parseCliArgs(["-v"]);
      expect(values.version).toBe(true);
    });
  });
});

/**
 * Tests for agent argument passthrough functionality
 * These test the helper functions that enable passing arguments to agents
 */
describe("Agent argument passthrough", () => {
  // Helper functions copied from src/index.ts for testing
  function isAgentRunMode(args: string[]): boolean {
    let hasAgent = false;
    let hasInit = false;

    for (const arg of args) {
      if (arg === "init") {
        hasInit = true;
      }
      if (
        arg === "-a" ||
        arg === "--agent" ||
        arg.startsWith("--agent=") ||
        arg.startsWith("-a=")
      ) {
        hasAgent = true;
      }
    }

    return hasAgent && !hasInit;
  }

  function extractAgentName(args: string[]): string | undefined {
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === undefined) continue;

      if (arg === "-a" || arg === "--agent") {
        return args[i + 1];
      }
      if (arg.startsWith("--agent=")) {
        return arg.slice(8);
      }
      if (arg.startsWith("-a=")) {
        return arg.slice(3);
      }
    }

    return undefined;
  }

  function extractAgentArgs(args: string[]): string[] {
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === undefined) continue;

      if (arg === "-a" || arg === "--agent") {
        return args.slice(i + 2);
      }
      if (arg.startsWith("--agent=") || arg.startsWith("-a=")) {
        return args.slice(i + 1);
      }
    }

    return [];
  }

  describe("isAgentRunMode", () => {
    test("returns true for -a with agent name", () => {
      expect(isAgentRunMode(["-a", "claude-code"])).toBe(true);
    });

    test("returns true for --agent with agent name", () => {
      expect(isAgentRunMode(["--agent", "claude-code"])).toBe(true);
    });

    test("returns true for --agent=agent-name syntax", () => {
      expect(isAgentRunMode(["--agent=claude-code"])).toBe(true);
    });

    test("returns true for -a=agent-name syntax", () => {
      expect(isAgentRunMode(["-a=opencode"])).toBe(true);
    });

    test("returns false when init command is present", () => {
      expect(isAgentRunMode(["init", "-a", "claude-code"])).toBe(false);
    });

    test("returns false when no agent flag is present", () => {
      expect(isAgentRunMode(["--help"])).toBe(false);
      expect(isAgentRunMode(["--version"])).toBe(false);
      expect(isAgentRunMode([])).toBe(false);
    });

    test("returns true with additional arguments after agent", () => {
      expect(isAgentRunMode(["-a", "claude-code", "/commit"])).toBe(true);
      expect(isAgentRunMode(["-a", "claude-code", "--help"])).toBe(true);
    });
  });

  describe("extractAgentName", () => {
    test("extracts name from -a flag", () => {
      expect(extractAgentName(["-a", "claude-code"])).toBe("claude-code");
      expect(extractAgentName(["-a", "opencode", "--resume"])).toBe("opencode");
    });

    test("extracts name from --agent flag", () => {
      expect(extractAgentName(["--agent", "copilot-cli"])).toBe("copilot-cli");
    });

    test("extracts name from --agent=name syntax", () => {
      expect(extractAgentName(["--agent=claude-code"])).toBe("claude-code");
    });

    test("extracts name from -a=name syntax", () => {
      expect(extractAgentName(["-a=opencode"])).toBe("opencode");
    });

    test("returns undefined when no agent flag present", () => {
      expect(extractAgentName(["--help"])).toBeUndefined();
      expect(extractAgentName([])).toBeUndefined();
    });
  });

  describe("extractAgentArgs", () => {
    test("extracts arguments after -a agent", () => {
      expect(extractAgentArgs(["-a", "claude-code", "/commit"])).toEqual([
        "/commit",
      ]);
      expect(
        extractAgentArgs(["-a", "claude-code", "fix", "the", "bug"])
      ).toEqual(["fix", "the", "bug"]);
    });

    test("extracts arguments after --agent agent", () => {
      expect(extractAgentArgs(["--agent", "opencode", "--resume"])).toEqual([
        "--resume",
      ]);
    });

    test("extracts arguments after --agent=agent syntax", () => {
      expect(extractAgentArgs(["--agent=claude-code", "/commit"])).toEqual([
        "/commit",
      ]);
    });

    test("extracts arguments after -a=agent syntax", () => {
      expect(extractAgentArgs(["-a=opencode", "--resume"])).toEqual([
        "--resume",
      ]);
    });

    test("returns empty array when no args after agent", () => {
      expect(extractAgentArgs(["-a", "claude-code"])).toEqual([]);
    });

    test("returns empty array when no agent flag present", () => {
      expect(extractAgentArgs(["--help"])).toEqual([]);
    });

    test("preserves flags meant for the agent", () => {
      expect(extractAgentArgs(["-a", "claude-code", "--help"])).toEqual([
        "--help",
      ]);
      expect(extractAgentArgs(["-a", "claude-code", "-v"])).toEqual(["-v"]);
      expect(
        extractAgentArgs(["-a", "opencode", "--no-banner", "--resume"])
      ).toEqual(["--no-banner", "--resume"]);
    });

    test("handles prompt strings with spaces", () => {
      expect(
        extractAgentArgs(["-a", "claude-code", "fix the bug in auth"])
      ).toEqual(["fix the bug in auth"]);
    });
  });
});
