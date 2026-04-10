/**
 * Agent configuration definitions for atomic CLI
 */

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
    exclude: [".DS_Store", "settings.json"],
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
    ],
  },
  opencode: {
    name: "OpenCode",
    cmd: "opencode",
    chat_flags: [],
    env_vars: { OPENCODE_EXPERIMENTAL_LSP_TOOL: "true" },
    folder: ".opencode",
    install_url: "https://opencode.ai",
    exclude: [
      "node_modules",
      ".gitignore",
      "bun.lock",
      "package.json",
      ".DS_Store",
      "opencode.json",
    ],
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
    chat_flags: [
      "--add-dir",
      ".",
      "--yolo",
      "--experimental",
      "--no-auto-update",
    ],
    env_vars: {
      COPILOT_ALLOW_ALL: "true",
    },
    folder: ".github",
    install_url:
      "https://github.com/github/copilot-cli?tab=readme-ov-file#installation",
    exclude: ["workflows", "dependabot.yml", ".DS_Store"],
    onboarding_files: [
      {
        source: ".vscode/mcp.json",
        destination: ".vscode/mcp.json",
        merge: true,
      },
    ],
  },
};

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

/** Supported source control types */
export type SourceControlType = "github" | "sapling";
// Future: | 'azure-devops'

/** SCM keys for iteration */
const SCM_KEYS = ["github", "sapling"] as const;

export interface ScmConfig {
  /** Internal identifier */
  name: string;
  /** Display name for prompts */
  displayName: string;
  /** Primary CLI tool (git or sl) */
  cliTool: string;
  /** Code review tool (gh, jf submit, arc diff, etc.) */
  reviewTool: string;
  /** Code review system (github, phabricator) */
  reviewSystem: string;
  /** Directory marker for potential future auto-detection */
  detectDir: string;
  /** Code review command file name */
  reviewCommandFile: string;
  /** Required configuration files */
  requiredConfigFiles?: string[];
}

export const SCM_CONFIG: Record<SourceControlType, ScmConfig> = {
  github: {
    name: "github",
    displayName: "GitHub / Git",
    cliTool: "git",
    reviewTool: "gh",
    reviewSystem: "github",
    detectDir: ".git",
    reviewCommandFile: "create-gh-pr.md",
  },
  sapling: {
    name: "sapling",
    displayName: "Sapling + Phabricator",
    cliTool: "sl",
    reviewTool: "jf submit",
    reviewSystem: "phabricator",
    detectDir: ".sl",
    reviewCommandFile: "submit-diff.md",
    requiredConfigFiles: [".arcconfig", "~/.arcrc"],
  },
};

/** Commands that have SCM-specific variants */
export const SCM_SPECIFIC_COMMANDS = ["commit"];

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
 * Get the configuration for a specific SCM type
 */
export function getScmConfig(key: SourceControlType): ScmConfig {
  return SCM_CONFIG[key];
}
