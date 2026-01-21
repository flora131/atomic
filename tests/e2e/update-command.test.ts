import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { spawn } from "child_process";

/**
 * E2E tests for the update command
 *
 * These tests verify:
 * 1. update --check works and shows version info
 * 2. update command detects installation type correctly
 * 3. Error messages are helpful for non-binary installations
 *
 * Note: Full binary update integration tests require a CI environment
 * with actual binary builds and GitHub releases.
 */
describe("Update Command E2E", () => {
  let tmpDir: string;
  const atomicPath = path.join(__dirname, "../../src/index.ts");

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "atomic-update-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  /**
   * Helper function to run the atomic CLI and capture output
   */
  function runAtomic(
    args: string[],
    options: { timeout?: number; env?: NodeJS.ProcessEnv } = {}
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const { timeout = 30000, env = {} } = options;

    return new Promise((resolve) => {
      const proc = spawn("bun", ["run", atomicPath, ...args], {
        cwd: tmpDir,
        env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", ...env },
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

      const timer = setTimeout(() => {
        proc.stdin.end();
        proc.kill("SIGTERM");
      }, timeout);

      proc.on("close", (code) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, exitCode: code ?? 1 });
      });

      proc.on("error", () => {
        clearTimeout(timer);
        resolve({ stdout, stderr, exitCode: 1 });
      });
    });
  }

  describe("Installation type detection", () => {
    test("shows helpful message for source installations", async () => {
      // Running from source (bun run src/index.ts) should show source installation error
      const { stdout, stderr, exitCode } = await runAtomic(["update"], { timeout: 10000 });
      const output = stdout + stderr;

      // When running from source, it should detect source installation
      // and show the git pull guidance
      expect(output).toContain("git pull");
      expect(output).toContain("bun install");
      expect(exitCode).toBe(1);
    }, 15000);

    test("shows helpful message with --check for source installations", async () => {
      const { stdout, stderr, exitCode } = await runAtomic(["update", "--check"], {
        timeout: 10000,
      });
      const output = stdout + stderr;

      // Should still show source installation message
      expect(output).toContain("git pull");
      expect(exitCode).toBe(1);
    }, 15000);
  });

  describe("Help text", () => {
    test("update command is listed in help", async () => {
      const { stdout, stderr } = await runAtomic(["--help"], { timeout: 5000 });
      const output = stdout + stderr;

      expect(output).toContain("update");
      expect(output).toContain("--check");
      expect(output).toContain("--target-version");
    }, 10000);

    test("update is in COMMANDS section", async () => {
      const { stdout, stderr } = await runAtomic(["--help"], { timeout: 5000 });
      const output = stdout + stderr;

      // Verify update command is listed under commands
      expect(output).toContain("update");
      expect(output).toContain("Self-update");
    }, 10000);
  });

  describe("Command parsing", () => {
    test("update command is recognized", async () => {
      const { stdout, stderr, exitCode } = await runAtomic(["update"], { timeout: 10000 });
      const output = stdout + stderr;

      // Should not show "Unknown command"
      expect(output).not.toContain("Unknown command");

      // When running from source, it shows development mode message
      // which means the command was recognized
      expect(output).toContain("development mode");
    }, 15000);

    test("update --yes is recognized", async () => {
      const { stdout, stderr } = await runAtomic(["update", "--yes"], { timeout: 10000 });
      const output = stdout + stderr;

      expect(output).not.toContain("Unknown command");
      expect(output).not.toContain("unrecognized option");
    }, 15000);

    test("update -y shorthand is recognized", async () => {
      const { stdout, stderr } = await runAtomic(["update", "-y"], { timeout: 10000 });
      const output = stdout + stderr;

      expect(output).not.toContain("Unknown command");
      expect(output).not.toContain("unrecognized option");
    }, 15000);

    test("update --target-version accepts version argument", async () => {
      const { stdout, stderr } = await runAtomic(["update", "--target-version", "v0.1.0"], {
        timeout: 10000,
      });
      const output = stdout + stderr;

      expect(output).not.toContain("Unknown command");
      // Command should be recognized even if it fails due to source installation
      expect(output).toContain("development mode");
    }, 15000);
  });
});

describe("Update Command Unit Integration", () => {
  test("isNewerVersion is exported and works", async () => {
    const { isNewerVersion } = await import("../../src/commands/update");

    expect(isNewerVersion("1.0.0", "0.9.0")).toBe(true);
    expect(isNewerVersion("0.9.0", "1.0.0")).toBe(false);
    expect(isNewerVersion("1.0.0", "1.0.0")).toBe(false);
  });

  test("UpdateOptions interface is usable", async () => {
    const { updateCommand } = await import("../../src/commands/update");

    // Verify the function exists and is callable
    expect(typeof updateCommand).toBe("function");
  });
});
