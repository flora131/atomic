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
import { join, resolve } from "path";

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
import { pathExists } from "@/services/system/copy.ts";
import { detectInstallationType, getConfigRoot } from "@/services/config/config-path.ts";
import { isWindows, isWslInstalled, WSL_INSTALL_URL } from "@/services/system/detect.ts";
import { saveAtomicConfig } from "@/services/config/atomic-config.ts";
import { upsertTrustedWorkspacePath } from "@/services/config/settings.ts";
import {
  ensureAtomicGlobalAgentConfigsForInstallType,
  getTemplateAgentFolder,
} from "@/services/config/atomic-global-config.ts";
import {
  getScmPrefix,
  installLocalScmSkills,
  reconcileScmVariants,
  syncProjectScmSkills,
} from "./scm.ts";
import {
  applyManagedOnboardingFiles,
  hasProjectOnboardingFiles,
} from "./onboarding.ts";
import { supportsTrueColor, supports256Color, supportsColor } from "@/services/system/detect.ts";

const ATOMIC_BLOCK_LOGO = [
  "█▀▀█ ▀▀█▀▀ █▀▀█ █▀▄▀█ ▀█▀ █▀▀",
  "█▄▄█   █   █  █ █ ▀ █  █  █  ",
  "▀  ▀   ▀   ▀▀▀▀ ▀   ▀ ▀▀▀ ▀▀▀",
];

// Catppuccin-inspired gradient (dark terminal)
const GRADIENT_DARK = [
  "#f5e0dc", "#f2cdcd", "#f5c2e7", "#cba6f7",
  "#b4befe", "#89b4fa", "#74c7ec", "#89dceb", "#94e2d5",
];

// Catppuccin-inspired gradient (light terminal)
const GRADIENT_LIGHT = [
  "#dc8a78", "#dd7878", "#ea76cb", "#8839ef",
  "#7287fd", "#1e66f5", "#209fb5", "#04a5e5", "#179299",
];

// 256-color approximation of the gradient
const GRADIENT_256 = [224, 218, 219, 183, 147, 111, 117, 159, 115];

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

function interpolateHex(gradient: string[], t: number): [number, number, number] {
  const pos = Math.max(0, Math.min(1, t)) * (gradient.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, gradient.length - 1);
  const frac = pos - lo;
  const [r1, g1, b1] = hexToRgb(gradient[lo]!);
  const [r2, g2, b2] = hexToRgb(gradient[hi]!);
  return [
    Math.round(r1 + (r2 - r1) * frac),
    Math.round(g1 + (g2 - g1) * frac),
    Math.round(b1 + (b2 - b1) * frac),
  ];
}

function interpolate256(gradient: number[], t: number): number {
  const pos = Math.max(0, Math.min(1, t)) * (gradient.length - 1);
  const lo = Math.floor(pos);
  return gradient[lo]!;
}

function colorizeLineTrueColor(line: string, gradient: string[]): string {
  let out = "";
  const len = line.length;
  for (let i = 0; i < len; i++) {
    const ch = line[i]!;
    if (ch === " ") {
      out += ch;
      continue;
    }
    const [r, g, b] = interpolateHex(gradient, len > 1 ? i / (len - 1) : 0);
    out += `\x1b[38;2;${r};${g};${b}m${ch}`;
  }
  return out + "\x1b[0m";
}

function colorizeLine256(line: string, gradient: number[]): string {
  let out = "";
  const len = line.length;
  for (let i = 0; i < len; i++) {
    const ch = line[i]!;
    if (ch === " ") {
      out += ch;
      continue;
    }
    const code = interpolate256(gradient, len > 1 ? i / (len - 1) : 0);
    out += `\x1b[38;5;${code}m${ch}`;
  }
  return out + "\x1b[0m";
}

function displayBlockBanner(): void {
  const isDark = !(process.env.COLORFGBG ?? "").startsWith("0;");
  const truecolor = supportsTrueColor();
  const color256 = supports256Color();
  const hasColor = supportsColor();

  console.log();
  for (const line of ATOMIC_BLOCK_LOGO) {
    if (truecolor) {
      const gradient = isDark ? GRADIENT_DARK : GRADIENT_LIGHT;
      console.log(`  ${colorizeLineTrueColor(line, gradient)}`);
    } else if (color256 && hasColor) {
      console.log(`  ${colorizeLine256(line, GRADIENT_256)}`);
    } else {
      console.log(`  ${line}`);
    }
  }
  console.log();
}

/**
 * Thrown when the user cancels an interactive prompt during init.
 *
 * When `initCommand` is invoked from a caller that sets
 * `callerHandlesExit: true` (e.g. the auto-init path inside
 * `chatCommand`), cancellation throws this error instead of calling
 * `process.exit(0)` so the caller can decide what to do.
 */
export class InitCancelledError extends Error {
  constructor(message = "Operation cancelled.") {
    super(message);
    this.name = "InitCancelledError";
  }
}

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
  /**
   * When true, throw `InitCancelledError` instead of calling
   * `process.exit()` on user cancellation.  This allows callers like
   * `chatCommand` auto-init to handle the cancellation gracefully.
   */
  callerHandlesExit?: boolean;
}

export {
  applyManagedOnboardingFiles,
  hasProjectOnboardingFiles,
} from "./onboarding.ts";
export {
  getScmPrefix,
  reconcileScmVariants,
} from "./scm.ts";

/**
 * Run the interactive init command
 */
export async function initCommand(options: InitOptions = {}): Promise<void> {
  const { showBanner = true, configNotFoundMessage, callerHandlesExit = false } = options;

  /** Exit-or-throw helper: when a caller (e.g. chatCommand auto-init) sets
   *  `callerHandlesExit`, we throw so the caller can handle the cancellation.
   *  Otherwise we call `process.exit()` directly (standalone `atomic init`). */
  function exitOrThrow(code: number, message?: string): never {
    if (callerHandlesExit) {
      throw new InitCancelledError(message);
    }
    process.exit(code);
  }

  // Display banner
  if (showBanner) {
    displayBlockBanner();
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
      exitOrThrow(1, `Unknown agent: ${options.preSelectedAgent}`);
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
      exitOrThrow(0);
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
      exitOrThrow(1, `Unknown source control: ${options.preSelectedScm}`);
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
      exitOrThrow(0);
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
      exitOrThrow(0);
    }

    if (!confirmDir) {
      cancel("Operation cancelled.");
      exitOrThrow(0);
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
      exitOrThrow(0);
    }

    if (!update) {
      cancel("Operation cancelled. Existing config preserved.");
      exitOrThrow(0);
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

    // Best-effort template copy: source checkouts still carry the bundled
    // gh-*/sl-* skill templates, but binary and npm installs no longer do
    // (they live in the skills CLI repo). `installLocalScmSkills` below
    // handles the binary/npm case by invoking `npx skills add` — so a zero
    // copy here is not an error, just a signal that the template isn't
    // bundled for this install type.
    await syncProjectScmSkills({
      scmType,
      sourceSkillsDir,
      targetSkillsDir,
    });

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

    // Install SCM-specific skill variants locally for the active agent via
    // `npx skills add` (best-effort: a failure is surfaced as a warning).
    //
    // Source checkouts already have the bundled skills on disk and the
    // template-copy above has placed the selected variants into `targetDir`;
    // skip the network-backed skills CLI in that case to keep dev iteration
    // fast and offline-friendly.
    if (detectInstallationType() !== "source") {
      const skillsSpinner = spinner();
      skillsSpinner.start(
        `Installing ${getScmPrefix(scmType)}* skills locally for ${agent.name}...`,
      );
      const skillsResult = await installLocalScmSkills({
        scmType,
        agentKey,
        cwd: targetDir,
      });
      if (skillsResult.success) {
        skillsSpinner.stop(
          `Installed ${getScmPrefix(scmType)}* skills locally for ${agent.name}`,
        );
      } else {
        skillsSpinner.stop(
          `Skipped local ${getScmPrefix(scmType)}* skills install (${skillsResult.details})`,
        );
      }
    }
  } catch (error) {
    s.stop("Failed to configure source control skills");
    console.error(
      error instanceof Error ? error.message : "Unknown error occurred"
    );
    exitOrThrow(1, error instanceof Error ? error.message : "Unknown error occurred");
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
