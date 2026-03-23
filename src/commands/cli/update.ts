/**
 * Update command - Self-update for binary installations
 *
 * Upgrades to the latest available version automatically.
 */

import { spinner, log } from "@clack/prompts";
import { join } from "path";
import { tmpdir } from "os";
import { mkdir, rm, rename, chmod, copyFile as fsCopyFile, unlink } from "fs/promises";
import { existsSync } from "fs";

import {
  detectInstallationType,
  getBinaryPath,
  getBinaryDataDir,
} from "@/services/config/config-path.ts";
import { syncAtomicGlobalAgentConfigs } from "@/services/config/atomic-global-config.ts";
import { isWindows } from "@/services/system/detect.ts";
import { getPrereleasePreference } from "@/services/config/settings.ts";
import { VERSION } from "@/version.ts";
import {
  ChecksumMismatchError,
  getLatestRelease,
  getLatestPrerelease,
  downloadFile,
  verifyChecksum,
  getBinaryFilename,
  getConfigArchiveFilename,
  getDownloadUrl,
  getChecksumsUrl,
} from "@/services/system/download.ts";
import { cleanupBunTempNativeAddons } from "@/services/system/cleanup.ts";
import { trackAtomicCommand } from "@/services/telemetry/index.ts";

/**
 * Parse a version string into its components.
 * Handles formats like "0.4.22" and "0.4.22-1" (prerelease suffix).
 */
function parseVersion(v: string): [number, number, number, number] {
  const clean = v.replace(/^v/, "");
  const [mainPart, prePart] = clean.split("-");
  const parts = (mainPart || "").split(".").map(Number);
  const pre = prePart !== undefined ? Number(prePart) : -1; // -1 means stable (no prerelease suffix)
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0, pre];
}

/**
 * Compare two version strings (supports prerelease suffixes).
 * Returns true if v1 > v2.
 *
 * Prerelease ordering: 0.4.22-1 < 0.4.22-2 < 0.4.22 (stable).
 * A stable release is always newer than a prerelease of the same major.minor.patch.
 *
 * @param v1 - First version string (with or without 'v' prefix)
 * @param v2 - Second version string (with or without 'v' prefix)
 * @returns True if v1 is newer than v2
 */
export function isNewerVersion(v1: string, v2: string): boolean {
  const [major1, minor1, patch1, pre1] = parseVersion(v1);
  const [major2, minor2, patch2, pre2] = parseVersion(v2);

  if (major1 !== major2) return major1 > major2;
  if (minor1 !== minor2) return minor1 > minor2;
  if (patch1 !== patch2) return patch1 > patch2;
  // Both stable (-1): equal; one stable, one pre: stable wins; both pre: higher wins
  return pre1 > pre2;
}

/**
 * Move a file across filesystems by falling back to copy + unlink
 * when rename fails with EXDEV (cross-device link).
 */
async function crossDeviceRename(src: string, dest: string): Promise<void> {
  try {
    await rename(src, dest);
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && err.code === "EXDEV") {
      await fsCopyFile(src, dest);
      await unlink(src);
    } else {
      throw err;
    }
  }
}

/**
 * Replace binary on Unix systems using atomic rename.
 * Falls back to copy + unlink for cross-device moves (e.g. WSL).
 *
 * @param newBinaryPath - Path to the new binary in temp directory
 * @param targetPath - Path where the binary should be installed
 */
async function replaceBinaryUnix(newBinaryPath: string, targetPath: string): Promise<void> {
  // Make executable
  await chmod(newBinaryPath, 0o755);
  // Atomic rename (replaces existing), with cross-device fallback
  await crossDeviceRename(newBinaryPath, targetPath);
}

/**
 * Replace binary on Windows using rename strategy for locked executables.
 * Windows doesn't allow overwriting a running executable, so we:
 * 1. Rename the running executable to .old
 * 2. Move the new binary to the target location
 * 3. Try to delete the .old file (may fail if still running)
 *
 * @param newBinaryPath - Path to the new binary in temp directory
 * @param targetPath - Path where the binary should be installed
 */
async function replaceBinaryWindows(newBinaryPath: string, targetPath: string): Promise<void> {
  const oldPath = targetPath + ".old";

  // Clean up any previous .old file
  if (existsSync(oldPath)) {
    try {
      await rm(oldPath, { force: true });
    } catch {
      // Ignore - may still be locked from previous update
    }
  }

  // Rename running executable to .old
  await rename(targetPath, oldPath);

  try {
    // Move new binary to target location (with cross-device fallback)
    await crossDeviceRename(newBinaryPath, targetPath);
  } catch (e) {
    // Rollback: restore old binary
    await rename(oldPath, targetPath);
    throw e;
  }

  // Try to delete old binary (may fail if still running)
  try {
    await rm(oldPath, { force: true });
  } catch {
    // Will be cleaned up on next update
    log.warn(`Could not remove old binary: ${oldPath}`);
    log.warn("It will be cleaned up automatically on next update.");
  }
}

/**
 * Extract config archive to data directory.
 *
 * @param archivePath - Path to the downloaded archive
 * @param dataDir - Path to the data directory where configs should be extracted
 */
export async function extractConfig(archivePath: string, dataDir: string): Promise<void> {
  // Ensure data directory exists
  await mkdir(dataDir, { recursive: true });

  if (isWindows()) {
    // Use PowerShell's Expand-Archive for zip files
    const result = Bun.spawnSync({
      cmd: [
        "powershell",
        "-Command",
        `Expand-Archive -Path '${archivePath}' -DestinationPath '${dataDir}' -Force`,
      ],
      stdout: "pipe",
      stderr: "pipe",
    });

    if (!result.success) {
      throw new Error(`Failed to extract config: ${result.stderr.toString()}`);
    }
  } else {
    // Use tar for .tar.gz files
    const result = Bun.spawnSync({
      cmd: ["tar", "-xzf", archivePath, "-C", dataDir],
      stdout: "pipe",
      stderr: "pipe",
    });

    if (!result.success) {
      throw new Error(`Failed to extract config: ${result.stderr.toString()}`);
    }
  }
}

/**
 * Main update command handler.
 * Upgrades to the latest available version automatically.
 */
export async function updateCommand(): Promise<void> {
  const installType = detectInstallationType();

  // Check if update is supported for this installation type
  if (installType === "npm") {
    log.error("'atomic update' is not available for npm/bun installations.");
    log.info("");
    log.info("To update atomic, use your package manager:");
    log.info("  bun upgrade @bastani/atomic");
    log.info("  # or");
    log.info("  npm update -g @bastani/atomic");
    process.exit(1);
  }

  if (installType === "source") {
    log.error("'atomic update' is not available in development mode.");
    log.info("");
    log.info("To update atomic from source:");
    log.info("  git pull");
    log.info("  bun install");
    process.exit(1);
  }

  // Binary installation - proceed with update
  const s = spinner();

  try {
    const usePrerelease = getPrereleasePreference();
    s.start(usePrerelease ? "Checking for prerelease updates..." : "Checking for updates...");

    const releaseInfo = usePrerelease ? await getLatestPrerelease() : await getLatestRelease();
    const targetVersion = releaseInfo.tagName;
    const targetVersionNum = targetVersion.replace(/^v/, "");
    s.stop(`Current version: v${VERSION}${usePrerelease ? " (prerelease channel)" : ""}`);

    // Check if already on latest
    if (!isNewerVersion(targetVersionNum, VERSION)) {
      log.success("You're already running the latest version!");
      return;
    }

    log.info(`Updating to ${targetVersion}...`);

    // Create temp directory for downloads
    const tempDir = join(tmpdir(), `atomic-update-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });

    try {
      const binaryFilename = getBinaryFilename();
      const configFilename = getConfigArchiveFilename();

      // Download binary
      s.start(`Downloading ${binaryFilename}...`);
      const binaryPath = join(tempDir, binaryFilename);
      await downloadFile(getDownloadUrl(targetVersion, binaryFilename), binaryPath, (percent) =>
        s.message(`Downloading ${binaryFilename}... ${percent}%`)
      );
      s.stop(`Downloaded ${binaryFilename}`);

      // Download config archive
      s.start(`Downloading ${configFilename}...`);
      const configPath = join(tempDir, configFilename);
      await downloadFile(getDownloadUrl(targetVersion, configFilename), configPath);
      s.stop(`Downloaded ${configFilename}`);

      // Download and verify checksums
      s.start("Verifying checksums...");
      const checksumsPath = join(tempDir, "checksums.txt");
      await downloadFile(getChecksumsUrl(targetVersion), checksumsPath);
      const checksumsTxt = await Bun.file(checksumsPath).text();

      const binaryValid = await verifyChecksum(binaryPath, checksumsTxt, binaryFilename);
      if (!binaryValid) {
        throw new ChecksumMismatchError(binaryFilename);
      }

      const configValid = await verifyChecksum(configPath, checksumsTxt, configFilename);
      if (!configValid) {
        throw new ChecksumMismatchError(configFilename);
      }
      s.stop("Checksums verified");

      // Replace binary
      s.start("Installing binary...");
      const targetBinaryPath = getBinaryPath();

      if (isWindows()) {
        await replaceBinaryWindows(binaryPath, targetBinaryPath);
      } else {
        await replaceBinaryUnix(binaryPath, targetBinaryPath);
      }
      s.stop("Binary installed");

      // Clean up stale native addon DLLs from temp directory
      await cleanupBunTempNativeAddons();

      // Update config files (clean install - remove stale artifacts)
      s.start("Updating config files...");
      const dataDir = getBinaryDataDir();
      await rm(dataDir, { recursive: true, force: true });
      await extractConfig(configPath, dataDir);

      // Sync globally discoverable agent configs into provider home roots
      await syncAtomicGlobalAgentConfigs(dataDir);
      s.stop("Config files updated");

      // Update @bastani/atomic workflow SDK globally
      s.start("Updating @bastani/atomic workflow SDK...");
      const sdkResult = Bun.spawnSync(["bun", "install", "-g", "@bastani/atomic@latest"], {
        stdout: "ignore",
        stderr: "pipe",
      });
      if (sdkResult.exitCode === 0) {
        s.stop("Workflow SDK updated");
      } else {
        s.stop("Workflow SDK update failed");
        log.warn("Could not update @bastani/atomic workflow SDK. Run manually: bun install -g @bastani/atomic@latest");
      }

      // Verify installation
      s.start("Verifying installation...");
      const verifyResult = Bun.spawnSync({
        cmd: [targetBinaryPath, "--version"],
        stdout: "pipe",
        stderr: "pipe",
      });

      if (!verifyResult.success) {
        throw new Error("Installation verification failed");
      }
      s.stop("Installation verified");

      // Track successful update command
      trackAtomicCommand("update", null, true);

      log.success(`Successfully updated to ${targetVersion}!`);
      log.info("");
      log.info("Run 'atomic --help' to see what's new.");
    } finally {
      // Cleanup temp directory
      await rm(tempDir, { recursive: true, force: true });
    }
  } catch (error) {
    // Track failed update command
    trackAtomicCommand("update", null, false);

    s.stop("Update failed");
    const message = error instanceof Error ? error.message : String(error);
    log.error(`Update failed: ${message}`);

    if (message.includes("rate limit")) {
      log.info("");
      log.info("To avoid rate limits, set the GITHUB_TOKEN environment variable:");
      log.info("  export GITHUB_TOKEN=<your-token>");
    }

    if (message.includes("not found") || message.includes("404")) {
      log.info("");
      log.info("This version may not exist. Check available versions at:");
      log.info("  https://github.com/flora131/atomic/releases");
    }

    process.exit(1);
  }
}
