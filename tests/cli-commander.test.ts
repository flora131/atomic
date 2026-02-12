import { describe, test, expect, beforeEach, mock, spyOn } from "bun:test";
import { createProgram } from "../src/cli";
import { AGENT_CONFIG, isValidAgent } from "../src/config";

/**
 * Unit tests for the new Commander.js CLI implementation
 * Tests command parsing, option handling, and validation
 */
describe("Commander.js CLI", () => {
  describe("createProgram", () => {
    test("creates a program with correct metadata", () => {
      const program = createProgram();
      expect(program.name()).toBe("atomic");
      expect(program.description()).toBe("Configuration management CLI for coding agents");
    });

    test("program has expected commands", () => {
      const program = createProgram();
      const commands = program.commands.map(cmd => cmd.name());

      expect(commands).toContain("init");
      expect(commands).toContain("chat");
      expect(commands).toContain("config");
      expect(commands).toContain("update");
      expect(commands).toContain("uninstall");
    });
  });

  describe("Global options", () => {
    test("has --force option", () => {
      const program = createProgram();
      const forceOption = program.options.find(opt => opt.long === "--force");
      expect(forceOption).toBeDefined();
      expect(forceOption?.short).toBe("-f");
    });

    test("has --yes option", () => {
      const program = createProgram();
      const yesOption = program.options.find(opt => opt.long === "--yes");
      expect(yesOption).toBeDefined();
      expect(yesOption?.short).toBe("-y");
    });

    test("has --no-banner option", () => {
      const program = createProgram();
      const noBannerOption = program.options.find(opt => opt.long === "--no-banner");
      expect(noBannerOption).toBeDefined();
    });

    test("has hidden upload-telemetry command", () => {
      const program = createProgram();
      const telemetryCmd = program.commands.find(cmd => cmd.name() === "upload-telemetry");
      expect(telemetryCmd).toBeDefined();
      // Commander.js sets _hidden when { hidden: true } is passed to .command()
      expect((telemetryCmd as any)._hidden).toBe(true);
    });

    test("has --version option", () => {
      const program = createProgram();
      const versionOption = program.options.find(opt => opt.long === "--version");
      expect(versionOption).toBeDefined();
      expect(versionOption?.short).toBe("-v");
    });
  });

  describe("init command", () => {
    test("init command is the default command", () => {
      const program = createProgram();
      const initCmd = program.commands.find(cmd => cmd.name() === "init");
      expect(initCmd).toBeDefined();
      // Check that it's marked as default by checking the raw command config
      // Commander.js sets _defaultCommandName on the parent program
      expect((program as any)._defaultCommandName).toBe("init");
    });

    test("init command has -a/--agent option", () => {
      const program = createProgram();
      const initCmd = program.commands.find(cmd => cmd.name() === "init");
      expect(initCmd).toBeDefined();

      const agentOption = initCmd?.options.find(opt => opt.long === "--agent");
      expect(agentOption).toBeDefined();
      expect(agentOption?.short).toBe("-a");
    });

    test("init command shows available agents in help", () => {
      const program = createProgram();
      const initCmd = program.commands.find(cmd => cmd.name() === "init");
      const agentOption = initCmd?.options.find(opt => opt.long === "--agent");

      // Check that the description includes agent names
      const agentNames = Object.keys(AGENT_CONFIG);
      for (const agent of agentNames) {
        expect(agentOption?.description).toContain(agent);
      }
    });
  });

  describe("config command", () => {
    test("config command has set subcommand", () => {
      const program = createProgram();
      const configCmd = program.commands.find(cmd => cmd.name() === "config");
      expect(configCmd).toBeDefined();

      const setCmd = configCmd?.commands.find(cmd => cmd.name() === "set");
      expect(setCmd).toBeDefined();
    });

    test("config set has key and value arguments", () => {
      const program = createProgram();
      const configCmd = program.commands.find(cmd => cmd.name() === "config");
      const setCmd = configCmd?.commands.find(cmd => cmd.name() === "set");

      const args = (setCmd as any)._args;
      expect(args.length).toBe(2);
      expect(args[0].name()).toBe("key");
      expect(args[1].name()).toBe("value");
    });
  });

  describe("uninstall command", () => {
    test("uninstall command has --dry-run option", () => {
      const program = createProgram();
      const uninstallCmd = program.commands.find(cmd => cmd.name() === "uninstall");
      expect(uninstallCmd).toBeDefined();

      const dryRunOption = uninstallCmd?.options.find(opt => opt.long === "--dry-run");
      expect(dryRunOption).toBeDefined();
    });

    test("uninstall command has --keep-config option", () => {
      const program = createProgram();
      const uninstallCmd = program.commands.find(cmd => cmd.name() === "uninstall");

      const keepConfigOption = uninstallCmd?.options.find(opt => opt.long === "--keep-config");
      expect(keepConfigOption).toBeDefined();
    });
  });

  describe("Agent validation", () => {
    test("isValidAgent returns true for known agents", () => {
      expect(isValidAgent("claude")).toBe(true);
      expect(isValidAgent("opencode")).toBe(true);
      expect(isValidAgent("copilot")).toBe(true);
    });

    test("isValidAgent returns false for unknown agents", () => {
      expect(isValidAgent("unknown")).toBe(false);
      expect(isValidAgent("invalid")).toBe(false);
      expect(isValidAgent("")).toBe(false);
    });

    test("AGENT_CONFIG contains expected agents", () => {
      expect(AGENT_CONFIG).toHaveProperty("claude");
      expect(AGENT_CONFIG).toHaveProperty("opencode");
      expect(AGENT_CONFIG).toHaveProperty("copilot");
    });
  });
});
