import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { isWindows } from "../src/utils/detect";

/**
 * Tests for install.sh clean data directory behavior.
 *
 * These tests verify that install.sh removes the data directory before
 * extracting new config files, preventing stale artifacts from persisting.
 *
 * We test the shell commands (rm -rf, mkdir -p, tar -xzf) in isolation
 * since the full install.sh requires network access and a GitHub release.
 *
 * NOTE: These tests are skipped on Windows because they require bash and tar
 * commands that are not natively available on Windows.
 */
describe.skipIf(isWindows())("install.sh clean data directory", () => {
  let testDir: string;
  let dataDir: string;
  let archivePath: string;
  let configContentDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `atomic-install-sh-test-${Date.now()}`);
    dataDir = join(testDir, "data");
    archivePath = join(testDir, "config.tar.gz");
    configContentDir = join(testDir, "config-content");

    await mkdir(testDir, { recursive: true });
    await mkdir(dataDir, { recursive: true });

    // Create a tar.gz archive with known content
    await mkdir(join(configContentDir, "subdir"), { recursive: true });
    await writeFile(join(configContentDir, "new-config.txt"), "new config");
    await writeFile(join(configContentDir, "subdir", "nested.txt"), "nested");

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

  test("rm -rf and mkdir -p before tar removes stale files", () => {
    // Add stale files to the data directory
    Bun.spawnSync({ cmd: ["bash", "-c", `echo "stale" > "${dataDir}/stale-file.txt"`] });
    Bun.spawnSync({ cmd: ["bash", "-c", `mkdir -p "${dataDir}/stale-dir" && echo "old" > "${dataDir}/stale-dir/old.txt"`] });

    expect(existsSync(join(dataDir, "stale-file.txt"))).toBe(true);
    expect(existsSync(join(dataDir, "stale-dir", "old.txt"))).toBe(true);

    // Execute the same commands as install.sh: rm -rf, mkdir -p, tar -xzf
    const result = Bun.spawnSync({
      cmd: [
        "bash", "-c",
        `rm -rf "${dataDir}" && mkdir -p "${dataDir}" && tar -xzf "${archivePath}" -C "${dataDir}"`,
      ],
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.success).toBe(true);

    // Stale files should be gone
    expect(existsSync(join(dataDir, "stale-file.txt"))).toBe(false);
    expect(existsSync(join(dataDir, "stale-dir"))).toBe(false);

    // New files should be present
    expect(existsSync(join(dataDir, "new-config.txt"))).toBe(true);
    expect(existsSync(join(dataDir, "subdir", "nested.txt"))).toBe(true);
  });

  test("tar without rm leaves stale files in place", () => {
    // Add a stale file
    Bun.spawnSync({ cmd: ["bash", "-c", `echo "stale" > "${dataDir}/stale-file.txt"`] });

    expect(existsSync(join(dataDir, "stale-file.txt"))).toBe(true);

    // Extract without rm - simulating the old behavior
    const result = Bun.spawnSync({
      cmd: ["bash", "-c", `tar -xzf "${archivePath}" -C "${dataDir}"`],
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.success).toBe(true);

    // Stale file should still exist (this is the bug)
    expect(existsSync(join(dataDir, "stale-file.txt"))).toBe(true);

    // New files should also be present
    expect(existsSync(join(dataDir, "new-config.txt"))).toBe(true);
  });

  test("rm -rf on non-existent directory succeeds", () => {
    const nonExistent = join(testDir, "does-not-exist");

    const result = Bun.spawnSync({
      cmd: ["bash", "-c", `rm -rf "${nonExistent}"`],
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.success).toBe(true);
  });

  test("mkdir -p recreates directory after rm -rf", () => {
    // Remove directory
    Bun.spawnSync({ cmd: ["bash", "-c", `rm -rf "${dataDir}"`] });
    expect(existsSync(dataDir)).toBe(false);

    // mkdir -p recreates it
    Bun.spawnSync({ cmd: ["bash", "-c", `mkdir -p "${dataDir}"`] });
    expect(existsSync(dataDir)).toBe(true);
  });

  test("install.sh contains the rm -rf and mkdir -p commands before tar", async () => {
    // Verify the install.sh script has the correct sequence
    const installScript = await Bun.file(join(__dirname, "../install.sh")).text();

    // Find the extraction section and verify rm/mkdir are before tar
    const extractionSection = installScript.match(
      /# Extract config files to data directory.*?\n([\s\S]*?)# Verify installation/
    );

    expect(extractionSection).not.toBeNull();
    const section = extractionSection![1]!;

    // Verify the correct order: rm before mkdir before tar
    const rmIndex = section.indexOf('rm -rf "$DATA_DIR"');
    const mkdirIndex = section.indexOf('mkdir -p "$DATA_DIR"');
    const tarIndex = section.indexOf("tar -xzf");

    expect(rmIndex).toBeGreaterThan(-1);
    expect(mkdirIndex).toBeGreaterThan(-1);
    expect(tarIndex).toBeGreaterThan(-1);
    expect(rmIndex).toBeLessThan(mkdirIndex);
    expect(mkdirIndex).toBeLessThan(tarIndex);
  });
});
