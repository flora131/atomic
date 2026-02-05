import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

/**
 * Tests for CLI argument parsing in .github/scripts/ralph-loop.ts
 *
 * Covers ONLY unique CLI behavior not tested by integration tests:
 * - Help flags (-h, --help, precedence)
 * - Argument validation error paths
 * - Argument parsing edge cases (float truncation, interspersed args)
 */

const TEST_DIR = ".github-test-cli";
const SCRIPT_PATH = ".github/scripts/ralph-loop.ts";

// Helper to run the script with arguments
async function runRalphLoop(
  args: string[] = [],
  options: { featureListExists?: boolean } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const { featureListExists = true } = options;

  const featureListPath = "research/feature-list.json";
  const featureListDir = "research";

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
    } else if (existsSync(featureListPath)) {
      // File didn't exist before — clean it up
      rmSync(featureListPath);
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

  const originalFeatureListExists = existsSync(featureListPath);

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
  // Clean up feature list if we created it
  if (!originalFeatureListExists && existsSync(featureListPath)) {
    rmSync(featureListPath);
  }

  return { stdout, stderr, exitCode, state };
}

describe("ralph-loop.ts CLI", () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
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
  // ARGUMENT VALIDATION ERROR TESTS
  // ==========================================================================

  describe("argument validation errors", () => {
    test("--max-iterations errors on missing value", async () => {
      const { stderr, exitCode } = await runRalphLoop(["--max-iterations"]);

      expect(exitCode).toBe(1);
      expect(stderr).toContain("--max-iterations requires a number argument");
    });

    test("--max-iterations errors on non-integer value", async () => {
      const { stderr, exitCode } = await runRalphLoop(["--max-iterations", "abc"]);

      expect(exitCode).toBe(1);
      expect(stderr).toContain("--max-iterations must be a positive integer or 0");
    });

    test("--max-iterations errors on negative value", async () => {
      const { stderr, exitCode } = await runRalphLoop(["--max-iterations", "-5"]);

      expect(exitCode).toBe(1);
      expect(stderr).toContain("--max-iterations must be a positive integer or 0");
    });

    test("--completion-promise errors on missing value", async () => {
      const { stderr, exitCode } = await runRalphLoop(["--completion-promise"]);

      expect(exitCode).toBe(1);
      expect(stderr).toContain("--completion-promise requires a text argument");
    });

    test("--feature-list errors on missing value", async () => {
      const { stderr, exitCode } = await runRalphLoop(["--feature-list"]);

      expect(exitCode).toBe(1);
      expect(stderr).toContain("--feature-list requires a path argument");
    });

    test("default prompt fails when feature list doesn't exist", async () => {
      const { stderr, exitCode } = await runRalphLoop(
        ["--feature-list", "nonexistent/features.json"],
        { featureListExists: false }
      );

      expect(exitCode).toBe(1);
      expect(stderr).toContain("Feature list not found");
    });
  });

  // ==========================================================================
  // ARGUMENT PARSING EDGE CASES
  // ==========================================================================

  describe("argument parsing edge cases", () => {
    test("truncates float value to integer (3.14 -> 3)", async () => {
      const { stdout, state, exitCode } = await runAndGetState(["--max-iterations", "3.14"]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Max iterations: 3");
      expect(state).toContain("max_iterations: 3");
    });

    test("custom prompt succeeds even without feature list", async () => {
      const { exitCode, stdout } = await runRalphLoop(
        ["Build a todo app", "--feature-list", "nonexistent/features.json"],
        { featureListExists: false }
      );

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Custom prompt: Build a todo app");
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
  });
});
