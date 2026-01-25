/**
 * Config path resolution for different installation types
 *
 * Supports three installation modes:
 * 1. Source/Development: Running from source with `bun run src/cli.ts`
 * 2. npm/bun installed: Installed via `npm install -g @bastani/atomic`
 * 3. Binary executable: Installed via install.sh/install.ps1
 *
 * For binary installs, config files are stored in a data directory:
 * - Unix: ~/.local/share/atomic (or $XDG_DATA_HOME/atomic)
 * - Windows: %LOCALAPPDATA%\atomic
 */

import { join } from "path";
import { existsSync } from "fs";
import { isWindows } from "./detect";

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
 * - npm: Navigate up from node_modules/@bastani/atomic/src/utils to package root
 * - Binary: Use the dedicated data directory (~/.local/share/atomic or %LOCALAPPDATA%\atomic)
 *
 * @returns The path to the config root directory
 * @throws Error if binary data directory is not found (install may be incomplete)
 */
export function getConfigRoot(): string {
  const installType = detectInstallationType();

  if (installType === "binary") {
    const dataDir = getBinaryDataDir();

    // Validate that the data directory exists for binary installs
    if (!existsSync(dataDir)) {
      throw new Error(
        `Config data directory not found: ${dataDir}\n\n` +
          `This usually means the installation is incomplete.\n` +
          `Please reinstall using the install script:\n` +
          `  curl -fsSL https://raw.githubusercontent.com/flora131/atomic/main/install.sh | bash`
      );
    }

    return dataDir;
  }

  // For source and npm installs, navigate up from the current file
  // src/utils/config-path.ts -> ../.. -> src -> .. -> package/repo root
  return join(import.meta.dir, "..", "..");
}

/**
 * Check if the config data directory exists (for binary installs).
 * This can be used to provide better error messages before operations.
 */
export function configDataDirExists(): boolean {
  const installType = detectInstallationType();

  if (installType !== "binary") {
    // For source/npm installs, the config is always available
    return true;
  }

  return existsSync(getBinaryDataDir());
}

/**
 * Get the directory where the binary is installed.
 *
 * Default locations:
 * - Unix: ~/.local/bin
 * - Windows: %USERPROFILE%\.local\bin
 *
 * Can be overridden via ATOMIC_INSTALL_DIR environment variable.
 *
 * @returns The path to the binary installation directory
 */
export function getBinaryInstallDir(): string {
  // Allow override via environment variable
  if (process.env.ATOMIC_INSTALL_DIR) {
    return process.env.ATOMIC_INSTALL_DIR;
  }

  if (isWindows()) {
    return join(process.env.USERPROFILE || "", ".local", "bin");
  }

  return join(process.env.HOME || "", ".local", "bin");
}

/**
 * Get the full path to the atomic binary executable.
 *
 * Returns platform-specific binary path:
 * - Unix: ~/.local/bin/atomic
 * - Windows: %USERPROFILE%\.local\bin\atomic.exe
 *
 * @returns The full path to the atomic binary
 */
export function getBinaryPath(): string {
  const dir = getBinaryInstallDir();
  const binaryName = isWindows() ? "atomic.exe" : "atomic";
  return join(dir, binaryName);
}
