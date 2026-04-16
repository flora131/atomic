/**
 * Agent configuration definitions for atomic CLI
 */

import { stat } from "node:fs/promises";
import { join } from "node:path";

export interface AgentConfig {
  /** Display name for the agent */
  name: string;
  /** Command to execute the agent */
  cmd: string;
  /** Flags used when spawning the agent in interactive chat mode */
  chat_flags: string[];
  /** Environment variables to set when spawning the agent (merged with process env) */
  env_vars: Record<string, string>;
  /** Config folder relative to repo root */
  folder: string;
  /** URL for installation instructions */
  install_url: string;
  /** Paths to exclude when copying (relative to folder) */
  exclude: string[];
  /** Project files managed by `atomic init` for provider onboarding */
  onboarding_files: Array<{
    source: string;
    destination: string;
    merge: boolean;
  }>;
}

const AGENT_KEYS = ["claude", "opencode", "copilot"] as const;
export type AgentKey = (typeof AGENT_KEYS)[number];

export const AGENT_CONFIG: Record<AgentKey, AgentConfig> = {
  claude: {
    name: "Claude Code",
    cmd: "claude",
    chat_flags: [
      "--allow-dangerously-skip-permissions",
      "--dangerously-skip-permissions",
    ],
    env_vars: {},
    folder: ".claude",
    install_url: "https://code.claude.com/docs/en/setup",
    exclude: [],
    onboarding_files: [
      {
        source: ".mcp.json",
        destination: ".mcp.json",
        merge: true,
      },
      {
        source: ".claude/settings.json",
        destination: ".claude/settings.json",
        merge: true,
      },
      {
        source: ".claude/settings.json",
        destination: "~/.claude/settings.json",
        merge: true,
      },
    ],
  },
  opencode: {
    name: "OpenCode",
    cmd: "opencode",
    chat_flags: [],
    env_vars: { OPENCODE_EXPERIMENTAL_LSP_TOOL: "true" },
    folder: ".opencode",
    install_url: "https://opencode.ai",
    exclude: [".gitignore", "package.json"],
    onboarding_files: [
      {
        source: ".opencode/opencode.json",
        destination: ".opencode/opencode.json",
        merge: true,
      },
    ],
  },
  copilot: {
    name: "GitHub Copilot CLI",
    cmd: "copilot",
    chat_flags: ["--add-dir", ".", "--yolo", "--experimental"],
    env_vars: {
      COPILOT_ALLOW_ALL: "true",
    },
    folder: ".github",
    install_url:
      "https://github.com/github/copilot-cli?tab=readme-ov-file#installation",
    exclude: ["workflows", "dependabot.yml"],
    onboarding_files: [
      {
        source: ".mcp.json",
        destination: ".mcp.json",
        merge: true,
      },
    ],
  },
};

/**
 * Per-provider overrides that users can set in `.atomic/settings.json`
 * (local) or `~/.atomic/settings.json` (global).
 *
 * - `chatFlags`: when set, replaces the agent's default `chat_flags` entirely.
 * - `envVars`: environment variables merged on top of the agent's default
 *   `env_vars` (user values win on conflict).
 */
export interface ProviderOverrides {
  chatFlags?: string[];
  envVars?: Record<string, string>;
}

export function isValidAgent(key: string): key is AgentKey {
  return key in AGENT_CONFIG;
}

export function getAgentConfig(key: AgentKey): AgentConfig {
  return AGENT_CONFIG[key];
}

export function getAgentKeys(): AgentKey[] {
  return [...AGENT_KEYS];
}

/**
 * Source Control Management (SCM) configuration definitions
 */

/** SCM keys for iteration */
const SCM_KEYS = ["github", "sapling"] as const;

/** Supported source control types — derived from SCM_KEYS tuple. */
export type SourceControlType = (typeof SCM_KEYS)[number];

export interface ScmConfig {
  /** Display name for prompts */
  displayName: string;
  /** Primary CLI tool (git or sl) */
  cliTool: string;
  /** Code review system (github, phabricator) */
  reviewSystem: string;
  /** Directory marker used to detect this SCM in a repo (e.g. `.git`, `.sl`) */
  detectDir: string;
}

export const SCM_CONFIG: Record<SourceControlType, ScmConfig> = {
  github: {
    displayName: "GitHub / Git",
    cliTool: "git",
    reviewSystem: "github",
    detectDir: ".git",
  },
  sapling: {
    displayName: "Sapling + Phabricator",
    cliTool: "sl",
    reviewSystem: "phabricator",
    detectDir: ".sl",
  },
};

/**
 * SCM-variant skill names, grouped by source control type.
 *
 * These are the skills that `installGlobalSkills` removes from the global
 * scope after the initial install, and that `installLocalScmSkills`
 * re-installs per-project based on the user's selected SCM. Passed to
 * `npx skills add --skill <name>` as explicit names (the skills CLI does
 * not support glob patterns like `gh-*`).
 */
export const SCM_SKILLS_BY_TYPE: Record<SourceControlType, readonly string[]> =
  {
    github: ["gh-commit", "gh-create-pr"],
    sapling: ["sl-commit", "sl-submit-diff"],
  };

/** Flat list of every SCM-variant skill across all source control types. */
export const ALL_SCM_SKILLS: readonly string[] = [
  ...SCM_SKILLS_BY_TYPE.github,
  ...SCM_SKILLS_BY_TYPE.sapling,
];

/**
 * Get all SCM keys for iteration
 */
export function getScmKeys(): SourceControlType[] {
  return [...SCM_KEYS];
}

/**
 * Check if a string is a valid SCM type
 */
export function isValidScm(key: string): key is SourceControlType {
  return key in SCM_CONFIG;
}

/**
 * Detect the SCM type by looking for marker directories in `projectRoot`.
 *
 * Checks each {@link ScmConfig.detectDir} (e.g. `.git`, `.sl`) and returns
 * the first match. Returns `null` when no known marker is found.
 */
export async function detectScmType(
  projectRoot: string,
): Promise<SourceControlType | null> {
  for (const key of getScmKeys()) {
    const markerPath = join(projectRoot, SCM_CONFIG[key].detectDir);
    try {
      await stat(markerPath);
      return key;
    } catch {
      // marker not found — try next
    }
  }
  return null;
}
