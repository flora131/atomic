/**
 * Agent configuration definitions for atomic CLI
 */

export interface AgentConfig {
  /** Display name for the agent */
  name: string;
  /** Command to execute the agent */
  cmd: string;
  /** Additional flags to pass when spawning the agent */
  additional_flags: string[];
  /** Config folder relative to repo root */
  folder: string;
  /** URL for installation instructions */
  install_url: string;
  /** Paths to exclude when copying (relative to folder) */
  exclude: string[];
  /** Additional files to copy from repo root */
  additional_files: string[];
  /** Files to skip if they already exist (e.g., CLAUDE.md, AGENTS.md) */
  preserve_files: string[];
  /** Files to merge instead of overwrite (e.g., .mcp.json) */
  merge_files: string[];
}

const AGENT_KEYS = ["claude", "opencode", "copilot"] as const;
export type AgentKey = (typeof AGENT_KEYS)[number];

export const AGENT_CONFIG: Record<AgentKey, AgentConfig> = {
  claude: {
    name: "Claude Code",
    cmd: "claude",
    additional_flags: [],
    folder: ".claude",
    install_url: "https://docs.anthropic.com/en/docs/claude-code/setup",
    exclude: [".DS_Store"],
    additional_files: [".mcp.json"],
    preserve_files: [],
    merge_files: [".mcp.json"],
  },
  opencode: {
    name: "OpenCode",
    cmd: "opencode",
    additional_flags: [],
    folder: ".opencode",
    install_url: "https://opencode.ai",
    exclude: [
      "node_modules",
      ".gitignore",
      "bun.lock",
      "package.json",
      ".DS_Store",
    ],
    additional_files: [],
    preserve_files: [],
    merge_files: [],
  },
  copilot: {
    name: "GitHub Copilot CLI",
    cmd: "copilot",
    additional_flags: ["--add-dir", ".", "--yolo", "--disable-builtin-mcps"],
    folder: ".github",
    install_url:
      "https://github.com/github/copilot-cli?tab=readme-ov-file#installation",
    exclude: ["workflows", "dependabot.yml", "mcp-config.json", ".DS_Store"],
    additional_files: [".github/mcp-config.json"],
    preserve_files: [],
    merge_files: [".github/mcp-config.json"],
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
