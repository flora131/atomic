import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, writeFile, readdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { extractConfig } from "../src/commands/update";
import { isWindows } from "../src/utils/detect";

/**
 * Cross-path verification tests for clean data directory behavior.
 *
 * Verifies that no stale artifacts remain after update or re-install
 * across all three code paths:
 * 1. TypeScript updateCommand (rm + extractConfig)
 * 2. install.sh (rm -rf + mkdir -p + tar)
 * 3. install.ps1 (Remove-Item + New-Item + Expand-Archive)
 *
 * For paths 2 and 3, we simulate the shell commands since the full
 * scripts require network access and GitHub releases.
 *
 * NOTE: These tests are skipped on Windows because they require bash and tar
 * commands that are not natively available on Windows.
 */
describe.skipIf(isWindows())("cross-path stale artifact verification", () => {
  let testDir: string;
  let dataDir: string;
  let archivePath: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `atomic-verify-clean-${Date.now()}`);
    dataDir = join(testDir, "data");
    archivePath = join(testDir, "config.tar.gz");

    await mkdir(testDir, { recursive: true });
    await mkdir(dataDir, { recursive: true });

    // Create config content with multiple files and directories
    const configContentDir = join(testDir, "config-content");
    await mkdir(join(configContentDir, ".claude"), { recursive: true });
    await mkdir(join(configContentDir, ".opencode"), { recursive: true });
    await mkdir(join(configContentDir, ".github"), { recursive: true });
    await writeFile(join(configContentDir, ".claude", "settings.json"), '{"version": "2.0"}');
    await writeFile(join(configContentDir, ".opencode", "config.yaml"), "version: 2.0");
    await writeFile(join(configContentDir, ".github", "copilot.yml"), "version: 2.0");

    // Create tar.gz archive
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

  describe("TypeScript path (updateCommand pattern)", () => {
    test("stale files from previous version are removed after rm + extractConfig", async () => {
      // Simulate "older config set" with stale files
      await mkdir(join(dataDir, ".claude"), { recursive: true });
      await mkdir(join(dataDir, ".oldagent"), { recursive: true });
      await writeFile(join(dataDir, ".claude", "settings.json"), '{"version": "1.0"}');
      await writeFile(join(dataDir, ".claude", "old-plugin.js"), "// deprecated plugin");
      await writeFile(join(dataDir, ".oldagent", "config.toml"), "old = true");
      await writeFile(join(dataDir, "stale-root-file.txt"), "should be removed");

      // Verify stale files exist
      expect(existsSync(join(dataDir, ".claude", "old-plugin.js"))).toBe(true);
      expect(existsSync(join(dataDir, ".oldagent", "config.toml"))).toBe(true);
      expect(existsSync(join(dataDir, "stale-root-file.txt"))).toBe(true);

      // Execute the update pattern: rm then extractConfig
      await rm(dataDir, { recursive: true, force: true });
      await extractConfig(archivePath, dataDir);

      // Stale files should be gone
      expect(existsSync(join(dataDir, ".claude", "old-plugin.js"))).toBe(false);
      expect(existsSync(join(dataDir, ".oldagent"))).toBe(false);
      expect(existsSync(join(dataDir, "stale-root-file.txt"))).toBe(false);

      // New files should be present with updated content
      expect(existsSync(join(dataDir, ".claude", "settings.json"))).toBe(true);
      expect(existsSync(join(dataDir, ".opencode", "config.yaml"))).toBe(true);
      expect(existsSync(join(dataDir, ".github", "copilot.yml"))).toBe(true);

      // Verify content is from the new version
      const settings = await Bun.file(join(dataDir, ".claude", "settings.json")).text();
      expect(settings).toContain('"version": "2.0"');
    });

    test("deeply nested stale files are removed", async () => {
      // Create deeply nested stale structure
      await mkdir(join(dataDir, "a", "b", "c", "d"), { recursive: true });
      await writeFile(join(dataDir, "a", "b", "c", "d", "deep.txt"), "deep stale");

      await rm(dataDir, { recursive: true, force: true });
      await extractConfig(archivePath, dataDir);

      expect(existsSync(join(dataDir, "a"))).toBe(false);
    });
  });

  describe("install.sh path (shell commands)", () => {
    test("stale files are removed by rm -rf + mkdir -p + tar sequence", () => {
      // Add stale files
      Bun.spawnSync({
        cmd: ["bash", "-c", `
          mkdir -p "${dataDir}/.oldagent"
          echo "stale" > "${dataDir}/stale.txt"
          echo "old" > "${dataDir}/.oldagent/config.toml"
          mkdir -p "${dataDir}/.claude"
          echo "old plugin" > "${dataDir}/.claude/old-plugin.js"
        `],
      });

      expect(existsSync(join(dataDir, "stale.txt"))).toBe(true);
      expect(existsSync(join(dataDir, ".oldagent", "config.toml"))).toBe(true);
      expect(existsSync(join(dataDir, ".claude", "old-plugin.js"))).toBe(true);

      // Execute the install.sh pattern
      const result = Bun.spawnSync({
        cmd: ["bash", "-c", `
          rm -rf "${dataDir}"
          mkdir -p "${dataDir}"
          tar -xzf "${archivePath}" -C "${dataDir}"
        `],
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(result.success).toBe(true);

      // Stale files should be gone
      expect(existsSync(join(dataDir, "stale.txt"))).toBe(false);
      expect(existsSync(join(dataDir, ".oldagent"))).toBe(false);
      expect(existsSync(join(dataDir, ".claude", "old-plugin.js"))).toBe(false);

      // New files should be present
      expect(existsSync(join(dataDir, ".claude", "settings.json"))).toBe(true);
      expect(existsSync(join(dataDir, ".opencode", "config.yaml"))).toBe(true);
      expect(existsSync(join(dataDir, ".github", "copilot.yml"))).toBe(true);
    });

    test("hidden files (dotfiles) in stale directory are removed", () => {
      Bun.spawnSync({
        cmd: ["bash", "-c", `
          mkdir -p "${dataDir}/.hidden-dir"
          echo "hidden" > "${dataDir}/.hidden-file"
          echo "nested hidden" > "${dataDir}/.hidden-dir/.nested-hidden"
        `],
      });

      expect(existsSync(join(dataDir, ".hidden-file"))).toBe(true);
      expect(existsSync(join(dataDir, ".hidden-dir", ".nested-hidden"))).toBe(true);

      const result = Bun.spawnSync({
        cmd: ["bash", "-c", `
          rm -rf "${dataDir}"
          mkdir -p "${dataDir}"
          tar -xzf "${archivePath}" -C "${dataDir}"
        `],
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(result.success).toBe(true);
      expect(existsSync(join(dataDir, ".hidden-file"))).toBe(false);
      expect(existsSync(join(dataDir, ".hidden-dir"))).toBe(false);
    });
  });

  describe("install.ps1 path (PowerShell commands simulated with bash)", () => {
    /**
     * Since PowerShell is not available on all platforms, we simulate
     * the Remove-Item + New-Item + extraction behavior using equivalent
     * bash commands that perform the same logical operations.
     */
    test("stale files are removed by simulated Remove-Item + New-Item + extract", async () => {
      // Add stale files
      await mkdir(join(dataDir, ".oldagent"), { recursive: true });
      await writeFile(join(dataDir, "stale.txt"), "stale content");
      await writeFile(join(dataDir, ".oldagent", "config.toml"), "old = true");

      expect(existsSync(join(dataDir, "stale.txt"))).toBe(true);
      expect(existsSync(join(dataDir, ".oldagent", "config.toml"))).toBe(true);

      // Simulate PowerShell behavior:
      // if (Test-Path $DataDir) { Remove-Item -Recurse -Force $DataDir }
      // $null = New-Item -ItemType Directory -Force -Path $DataDir
      // Expand-Archive -Path $TempConfig -DestinationPath $DataDir -Force
      if (existsSync(dataDir)) {
        await rm(dataDir, { recursive: true, force: true });
      }
      await mkdir(dataDir, { recursive: true });
      // Simulate Expand-Archive with tar (same logical operation)
      const result = Bun.spawnSync({
        cmd: ["tar", "-xzf", archivePath, "-C", dataDir],
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(result.success).toBe(true);

      // Stale files should be gone
      expect(existsSync(join(dataDir, "stale.txt"))).toBe(false);
      expect(existsSync(join(dataDir, ".oldagent"))).toBe(false);

      // New files should be present
      expect(existsSync(join(dataDir, ".claude", "settings.json"))).toBe(true);
      expect(existsSync(join(dataDir, ".opencode", "config.yaml"))).toBe(true);
    });

    test("first install works when directory does not exist (Test-Path guard)", async () => {
      // Remove the data dir to simulate first install
      await rm(dataDir, { recursive: true, force: true });
      expect(existsSync(dataDir)).toBe(false);

      // Simulate PowerShell pattern with Test-Path guard
      if (existsSync(dataDir)) {
        await rm(dataDir, { recursive: true, force: true });
      }
      await mkdir(dataDir, { recursive: true });
      const result = Bun.spawnSync({
        cmd: ["tar", "-xzf", archivePath, "-C", dataDir],
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(result.success).toBe(true);

      // New files should be present
      expect(existsSync(join(dataDir, ".claude", "settings.json"))).toBe(true);
    });
  });

  describe("consistency across all paths", () => {
    test("all paths produce identical directory contents after clean install", async () => {
      // Path 1: TypeScript (rm + extractConfig)
      const tsDir = join(testDir, "ts-result");
      await mkdir(tsDir, { recursive: true });
      await writeFile(join(tsDir, "stale.txt"), "stale");
      await rm(tsDir, { recursive: true, force: true });
      await extractConfig(archivePath, tsDir);

      // Path 2: Bash (rm -rf + mkdir -p + tar)
      const bashDir = join(testDir, "bash-result");
      await mkdir(bashDir, { recursive: true });
      await writeFile(join(bashDir, "stale.txt"), "stale");
      Bun.spawnSync({
        cmd: ["bash", "-c", `rm -rf "${bashDir}" && mkdir -p "${bashDir}" && tar -xzf "${archivePath}" -C "${bashDir}"`],
      });

      // Path 3: PowerShell-equivalent (rm + mkdir + tar)
      const psDir = join(testDir, "ps-result");
      await mkdir(psDir, { recursive: true });
      await writeFile(join(psDir, "stale.txt"), "stale");
      await rm(psDir, { recursive: true, force: true });
      await mkdir(psDir, { recursive: true });
      Bun.spawnSync({
        cmd: ["tar", "-xzf", archivePath, "-C", psDir],
      });

      // All three paths should have the same files
      const getFiles = async (dir: string): Promise<string[]> => {
        const result = Bun.spawnSync({
          cmd: ["bash", "-c", `find "${dir}" -type f | sort | sed "s|${dir}||"`],
          stdout: "pipe",
        });
        return result.stdout.toString().trim().split("\n").filter(Boolean);
      };

      const tsFiles = await getFiles(tsDir);
      const bashFiles = await getFiles(bashDir);
      const psFiles = await getFiles(psDir);

      expect(tsFiles).toEqual(bashFiles);
      expect(bashFiles).toEqual(psFiles);

      // None should have stale.txt
      expect(tsFiles).not.toContain("/stale.txt");
      expect(bashFiles).not.toContain("/stale.txt");
      expect(psFiles).not.toContain("/stale.txt");

      // All should have the expected config files
      expect(tsFiles).toContain("/.claude/settings.json");
      expect(tsFiles).toContain("/.opencode/config.yaml");
      expect(tsFiles).toContain("/.github/copilot.yml");
    });
  });

  describe("source code verification", () => {
    test("all three code paths contain the clean install pattern", async () => {
      // Verify update.ts has rm before extractConfig
      const updateTs = await Bun.file(join(__dirname, "../src/commands/update.ts")).text();
      const updateRmIndex = updateTs.indexOf("await rm(dataDir, { recursive: true, force: true })");
      const updateExtractIndex = updateTs.indexOf("await extractConfig(configPath, dataDir)");
      expect(updateRmIndex).toBeGreaterThan(-1);
      expect(updateExtractIndex).toBeGreaterThan(-1);
      expect(updateRmIndex).toBeLessThan(updateExtractIndex);

      // Verify install.sh has rm -rf before mkdir -p before tar in the extraction section
      const installSh = await Bun.file(join(__dirname, "../install.sh")).text();
      const extractionMatch = installSh.match(
        /# Extract config files to data directory.*?\n([\s\S]*?)# Verify installation/
      );
      expect(extractionMatch).not.toBeNull();
      const shSection = extractionMatch![1]!;
      const shRmIndex = shSection.indexOf('rm -rf "$DATA_DIR"');
      const shMkdirIndex = shSection.indexOf('mkdir -p "$DATA_DIR"');
      const shTarIndex = shSection.indexOf("tar -xzf");
      expect(shRmIndex).toBeGreaterThan(-1);
      expect(shMkdirIndex).toBeGreaterThan(-1);
      expect(shTarIndex).toBeGreaterThan(-1);
      expect(shRmIndex).toBeLessThan(shMkdirIndex);
      expect(shMkdirIndex).toBeLessThan(shTarIndex);

      // Verify install.ps1 has Remove-Item before New-Item before Expand-Archive in the extraction section
      const installPs1 = await Bun.file(join(__dirname, "../install.ps1")).text();
      const ps1ExtractionMatch = installPs1.match(
        /# Extract config files to data directory.*?\r?\n([\s\S]*?)# Verify installation/
      );
      expect(ps1ExtractionMatch).not.toBeNull();
      const psSection = ps1ExtractionMatch![1]!;
      const psRemoveIndex = psSection.indexOf("Remove-Item -Recurse -Force $DataDir");
      const psNewItemIndex = psSection.indexOf("New-Item -ItemType Directory -Force -Path $DataDir");
      const psExpandIndex = psSection.indexOf("Expand-Archive");
      expect(psRemoveIndex).toBeGreaterThan(-1);
      expect(psNewItemIndex).toBeGreaterThan(-1);
      expect(psExpandIndex).toBeGreaterThan(-1);
      expect(psRemoveIndex).toBeLessThan(psNewItemIndex);
      expect(psNewItemIndex).toBeLessThan(psExpandIndex);
    });
  });
});
