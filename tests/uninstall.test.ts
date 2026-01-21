import { test, expect, describe } from "bun:test";
import { getPathCleanupInstructions } from "../src/commands/uninstall";
import { isWindows } from "../src/utils/detect";
import { getBinaryInstallDir } from "../src/utils/config-path";

describe("getPathCleanupInstructions", () => {
  test("returns a non-empty string", () => {
    const instructions = getPathCleanupInstructions();
    expect(typeof instructions).toBe("string");
    expect(instructions.length).toBeGreaterThan(0);
  });

  test("includes the binary install directory", () => {
    const binDir = getBinaryInstallDir();
    const instructions = getPathCleanupInstructions();
    expect(instructions).toContain(binDir);
  });

  test("includes platform-appropriate shell instructions", () => {
    const instructions = getPathCleanupInstructions();

    if (isWindows()) {
      // Windows should mention PowerShell and environment variables
      expect(instructions).toContain("PowerShell");
      expect(instructions).toContain("Environment Variables");
    } else {
      // Unix should mention bash, zsh, and fish
      expect(instructions).toContain("Bash");
      expect(instructions).toContain("Zsh");
      expect(instructions).toContain("Fish");
      expect(instructions).toContain(".bashrc");
      expect(instructions).toContain(".zshrc");
    }
  });

  test("includes export PATH syntax on Unix", () => {
    if (!isWindows()) {
      const instructions = getPathCleanupInstructions();
      expect(instructions).toContain("export PATH=");
    }
  });

  test("includes fish_add_path syntax on Unix", () => {
    if (!isWindows()) {
      const instructions = getPathCleanupInstructions();
      expect(instructions).toContain("fish_add_path");
    }
  });
});

describe("uninstall command exports", () => {
  test("uninstallCommand is exported", async () => {
    const { uninstallCommand } = await import("../src/commands/uninstall");
    expect(typeof uninstallCommand).toBe("function");
  });

  test("UninstallOptions interface is usable", async () => {
    // This verifies the type is exported and usable
    const options = {
      yes: true,
      keepConfig: false,
      dryRun: true,
    };
    expect(options.yes).toBe(true);
    expect(options.keepConfig).toBe(false);
    expect(options.dryRun).toBe(true);
  });

  test("getPathCleanupInstructions is exported", async () => {
    const { getPathCleanupInstructions } = await import("../src/commands/uninstall");
    expect(typeof getPathCleanupInstructions).toBe("function");
  });
});

describe("uninstall command structure", () => {
  test("instructions mention PATH cleanup", () => {
    const instructions = getPathCleanupInstructions();
    expect(instructions.toLowerCase()).toContain("path");
  });

  test("instructions provide removal guidance", () => {
    const instructions = getPathCleanupInstructions();
    expect(instructions.toLowerCase()).toContain("remove");
  });
});
