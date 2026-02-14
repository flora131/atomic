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

import {
  AGENT_CONFIG,
  type AgentKey,
  getAgentKeys,
  isValidAgent,
  SCM_CONFIG,
  type SourceControlType,
  getScmKeys,
  isValidScm,
} from "../config";
import { displayBanner } from "../utils/banner";
import { copyFile, pathExists, isFileEmpty } from "../utils/copy";
import { getConfigRoot } from "../utils/config-path";
import { isWindows, isWslInstalled, WSL_INSTALL_URL, getOppositeScriptExtension } from "../utils/detect";
import { mergeJsonFile } from "../utils/merge";
import { trackAtomicCommand, handleTelemetryConsent, type AgentType } from "../utils/telemetry";
import { saveAtomicConfig } from "../utils/atomic-config";

interface InitOptions {
  showBanner?: boolean;
  preSelectedAgent?: AgentKey;
  /** Pre-selected source control type (skip SCM selection prompt) */
  preSelectedScm?: SourceControlType;
  configNotFoundMessage?: string;
  /** Force overwrite of preserved files (bypass preservation/merge logic) */
  force?: boolean;
  /** Auto-confirm all prompts (non-interactive mode for CI/testing) */
  yes?: boolean;
}



/**
 * Get the appropriate SCM template directory based on OS and SCM selection.
 *
 * For Sapling on Windows, uses the windows-specific variant that includes
 * full paths to avoid the PowerShell `sl` alias conflict.
 */
function getScmTemplatePath(scmType: SourceControlType): string {
  if (scmType === "sapling-phabricator" && isWindows()) {
    return "sapling-phabricator-windows";
  }
  return scmType;
}

/**
 * Get the commands subfolder name for a given agent type.
 *
 * Different agents use different folder names for commands:
 * - Claude: .claude/commands/
 * - OpenCode: .opencode/command/ (singular)
 * - Copilot: .github/skills/
 */
function getCommandsSubfolder(agentKey: AgentKey): string {
  switch (agentKey) {
    case "claude":
      return "commands";
    case "opencode":
      return "command";
    case "copilot":
      return "skills";
    default:
      return "commands";
  }
}

interface CopyScmCommandsOptions {
  scmType: SourceControlType;
  agentKey: AgentKey;
  agentFolder: string;
  targetDir: string;
  configRoot: string;
}

/**
 * Copy SCM-specific command files to the target directory.
 *
 * This copies the appropriate commit/PR commands based on the selected SCM type.
 */
async function copyScmCommands(options: CopyScmCommandsOptions): Promise<void> {
  const { scmType, agentKey, agentFolder, targetDir, configRoot } = options;

  const scmTemplatePath = getScmTemplatePath(scmType);
  const commandsSubfolder = getCommandsSubfolder(agentKey);

  // Source: templates/scm/<scm-type>/<agent-folder>/<commands-subfolder>/
  const srcDir = join(
    configRoot,
    "templates",
    "scm",
    scmTemplatePath,
    agentFolder,
    commandsSubfolder
  );

  // Destination: <target>/<agent-folder>/<commands-subfolder>/
  const destDir = join(targetDir, agentFolder, commandsSubfolder);

  // Check if source directory exists
  if (!(await pathExists(srcDir))) {
    if (process.env.DEBUG === "1") {
      console.log(`[DEBUG] SCM template not found: ${srcDir}`);
    }
    return;
  }

  // Ensure destination directory exists
  await mkdir(destDir, { recursive: true });

  // Copy all files from SCM template
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(srcDir, entry.name);
    const destPath = join(destDir, entry.name);

    if (entry.isDirectory()) {
      // For Copilot skills, we need to copy the skill directories
      await copyDirPreserving(srcPath, destPath);
    } else {
      await copyFile(srcPath, destPath);
    }
  }
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

  // Select source control type (after agent selection)
  let scmType: SourceControlType;

  if (options.preSelectedScm) {
    // Pre-selected SCM - validate and skip selection prompt
    if (!isValidScm(options.preSelectedScm)) {
      cancel(`Unknown source control: ${options.preSelectedScm}`);
      process.exit(1);
    }
    scmType = options.preSelectedScm;
    log.info(`Using ${SCM_CONFIG[scmType].displayName} for source control...`);
  } else if (autoConfirm) {
    // Auto-confirm mode defaults to GitHub
    scmType = "github";
    log.info("Defaulting to GitHub/Git for source control...");
  } else {
    // Interactive selection
    const scmOptions = getScmKeys().map((key) => ({
      value: key,
      label: SCM_CONFIG[key].displayName,
      hint: `Uses ${SCM_CONFIG[key].cliTool} + ${SCM_CONFIG[key].reviewSystem}`,
    }));

    const selectedScm = await select({
      message: "Select your source control system:",
      options: scmOptions,
    });

    if (isCancel(selectedScm)) {
      cancel("Operation cancelled.");
      process.exit(0);
    }

    scmType = selectedScm as SourceControlType;
  }

  // Show Phabricator configuration warning if Sapling is selected
  if (scmType === "sapling-phabricator") {
    const arcconfigPath = join(targetDir, ".arcconfig");
    const hasArcconfig = await pathExists(arcconfigPath);

    if (!hasArcconfig) {
      log.warn(
        "Note: Sapling + Phabricator requires .arcconfig in your repository root.\n" +
          "See: https://www.phacility.com/phabricator/ for Phabricator setup."
      );
    }
  }

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

  // Telemetry consent prompt (only on first run)
  // Skip in autoConfirm mode - respect non-interactive intent (no implicit consent)
  if (!autoConfirm) {
    try {
      await handleTelemetryConsent();
    } catch {
      // Fail-safe: consent prompt failure shouldn't block CLI operation
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

    // Copy SCM-specific command files
    await copyScmCommands({
      scmType,
      agentKey,
      agentFolder: agent.folder,
      targetDir,
      configRoot,
    });

    // Save SCM selection to .atomic.json
    await saveAtomicConfig(targetDir, {
      scm: scmType,
      agent: agentKey,
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

    // Track successful init command
    trackAtomicCommand("init", agentKey as AgentType, true);
  } catch (error) {
    // Track failed init command before exiting
    trackAtomicCommand("init", agentKey as AgentType, false);

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
