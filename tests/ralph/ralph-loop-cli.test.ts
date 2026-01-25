import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

/**
 * Tests for CLI argument parsing in .github/scripts/ralph-loop.ts
 *
 * Feature 8 from research/feature-list.json
 *
 * Tests CLI argument parsing functionality:
 * - Default values when no arguments provided
 * - --max-iterations with valid integers
 * - --completion-promise with quoted strings
 * - --feature-list with custom paths
 * - -h and --help flags
 * - Invalid argument handling and error messages
 * - Positional arguments for prompt
 */

const TEST_DIR = ".github-test-cli";
const SCRIPT_PATH = ".github/scripts/ralph-loop.ts";

// Helper to run the script with arguments
async function runRalphLoop(
  args: string[] = [],
  options: { featureListExists?: boolean } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const { featureListExists = true } = options;

  // Create or remove feature list based on test needs
  const featureListPath = "research/feature-list.json";
  const featureListDir = "research";

  // Temporarily ensure feature list exists/doesn't exist
  const originalFeatureListExists = existsSync(featureListPath);
  const originalContent = originalFeatureListExists
    ? readFileSync(featureListPath, "utf-8")
    : null;

  if (featureListExists && !existsSync(featureListPath)) {
    if (!existsSync(featureListDir)) {
      mkdirSync(featureListDir, { recursive: true });
    }
    writeFileSync(featureListPath, "[]", "utf-8");
  }

  try {
    const proc = Bun.spawn(["bun", "run", SCRIPT_PATH, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      cwd: process.cwd(),
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    return { stdout, stderr, exitCode };
  } finally {
    // Restore original state
    if (originalContent !== null) {
      writeFileSync(featureListPath, originalContent, "utf-8");
    }

    // Clean up state files created by the script
    const stateFile = ".github/ralph-loop.local.md";
    const continueFile = ".github/ralph-continue.flag";
    if (existsSync(stateFile)) {
      rmSync(stateFile);
    }
    if (existsSync(continueFile)) {
      rmSync(continueFile);
    }
  }
}

// Helper to read state file after script execution
async function runAndGetState(
  args: string[] = []
): Promise<{ stdout: string; stderr: string; exitCode: number; state: string | null }> {
  const featureListPath = "research/feature-list.json";
  const stateFile = ".github/ralph-loop.local.md";

  // Ensure feature list exists
  if (!existsSync(featureListPath)) {
    if (!existsSync("research")) {
      mkdirSync("research", { recursive: true });
    }
    writeFileSync(featureListPath, "[]", "utf-8");
  }

  const proc = Bun.spawn(["bun", "run", SCRIPT_PATH, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    cwd: process.cwd(),
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  let state: string | null = null;
  if (existsSync(stateFile)) {
    state = readFileSync(stateFile, "utf-8");
  }

  // Clean up
  if (existsSync(stateFile)) {
    rmSync(stateFile);
  }
  const continueFile = ".github/ralph-continue.flag";
  if (existsSync(continueFile)) {
    rmSync(continueFile);
  }

  return { stdout, stderr, exitCode, state };
}

describe("ralph-loop.ts CLI", () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
    // Clean up any leftover state files
    const stateFile = ".github/ralph-loop.local.md";
    const continueFile = ".github/ralph-continue.flag";
    if (existsSync(stateFile)) {
      rmSync(stateFile);
    }
    if (existsSync(continueFile)) {
      rmSync(continueFile);
    }
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
    // Clean up any leftover state files
    const stateFile = ".github/ralph-loop.local.md";
    const continueFile = ".github/ralph-continue.flag";
    if (existsSync(stateFile)) {
      rmSync(stateFile);
    }
    if (existsSync(continueFile)) {
      rmSync(continueFile);
    }
  });

  // ==========================================================================
  // HELP FLAG TESTS
  // ==========================================================================

  describe("help flags", () => {
    test("-h shows help and exits with 0", async () => {
      const { stdout, exitCode } = await runRalphLoop(["-h"]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Ralph Loop");
      expect(stdout).toContain("USAGE:");
      expect(stdout).toContain("--max-iterations");
      expect(stdout).toContain("--completion-promise");
      expect(stdout).toContain("--feature-list");
    });

    test("--help shows help and exits with 0", async () => {
      const { stdout, exitCode } = await runRalphLoop(["--help"]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Ralph Loop");
      expect(stdout).toContain("USAGE:");
      expect(stdout).toContain("EXAMPLES:");
      expect(stdout).toContain("STOPPING:");
    });

    test("help flag takes precedence over other arguments", async () => {
      const { stdout, exitCode } = await runRalphLoop([
        "--max-iterations",
        "10",
        "--help",
        "--completion-promise",
        "DONE",
      ]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Ralph Loop");
      expect(stdout).toContain("USAGE:");
    });
  });

  // ==========================================================================
  // DEFAULT VALUES TESTS
  // ==========================================================================

  describe("default values", () => {
    test("uses default prompt when no arguments provided", async () => {
      const { stdout, exitCode, state } = await runAndGetState([]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Using default prompt:");
      expect(stdout).toContain("research/feature-list.json");
      expect(state).not.toBeNull();
      expect(state).toContain("You are tasked with implementing a SINGLE feature");
    });

    test("uses unlimited max_iterations by default (0)", async () => {
      const { stdout, state } = await runAndGetState([]);

      expect(stdout).toContain("Max iterations: unlimited");
      expect(state).toContain("max_iterations: 0");
    });

    test("uses null completion_promise by default", async () => {
      const { stdout, state } = await runAndGetState([]);

      expect(stdout).toContain("Completion promise: none");
      expect(state).toContain("completion_promise: null");
    });

    test("uses default feature_list_path", async () => {
      const { stdout, state } = await runAndGetState([]);

      expect(stdout).toContain("Feature list: research/feature-list.json");
      expect(state).toContain("feature_list_path: research/feature-list.json");
    });

    test("sets iteration to 1 initially", async () => {
      const { state } = await runAndGetState([]);

      expect(state).toContain("iteration: 1");
    });

    test("sets active to true", async () => {
      const { state } = await runAndGetState([]);

      expect(state).toContain("active: true");
    });
  });

  // ==========================================================================
  // --max-iterations TESTS
  // ==========================================================================

  describe("--max-iterations", () => {
    test("accepts valid positive integer", async () => {
      const { stdout, state, exitCode } = await runAndGetState(["--max-iterations", "20"]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Max iterations: 20");
      expect(state).toContain("max_iterations: 20");
    });

    test("accepts 0 for unlimited", async () => {
      const { stdout, state, exitCode } = await runAndGetState(["--max-iterations", "0"]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Max iterations: unlimited");
      expect(state).toContain("max_iterations: 0");
    });

    test("accepts large integer", async () => {
      const { stdout, state, exitCode } = await runAndGetState(["--max-iterations", "999999"]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Max iterations: 999999");
      expect(state).toContain("max_iterations: 999999");
    });

    test("errors on missing value", async () => {
      const { stderr, exitCode } = await runRalphLoop(["--max-iterations"]);

      expect(exitCode).toBe(1);
      expect(stderr).toContain("--max-iterations requires a number argument");
    });

    test("errors on non-integer value", async () => {
      const { stderr, exitCode } = await runRalphLoop(["--max-iterations", "abc"]);

      expect(exitCode).toBe(1);
      expect(stderr).toContain("--max-iterations must be a positive integer or 0");
    });

    test("errors on negative value", async () => {
      const { stderr, exitCode } = await runRalphLoop(["--max-iterations", "-5"]);

      expect(exitCode).toBe(1);
      expect(stderr).toContain("--max-iterations must be a positive integer or 0");
    });

    test("truncates float value to integer (3.14 -> 3)", async () => {
      // parseInt("3.14") returns 3, which is valid
      // This documents the current behavior
      const { stdout, state, exitCode } = await runAndGetState(["--max-iterations", "3.14"]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Max iterations: 3");
      expect(state).toContain("max_iterations: 3");
    });
  });

  // ==========================================================================
  // --completion-promise TESTS
  // ==========================================================================

  describe("--completion-promise", () => {
    test("accepts simple string", async () => {
      const { stdout, state, exitCode } = await runAndGetState(["--completion-promise", "DONE"]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Completion promise: DONE");
      expect(stdout).toContain("<promise>DONE</promise>");
      expect(state).toContain('completion_promise: "DONE"');
    });

    test("accepts string with spaces (quoted)", async () => {
      const { stdout, state, exitCode } = await runAndGetState([
        "--completion-promise",
        "All tests pass",
      ]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Completion promise: All tests pass");
      expect(state).toContain('completion_promise: "All tests pass"');
    });

    test("accepts string with special characters", async () => {
      const { stdout, state, exitCode } = await runAndGetState([
        "--completion-promise",
        "Done! 100% complete",
      ]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Done! 100% complete");
      expect(state).toContain("Done! 100% complete");
    });

    test("errors on missing value", async () => {
      const { stderr, exitCode } = await runRalphLoop(["--completion-promise"]);

      expect(exitCode).toBe(1);
      expect(stderr).toContain("--completion-promise requires a text argument");
    });

    test("displays critical completion promise warning", async () => {
      const { stdout } = await runAndGetState(["--completion-promise", "FINISHED"]);

      expect(stdout).toContain("CRITICAL - Ralph Loop Completion Promise");
      expect(stdout).toContain("STRICT REQUIREMENTS");
      expect(stdout).toContain("The statement MUST be completely TRUE");
    });
  });

  // ==========================================================================
  // --feature-list TESTS
  // ==========================================================================

  describe("--feature-list", () => {
    test("accepts custom path", async () => {
      // Create a temporary feature list
      const customPath = join(TEST_DIR, "custom-features.json");
      mkdirSync(TEST_DIR, { recursive: true });
      writeFileSync(customPath, "[]", "utf-8");

      const { stdout, state, exitCode } = await runAndGetState([
        "--feature-list",
        customPath,
      ]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain(`Feature list: ${customPath}`);
      expect(state).toContain(`feature_list_path: ${customPath}`);
    });

    test("errors on missing value", async () => {
      const { stderr, exitCode } = await runRalphLoop(["--feature-list"]);

      expect(exitCode).toBe(1);
      expect(stderr).toContain("--feature-list requires a path argument");
    });

    test("default prompt fails when feature list doesn't exist", async () => {
      // Use a path that doesn't exist
      const { stderr, exitCode } = await runRalphLoop(
        ["--feature-list", "nonexistent/features.json"],
        { featureListExists: false }
      );

      expect(exitCode).toBe(1);
      expect(stderr).toContain("Feature list not found");
    });

    test("custom prompt succeeds even without feature list", async () => {
      // Custom prompt doesn't require feature list
      const { exitCode, stdout } = await runRalphLoop(
        ["Build a todo app", "--feature-list", "nonexistent/features.json"],
        { featureListExists: false }
      );

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Custom prompt: Build a todo app");
    });
  });

  // ==========================================================================
  // POSITIONAL ARGUMENTS (PROMPT) TESTS
  // ==========================================================================

  describe("positional arguments for prompt", () => {
    test("single word prompt", async () => {
      const { stdout, state, exitCode } = await runAndGetState(["Hello"]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Custom prompt: Hello");
      expect(state).toContain("Hello");
    });

    test("multi-word prompt", async () => {
      const { stdout, state, exitCode } = await runAndGetState([
        "Build",
        "a",
        "todo",
        "application",
      ]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Custom prompt: Build a todo application");
      expect(state).toContain("Build a todo application");
    });

    test("prompt with options interspersed", async () => {
      const { stdout, state, exitCode } = await runAndGetState([
        "Build",
        "--max-iterations",
        "10",
        "a",
        "todo",
        "app",
      ]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Custom prompt: Build a todo app");
      expect(stdout).toContain("Max iterations: 10");
      expect(state).toContain("Build a todo app");
      expect(state).toContain("max_iterations: 10");
    });

    test("prompt at end after all options", async () => {
      const { stdout, state, exitCode } = await runAndGetState([
        "--max-iterations",
        "5",
        "--completion-promise",
        "DONE",
        "Create",
        "a",
        "REST",
        "API",
      ]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Custom prompt: Create a REST API");
      expect(stdout).toContain("Max iterations: 5");
      expect(stdout).toContain("Completion promise: DONE");
      expect(state).toContain("Create a REST API");
    });

    test("empty prompt uses default", async () => {
      const { stdout, state, exitCode } = await runAndGetState([]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Using default prompt:");
      expect(state).toContain("You are tasked with implementing a SINGLE feature");
    });
  });

  // ==========================================================================
  // STATE FILE CREATION TESTS
  // ==========================================================================

  describe("state file creation", () => {
    test("creates .github/ralph-loop.local.md", async () => {
      const stateFile = ".github/ralph-loop.local.md";

      // Ensure clean state
      if (existsSync(stateFile)) {
        rmSync(stateFile);
      }

      const proc = Bun.spawn(["bun", "run", SCRIPT_PATH], {
        stdout: "pipe",
        stderr: "pipe",
      });
      await proc.exited;

      expect(existsSync(stateFile)).toBe(true);

      // Cleanup
      rmSync(stateFile);
      const continueFile = ".github/ralph-continue.flag";
      if (existsSync(continueFile)) {
        rmSync(continueFile);
      }
    });

    test("creates .github/ralph-continue.flag", async () => {
      const continueFile = ".github/ralph-continue.flag";

      // Ensure clean state
      if (existsSync(continueFile)) {
        rmSync(continueFile);
      }

      const proc = Bun.spawn(["bun", "run", SCRIPT_PATH], {
        stdout: "pipe",
        stderr: "pipe",
      });
      await proc.exited;

      expect(existsSync(continueFile)).toBe(true);

      // Cleanup
      const stateFile = ".github/ralph-loop.local.md";
      if (existsSync(stateFile)) {
        rmSync(stateFile);
      }
      rmSync(continueFile);
    });

    test("continue flag contains the prompt", async () => {
      const continueFile = ".github/ralph-continue.flag";

      const proc = Bun.spawn(["bun", "run", SCRIPT_PATH, "Test", "prompt", "here"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      await proc.exited;

      const content = readFileSync(continueFile, "utf-8");
      expect(content).toBe("Test prompt here");

      // Cleanup
      const stateFile = ".github/ralph-loop.local.md";
      if (existsSync(stateFile)) {
        rmSync(stateFile);
      }
      rmSync(continueFile);
    });

    test("state file has valid YAML frontmatter", async () => {
      const stateFile = ".github/ralph-loop.local.md";

      const proc = Bun.spawn(
        [
          "bun",
          "run",
          SCRIPT_PATH,
          "Custom prompt",
          "--max-iterations",
          "15",
          "--completion-promise",
          "DONE",
        ],
        {
          stdout: "pipe",
          stderr: "pipe",
        }
      );
      await proc.exited;

      const content = readFileSync(stateFile, "utf-8");

      // Verify YAML frontmatter structure
      expect(content).toMatch(/^---\n/);
      expect(content).toMatch(/\n---\n/);
      expect(content).toContain("active: true");
      expect(content).toContain("iteration: 1");
      expect(content).toContain("max_iterations: 15");
      expect(content).toContain('completion_promise: "DONE"');
      expect(content).toContain("feature_list_path:");
      expect(content).toContain("started_at:");

      // Cleanup
      rmSync(stateFile);
      const continueFile = ".github/ralph-continue.flag";
      if (existsSync(continueFile)) {
        rmSync(continueFile);
      }
    });
  });

  // ==========================================================================
  // OUTPUT MESSAGE TESTS
  // ==========================================================================

  describe("output messages", () => {
    test("displays activation message", async () => {
      const { stdout, exitCode } = await runAndGetState([]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Ralph loop activated for GitHub Copilot!");
    });

    test("displays state file paths", async () => {
      const { stdout } = await runAndGetState([]);

      expect(stdout).toContain("State file: .github/ralph-loop.local.md");
      expect(stdout).toContain("Continue flag: .github/ralph-continue.flag");
    });

    test("displays orchestrator instructions", async () => {
      const { stdout } = await runAndGetState([]);

      expect(stdout).toContain("external orchestrator");
      expect(stdout).toContain("while [ -f .github/ralph-continue.flag ]");
    });

    test("shows custom prompt when provided", async () => {
      const { stdout } = await runAndGetState(["Build a web server"]);

      expect(stdout).toContain("Custom prompt: Build a web server");
    });

    test("shows default prompt notice when no custom prompt", async () => {
      const { stdout } = await runAndGetState([]);

      expect(stdout).toContain("Using default prompt:");
    });
  });

  // ==========================================================================
  // COMBINED OPTIONS TESTS
  // ==========================================================================

  describe("combined options", () => {
    test("all options together", async () => {
      // Create test feature list
      const customFeaturePath = join(TEST_DIR, "features.json");
      mkdirSync(TEST_DIR, { recursive: true });
      writeFileSync(customFeaturePath, "[]", "utf-8");

      const { stdout, state, exitCode } = await runAndGetState([
        "My custom prompt here",
        "--max-iterations",
        "25",
        "--completion-promise",
        "All done",
        "--feature-list",
        customFeaturePath,
      ]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Custom prompt: My custom prompt here");
      expect(stdout).toContain("Max iterations: 25");
      expect(stdout).toContain("Completion promise: All done");
      expect(stdout).toContain(`Feature list: ${customFeaturePath}`);
      expect(state).toContain("max_iterations: 25");
      expect(state).toContain('completion_promise: "All done"');
      expect(state).toContain(`feature_list_path: ${customFeaturePath}`);
      expect(state).toContain("My custom prompt here");
    });

    test("options in different order", async () => {
      const { stdout, state, exitCode } = await runAndGetState([
        "--completion-promise",
        "FINISHED",
        "--max-iterations",
        "50",
        "Do something cool",
      ]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Max iterations: 50");
      expect(stdout).toContain("Completion promise: FINISHED");
      expect(stdout).toContain("Custom prompt: Do something cool");
      expect(state).toContain("max_iterations: 50");
      expect(state).toContain('completion_promise: "FINISHED"');
    });
  });
});
