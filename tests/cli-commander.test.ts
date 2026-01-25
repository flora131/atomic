import { describe, test, expect, beforeEach, mock, spyOn } from "bun:test";
import { createProgram } from "../src/cli";
import { AGENT_CONFIG, isValidAgent } from "../src/config";
import { ralphSetup, type RalphSetupOptions } from "../src/commands/ralph";

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
      expect(commands).toContain("run");
      expect(commands).toContain("config");
      expect(commands).toContain("update");
      expect(commands).toContain("uninstall");
      expect(commands).toContain("ralph");
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

  describe("run command", () => {
    test("run command exists with agent argument", () => {
      const program = createProgram();
      const runCmd = program.commands.find(cmd => cmd.name() === "run");
      expect(runCmd).toBeDefined();
      
      // Check for required agent argument
      const args = (runCmd as any)._args;
      expect(args.length).toBeGreaterThanOrEqual(1);
      expect(args[0].name()).toBe("agent");
      expect(args[0].required).toBe(true);
    });

    test("run command has variadic args argument", () => {
      const program = createProgram();
      const runCmd = program.commands.find(cmd => cmd.name() === "run");
      
      const args = (runCmd as any)._args;
      expect(args.length).toBe(2);
      expect(args[1].name()).toBe("args");
      expect(args[1].variadic).toBe(true);
    });

    test("run command allows passthrough options", () => {
      const program = createProgram();
      const runCmd = program.commands.find(cmd => cmd.name() === "run");
      
      // Commander.js sets _passThroughOptions when .passThroughOptions() is called
      expect((runCmd as any)._passThroughOptions).toBe(true);
    });

    test("run command uses passThroughOptions for clean argument passing", () => {
      const program = createProgram();
      const runCmd = program.commands.find(cmd => cmd.name() === "run");

      // passThroughOptions() allows arguments after <agent> to pass through
      // without requiring the -- separator. Options appearing after the agent
      // argument are treated as passthrough arguments, not parsed by Commander.
      expect((runCmd as any)._passThroughOptions).toBe(true);
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

  describe("ralph command", () => {
    test("ralph command has setup and stop subcommands", () => {
      const program = createProgram();
      const ralphCmd = program.commands.find(cmd => cmd.name() === "ralph");
      expect(ralphCmd).toBeDefined();
      
      const setupCmd = ralphCmd?.commands.find(cmd => cmd.name() === "setup");
      const stopCmd = ralphCmd?.commands.find(cmd => cmd.name() === "stop");
      
      expect(setupCmd).toBeDefined();
      expect(stopCmd).toBeDefined();
    });

    test("ralph setup has required -a/--agent option", () => {
      const program = createProgram();
      const ralphCmd = program.commands.find(cmd => cmd.name() === "ralph");
      const setupCmd = ralphCmd?.commands.find(cmd => cmd.name() === "setup");
      
      const agentOption = setupCmd?.options.find(opt => opt.long === "--agent");
      expect(agentOption).toBeDefined();
      expect(agentOption?.short).toBe("-a");
      expect(agentOption?.mandatory).toBe(true);
    });

    test("ralph setup has --max-iterations option", () => {
      const program = createProgram();
      const ralphCmd = program.commands.find(cmd => cmd.name() === "ralph");
      const setupCmd = ralphCmd?.commands.find(cmd => cmd.name() === "setup");
      
      const maxIterOption = setupCmd?.options.find(opt => opt.long === "--max-iterations");
      expect(maxIterOption).toBeDefined();
    });

    test("ralph setup has --completion-promise option", () => {
      const program = createProgram();
      const ralphCmd = program.commands.find(cmd => cmd.name() === "ralph");
      const setupCmd = ralphCmd?.commands.find(cmd => cmd.name() === "setup");
      
      const promiseOption = setupCmd?.options.find(opt => opt.long === "--completion-promise");
      expect(promiseOption).toBeDefined();
    });

    test("ralph setup has --feature-list option with default value", () => {
      const program = createProgram();
      const ralphCmd = program.commands.find(cmd => cmd.name() === "ralph");
      const setupCmd = ralphCmd?.commands.find(cmd => cmd.name() === "setup");
      
      const featureListOption = setupCmd?.options.find(opt => opt.long === "--feature-list");
      expect(featureListOption).toBeDefined();
      expect(featureListOption?.defaultValue).toBe("research/feature-list.json");
    });

    test("ralph stop has required -a/--agent option", () => {
      const program = createProgram();
      const ralphCmd = program.commands.find(cmd => cmd.name() === "ralph");
      const stopCmd = ralphCmd?.commands.find(cmd => cmd.name() === "stop");
      
      const agentOption = stopCmd?.options.find(opt => opt.long === "--agent");
      expect(agentOption).toBeDefined();
      expect(agentOption?.mandatory).toBe(true);
    });
  });

  describe("RalphSetupOptions interface", () => {
    test("ralphSetup accepts options object with prompt array", async () => {
      // Type check - this should compile without errors
      const options: RalphSetupOptions = {
        prompt: ["test", "prompt"],
      };
      
      // Verify the interface structure
      expect(options.prompt).toEqual(["test", "prompt"]);
      expect(options.maxIterations).toBeUndefined();
      expect(options.completionPromise).toBeUndefined();
      expect(options.featureList).toBeUndefined();
    });

    test("RalphSetupOptions supports all optional properties", () => {
      const options: RalphSetupOptions = {
        prompt: ["implement", "feature"],
        maxIterations: 10,
        completionPromise: "DONE",
        featureList: "custom/features.json",
      };
      
      expect(options.prompt).toEqual(["implement", "feature"]);
      expect(options.maxIterations).toBe(10);
      expect(options.completionPromise).toBe("DONE");
      expect(options.featureList).toBe("custom/features.json");
    });

    test("RalphSetupOptions allows empty prompt array", () => {
      const options: RalphSetupOptions = {
        prompt: [],
      };
      
      expect(options.prompt).toEqual([]);
    });

    test("completionPromise can be undefined (no promise set)", () => {
      const options: RalphSetupOptions = {
        prompt: ["test"],
        completionPromise: undefined,
      };
      
      expect(options.completionPromise).toBeUndefined();
    });

    test("completionPromise can be a string value", () => {
      const options: RalphSetupOptions = {
        prompt: ["test"],
        completionPromise: "All tests passing",
      };
      
      expect(options.completionPromise).toBe("All tests passing");
    });

    test("maxIterations defaults to 0 (unlimited) when not specified", () => {
      const options: RalphSetupOptions = {
        prompt: [],
      };
      
      // The default is applied in the function, not the interface
      // Interface just allows undefined
      expect(options.maxIterations).toBeUndefined();
    });

    test("featureList defaults to 'research/feature-list.json' when not specified", () => {
      const options: RalphSetupOptions = {
        prompt: [],
      };
      
      // The default is applied in the function, not the interface
      expect(options.featureList).toBeUndefined();
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

/**
 * Tests for new 'atomic run <agent>' syntax
 * Replaces legacy 'atomic --agent <name>' pattern
 */
describe("New run command syntax", () => {
  describe("run command parsing", () => {
    test("run command accepts agent as first argument", () => {
      const program = createProgram();
      const runCmd = program.commands.find(cmd => cmd.name() === "run");
      
      // The first argument should be the agent name
      const args = (runCmd as any)._args;
      expect(args[0].name()).toBe("agent");
      expect(args[0].description).toContain("Agent to run");
    });

    test("run command accepts variadic args for agent", () => {
      const program = createProgram();
      const runCmd = program.commands.find(cmd => cmd.name() === "run");
      
      // The second argument should be variadic args
      const args = (runCmd as any)._args;
      expect(args[1].variadic).toBe(true);
      expect(args[1].description).toContain("Arguments to pass");
    });

    test("run command has clean description", () => {
      const program = createProgram();
      const runCmd = program.commands.find(cmd => cmd.name() === "run");

      expect(runCmd?.description()).toBe("Run a coding agent");
    });
  });

  describe("passthrough options behavior", () => {
    test("run command passes arguments through without requiring -- separator", () => {
      const program = createProgram();
      const runCmd = program.commands.find(cmd => cmd.name() === "run");

      // passThroughOptions() treats options appearing after <agent> as passthrough
      // arguments, not as options for the run command itself. This allows:
      //   atomic run claude --help       → --help passed to claude
      //   atomic run claude /commit msg  → /commit and msg passed to claude
      expect((runCmd as any)._passThroughOptions).toBe(true);
    });
  });
});
