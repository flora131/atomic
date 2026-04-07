/**
 * Update command - Self-update for binary installations
 *
 * Delegates to the remote install script (install.sh / install.ps1) so that
 * the latest installation logic always runs, even when upgrading from an
 * older binary that predates new install steps.
 */

import { log, spinner } from "@clack/prompts";
import { join } from "path";
import { tmpdir } from "os";
import { rm } from "fs/promises";

import {
  detectInstallationType,
  getBinaryInstallDir,
  getBinaryDataDir,
} from "@/services/config/config-path.ts";
import { isWindows } from "@/services/system/detect.ts";
import { getPrereleasePreference } from "@/services/config/settings.ts";
import { VERSION } from "@/version.ts";
import {
  GITHUB_REPO,
  getLatestRelease,
  getLatestPrerelease,
  checkNpmPackageExists,
  downloadFile,
} from "@/services/system/download.ts";

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
  // Both stable (-1): equal
  if (pre1 === -1 && pre2 === -1) return false;
  // One stable, one prerelease: stable wins
  if (pre1 === -1) return true;
  if (pre2 === -1) return false;
  // Both prerelease: higher number wins
  return pre1 > pre2;
}

/** URL for the remote install script on the main branch. */
const INSTALL_SCRIPT_URL = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/install.sh`;
const INSTALL_PS1_URL = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/install.ps1`;

/**
 * Run the remote install script to perform the actual update.
 *
 * On Unix: downloads install.sh to a temp file and executes it via bash.
 * On Windows: invokes install.ps1 via pwsh using Invoke-RestMethod.
 *
 * Passes the resolved version and current binary/data dirs to avoid
 * race conditions and path mismatches.
 *
 * @param targetVersion - The resolved version tag to install (e.g., "v0.5.0")
 * @param usePrerelease - Whether to pass the --prerelease flag
 */
async function runRemoteInstallScript(targetVersion: string, usePrerelease: boolean): Promise<void> {
  // Pass current dirs so the install script targets the same locations
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    BIN_DIR: getBinaryInstallDir(),
    DATA_DIR: getBinaryDataDir(),
  };

  if (isWindows()) {
    const ps1Args = [
      `-Version '${targetVersion}'`,
      usePrerelease ? " -Prerelease" : "",
    ].join("");
    const proc = Bun.spawn({
      cmd: [
        "pwsh",
        "-NoProfile",
        "-Command",
        `iex "& { $(irm '${INSTALL_PS1_URL}') }${ps1Args}"`,
      ],
      stdout: "inherit",
      stderr: "inherit",
      env,
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      throw new Error(`Install script exited with code ${exitCode}`);
    }
    return;
  }

  // Unix: download install.sh to a temp file, then execute with bash
  const tempDir = join(tmpdir(), `atomic-update-${Date.now()}`);
  const scriptPath = join(tempDir, "install.sh");

  try {
    const { ensureDir } = await import("@/services/system/copy.ts");
    await ensureDir(tempDir);
    await downloadFile(INSTALL_SCRIPT_URL, scriptPath);

    const args = [targetVersion];
    if (usePrerelease) args.push("--prerelease");

    const proc = Bun.spawn({
      cmd: ["bash", scriptPath, ...args],
      stdout: "inherit",
      stderr: "inherit",
      env,
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      throw new Error(`Install script exited with code ${exitCode}`);
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Main update command handler.
 * Checks for a newer version, then delegates to the remote install script.
 */
export async function updateCommand(): Promise<void> {
  const installType = detectInstallationType();

  // Check if update is supported for this installation type
  if (installType === "npm") {
    log.error("'atomic update' is not available for npm/bun installations.");
    log.info("");
    log.info("To update atomic, reinstall using the install script:");
    log.info("  curl -fsSL https://raw.githubusercontent.com/flora131/atomic/main/install.sh | bash");
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

    // Verify the @bastani/atomic-workflows npm package is published for this version
    // before proceeding. Both the GH release and the npm package must be available.
    s.start("Verifying package availability...");
    const npmExists = await checkNpmPackageExists("@bastani/atomic-workflows", targetVersionNum);
    s.stop(npmExists ? "Package available" : "Package not yet published");

    if (!npmExists) {
      log.success("No new updates available.");
      return;
    }

    log.info(`Updating to ${targetVersion}...`);
    log.info("");

    // Delegate to the remote install script which handles everything:
    // binary download, checksums, config extraction, tooling, skills, workflows, PATH
    await runRemoteInstallScript(targetVersion, usePrerelease);
  } catch (error) {
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
