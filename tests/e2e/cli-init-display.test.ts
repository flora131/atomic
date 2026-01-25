import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { spawn } from "child_process";

/**
 * E2E tests for CLI init display ordering
 *
 * These tests verify the correct display order when:
 * 1. Running `atomic init --agent [agent]` directly
 * 2. Running `atomic run [agent]` with existing config
 * 3. Running `atomic run [agent]` without config shows error
 */
describe("CLI Init Display Ordering", () => {
  let tmpDir: string;
  const atomicPath = path.join(__dirname, "../../src/cli.ts");

  beforeEach(async () => {
    // Create a temporary directory for each test
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "atomic-test-"));
  });

  afterEach(async () => {
    // Clean up the temporary directory
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  /**
   * Helper function to run the atomic CLI and capture output
   */
  function runAtomic(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
      const proc = spawn("bun", ["run", atomicPath, ...args], {
        cwd: tmpDir,
        env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      // Auto-cancel any prompts by closing stdin after a delay
      setTimeout(() => {
        proc.stdin.end();
        proc.kill("SIGTERM");
      }, 2000);

      proc.on("close", (code) => {
        resolve({ stdout, stderr, exitCode: code ?? 1 });
      });

      proc.on("error", () => {
        resolve({ stdout, stderr, exitCode: 1 });
      });
    });
  }

  /**
   * Helper to find the index of a string in the output
   * Returns -1 if not found
   */
  function findPosition(output: string, needle: string): number {
    return output.indexOf(needle);
  }

  test("atomic init --agent claude shows correct display order", async () => {
    // Run atomic init with agent flag
    const { stdout, stderr } = await runAtomic(["init", "--agent", "claude"]);
    const output = stdout + stderr;

    // Check for key elements in the output
    const introPos = findPosition(output, "Atomic:");
    const configuringPos = findPosition(output, "Configuring");

    // Intro and configuring should be present
    expect(introPos).toBeGreaterThanOrEqual(0);
    expect(configuringPos).toBeGreaterThanOrEqual(0);

    // Verify ordering: intro -> configuring
    expect(introPos).toBeLessThan(configuringPos);
  }, 10000);

  test("atomic run claude with existing config attempts to run agent", async () => {
    // Create .claude folder before running CLI
    await fs.mkdir(path.join(tmpDir, ".claude"));

    // Run atomic with run command
    const { stdout, stderr } = await runAtomic(["run", "claude"]);
    const output = stdout + stderr;

    // Should NOT show intro banner or setup messages
    const introPos = findPosition(output, "Atomic:");
    const configuringPos = findPosition(output, "Configuring");

    // None of these setup messages should appear
    expect(introPos).toBe(-1);
    expect(configuringPos).toBe(-1);
  }, 10000);

  test("atomic run with invalid agent shows error", async () => {
    // Run atomic with invalid agent
    const { stdout, stderr, exitCode } = await runAtomic(["run", "invalid-agent"]);
    const output = stdout + stderr;

    // Should show error about unknown agent
    expect(output).toContain("Unknown agent");
    expect(exitCode).toBe(1);
  }, 10000);
});
