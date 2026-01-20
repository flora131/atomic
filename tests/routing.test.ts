import { test, expect, describe } from "bun:test";
import { parseArgs } from "util";
import {
  detectMissingSeparatorArgs,
  extractAgentArgs,
  extractAgentName,
  isAgentRunMode,
  isInitWithSeparator,
} from "../src/utils/arg-parser";

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

    test("returns true when init appears after -- separator", () => {
      // init after -- is an agent argument, not a command
      expect(isAgentRunMode(["-a", "claude-code", "--", "init"])).toBe(true);
      expect(isAgentRunMode(["--agent", "opencode", "--", "init", "something"])).toBe(true);
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
    test("returns empty array when no -- separator present", () => {
      expect(extractAgentArgs(["-a", "claude-code"])).toEqual([]);
      expect(extractAgentArgs(["-a", "claude-code", "/commit"])).toEqual([]);
      expect(extractAgentArgs(["--agent", "opencode", "--resume"])).toEqual([]);
      expect(extractAgentArgs(["--help"])).toEqual([]);
    });

    test("extracts arguments after -- separator", () => {
      expect(extractAgentArgs(["-a", "claude-code", "--", "/commit"])).toEqual([
        "/commit",
      ]);
    });

    test("extracts multiple arguments after -- separator", () => {
      expect(
        extractAgentArgs(["-a", "claude-code", "--", "fix", "the", "bug"])
      ).toEqual(["fix", "the", "bug"]);
    });

    test("works with --agent flag and separator", () => {
      expect(
        extractAgentArgs(["--agent", "opencode", "--", "--resume"])
      ).toEqual(["--resume"]);
    });

    test("works with --agent=name syntax and separator", () => {
      expect(
        extractAgentArgs(["--agent=claude-code", "--", "/commit"])
      ).toEqual(["/commit"]);
    });

    test("works with -a=name syntax and separator", () => {
      expect(extractAgentArgs(["-a=opencode", "--", "--resume"])).toEqual([
        "--resume",
      ]);
    });

    test("returns empty array when separator present but no args after", () => {
      expect(extractAgentArgs(["-a", "claude-code", "--"])).toEqual([]);
    });

    test("preserves flags meant for the agent after separator", () => {
      expect(extractAgentArgs(["-a", "claude-code", "--", "--help"])).toEqual([
        "--help",
      ]);
      expect(extractAgentArgs(["-a", "claude-code", "--", "-v"])).toEqual([
        "-v",
      ]);
      expect(
        extractAgentArgs(["-a", "opencode", "--", "--no-banner", "--resume"])
      ).toEqual(["--no-banner", "--resume"]);
    });

    test("handles prompt strings with spaces after separator", () => {
      expect(
        extractAgentArgs(["-a", "claude-code", "--", "fix the bug in auth"])
      ).toEqual(["fix the bug in auth"]);
    });

    test("ignores args before separator", () => {
      // Args before -- are ignored, only args after are passed to agent
      expect(
        extractAgentArgs(["-a", "claude-code", "ignored", "--", "--resume"])
      ).toEqual(["--resume"]);
    });

    test("disambiguates atomic flags from agent flags", () => {
      // -v after -- goes to agent, not interpreted as atomic's version flag
      expect(extractAgentArgs(["-a", "claude-code", "--", "-v"])).toEqual([
        "-v",
      ]);
      // --help after -- goes to agent
      expect(extractAgentArgs(["-a", "claude-code", "--", "--help"])).toEqual([
        "--help",
      ]);
    });
  });

  describe("extractAgentName edge cases", () => {
    test("returns undefined when -a flag has no value", () => {
      expect(extractAgentName(["-a"])).toBeUndefined();
    });

    test("returns undefined when --agent flag has no value", () => {
      expect(extractAgentName(["--agent"])).toBeUndefined();
    });

    test("returns undefined for --agent= with no value", () => {
      expect(extractAgentName(["--agent="])).toBeUndefined();
    });

    test("returns undefined for -a= with no value", () => {
      expect(extractAgentName(["-a="])).toBeUndefined();
    });

    test("returns undefined when next arg is the -- separator", () => {
      // The separator should not be treated as an agent name
      expect(extractAgentName(["-a", "--"])).toBeUndefined();
      expect(extractAgentName(["--agent", "--", "/commit"])).toBeUndefined();
    });
  });

  describe("detectMissingSeparatorArgs", () => {
    test("returns empty array when -- separator is present", () => {
      expect(
        detectMissingSeparatorArgs(["-a", "claude-code", "--", "/commit"])
      ).toEqual([]);
      expect(
        detectMissingSeparatorArgs(["-a", "claude-code", "--", "--help"])
      ).toEqual([]);
      expect(
        detectMissingSeparatorArgs(["--agent", "opencode", "--", "--resume"])
      ).toEqual([]);
    });

    test("detects slash commands without separator", () => {
      expect(
        detectMissingSeparatorArgs(["-a", "claude-code", "/commit"])
      ).toEqual(["/commit"]);
      expect(
        detectMissingSeparatorArgs(["-a", "claude-code", "/research-codebase"])
      ).toEqual(["/research-codebase"]);
    });

    test("detects flags without separator", () => {
      expect(
        detectMissingSeparatorArgs(["-a", "claude-code", "--resume"])
      ).toEqual(["--resume"]);
      expect(
        detectMissingSeparatorArgs(["--agent", "opencode", "-p"])
      ).toEqual(["-p"]);
    });

    test("detects prompts without separator", () => {
      expect(
        detectMissingSeparatorArgs(["-a", "claude-code", "fix the bug"])
      ).toEqual(["fix the bug"]);
    });

    test("detects multiple args without separator", () => {
      expect(
        detectMissingSeparatorArgs([
          "-a",
          "claude-code",
          "/research-codebase",
          "my question",
        ])
      ).toEqual(["/research-codebase", "my question"]);
    });

    test("returns empty array when no args after agent name", () => {
      expect(detectMissingSeparatorArgs(["-a", "claude-code"])).toEqual([]);
      expect(detectMissingSeparatorArgs(["--agent", "opencode"])).toEqual([]);
      expect(detectMissingSeparatorArgs(["--agent=copilot-cli"])).toEqual([]);
    });

    test("ignores atomic's own flags", () => {
      expect(
        detectMissingSeparatorArgs(["-a", "claude-code", "--no-banner"])
      ).toEqual([]);
      expect(
        detectMissingSeparatorArgs(["--no-banner", "-a", "claude-code"])
      ).toEqual([]);
    });

    test("works with --agent=name syntax", () => {
      expect(
        detectMissingSeparatorArgs(["--agent=claude-code", "/commit"])
      ).toEqual(["/commit"]);
    });

    test("works with -a=name syntax", () => {
      expect(detectMissingSeparatorArgs(["-a=opencode", "--resume"])).toEqual([
        "--resume",
      ]);
    });

    test("returns empty when no agent flag present", () => {
      expect(detectMissingSeparatorArgs(["--help"])).toEqual([]);
      expect(detectMissingSeparatorArgs(["--version"])).toEqual([]);
      expect(detectMissingSeparatorArgs([])).toEqual([]);
    });
  });

  describe("isInitWithSeparator", () => {
    test("returns true when init is used with -- separator", () => {
      expect(
        isInitWithSeparator(["init", "-a", "claude-code", "--", "/commit"])
      ).toBe(true);
      expect(
        isInitWithSeparator(["init", "--agent", "opencode", "--", "--resume"])
      ).toBe(true);
      expect(
        isInitWithSeparator(["init", "--", "some prompt"])
      ).toBe(true);
    });

    test("returns false when init is used without -- separator", () => {
      expect(isInitWithSeparator(["init"])).toBe(false);
      expect(isInitWithSeparator(["init", "-a", "claude-code"])).toBe(false);
      expect(isInitWithSeparator(["init", "--agent", "opencode"])).toBe(false);
    });

    test("returns false when -- is used without init (run mode)", () => {
      expect(
        isInitWithSeparator(["-a", "claude-code", "--", "/commit"])
      ).toBe(false);
      expect(
        isInitWithSeparator(["--agent", "opencode", "--", "--resume"])
      ).toBe(false);
    });

    test("returns false when init appears only after -- separator", () => {
      // init after -- is an agent argument, not a command
      expect(isInitWithSeparator(["-a", "claude-code", "--", "init"])).toBe(false);
      expect(isInitWithSeparator(["--agent", "opencode", "--", "init", "something"])).toBe(false);
    });

    test("returns false when neither init nor -- is present", () => {
      expect(isInitWithSeparator([])).toBe(false);
      expect(isInitWithSeparator(["--help"])).toBe(false);
      expect(isInitWithSeparator(["-a", "claude-code"])).toBe(false);
    });
  });
});
