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
import { dirname, join, resolve } from "path";
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
} from "@/services/config/index.ts";
import { displayBanner } from "@/theme/banner/index.ts";
import { pathExists } from "@/services/system/copy.ts";
import { detectInstallationType, getConfigRoot } from "@/services/config/config-path.ts";
import { isWindows, isWslInstalled, WSL_INSTALL_URL, getOppositeScriptExtension } from "@/services/system/detect.ts";
import { trackAtomicCommand, handleTelemetryConsent, type AgentType } from "@/services/telemetry/index.ts";
import { saveAtomicConfig } from "@/services/config/atomic-config.ts";
import { upsertTrustedWorkspacePath } from "@/services/config/settings.ts";
import {
  ensureAtomicGlobalAgentConfigsForInstallType,
  getTemplateAgentFolder,
} from "@/services/config/atomic-global-config.ts";
import {
  getScmPrefix,
  reconcileScmVariants,
  syncProjectScmSkills,
} from "./scm.ts";
import {
  applyManagedOnboardingFiles,
  hasProjectOnboardingFiles,
} from "./onboarding.ts";

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

export {
  applyManagedOnboardingFiles,
  hasProjectOnboardingFiles,
} from "./onboarding.ts";
export {
  getScmPrefix,
  reconcileScmVariants,
} from "./scm.ts";

function decodeSpawnOutput(output: Uint8Array): string {
  return new TextDecoder().decode(output).trim();
}

function runPlaywrightCliInstall(): void {
  const playwrightCliPath = Bun.which("playwright-cli");
  const command = playwrightCliPath
    ? [playwrightCliPath, "install"]
    : [process.execPath, "x", "@playwright/cli", "install"];

  const result = Bun.spawnSync({
    cmd: command,
    stdout: "pipe",
    stderr: "pipe",
  });

  if (result.success) {
    return;
  }

  const stderr = decodeSpawnOutput(result.stderr);
  const stdout = decodeSpawnOutput(result.stdout);
  const details = stderr || stdout || "No command output captured.";
  throw new Error(`Failed to run '${command.join(" ")}': ${details}`);
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

    await ensureAtomicGlobalAgentConfigsForInstallType(
      detectInstallationType(),
      configRoot
    );

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

    await applyManagedOnboardingFiles(agentKey, targetDir, configRoot);

    // Save SCM selection to .atomic/settings.json
    await saveAtomicConfig(targetDir, {
      scm: scmType,
    });
    upsertTrustedWorkspacePath(resolve(targetDir), agentKey);

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

  const playwrightInstallSpinner = spinner();
  playwrightInstallSpinner.start("Installing Playwright browser runtime...");
  try {
    runPlaywrightCliInstall();
    playwrightInstallSpinner.stop("Playwright browser runtime installed");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    playwrightInstallSpinner.stop("Playwright browser runtime installation failed");
    log.warn(`Could not run 'playwright-cli install': ${message}`);
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
