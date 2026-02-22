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
import { mkdir, readdir, rm } from "fs/promises";

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
import { copyFile, pathExists } from "../utils/copy";
import { detectInstallationType, getConfigRoot } from "../utils/config-path";
import { isWindows, isWslInstalled, WSL_INSTALL_URL, getOppositeScriptExtension } from "../utils/detect";
import { trackAtomicCommand, handleTelemetryConsent, type AgentType } from "../telemetry";
import { saveAtomicConfig } from "../utils/atomic-config";
import {
  ensureAtomicGlobalAgentConfigs,
  getTemplateAgentFolder,
} from "../utils/atomic-global-config";

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

const SCM_PREFIX_BY_TYPE: Record<SourceControlType, "gh-" | "sl-"> = {
  github: "gh-",
  sapling: "sl-",
};

function getScmPrefix(scmType: SourceControlType): "gh-" | "sl-" {
  return SCM_PREFIX_BY_TYPE[scmType];
}

function isManagedScmEntry(name: string): boolean {
  return name.startsWith("gh-") || name.startsWith("sl-");
}

interface ReconcileScmVariantsOptions {
  scmType: SourceControlType;
  agentFolder: string;
  skillsSubfolder: string;
  targetDir: string;
  configRoot: string;
}

/**
 * Keep only selected SCM variants (gh-* or sl-*) for managed entries.
 *
 * User-defined or unmanaged entries are preserved.
 */
export async function reconcileScmVariants(options: ReconcileScmVariantsOptions): Promise<void> {
  const { scmType, agentFolder, skillsSubfolder, targetDir, configRoot } = options;
  const selectedPrefix = getScmPrefix(scmType);
  const srcDir = join(configRoot, agentFolder, skillsSubfolder);
  const destDir = join(targetDir, agentFolder, skillsSubfolder);

  if (!(await pathExists(srcDir))) {
    if (process.env.DEBUG === "1") {
      console.log(`[DEBUG] SCM source directory not found: ${srcDir}`);
    }
    return;
  }

  if (!(await pathExists(destDir))) return;

  const sourceEntries = await readdir(srcDir, { withFileTypes: true });
  const managedEntries = new Set(
    sourceEntries
      .filter((entry) => isManagedScmEntry(entry.name))
      .map((entry) => entry.name)
  );
  if (managedEntries.size === 0) return;

  const targetEntries = await readdir(destDir, { withFileTypes: true });
  for (const entry of targetEntries) {
    if (!managedEntries.has(entry.name)) continue;
    if (entry.name.startsWith(selectedPrefix)) continue;

    const entryPath = join(destDir, entry.name);
    await rm(entryPath, { recursive: true, force: true });
    if (process.env.DEBUG === "1") {
      console.log(`[DEBUG] Removed SCM variant not selected (${scmType}): ${entryPath}`);
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

interface SyncProjectScmSkillsOptions {
  scmType: SourceControlType;
  sourceSkillsDir: string;
  targetSkillsDir: string;
}

/**
 * Copy only SCM-managed skill variants for the selected source control.
 */
async function syncProjectScmSkills(options: SyncProjectScmSkillsOptions): Promise<number> {
  const { scmType, sourceSkillsDir, targetSkillsDir } = options;
  const selectedPrefix = getScmPrefix(scmType);

  if (!(await pathExists(sourceSkillsDir))) {
    return 0;
  }

  await mkdir(targetSkillsDir, { recursive: true });

  const entries = await readdir(sourceSkillsDir, { withFileTypes: true });
  let copiedCount = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.startsWith(selectedPrefix)) continue;

    const srcPath = join(sourceSkillsDir, entry.name);
    const destPath = join(targetSkillsDir, entry.name);
    await copyDirPreserving(srcPath, destPath);
    copiedCount += 1;
  }

  return copiedCount;
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
  if (scmType === "sapling") {
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
      message: `Configure ${agent.name} source control skills in ${targetDir}?`,
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

  // --force bypasses update confirmation prompts.
  const shouldForce = options.force ?? false;

  if (folderExists && !shouldForce && !autoConfirm) {
    const update = await confirm({
      message: `${agent.folder} already exists. Update source control skills?`,
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
  }

  // Configure source control skills with spinner
  const s = spinner();
  s.start("Configuring source control skills...");

  try {
    const configRoot = getConfigRoot();

    // Ensure global baseline skills/agents are available in ~/.atomic
    // for installed builds (binary/npm).
    if (detectInstallationType() !== "source") {
      await ensureAtomicGlobalAgentConfigs(configRoot);
    }

    const templateAgentFolder = getTemplateAgentFolder(agentKey);
    const sourceSkillsDir = join(configRoot, templateAgentFolder, "skills");
    const targetSkillsDir = join(targetFolder, "skills");

    const copiedCount = await syncProjectScmSkills({
      scmType,
      sourceSkillsDir,
      targetSkillsDir,
    });

    if (copiedCount === 0) {
      throw new Error(
        `No ${getScmPrefix(scmType)}* skills found in ${sourceSkillsDir}`
      );
    }

    // Keep SCM-specific managed command/skill variants aligned with selected SCM
    await reconcileScmVariants({
      scmType,
      agentFolder: agent.folder,
      skillsSubfolder: "skills",
      targetDir,
      configRoot,
    });

    // Save SCM selection to .atomic/settings.json
    await saveAtomicConfig(targetDir, {
      scm: scmType,
      agent: agentKey,
    });

    s.stop("Source control skills configured successfully!");

    // Track successful init command
    trackAtomicCommand("init", agentKey as AgentType, true);
  } catch (error) {
    // Track failed init command before exiting
    trackAtomicCommand("init", agentKey as AgentType, false);

    s.stop("Failed to configure source control skills");
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
    `${agent.name} source control skills configured in ${agent.folder}/skills\n\n` +
      `Selected workflow: ${SCM_CONFIG[scmType].displayName}\n\n` +
      `Run '${agent.cmd}' to start the agent.`,
    "Success"
  );

  outro("You're all set!");
}
