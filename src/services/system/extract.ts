/**
 * Config archive extraction utility.
 *
 * Extracts platform-specific config archives (tar.gz on Unix, zip on Windows)
 * into a target directory.
 */

import { ensureDir } from "@/services/system/copy.ts";
import { isWindows } from "@/services/system/detect.ts";

/**
 * Extract config archive to data directory.
 *
 * @param archivePath - Path to the downloaded archive
 * @param dataDir - Path to the data directory where configs should be extracted
 */
export async function extractConfig(archivePath: string, dataDir: string): Promise<void> {
  // Ensure data directory exists
  await ensureDir(dataDir);

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
