/**
 * Utilities for command and platform detection
 */

export const WSL_INSTALL_URL =
  "https://learn.microsoft.com/en-us/windows/wsl/install";

/**
 * Check if a command is installed and available in PATH
 */
export function isCommandInstalled(cmd: string): boolean {
  return Bun.which(cmd) !== null;
}

/**
 * Get the version string of a command
 * Returns null if command is not installed or version check fails
 */
export function getCommandVersion(cmd: string): string | null {
  const cmdPath = Bun.which(cmd);
  if (!cmdPath) return null;

  const result = Bun.spawnSync({
    cmd: [cmdPath, "--version"],
    stdout: "pipe",
    stderr: "pipe",
  });

  if (result.success) {
    return result.stdout.toString().trim();
  }
  return null;
}

/**
 * Check if running on Windows
 */
export function isWindows(): boolean {
  return process.platform === "win32";
}

/**
 * Check if running on macOS
 */
export function isMacOS(): boolean {
  return process.platform === "darwin";
}

/**
 * Check if running on Linux
 */
export function isLinux(): boolean {
  return process.platform === "linux";
}

/**
 * Get the appropriate script extension for the current platform
 * Returns ".ps1" on Windows, ".sh" on Unix-like systems
 */
export function getScriptExtension(): string {
  return isWindows() ? ".ps1" : ".sh";
}

/**
 * Get the opposite script extension (for filtering)
 * Returns ".sh" on Windows, ".ps1" on Unix-like systems
 */
export function getOppositeScriptExtension(): string {
  return isWindows() ? ".sh" : ".ps1";
}

/**
 * Check if WSL is installed on Windows
 * Returns false on non-Windows platforms
 */
export function isWslInstalled(): boolean {
  if (!isWindows()) return false;

  const result = Bun.spawnSync({
    cmd: ["wsl", "--status"],
    stdout: "pipe",
    stderr: "pipe",
  });

  return result.success;
}

/**
 * Check if the terminal supports true color (24-bit)
 */
export function supportsTrueColor(): boolean {
  const colorTerm = process.env.COLORTERM;
  return colorTerm === "truecolor" || colorTerm === "24bit";
}

/**
 * Check if the terminal supports 256 colors
 */
export function supports256Color(): boolean {
  const term = process.env.TERM || "";
  return term.includes("256color") || supportsTrueColor();
}
