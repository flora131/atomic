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
import { rm } from "fs/promises";

import { AGENT_CONFIG, type AgentKey, getAgentKeys, isValidAgent } from "../config";
import { displayBanner } from "../utils/banner";
import { copyDir, copyFile, pathExists } from "../utils/copy";
import { isWindows, isWslInstalled, WSL_INSTALL_URL } from "../utils/detect";

interface InitOptions {
  showBanner?: boolean;
  preSelectedAgent?: AgentKey;
  configNotFoundMessage?: string;
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

  // Confirm directory
  const confirmDir = await confirm({
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

  // Check if folder already exists
  const targetFolder = join(targetDir, agent.folder);
  const folderExists = await pathExists(targetFolder);

  if (folderExists) {
    const overwrite = await confirm({
      message: `${agent.folder} already exists. Overwrite?`,
      initialValue: false,
      active: "Yes, overwrite",
      inactive: "No, cancel",
    });

    if (isCancel(overwrite)) {
      cancel("Operation cancelled.");
      process.exit(0);
    }

    if (!overwrite) {
      cancel("Operation cancelled. Existing config preserved.");
      process.exit(0);
    }
  }

  // Copy files with spinner
  const s = spinner();
  s.start("Copying configuration files...");

  try {
    const configRoot = getConfigRoot();
    const sourceFolder = join(configRoot, agent.folder);

    // Clear existing folder if overwriting to prevent stale files
    if (folderExists) {
      await rm(targetFolder, { recursive: true, force: true });
    }

    // Copy the main config folder
    await copyDir(sourceFolder, targetFolder, {
      exclude: agent.exclude,
      skipOppositeScripts: true,
    });

    // Copy additional files
    for (const file of agent.additional_files) {
      const srcFile = join(configRoot, file);
      const destFile = join(targetDir, file);

      if (await pathExists(srcFile)) {
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
