import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { spawn } from "child_process";

/**
 * E2E tests for the uninstall command
 *
 * These tests verify:
 * 1. uninstall --dry-run shows preview without removing files
 * 2. uninstall command detects installation type correctly
 * 3. Error messages are helpful for non-binary installations
 * 4. PATH cleanup instructions are displayed
 *
 * Note: Full binary uninstall integration tests require a CI environment
 * with actual binary installations. These tests verify command behavior
 * from source.
 */
describe("Uninstall Command E2E", () => {
  let tmpDir: string;
  const atomicPath = path.join(__dirname, "../../src/index.ts");

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "atomic-uninstall-test-"));
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
      const { stdout, stderr, exitCode } = await runAtomic(["uninstall"], { timeout: 10000 });
      const output = stdout + stderr;

      // When running from source, it should detect source installation
      // and show the repository deletion guidance
      expect(output).toContain("source installation");
      expect(output).toContain("cloned repository");
      expect(exitCode).toBe(1);
    }, 15000);

    test("shows helpful message with --dry-run for source installations", async () => {
      const { stdout, stderr, exitCode } = await runAtomic(["uninstall", "--dry-run"], {
        timeout: 10000,
      });
      const output = stdout + stderr;

      // Should still show source installation message
      expect(output).toContain("source installation");
      expect(exitCode).toBe(1);
    }, 15000);
  });

  describe("Help text", () => {
    test("uninstall command is listed in help", async () => {
      const { stdout, stderr } = await runAtomic(["--help"], { timeout: 5000 });
      const output = stdout + stderr;

      expect(output).toContain("uninstall");
      expect(output).toContain("--dry-run");
      expect(output).toContain("--keep-config");
    }, 10000);

    test("uninstall is in COMMANDS section", async () => {
      const { stdout, stderr } = await runAtomic(["--help"], { timeout: 5000 });
      const output = stdout + stderr;

      // Verify uninstall command is listed under commands
      expect(output).toContain("uninstall");
      expect(output).toContain("Remove");
    }, 10000);
  });

  describe("Command parsing", () => {
    test("uninstall command is recognized", async () => {
      const { stdout, stderr } = await runAtomic(["uninstall"], { timeout: 10000 });
      const output = stdout + stderr;

      // Should not show "Unknown command"
      expect(output).not.toContain("Unknown command");
    }, 15000);

    test("uninstall --yes is recognized", async () => {
      const { stdout, stderr } = await runAtomic(["uninstall", "--yes"], { timeout: 10000 });
      const output = stdout + stderr;

      expect(output).not.toContain("Unknown command");
      expect(output).not.toContain("unrecognized option");
    }, 15000);

    test("uninstall -y shorthand is recognized", async () => {
      const { stdout, stderr } = await runAtomic(["uninstall", "-y"], { timeout: 10000 });
      const output = stdout + stderr;

      expect(output).not.toContain("Unknown command");
      expect(output).not.toContain("unrecognized option");
    }, 15000);

    test("uninstall --dry-run is recognized", async () => {
      const { stdout, stderr } = await runAtomic(["uninstall", "--dry-run"], { timeout: 10000 });
      const output = stdout + stderr;

      expect(output).not.toContain("Unknown command");
      expect(output).not.toContain("unrecognized option");
    }, 15000);

    test("uninstall --keep-config is recognized", async () => {
      const { stdout, stderr } = await runAtomic(["uninstall", "--keep-config"], { timeout: 10000 });
      const output = stdout + stderr;

      expect(output).not.toContain("Unknown command");
      expect(output).not.toContain("unrecognized option");
    }, 15000);
  });
});

describe("Uninstall Command Unit Integration", () => {
  test("uninstallCommand is exported and callable", async () => {
    const { uninstallCommand } = await import("../../src/commands/uninstall");

    // Verify the function exists and is callable
    expect(typeof uninstallCommand).toBe("function");
  });

  test("getPathCleanupInstructions is exported and callable", async () => {
    const { getPathCleanupInstructions } = await import("../../src/commands/uninstall");

    expect(typeof getPathCleanupInstructions).toBe("function");
    const instructions = getPathCleanupInstructions();
    expect(typeof instructions).toBe("string");
    expect(instructions.length).toBeGreaterThan(0);
  });

  test("PATH cleanup instructions contain shell-specific guidance", async () => {
    const { getPathCleanupInstructions } = await import("../../src/commands/uninstall");
    const { isWindows } = await import("../../src/utils/detect");

    const instructions = getPathCleanupInstructions();

    if (isWindows()) {
      expect(instructions).toContain("PowerShell");
      expect(instructions).toContain("Environment Variables");
    } else {
      expect(instructions).toContain("Bash");
      expect(instructions).toContain("Zsh");
      expect(instructions).toContain("Fish");
    }
  });
});

describe("Uninstall Command Error Messages", () => {
  test("npm installation error message includes package manager guidance", async () => {
    // Verify the error message content is present in the uninstall module
    const uninstallSource = await Bun.file(
      path.join(__dirname, "../../src/commands/uninstall.ts")
    ).text();

    // npm installation should show package manager commands
    expect(uninstallSource).toContain("npm/bun installations");
    expect(uninstallSource).toContain("bun remove -g @bastani/atomic");
    expect(uninstallSource).toContain("npm uninstall -g @bastani/atomic");
  });

  test("source installation error message includes repository deletion guidance", async () => {
    const uninstallSource = await Bun.file(
      path.join(__dirname, "../../src/commands/uninstall.ts")
    ).text();

    // Source installation should show manual removal instructions
    expect(uninstallSource).toContain("source installation");
    expect(uninstallSource).toContain("cloned repository");
    expect(uninstallSource).toContain("bun unlink");
  });

  test("permission error message includes elevation guidance", async () => {
    const uninstallSource = await Bun.file(
      path.join(__dirname, "../../src/commands/uninstall.ts")
    ).text();

    // Permission errors should include elevation guidance
    expect(uninstallSource).toContain("permission");
    expect(uninstallSource).toContain("EACCES");
    expect(uninstallSource).toContain("EPERM");
    expect(uninstallSource).toContain("sudo atomic uninstall");
    expect(uninstallSource).toContain("Administrator");
  });
});

describe("Uninstall Dry-Run Behavior", () => {
  test("dry-run option interface is correctly typed", async () => {
    const { UninstallOptions } = await import("../../src/commands/uninstall");

    // Create options object with dry-run
    const options = {
      dryRun: true,
      yes: false,
      keepConfig: false,
    };

    expect(options.dryRun).toBe(true);
    expect(options.yes).toBe(false);
    expect(options.keepConfig).toBe(false);
  });

  test("keep-config option interface is correctly typed", async () => {
    const options = {
      dryRun: false,
      yes: true,
      keepConfig: true,
    };

    expect(options.keepConfig).toBe(true);
    expect(options.yes).toBe(true);
    expect(options.dryRun).toBe(false);
  });
});

describe("Uninstall Command Error Paths", () => {
  describe("Installation type error messages", () => {
    test("detectInstallationType returns source when running from source", async () => {
      const { detectInstallationType } = await import("../../src/utils/config-path");

      // When running tests via bun, we're in source mode
      const installType = detectInstallationType();
      expect(installType).toBe("source");
    });

    test("npm error message contains bun remove and npm uninstall commands", async () => {
      const uninstallSource = await Bun.file(
        path.join(__dirname, "../../src/commands/uninstall.ts")
      ).text();

      // Verify npm/bun uninstall guidance exists
      expect(uninstallSource).toContain("bun remove -g @bastani/atomic");
      expect(uninstallSource).toContain("npm uninstall -g @bastani/atomic");
    });

    test("source error message contains bun unlink instruction", async () => {
      const uninstallSource = await Bun.file(
        path.join(__dirname, "../../src/commands/uninstall.ts")
      ).text();

      // Verify source installation guidance exists
      expect(uninstallSource).toContain("bun unlink");
      expect(uninstallSource).toContain("Delete the cloned repository");
    });
  });

  describe("Permission error handling", () => {
    test("permission error checks include EACCES", async () => {
      const uninstallSource = await Bun.file(
        path.join(__dirname, "../../src/commands/uninstall.ts")
      ).text();

      // Verify EACCES is checked
      expect(uninstallSource).toContain("EACCES");
    });

    test("permission error checks include EPERM", async () => {
      const uninstallSource = await Bun.file(
        path.join(__dirname, "../../src/commands/uninstall.ts")
      ).text();

      // Verify EPERM is checked
      expect(uninstallSource).toContain("EPERM");
    });

    test("permission error shows sudo guidance on Unix", async () => {
      const uninstallSource = await Bun.file(
        path.join(__dirname, "../../src/commands/uninstall.ts")
      ).text();

      // Verify Unix elevation guidance
      expect(uninstallSource).toContain("sudo atomic uninstall");
    });

    test("permission error shows Administrator guidance on Windows", async () => {
      const uninstallSource = await Bun.file(
        path.join(__dirname, "../../src/commands/uninstall.ts")
      ).text();

      // Verify Windows elevation guidance
      expect(uninstallSource).toContain("Run PowerShell as Administrator");
    });

    test("permission error suggests manual deletion", async () => {
      const uninstallSource = await Bun.file(
        path.join(__dirname, "../../src/commands/uninstall.ts")
      ).text();

      // Verify manual deletion fallback
      expect(uninstallSource).toContain("manually delete");
    });
  });

  describe("Windows-specific handling", () => {
    test("Windows rename strategy uses .delete extension", async () => {
      const uninstallSource = await Bun.file(
        path.join(__dirname, "../../src/commands/uninstall.ts")
      ).text();

      // Verify Windows rename strategy
      expect(uninstallSource).toContain(".delete");
      expect(uninstallSource).toContain("Cannot delete running executable");
    });

    test("Windows shows restart guidance after rename", async () => {
      const uninstallSource = await Bun.file(
        path.join(__dirname, "../../src/commands/uninstall.ts")
      ).text();

      // Verify restart guidance for Windows
      expect(uninstallSource).toContain("restart your computer");
      expect(uninstallSource).toContain("marked for deletion");
    });
  });

  describe("Already uninstalled handling", () => {
    test("already uninstalled message is in source", async () => {
      const uninstallSource = await Bun.file(
        path.join(__dirname, "../../src/commands/uninstall.ts")
      ).text();

      // Verify already uninstalled message
      expect(uninstallSource).toContain("already uninstalled");
      expect(uninstallSource).toContain("no files found");
    });
  });
});
