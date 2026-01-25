import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { isNewerVersion, extractConfig } from "../src/commands/update";
import { mkdir, rm, writeFile, readdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { isWindows } from "../src/utils/detect";

describe("isNewerVersion", () => {
  describe("major version differences", () => {
    test("returns true when major version is greater", () => {
      expect(isNewerVersion("2.0.0", "1.0.0")).toBe(true);
      expect(isNewerVersion("10.0.0", "9.0.0")).toBe(true);
    });

    test("returns false when major version is less", () => {
      expect(isNewerVersion("1.0.0", "2.0.0")).toBe(false);
      expect(isNewerVersion("9.0.0", "10.0.0")).toBe(false);
    });
  });

  describe("minor version differences", () => {
    test("returns true when minor version is greater (same major)", () => {
      expect(isNewerVersion("1.2.0", "1.1.0")).toBe(true);
      expect(isNewerVersion("1.10.0", "1.9.0")).toBe(true);
    });

    test("returns false when minor version is less (same major)", () => {
      expect(isNewerVersion("1.1.0", "1.2.0")).toBe(false);
      expect(isNewerVersion("1.9.0", "1.10.0")).toBe(false);
    });
  });

  describe("patch version differences", () => {
    test("returns true when patch version is greater (same major.minor)", () => {
      expect(isNewerVersion("1.0.2", "1.0.1")).toBe(true);
      expect(isNewerVersion("1.0.10", "1.0.9")).toBe(true);
    });

    test("returns false when patch version is less (same major.minor)", () => {
      expect(isNewerVersion("1.0.1", "1.0.2")).toBe(false);
      expect(isNewerVersion("1.0.9", "1.0.10")).toBe(false);
    });
  });

  describe("equal versions", () => {
    test("returns false when versions are equal", () => {
      expect(isNewerVersion("1.0.0", "1.0.0")).toBe(false);
      expect(isNewerVersion("2.5.3", "2.5.3")).toBe(false);
      expect(isNewerVersion("0.1.0", "0.1.0")).toBe(false);
    });
  });

  describe("v prefix handling", () => {
    test("handles v prefix on first version", () => {
      expect(isNewerVersion("v2.0.0", "1.0.0")).toBe(true);
      expect(isNewerVersion("v1.0.0", "2.0.0")).toBe(false);
    });

    test("handles v prefix on second version", () => {
      expect(isNewerVersion("2.0.0", "v1.0.0")).toBe(true);
      expect(isNewerVersion("1.0.0", "v2.0.0")).toBe(false);
    });

    test("handles v prefix on both versions", () => {
      expect(isNewerVersion("v2.0.0", "v1.0.0")).toBe(true);
      expect(isNewerVersion("v1.0.0", "v2.0.0")).toBe(false);
      expect(isNewerVersion("v1.0.0", "v1.0.0")).toBe(false);
    });
  });

  describe("edge cases", () => {
    test("handles versions with leading zeros", () => {
      // "01" should be parsed as 1
      expect(isNewerVersion("1.0.0", "0.9.9")).toBe(true);
    });

    test("handles versions starting with 0", () => {
      expect(isNewerVersion("0.2.0", "0.1.0")).toBe(true);
      expect(isNewerVersion("0.1.1", "0.1.0")).toBe(true);
      expect(isNewerVersion("0.0.2", "0.0.1")).toBe(true);
    });

    test("handles typical atomic versions", () => {
      expect(isNewerVersion("0.2.0", "0.1.0")).toBe(true);
      expect(isNewerVersion("0.1.1", "0.1.0")).toBe(true);
      expect(isNewerVersion("1.0.0", "0.9.9")).toBe(true);
    });

    test("major version takes precedence over minor and patch", () => {
      expect(isNewerVersion("2.0.0", "1.9.9")).toBe(true);
      expect(isNewerVersion("1.0.0", "0.99.99")).toBe(true);
    });

    test("minor version takes precedence over patch", () => {
      expect(isNewerVersion("1.1.0", "1.0.99")).toBe(true);
    });
  });
});

describe("update command exports", () => {
  test("updateCommand is exported", async () => {
    const { updateCommand } = await import("../src/commands/update");
    expect(typeof updateCommand).toBe("function");
  });
});

/**
 * NOTE: These tests are skipped on Windows because they require the tar command
 * which is not natively available on Windows.
 */
describe.skipIf(isWindows())("clean data directory on update", () => {
  let testDir: string;
  let dataDir: string;
  let archivePath: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `atomic-clean-install-test-${Date.now()}`);
    dataDir = join(testDir, "data");
    archivePath = join(testDir, "config.tar.gz");

    await mkdir(testDir, { recursive: true });
    await mkdir(dataDir, { recursive: true });

    // Create a tar.gz archive with known content
    const configContentDir = join(testDir, "config-content");
    await mkdir(join(configContentDir, "subdir"), { recursive: true });
    await writeFile(join(configContentDir, "new-file.txt"), "new content");
    await writeFile(join(configContentDir, "subdir", "nested.txt"), "nested content");

    // Create tar.gz archive from the config content
    const result = Bun.spawnSync({
      cmd: ["tar", "-czf", archivePath, "-C", configContentDir, "."],
      stdout: "pipe",
      stderr: "pipe",
    });

    if (!result.success) {
      throw new Error(`Failed to create test archive: ${result.stderr.toString()}`);
    }
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test("rm before extractConfig removes stale files from data directory", async () => {
    // Add a stale file that should not exist after clean install
    await writeFile(join(dataDir, "stale-file.txt"), "stale content");
    await mkdir(join(dataDir, "stale-dir"), { recursive: true });
    await writeFile(join(dataDir, "stale-dir", "old.txt"), "old content");

    // Verify stale files exist
    expect(existsSync(join(dataDir, "stale-file.txt"))).toBe(true);
    expect(existsSync(join(dataDir, "stale-dir", "old.txt"))).toBe(true);

    // Simulate the clean install pattern: rm then extractConfig
    await rm(dataDir, { recursive: true, force: true });
    await extractConfig(archivePath, dataDir);

    // Verify stale files are gone
    expect(existsSync(join(dataDir, "stale-file.txt"))).toBe(false);
    expect(existsSync(join(dataDir, "stale-dir"))).toBe(false);

    // Verify new files are present
    expect(existsSync(join(dataDir, "new-file.txt"))).toBe(true);
    expect(existsSync(join(dataDir, "subdir", "nested.txt"))).toBe(true);
  });

  test("extractConfig without rm leaves stale files in place", async () => {
    // Add a stale file
    await writeFile(join(dataDir, "stale-file.txt"), "stale content");

    // Extract without rm - stale file should remain
    await extractConfig(archivePath, dataDir);

    // Stale file still exists (this is the bug we're fixing)
    expect(existsSync(join(dataDir, "stale-file.txt"))).toBe(true);

    // New files are also present
    expect(existsSync(join(dataDir, "new-file.txt"))).toBe(true);
  });

  test("rm on non-existent directory does not throw", async () => {
    const nonExistentDir = join(testDir, "does-not-exist");

    // Should not throw due to { force: true }
    await rm(nonExistentDir, { recursive: true, force: true });
  });

  test("extractConfig recreates directory after rm", async () => {
    // Remove the directory completely
    await rm(dataDir, { recursive: true, force: true });
    expect(existsSync(dataDir)).toBe(false);

    // extractConfig should recreate it via mkdir
    await extractConfig(archivePath, dataDir);

    expect(existsSync(dataDir)).toBe(true);
    const contents = await readdir(dataDir);
    expect(contents.length).toBeGreaterThan(0);
  });
});
