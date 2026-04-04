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
  getConfigRoot,
} from "@/services/config/config-path.ts";
import {
  getAtomicManagedConfigDirs,
  removeAtomicManagedGlobalAgentConfigs,
} from "@/services/config/atomic-global-config.ts";
import { isWindows } from "@/services/system/detect.ts";
import { cleanupBunTempNativeAddons } from "@/services/system/cleanup.ts";
import { trackAtomicCommand } from "@/services/telemetry/index.ts";
import { removeWorkflowSdk, getGlobalWorkflowsDir } from "@/services/config/workflow-package.ts";
import { getElevatedPrivilegesHint, isPermissionError } from "@/commands/cli/permission-guidance.ts";

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
    log.info("To uninstall atomic, remove it using your package manager.");
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
  const managedConfigDirs = getAtomicManagedConfigDirs();

  const binaryExists = existsSync(binaryPath);
  const dataDirExists = existsSync(dataDir);
  const configRoot = dataDirExists ? getConfigRoot() : null;
  const existingManagedConfigDirs = managedConfigDirs.filter((dir) => existsSync(dir));

  if (
    !binaryExists &&
    !dataDirExists &&
    existingManagedConfigDirs.length === 0
  ) {
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

  for (const dir of existingManagedConfigDirs) {
    if (options.keepConfig) {
      log.info(`  - (keeping)  ${dir}`);
    } else {
      log.info(`  - Managed:   ${dir}`);
    }
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
    // Run independent removal steps in parallel
    log.step("Removing Atomic components...");

    const parallelTasks: Promise<void>[] = [];

    // 1. Remove Atomic-managed provider config entries
    if (!options.keepConfig && configRoot) {
      parallelTasks.push(
        removeAtomicManagedGlobalAgentConfigs(configRoot).then(
          () => log.success("Removed Atomic-managed provider config entries"),
          () => log.warn("Failed to remove Atomic-managed provider config entries")
        )
      );
    } else if (!options.keepConfig && existingManagedConfigDirs.length > 0) {
      log.warn("Skipped native provider-root cleanup because the Atomic data directory is missing.");
    }

    // 2. Remove @bastani/atomic-workflows SDK
    parallelTasks.push(
      (async () => {
        try {
          const globalWorkflowsDir = getGlobalWorkflowsDir();
          const removed = await removeWorkflowSdk(globalWorkflowsDir);
          if (removed) {
            log.success("Removed @bastani/atomic-workflows SDK");
          } else {
            log.warn("Could not remove @bastani/atomic-workflows SDK");
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log.warn(`Could not remove @bastani/atomic-workflows SDK: ${message}`);
        }
      })()
    );

    // 3. Remove data directory (unless --keep-config)
    if (dataDirExists && !options.keepConfig) {
      parallelTasks.push(
        rm(dataDir, { recursive: true, force: true }).then(
          () => log.success("Data directory removed")
        )
      );
    }

    // 4. Clean up orphaned native addon files from temp directory
    parallelTasks.push(cleanupBunTempNativeAddons());

    await Promise.all(parallelTasks);

    // Remove binary last (self-deletion — must happen after everything else)
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

    // Track successful uninstall command
    trackAtomicCommand("uninstall", null, true);

    log.success("");
    log.success("Atomic has been uninstalled.");

    // Show PATH cleanup instructions
    note(getPathCleanupInstructions(), "PATH Cleanup (Manual)");
  } catch (error) {
    // Track failed uninstall command
    trackAtomicCommand("uninstall", null, false);

    const message = error instanceof Error ? error.message : String(error);
    log.error(`Uninstall failed: ${message}`);

    if (isPermissionError(message)) {
      for (const line of getElevatedPrivilegesHint("uninstall", isWindows(), true)) {
        log.info(line);
      }
    }

    process.exit(1);
  }
}
