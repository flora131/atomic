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
