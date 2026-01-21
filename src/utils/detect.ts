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
 * Get the resolved absolute path to a command executable.
 *
 * On Windows, this properly resolves .cmd, .bat, .exe and other executable
 * extensions through Bun.which(), which handles the PATHEXT environment
 * variable. This is essential for spawning commands correctly on Windows
 * where 'opencode' might actually be 'opencode.cmd'.
 *
 * @param cmd - The command name to resolve (e.g., 'opencode', 'claude')
 * @returns The absolute path to the command, or null if not found
 */
export function getCommandPath(cmd: string): string | null {
  return Bun.which(cmd);
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

  return Bun.which("wsl") !== null;
}

/**
 * Check if colors are enabled (respects NO_COLOR standard)
 * See: https://no-color.org/
 */
export function supportsColor(): boolean {
  // NO_COLOR standard: if set (any value), disable colors
  if (process.env.NO_COLOR !== undefined) {
    return false;
  }
  return true;
}

/**
 * Check if the terminal supports true color (24-bit)
 *
 * Following gemini-cli pattern: default to true for modern terminals,
 * only disable when NO_COLOR is set. Most terminals today support
 * true color even without COLORTERM being explicitly set.
 */
export function supportsTrueColor(): boolean {
  // Respect NO_COLOR standard first
  if (!supportsColor()) {
    return false;
  }

  // Default to true - most modern terminals support true color
  // Only explicit indicators are used as hints, not requirements
  return true;
}

/**
 * Check if the terminal supports 256 colors
 *
 * Note: This returns true when supportsTrueColor() returns true.
 * Since supportsTrueColor() defaults to true for modern terminals,
 * this function will also return true in most cases. This is intentional -
 * most modern terminals support at least 256 colors.
 */
export function supports256Color(): boolean {
  const term = process.env.TERM || "";
  return term.includes("256color") || supportsTrueColor();
}
