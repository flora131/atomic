/**
 * Init command - Interactive setup flow for atomic CLI
 *
 * Uses Catppuccin Mocha palette for visual hierarchy and brand alignment.
 * All color output respects the NO_COLOR environment variable.
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
import { join, resolve } from "node:path";

import {
  AGENT_CONFIG,
  type AgentKey,
  getAgentKeys,
  isValidAgent,
  SCM_CONFIG,
  SCM_SKILLS_BY_TYPE,
  type SourceControlType,
  getScmKeys,
  isValidScm,
} from "../../../services/config/index.ts";
import { pathExists } from "../../../services/system/copy.ts";
import { getConfigRoot } from "../../../services/config/config-path.ts";
import { isWindows, isWslInstalled, WSL_INSTALL_URL } from "../../../services/system/detect.ts";
import { saveAtomicConfig } from "../../../services/config/atomic-config.ts";
import { upsertTrustedWorkspacePath } from "../../../services/config/settings.ts";
import {
  ensureAtomicGlobalAgentConfigs,
  getTemplateAgentFolder,
} from "../../../services/config/atomic-global-config.ts";
import {
  installLocalScmSkills,
  reconcileScmVariants,
  syncProjectScmSkills,
} from "./scm.ts";
import {
  applyManagedOnboardingFiles,
  hasProjectOnboardingFiles,
} from "./onboarding.ts";
import { displayBlockBanner } from "../../../theme/logo.ts";
import { createPainter } from "../../../theme/colors.ts";

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
  const paint = createPainter();

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

  intro(paint("accent", "Configure agent skills & source control", { bold: true }));

  if (configNotFoundMessage) {
    log.info(configNotFoundMessage);
  }

  // ── Agent selection ────────────────────────────────────────────────
  let agentKey: AgentKey;

  if (options.preSelectedAgent) {
    if (!isValidAgent(options.preSelectedAgent)) {
      cancel(`Unknown agent: ${options.preSelectedAgent}`);
      exitOrThrow(1, `Unknown agent: ${options.preSelectedAgent}`);
    }
    agentKey = options.preSelectedAgent;
    log.info(`${paint("accent", "→")} Agent: ${paint("text", AGENT_CONFIG[agentKey].name, { bold: true })}`);
  } else {
    const agentKeys = getAgentKeys();
    const agentOptions = agentKeys.map((key) => ({
      value: key,
      label: AGENT_CONFIG[key].name,
      hint: AGENT_CONFIG[key].install_url.replace("https://", ""),
    }));

    const selectedAgent = await select({
      message: "Which coding agent?",
      options: agentOptions,
    });

    if (isCancel(selectedAgent)) {
      cancel("Cancelled.");
      exitOrThrow(0);
    }

    agentKey = selectedAgent as AgentKey;
  }
  const agent = AGENT_CONFIG[agentKey];
  const targetDir = process.cwd();
  const autoConfirm = options.yes ?? false;

  // ── SCM selection ──────────────────────────────────────────────────
  let scmType: SourceControlType;

  if (options.preSelectedScm) {
    if (!isValidScm(options.preSelectedScm)) {
      cancel(`Unknown source control: ${options.preSelectedScm}`);
      exitOrThrow(1, `Unknown source control: ${options.preSelectedScm}`);
    }
    scmType = options.preSelectedScm;
    log.info(`${paint("accent", "→")} SCM: ${paint("text", SCM_CONFIG[scmType].displayName, { bold: true })}`);
  } else if (autoConfirm) {
    scmType = "github";
    log.info(`${paint("accent", "→")} SCM: ${paint("text", "GitHub / Git", { bold: true })} ${paint("dim", "(default)")}`);
  } else {
    const scmOptions = getScmKeys().map((key) => ({
      value: key,
      label: SCM_CONFIG[key].displayName,
      hint: `${SCM_CONFIG[key].cliTool} + ${SCM_CONFIG[key].reviewSystem}`,
    }));

    const selectedScm = await select({
      message: "Which source control?",
      options: scmOptions,
    });

    if (isCancel(selectedScm)) {
      cancel("Cancelled.");
      exitOrThrow(0);
    }

    scmType = selectedScm as SourceControlType;
  }

  // Sapling-specific warning
  if (scmType === "sapling") {
    const arcconfigPath = join(targetDir, ".arcconfig");
    const hasArcconfig = await pathExists(arcconfigPath);

    if (!hasArcconfig) {
      log.warn(
        `Sapling + Phabricator requires ${paint("text", ".arcconfig", { bold: true })} in your repo root.\n` +
        `${paint("dim", "See: https://www.phacility.com/phabricator/")}`
      );
    }
  }

  // ── Preflight summary ──────────────────────────────────────────────
  const targetFolder = join(targetDir, agent.folder);
  const folderExists = await pathExists(targetFolder);
  const configAction = folderExists ? "update" : "create";

  if (!autoConfirm) {
    const summaryLines = [
      `${paint("dim", "Agent")}   ${paint("text", agent.name, { bold: true })}`,
      `${paint("dim", "SCM")}     ${paint("text", SCM_CONFIG[scmType].displayName, { bold: true })}`,
      `${paint("dim", "Target")}  ${paint("text", targetDir)}`,
      `${paint("dim", "Action")}  ${paint(folderExists ? "warning" : "success", configAction)}`,
    ];
    note(summaryLines.join("\n"), paint("accent", "Setup", { bold: true }));

    const shouldProceed = await confirm({
      message: folderExists
        ? `${agent.folder} exists — update source control skills?`
        : "Proceed with setup?",
      initialValue: true,
    });

    if (isCancel(shouldProceed) || !shouldProceed) {
      cancel("Cancelled.");
      exitOrThrow(0);
    }
  }

  // ── Configure ──────────────────────────────────────────────────────
  const s = spinner();
  s.start("Configuring skills…");

  let skillsInstalled = false;
  let skillsSkipReason = "";

  try {
    const configRoot = getConfigRoot();

    await ensureAtomicGlobalAgentConfigs(configRoot);

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
    await upsertTrustedWorkspacePath(resolve(targetDir), agentKey);

    s.stop(paint("success", "✓", { bold: true }) + " Skills configured");

    // Install SCM-specific skill variants locally for the active agent via
    // `npx skills add` (best-effort: a failure is surfaced as a warning).
    //
    // Source checkouts already have the bundled skills on disk and the
    // template-copy above has placed the selected variants into `targetDir`;
    // skip the network-backed skills CLI in that case to keep dev iteration
    // fast and offline-friendly.
    if (import.meta.dir.includes("node_modules")) {
      const skillsToInstall = SCM_SKILLS_BY_TYPE[scmType];
      const skillsLabel = skillsToInstall.join(", ");
      const skillsSpinner = spinner();
      skillsSpinner.start(
        `Installing ${paint("text", skillsLabel, { bold: true })}…`,
      );
      const skillsResult = await installLocalScmSkills({
        scmType,
        agentKey,
        cwd: targetDir,
      });
      if (skillsResult.success) {
        skillsInstalled = true;
        skillsSpinner.stop(
          paint("success", "✓", { bold: true }) + ` ${skillsLabel} installed`,
        );
      } else {
        skillsSkipReason = skillsResult.details;
        skillsSpinner.stop(
          paint("warning", "○") + ` ${skillsLabel} skipped ${paint("dim", `(${skillsResult.details})`)}`,
        );
      }
    }
  } catch (error) {
    s.stop(paint("error", "✗", { bold: true }) + " Configuration failed");
    console.error(
      error instanceof Error ? error.message : "Unknown error occurred"
    );
    exitOrThrow(1, error instanceof Error ? error.message : "Unknown error occurred");
  }

  // ── WSL warning ────────────────────────────────────────────────────
  if (isWindows() && !isWslInstalled()) {
    log.warn(
      `WSL not detected. Some scripts may require it.\n` +
      `${paint("dim", WSL_INSTALL_URL)}`
    );
  }

  // ── Summary ────────────────────────────────────────────────────────
  const resultLines: string[] = [];
  resultLines.push(
    `${paint("success", "✓")} ${agent.name} skills ${paint("dim", "→")} ${paint("text", agent.folder + "/skills")}`,
  );
  resultLines.push(
    `${paint("success", "✓")} SCM workflow ${paint("dim", "→")} ${paint("text", SCM_CONFIG[scmType].displayName)}`,
  );

  if (import.meta.dir.includes("node_modules")) {
    if (skillsInstalled) {
      resultLines.push(
        `${paint("success", "✓")} Local skills installed`,
      );
    } else {
      resultLines.push(
        `${paint("warning", "○")} Local skills skipped ${paint("dim", skillsSkipReason ? `(${skillsSkipReason})` : "")}`,
      );
    }
  }

  resultLines.push("");
  resultLines.push(
    `${paint("accent", "→")} Run ${paint("text", agent.cmd, { bold: true })} to start the agent`,
  );

  note(resultLines.join("\n"), paint("success", "Ready", { bold: true }));

  outro(paint("dim", "Happy coding ⚛"));
}
