/**
 * Cleanup utility for Windows leftover files
 *
 * On Windows, the uninstall and update commands create temporary files
 * (.delete and .old) because Windows cannot delete/overwrite running executables.
 * This module provides a cleanup function that runs at startup to remove
 * these leftover files when they're no longer locked.
 */

import { rm, readdir } from "fs/promises";
import { existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

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
 * Clean up Bun's temporary native addon files from the OS temp directory.
 *
 * Bun-compiled binaries extract embedded native addons (.dll/.so/.dylib/.node)
 * to the OS temp directory at runtime with hash-based filenames
 * (e.g., `.3ff63fefebffffbf-00000001.dll`). After an update or uninstall,
 * these files become orphaned and should be cleaned up.
 *
 * Locked files (from currently running processes) are silently skipped.
 */
export async function cleanupBunTempNativeAddons(): Promise<void> {
  try {
    const tempDir = tmpdir();
    const files = await readdir(tempDir);

    // Bun temp native addon pattern: .{hex}-{hex}.{dll|so|dylib|node}
    const bunTempPattern = /^\.[0-9a-f]+-[0-9a-f]+\.(dll|so|dylib|node)$/i;

    for (const file of files) {
      if (bunTempPattern.test(file)) {
        await tryRemoveFile(join(tempDir, file));
      }
    }
  } catch {
    // Best-effort cleanup - ignore all errors
  }
}

/**
 * Clean up leftover Windows files from previous uninstall/update operations.
 *
 * On Windows, when uninstalling or updating:
 * - Uninstall renames the binary to .delete (can't delete running executable)
 * - Update renames the old binary to .old before replacing
 * - Bun extracts native addons to temp as .dll files that become orphaned
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
  await cleanupBunTempNativeAddons();
}
