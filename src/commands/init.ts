/**
 * Init command - Interactive setup flow for atomic CLI
 */

import {
  intro,
  outro,
  select,
  confirm,
  spinner,
  isCancel,
  cancel,
  note,
  log,
} from "@clack/prompts";
import { join } from "path";
import { mkdir, readdir } from "fs/promises";

import { AGENT_CONFIG, type AgentKey, getAgentKeys, isValidAgent } from "../config";
import { displayBanner } from "../utils/banner";
import { copyFile, pathExists, isFileEmpty } from "../utils/copy";
import { isWindows, isWslInstalled, WSL_INSTALL_URL, getOppositeScriptExtension } from "../utils/detect";
import { mergeJsonFile } from "../utils/merge";

interface InitOptions {
  showBanner?: boolean;
  preSelectedAgent?: AgentKey;
  configNotFoundMessage?: string;
  /** Force overwrite of preserved files (bypass preservation/merge logic) */
  force?: boolean;
  /** Auto-confirm all prompts (non-interactive mode for CI/testing) */
  yes?: boolean;
}

/**
 * Get the root directory where config folders are stored.
 * Works for both source running and npm-installed packages.
 *
 * Path resolution:
 * - Source: src/commands/init.ts -> ../.. -> repo root
 * - npm installed: node_modules/@bastani/atomic/src/commands/init.ts -> ../.. -> package root
 *
 * The package.json "files" array ensures config folders (.claude, .opencode, etc.)
 * are shipped with the npm package, so this resolution works in both cases.
 */
function getConfigRoot(): string {
  // import.meta.dir gives us the directory containing this file (src/commands)
  // Navigate up two levels to reach the package/repo root
  const root = join(import.meta.dir, "..", "..");

  return root;
}

interface CopyDirPreservingOptions {
  /** Paths to exclude (base names) */
  exclude?: string[];
}

/**
 * Copy a directory, always overwriting template files.
 * User's custom files that are not in the template are preserved (not deleted).
 * This ensures template files are always up-to-date while keeping user additions.
 */
async function copyDirPreserving(
  src: string,
  dest: string,
  options: CopyDirPreservingOptions = {}
): Promise<void> {
  const { exclude = [] } = options;

  await mkdir(dest, { recursive: true });

  const entries = await readdir(src, { withFileTypes: true });
  const oppositeExt = getOppositeScriptExtension();

  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    // Skip excluded files/directories
    if (exclude.includes(entry.name)) continue;

    // Skip scripts for the opposite platform
    if (entry.name.endsWith(oppositeExt)) continue;

    if (entry.isDirectory()) {
      await copyDirPreserving(srcPath, destPath, options);
    } else {
      // Always copy template files (overwrites existing)
      // User's custom files not in template are preserved (not deleted)
      await copyFile(srcPath, destPath);
    }
  }
}

/**
 * Run the interactive init command
 */
export async function initCommand(options: InitOptions = {}): Promise<void> {
  const { showBanner = true, configNotFoundMessage } = options;

  // Display banner
  if (showBanner) {
    displayBanner();
    console.log(); // Add spacing after banner
  }

  // Show intro
  intro("Atomic: Automated Procedures and Memory for AI Coding Agents");
  log.message(
    "Enable multi-hour autonomous coding sessions with the Ralph Wiggum\nMethod using research, plan, implement methodology."
  );

  // Show config not found message if provided (after intro, before agent selection)
  if (configNotFoundMessage) {
    log.info(configNotFoundMessage);
  }

  // Select agent
  let agentKey: AgentKey;

  if (options.preSelectedAgent) {
    // Pre-selected agent - validate and skip selection prompt
    if (!isValidAgent(options.preSelectedAgent)) {
      cancel(`Unknown agent: ${options.preSelectedAgent}`);
      process.exit(1);
    }
    agentKey = options.preSelectedAgent;
    log.info(`Configuring ${AGENT_CONFIG[agentKey].name}...`);
  } else {
    // Interactive selection
    const agentKeys = getAgentKeys();
    const agentOptions = agentKeys.map((key) => ({
      value: key,
      label: AGENT_CONFIG[key].name,
      hint: AGENT_CONFIG[key].install_url.replace("https://", ""),
    }));

    const selectedAgent = await select({
      message: "Select a coding agent to configure:",
      options: agentOptions,
    });

    if (isCancel(selectedAgent)) {
      cancel("Operation cancelled.");
      process.exit(0);
    }

    agentKey = selectedAgent as AgentKey;
  }
  const agent = AGENT_CONFIG[agentKey];
  const targetDir = process.cwd();

  // Auto-confirm mode for CI/testing
  const autoConfirm = options.yes ?? false;

  // Confirm directory
  let confirmDir: boolean | symbol = true;
  if (!autoConfirm) {
    confirmDir = await confirm({
      message: `Install ${agent.name} config files to ${targetDir}?`,
      initialValue: true,
    });

    if (isCancel(confirmDir)) {
      cancel("Operation cancelled.");
      process.exit(0);
    }

    if (!confirmDir) {
      cancel("Operation cancelled.");
      process.exit(0);
    }
  }

  // Check if folder already exists
  const targetFolder = join(targetDir, agent.folder);
  const folderExists = await pathExists(targetFolder);

  // Track if we should force overwrite (either from CLI flag or user confirmation)
  let shouldForce = options.force ?? false;

  if (folderExists && !shouldForce && !autoConfirm) {
    const update = await confirm({
      message: `${agent.folder} already exists. Update config files? (CLAUDE.md/AGENTS.md will be preserved)`,
      initialValue: true,
      active: "Yes, update",
      inactive: "No, cancel",
    });

    if (isCancel(update)) {
      cancel("Operation cancelled.");
      process.exit(0);
    }

    if (!update) {
      cancel("Operation cancelled. Existing config preserved.");
      process.exit(0);
    }

    // User confirmed update (but NOT force - preserved files stay preserved)
    // Note: The shouldForce flag specifically controls whether to bypass preservation.
    // Interactive confirmation to update does NOT set shouldForce to true.
    // Only the --force flag sets shouldForce to true.
  }
  // Note: When autoConfirm is true and folder exists, we proceed with the update
  // but do NOT set shouldForce to true. This preserves the correct behavior where
  // --yes auto-confirms prompts but preserved files (CLAUDE.md/AGENTS.md) are still
  // protected unless --force is also provided.

  // Copy files with spinner
  const s = spinner();
  s.start("Copying configuration files...");

  try {
    const configRoot = getConfigRoot();
    const sourceFolder = join(configRoot, agent.folder);

    // Copy template folder - always overwrites template files
    // User's custom files not in template are preserved (not deleted)
    await copyDirPreserving(sourceFolder, targetFolder, {
      exclude: agent.exclude,
    });

    // Copy additional files with preservation and merge logic
    for (const file of agent.additional_files) {
      const srcFile = join(configRoot, file);
      const destFile = join(targetDir, file);

      if (!(await pathExists(srcFile))) continue;

      const destExists = await pathExists(destFile);
      const shouldPreserve = agent.preserve_files.includes(file);
      const shouldMerge = agent.merge_files.includes(file);

      // Preserved files (CLAUDE.md, AGENTS.md) are only overwritten if:
      // 1. --force flag is set, OR
      // 2. The file is empty (0 bytes or whitespace-only)
      if (shouldPreserve && destExists && !shouldForce) {
        const isEmpty = await isFileEmpty(destFile);
        if (!isEmpty) {
          if (process.env.DEBUG === "1") {
            console.log(`[DEBUG] Preserving non-empty user file: ${file}`);
          }
          continue;
        }
        // File is empty - allow overwrite
        if (process.env.DEBUG === "1") {
          console.log(`[DEBUG] Overwriting empty preserved file: ${file}`);
        }
        await copyFile(srcFile, destFile);
        continue;
      }

      // Handle merge files (e.g., .mcp.json)
      if (shouldMerge && destExists) {
        await mergeJsonFile(srcFile, destFile);
        continue;
      }

      // Force flag bypasses normal existence checks
      if (shouldForce) {
        await copyFile(srcFile, destFile);
        continue;
      }

      // Default: only copy if destination doesn't exist
      if (!destExists) {
        await copyFile(srcFile, destFile);
      }
    }

    s.stop("Configuration files copied successfully!");
  } catch (error) {
    s.stop("Failed to copy configuration files");
    console.error(
      error instanceof Error ? error.message : "Unknown error occurred"
    );
    process.exit(1);
  }

  // Check for WSL on Windows
  if (isWindows() && !isWslInstalled()) {
    note(
      `WSL is not installed. Some scripts may require WSL.\n` +
        `Install WSL: ${WSL_INSTALL_URL}`,
      "Warning"
    );
  }

  // Success message
  note(
    `${agent.name} configuration installed to ${agent.folder}\n\n` +
      `Run '${agent.cmd}' to start the agent.`,
    "Success"
  );

  outro("You're all set!");
}
