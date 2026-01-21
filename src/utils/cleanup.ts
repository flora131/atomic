/**
 * Cleanup utility for Windows leftover files
 *
 * On Windows, the uninstall and update commands create temporary files
 * (.delete and .old) because Windows cannot delete/overwrite running executables.
 * This module provides a cleanup function that runs at startup to remove
 * these leftover files when they're no longer locked.
 */

import { rm } from "fs/promises";
import { existsSync } from "fs";

import { getBinaryPath } from "./config-path";
import { isWindows } from "./detect";

/**
 * Attempt to remove a file if it exists.
 * Silently ignores errors (file may be locked).
 *
 * @param filePath - Path to the file to remove
 * @returns True if file was removed or didn't exist, false if removal failed
 */
export async function tryRemoveFile(filePath: string): Promise<boolean> {
  if (!existsSync(filePath)) {
    return true;
  }

  try {
    await rm(filePath, { force: true });
    return true;
  } catch {
    // Silently ignore - file may still be locked
    return false;
  }
}

/**
 * Clean up leftover files at a given binary path.
 * Removes .delete and .old files that may be left over from
 * previous uninstall/update operations on Windows.
 *
 * @param binaryPath - Path to the binary (without extension)
 */
export async function cleanupLeftoverFilesAt(binaryPath: string): Promise<void> {
  const deletePath = binaryPath + ".delete";
  const oldPath = binaryPath + ".old";

  await tryRemoveFile(deletePath);
  await tryRemoveFile(oldPath);
}

/**
 * Clean up leftover Windows files from previous uninstall/update operations.
 *
 * On Windows, when uninstalling or updating:
 * - Uninstall renames the binary to .delete (can't delete running executable)
 * - Update renames the old binary to .old before replacing
 *
 * These files persist until manually removed or system restart.
 * This function attempts to clean them up at startup when they're no longer locked.
 *
 * This function is safe to call on any platform - it's a no-op on non-Windows.
 * All errors are silently ignored since cleanup is best-effort.
 */
export async function cleanupWindowsLeftoverFiles(): Promise<void> {
  // Only relevant on Windows
  if (!isWindows()) {
    return;
  }

  const binaryPath = getBinaryPath();
  await cleanupLeftoverFilesAt(binaryPath);
}
