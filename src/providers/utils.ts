/**
 * Provider Utilities
 *
 * Shared utility functions for source control providers.
 */

import { spawn } from "child_process";

/**
 * Check if a command exists in the system PATH
 *
 * @param command - The command to check (e.g., 'git', 'sl', 'gh')
 * @returns Promise resolving to true if the command exists, false otherwise
 */
export async function commandExists(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const isWindows = process.platform === "win32";
    const checkCommand = isWindows ? "where" : "which";

    const proc = spawn(checkCommand, [command], {
      stdio: ["ignore", "ignore", "ignore"],
    });

    proc.on("close", (code) => {
      resolve(code === 0);
    });

    proc.on("error", () => {
      resolve(false);
    });
  });
}
