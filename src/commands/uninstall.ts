/**
 * Uninstall command - Remove binary installation
 *
 * Supports:
 * - Preview mode with --dry-run flag
 * - Auto-confirmation with --yes flag
 * - Preserving data directory with --keep-config flag
 * - Self-deletion on Unix via unlink()
 * - Rename strategy for running executable on Windows
 * - Shell-specific PATH cleanup instructions
 */

import { confirm, log, note, isCancel, cancel } from "@clack/prompts";
import { rm, rename, unlink } from "fs/promises";
import { existsSync } from "fs";

import {
  detectInstallationType,
  getBinaryPath,
  getBinaryDataDir,
  getBinaryInstallDir,
} from "../utils/config-path";
import { isWindows } from "../utils/detect";

/** Options for the uninstall command */
export interface UninstallOptions {
  /** Skip confirmation prompt */
  yes?: boolean;
  /** Keep data directory, only remove binary */
  keepConfig?: boolean;
  /** Show what would be removed without removing */
  dryRun?: boolean;
}

/**
 * Get shell config paths and cleanup instructions.
 * These instructions help users remove the PATH entry from their shell configuration.
 *
 * @returns Formatted string with cleanup instructions for various shells
 */
export function getPathCleanupInstructions(): string {
  const binDir = getBinaryInstallDir();

  if (isWindows()) {
    return `
To complete the uninstallation, remove the PATH entry:

PowerShell ($PROFILE):
  Remove the line that adds "${binDir}" to $env:Path

System Environment Variables (GUI):
  1. Open "Edit the system environment variables"
  2. Click "Environment Variables"
  3. Edit the "Path" variable in User or System variables
  4. Remove the entry: ${binDir}
`.trim();
  }

  return `
To complete the uninstallation, remove the PATH entry from your shell config:

Bash (~/.bashrc or ~/.bash_profile):
  Remove: export PATH="${binDir}:$PATH"

Zsh (~/.zshrc):
  Remove: export PATH="${binDir}:$PATH"

Fish (~/.config/fish/config.fish):
  Remove: fish_add_path ${binDir}
`.trim();
}

/**
 * Main uninstall command handler.
 *
 * @param options - Uninstall options
 */
export async function uninstallCommand(options: UninstallOptions = {}): Promise<void> {
  const installType = detectInstallationType();

  // Check if uninstall is supported for this installation type
  if (installType === "npm") {
    log.error("'atomic uninstall' is not available for npm/bun installations.");
    log.info("");
    log.info("To uninstall atomic, use your package manager:");
    log.info("  bun remove -g @bastani/atomic");
    log.info("  # or");
    log.info("  npm uninstall -g @bastani/atomic");
    process.exit(1);
  }

  if (installType === "source") {
    log.error("'atomic uninstall' is not applicable for source installations.");
    log.info("");
    log.info("To remove atomic from source:");
    log.info("  1. Delete the cloned repository directory");
    log.info("  2. Run 'bun unlink' if you linked it globally");
    process.exit(1);
  }

  // Binary installation - proceed with uninstall
  const binaryPath = getBinaryPath();
  const dataDir = getBinaryDataDir();

  const binaryExists = existsSync(binaryPath);
  const dataDirExists = existsSync(dataDir);

  if (!binaryExists && !dataDirExists) {
    log.success("Atomic is already uninstalled (no files found).");
    return;
  }

  // Show what will be removed
  log.info("This will remove:");
  if (binaryExists) {
    log.info(`  - Binary:    ${binaryPath}`);
  }
  if (dataDirExists && !options.keepConfig) {
    log.info(`  - Data:      ${dataDir}`);
  }
  if (options.keepConfig && dataDirExists) {
    log.info(`  - (keeping)  ${dataDir}`);
  }
  log.info("");

  // Dry run - just show what would be removed
  if (options.dryRun) {
    log.info("Dry run complete. No files were removed.");
    return;
  }

  // Confirm uninstall unless --yes flag
  if (!options.yes) {
    const shouldUninstall = await confirm({
      message: "Are you sure you want to uninstall atomic?",
      initialValue: false,
    });

    if (isCancel(shouldUninstall) || !shouldUninstall) {
      cancel("Uninstall cancelled.");
      return;
    }
  }

  try {
    // Remove data directory (unless --keep-config)
    if (dataDirExists && !options.keepConfig) {
      log.step("Removing data directory...");
      await rm(dataDir, { recursive: true, force: true });
      log.success("Data directory removed");
    }

    // Remove binary (self-deletion)
    if (binaryExists) {
      log.step("Removing binary...");

      if (isWindows()) {
        // Windows: Cannot delete running executable, rename it instead
        const deletePath = binaryPath + ".delete";

        // Clean up any previous .delete file
        if (existsSync(deletePath)) {
          try {
            await rm(deletePath, { force: true });
          } catch {
            // Ignore - may be locked
          }
        }

        // Rename current executable
        await rename(binaryPath, deletePath);
        log.success("Binary marked for deletion");
        log.warn("");
        log.warn("Note: The binary has been renamed to:");
        log.warn(`  ${deletePath}`);
        log.warn("");
        log.warn("Please delete this file manually, or restart your computer");
        log.warn("to complete the uninstallation.");
      } else {
        // Unix: Can delete self directly
        await unlink(binaryPath);
        log.success("Binary removed");
      }
    }

    log.success("");
    log.success("Atomic has been uninstalled.");

    // Show PATH cleanup instructions
    note(getPathCleanupInstructions(), "PATH Cleanup (Manual)");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`Uninstall failed: ${message}`);

    if (message.includes("permission") || message.includes("EACCES") || message.includes("EPERM")) {
      log.info("");
      log.info("Permission denied. Try running with elevated privileges:");
      if (isWindows()) {
        log.info("  Run PowerShell as Administrator and try again");
      } else {
        log.info("  sudo atomic uninstall");
      }
      log.info("");
      log.info("Or manually delete the files shown above.");
    }

    process.exit(1);
  }
}
