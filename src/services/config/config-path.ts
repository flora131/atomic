/**
 * Config path resolution for different installation types
 *
 * Supports three installation modes:
 * 1. Source/Development: Running from source with `bun run src/cli.ts`
 * 2. npm/bun installed: Installed via a package manager (npm/bun)
 * 3. Binary executable: Installed via install.sh/install.ps1
 *
 * For binary installs, config files are stored in a data directory:
 * - Unix: ~/.local/share/atomic (or $XDG_DATA_HOME/atomic)
 * - Windows: %LOCALAPPDATA%\atomic
 */

import { join, dirname } from "path";
import { existsSync } from "fs";
import { isWindows } from "@/services/system/detect.ts";

/** Installation type for the CLI */
export type InstallationType = "source" | "npm" | "binary";

/**
 * Detect how the CLI was installed.
 *
 * Detection logic:
 * - Binary: import.meta.dir contains '$bunfs' (Bun compiled executable)
 * - npm: import.meta.dir contains 'node_modules'
 * - Source: Everything else (development mode)
 */
export function detectInstallationType(): InstallationType {
  const dir = import.meta.dir;

  // Bun compiled executables use a virtual filesystem with '$bunfs' prefix
  // On Windows this can manifest as drive letters like 'B:\' when navigating up
  if (dir.includes("$bunfs") || dir.startsWith("B:\\") || dir.startsWith("b:\\")) {
    return "binary";
  }

  // Check for node_modules in path (npm/bun installed)
  if (dir.includes("node_modules")) {
    return "npm";
  }

  // Default to source (development mode)
  return "source";
}

/**
 * Get the data directory for binary installations.
 *
 * Follows XDG Base Directory spec on Unix, and uses LOCALAPPDATA on Windows.
 * - Unix: $XDG_DATA_HOME/atomic or ~/.local/share/atomic
 * - Windows: %LOCALAPPDATA%\atomic
 */
export function getBinaryDataDir(): string {
  if (isWindows()) {
    // Windows: use LOCALAPPDATA
    const localAppData = process.env.LOCALAPPDATA || join(process.env.USERPROFILE || "", "AppData", "Local");
    return join(localAppData, "atomic");
  }

  // Unix: follow XDG Base Directory spec
  const xdgDataHome = process.env.XDG_DATA_HOME || join(process.env.HOME || "", ".local", "share");
  return join(xdgDataHome, "atomic");
}

/**
 * Get the root directory where config folders (.claude, .opencode, .github) are stored.
 *
 * Path resolution by installation type:
 * - Source: Navigate up from src/utils to repo root
 * - npm: Navigate up from node_modules to package root
 * - Binary: Use the dedicated data directory (~/.local/share/atomic or %LOCALAPPDATA%\atomic)
 *
 * @returns The path to the config root directory
 * @throws Error if binary data directory is not found and ensureConfigDataDir() hasn't been called
 */
export function getConfigRoot(): string {
  const installType = detectInstallationType();

  if (installType === "binary") {
    return getBinaryDataDir();
  }

  // For source and npm installs, navigate up from the current file
  // src/services/config/config-path.ts -> ../../.. -> package/repo root
  return join(import.meta.dir, "..", "..", "..");
}

const REQUIRED_BINARY_CONFIG_PATHS = [
  join(".claude", "agents"),
  join(".opencode", "agents"),
  join(".github", "agents"),
  join(".github", "lsp.json"),
];

function hasRequiredBinaryConfigData(dataDir: string = getBinaryDataDir()): boolean {
  return REQUIRED_BINARY_CONFIG_PATHS.every((relativePath) =>
    existsSync(join(dataDir, relativePath)),
  );
}

/**
 * Check if the required config data exists for binary installs.
 * This can be used to provide better error messages before operations.
 */
export function configDataDirExists(
  installType: InstallationType = detectInstallationType(),
): boolean {
  if (installType !== "binary") {
    // For source/npm installs, the config is always available
    return true;
  }

  return hasRequiredBinaryConfigData();
}

/**
 * Ensure the config data directory exists for binary installs.
 *
 * If the binary was installed without config data (e.g., via a devcontainer
 * feature that only copies the binary), this function downloads and extracts
 * the config tarball for the current version from GitHub releases.
 *
 * No-op for source/npm installs or if the required config data already exists.
 */
export async function ensureConfigDataDir(
  version: string,
  installType: InstallationType = detectInstallationType(),
): Promise<void> {
  if (configDataDirExists(installType)) {
    return;
  }

  const { withLock } = await import("@/services/system/file-lock.ts");
  const { ensureDirSync } = await import("@/services/system/copy.ts");
  const dataDir = getBinaryDataDir();

  // Ensure the data directory exists before acquiring the lock,
  // since the lock file is created inside it.
  ensureDirSync(dataDir);

  const lockTarget = join(dataDir, "config-download");

  await withLock(lockTarget, async () => {
    // Re-check after acquiring the lock — another process may have completed the download
    if (configDataDirExists(installType)) {
      return;
    }

    const { log } = await import("@clack/prompts");
    const { downloadFile, getDownloadUrl, getConfigArchiveFilename } = await import(
      "@/services/system/download.ts"
    );
    const { extractConfig } = await import("@/services/system/extract.ts");
    const { tmpdir } = await import("os");
    const { rm } = await import("fs/promises");
    const { ensureDir } = await import("@/services/system/copy.ts");

    const configFilename = getConfigArchiveFilename();
    const tmpPath = join(tmpdir(), `atomic-config-${Date.now()}`);

    try {
      await ensureDir(tmpPath);
      const configPath = join(tmpPath, configFilename);
      const tag = version.startsWith("v") ? version : `v${version}`;

      log.info("Downloading config data for first run...");
      await downloadFile(getDownloadUrl(tag, configFilename), configPath);
      await ensureDir(dataDir);
      await extractConfig(configPath, dataDir);
      log.success("Config data installed");

      // Install bundled workflow templates to ~/.atomic/workflows/
      try {
        const { installGlobalWorkflows } = await import("@/services/system/install-workflows.ts");
        const copied = await installGlobalWorkflows(dataDir);
        if (copied > 0) {
          log.info(`Installed ${copied} workflow template(s)`);
        }
      } catch {
        // Workflow installation is best-effort — don't block first run
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to download config data: ${message}\n\n` +
          `You can fix this by reinstalling:\n` +
          `  curl -fsSL https://raw.githubusercontent.com/flora131/atomic/main/install.sh | bash`,
      );
    } finally {
      await rm(tmpPath, { recursive: true, force: true }).catch(() => {});
    }
  });
}

/**
 * Get the directory where the binary is installed.
 *
 * For binary installs, derives from the actual running executable path
 * via process.execPath — this is correct regardless of where the binary
 * was installed (e.g., a legacy path left over from a previous version).
 *
 * For source/npm installs, returns the platform-standard user bin dir:
 * - Unix: ~/.local/bin
 * - Windows: %USERPROFILE%\.local\bin
 *
 * @returns The path to the binary installation directory
 */
export function getBinaryInstallDir(): string {
  const installType = detectInstallationType();

  // For compiled binary installs, derive from the actual binary location
  if (installType === "binary") {
    return dirname(process.execPath);
  }

  if (isWindows()) {
    return join(process.env.USERPROFILE || "", ".local", "bin");
  }

  return join(process.env.HOME || "", ".local", "bin");
}

/**
 * Get the full path to the atomic binary executable.
 *
 * For binary installs, returns the actual path of the running executable
 * (via process.execPath), which is correct regardless of install location.
 *
 * For non-binary installs, returns the default path:
 * - Unix: ~/.local/bin/atomic
 * - Windows: %USERPROFILE%\.local\bin\atomic.exe
 *
 * @returns The full path to the atomic binary
 */
export function getBinaryPath(): string {
  const installType = detectInstallationType();

  // For compiled binary installs, use the actual running binary path
  if (installType === "binary") {
    return process.execPath;
  }

  const dir = getBinaryInstallDir();
  const binaryName = isWindows() ? "atomic.exe" : "atomic";
  return join(dir, binaryName);
}
